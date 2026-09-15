import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgreementAcceptanceMethod,
  AgreementEvidenceType,
  AgreementPartyRole,
  AgreementProvenance,
  AgreementStatus,
  AgreementType,
  AgreementVersionStatus,
  MerchantPaymentMethodKind,
  Prisma,
  RiderAdvanceStatus,
  RiderAssignmentStatus,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import {
  AGREEMENT_CANONICAL_SCHEMA,
  buildRiderAdvanceTerms,
} from '../agreements/agreement-canonical';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { PrismaService } from '../prisma/prisma.service';

const MONEY = (v: unknown) =>
  new Prisma.Decimal((v ?? 0) as Prisma.Decimal.Value).toDecimalPlaces(2);

const PRE_EXPENDITURE: RiderAdvanceStatus[] = [
  RiderAdvanceStatus.PROPOSED,
  RiderAdvanceStatus.CUSTOMER_AUTHORIZED,
  RiderAdvanceStatus.RIDER_ACCEPTED,
];

const POST_EXPENDITURE: RiderAdvanceStatus[] = [
  RiderAdvanceStatus.ADVANCE_RECORDED,
  RiderAdvanceStatus.VENDOR_ACKNOWLEDGED,
  RiderAdvanceStatus.REIMBURSEMENT_DUE,
  RiderAdvanceStatus.REIMBURSED,
];

@Injectable()
export class RiderAdvanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
  ) {}

  private async withSerializableRetry<T>(
    run: () => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await run();
      } catch (err) {
        last = err;
        const retryable =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          (err.code === 'P2034' ||
            (err.code === 'P2010' &&
              /could not serialize|40001|concurrent update/i.test(
                err.message,
              )));
        if (!retryable || i === attempts - 1) throw err;
      }
    }
    throw last;
  }

  async getForOrder(wkOrderId: number, actorUserId: string) {
    const row = await this.prisma.riderAdvance.findFirst({
      where: { wkOrderId, status: { not: RiderAdvanceStatus.CANCELLED } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw new NotFoundException('Rider Advance not found');
    await this.assertCanRead(row, actorUserId);
    return row;
  }

  async getById(id: string, actorUserId: string) {
    const row = await this.prisma.riderAdvance.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Rider Advance not found');
    await this.assertCanRead(row, actorUserId);
    return row;
  }

  /**
   * Stage 3 pickup guard: active RA orders require vendor cash ack before goods release.
   * Non-RA orders: no-op.
   */
  async assertPickupAllowedForOrder(
    wkOrderId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
    const db = tx ?? this.prisma;
    const ra = await db.riderAdvance.findFirst({
      where: {
        wkOrderId,
        status: { not: RiderAdvanceStatus.CANCELLED },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!ra) return { ok: true };
    const allowed: RiderAdvanceStatus[] = [
      RiderAdvanceStatus.VENDOR_ACKNOWLEDGED,
      RiderAdvanceStatus.REIMBURSEMENT_DUE,
      RiderAdvanceStatus.REIMBURSED,
    ];
    if (!allowed.includes(ra.status)) {
      return {
        ok: false,
        code: 'RIDER_ADVANCE_VENDOR_ACK_REQUIRED',
        message:
          'Rider Advance vendor cash acknowledgment is required before pickup handoff',
      };
    }
    return { ok: true };
  }

  /**
   * Called from rider reassignment (same transaction).
   * Pre-expenditure RA → CANCELLED. Post-expenditure → DISPUTED (history preserved).
   * No-op when Stage 4 schema is absent (Stage 0–3 dedicated DBs).
   */
  async invalidateOnReassignmentInTx(
    tx: Prisma.TransactionClient,
    input: {
      fulfillmentId: string;
      previousRiderId: string;
      newRiderId: string;
      actorId?: string | null;
      correlationId?: string;
    },
  ) {
    let rows: Array<{
      id: string;
      status: RiderAdvanceStatus;
      agreementId: string;
      wkOrderId: number;
      fulfillmentId: string;
      actualAdvanceAmount: Prisma.Decimal | null;
      reimbursementPrincipal: Prisma.Decimal | null;
    }>;
    try {
      rows = await tx.riderAdvance.findMany({
        where: {
          fulfillmentId: input.fulfillmentId,
          status: {
            notIn: [
              RiderAdvanceStatus.CANCELLED,
              RiderAdvanceStatus.REIMBURSED,
            ],
          },
        },
      });
    } catch (err) {
      if (isMissingRiderAdvanceRelation(err)) return;
      throw err;
    }
    const now = new Date();
    for (const ra of rows) {
      if (PRE_EXPENDITURE.includes(ra.status)) {
        await tx.riderAdvance.update({
          where: { id: ra.id },
          data: {
            status: RiderAdvanceStatus.CANCELLED,
            cancelledAt: now,
            cancelReason: 'rider_reassigned',
            version: { increment: 1 },
          },
        });
        if (ra.agreementId) {
          await tx.agreement.update({
            where: { id: ra.agreementId },
            data: {
              status: AgreementStatus.CANCELLED,
              cancelledAt: now,
              cancelledBy: input.actorId ?? undefined,
              cancellationReason: 'rider_reassigned',
            },
          });
        }
        await this.events.record({
          tx,
          aggregateType: 'AGREEMENT',
          aggregateId: ra.agreementId,
          wkOrderId: ra.wkOrderId,
          fulfillmentId: ra.fulfillmentId,
          actorId: input.actorId,
          actorType: 'SYSTEM',
          action: 'RIDER_ADVANCE_CANCELLED',
          previousState: ra.status,
          newState: RiderAdvanceStatus.CANCELLED,
          correlationId: input.correlationId,
          metadata: {
            riderAdvanceId: ra.id,
            reason: 'rider_reassigned',
            previousRiderId: input.previousRiderId,
            newRiderId: input.newRiderId,
          },
        });
      } else if (POST_EXPENDITURE.includes(ra.status)) {
        await tx.riderAdvance.update({
          where: { id: ra.id },
          data: {
            status: RiderAdvanceStatus.DISPUTED,
            disputedAt: now,
            disputeReason: 'rider_reassigned_after_advance',
            version: { increment: 1 },
          },
        });
        await this.events.record({
          tx,
          aggregateType: 'AGREEMENT',
          aggregateId: ra.agreementId,
          wkOrderId: ra.wkOrderId,
          fulfillmentId: ra.fulfillmentId,
          actorId: input.actorId,
          actorType: 'SYSTEM',
          action: 'RIDER_ADVANCE_DISPUTED',
          previousState: ra.status,
          newState: RiderAdvanceStatus.DISPUTED,
          correlationId: input.correlationId,
          metadata: {
            riderAdvanceId: ra.id,
            reason: 'rider_reassigned_after_advance',
            preservedActualAdvanceAmount: ra.actualAdvanceAmount?.toFixed(2),
            preservedReimbursementPrincipal:
              ra.reimbursementPrincipal?.toFixed(2) ?? null,
          },
        });
      }
    }
  }

  async authorize(input: {
    wkOrderId: number;
    actorUserId: string;
    maximumAuthorizedAdvance: string | number;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    if (input.idempotencyKey) {
      const prior = await this.prisma.riderAdvance.findUnique({
        where: { authorizeIdempotencyKey: input.idempotencyKey },
      });
      if (prior) return { riderAdvance: prior, idempotent: true };
    }

    const max = MONEY(input.maximumAuthorizedAdvance);
    if (max.lte(0)) {
      throw new BadRequestException(
        'maximumAuthorizedAdvance must be positive',
      );
    }

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            const order = await tx.wkOrder.findUnique({
              where: { id: input.wkOrderId },
              include: { merchant: true, orderItems: true },
            });
            if (!order) throw new NotFoundException('Order not found');
            if (order.userId !== input.actorUserId) {
              throw new ForbiddenException(
                'Only the order customer may authorize Rider Advance',
              );
            }
            if (['cancelled', 'rejected', 'refunded'].includes(order.status)) {
              throw new BadRequestException('Order is terminal');
            }

            await this.assertMerchantEligible(
              tx,
              order.merchantId,
              order.merchant,
            );

            const fulfillment = await tx.orderFulfillment.findUnique({
              where: { wkOrderId: order.id },
            });
            if (!fulfillment?.activeRiderId) {
              throw new BadRequestException({
                code: 'RIDER_NOT_ASSIGNED',
                message:
                  'Active rider assignment required before Rider Advance',
              });
            }
            await tx.$queryRaw`
            SELECT id FROM "order_fulfillments" WHERE id = ${fulfillment.id}::uuid FOR UPDATE
          `;
            const locked = await tx.orderFulfillment.findUniqueOrThrow({
              where: { id: fulfillment.id },
            });
            if (!locked.activeRiderId) {
              throw new BadRequestException('Active rider assignment required');
            }

            const assignment = await tx.riderAssignment.findFirst({
              where: {
                fulfillmentId: locked.id,
                riderId: locked.activeRiderId,
                status: RiderAssignmentStatus.ACTIVE,
                assignmentVersion: locked.assignmentVersion,
              },
            });
            if (!assignment) {
              throw new BadRequestException(
                'Active rider assignment not found',
              );
            }

            const existing = await tx.riderAdvance.findFirst({
              where: {
                wkOrderId: order.id,
                status: { not: RiderAdvanceStatus.CANCELLED },
              },
            });
            if (existing) {
              throw new ConflictException({
                code: 'RIDER_ADVANCE_ALREADY_EXISTS',
                message:
                  'An active Rider Advance already exists for this order',
              });
            }

            const hasCash = await this.hasEnabledCash(tx, order.merchantId);
            const built = buildRiderAdvanceTerms({
              wkOrderId: order.id,
              orderCode: order.orderCode,
              buyerId: order.userId,
              merchantId: order.merchantId,
              merchantName: order.merchant.name,
              riderUserId: locked.activeRiderId,
              riderAssignmentId: assignment.id,
              assignmentVersion: locked.assignmentVersion,
              shopId: order.shopId,
              paymentMethod: order.paymentMethod,
              paymentStatus: order.paymentStatus,
              paymentRef: order.paymentRef,
              totalAmount: order.totalAmount,
              deliveryFee: order.deliveryFee,
              discountAmount: order.discountAmount,
              transactionFeeAmount: order.transactionFeeAmount,
              maximumAuthorizedAdvance: max,
              merchantAllowRiderAdvance: order.merchant.allowRiderAdvance,
              merchantHasCashMethod: hasCash,
              items: order.orderItems.map((item) => ({
                productId: item.productId,
                productName: item.productName,
                variantId: item.variantId,
                quantity: item.quantity,
                price: item.price,
                subtotal: item.subtotal,
              })),
            });

            const agreementId = randomUUID();
            const versionId = randomUUID();
            const advanceId = randomUUID();
            const now = new Date();

            await tx.agreement.create({
              data: {
                id: agreementId,
                agreementType: AgreementType.RIDER_ADVANCE,
                status: AgreementStatus.OFFERED,
                provenance: AgreementProvenance.EXPLICIT_ACCEPTANCE,
                wkOrderId: order.id,
                fulfillmentId: locked.id,
                requiredPartyRoles: [
                  AgreementPartyRole.CUSTOMER,
                  AgreementPartyRole.RIDER,
                ],
              },
            });
            await tx.agreementVersion.create({
              data: {
                id: versionId,
                agreementId,
                versionNumber: 1,
                status: AgreementVersionStatus.OFFERED,
                canonicalSchema: AGREEMENT_CANONICAL_SCHEMA,
                termsSnapshot: built.terms as unknown as Prisma.InputJsonValue,
                termsHash: built.termsHash,
              },
            });
            await tx.agreement.update({
              where: { id: agreementId },
              data: { currentVersionId: versionId },
            });
            await tx.agreementParty.createMany({
              data: [
                {
                  id: randomUUID(),
                  agreementId,
                  role: AgreementPartyRole.CUSTOMER,
                  userId: order.userId,
                },
                {
                  id: randomUUID(),
                  agreementId,
                  role: AgreementPartyRole.RIDER,
                  userId: locked.activeRiderId,
                },
                {
                  id: randomUUID(),
                  agreementId,
                  role: AgreementPartyRole.MERCHANT,
                  merchantId: order.merchantId,
                  historicalLabel: order.merchant.name,
                },
              ],
            });

            await tx.agreementAcceptance.create({
              data: {
                id: randomUUID(),
                agreementVersionId: versionId,
                actorUserId: input.actorUserId,
                partyRole: AgreementPartyRole.CUSTOMER,
                acceptanceMethod: AgreementAcceptanceMethod.MOBILE_CONFIRMATION,
                termsHash: built.termsHash,
                correlationId: input.correlationId,
              },
            });

            await tx.agreementEvidence.create({
              data: {
                id: randomUUID(),
                agreementId,
                agreementVersionId: versionId,
                wkOrderId: order.id,
                evidenceType: AgreementEvidenceType.SYSTEM_EVENT,
                contentHash: hashMeta({
                  kind: 'customer_authorization',
                  max: max.toFixed(2),
                }),
                submittedBy: input.actorUserId,
                finalized: true,
                metadata: {
                  kind: 'customer_authorization',
                  authorizedMaximumAmount: max.toFixed(2),
                  currency: 'PHP',
                },
                idempotencyKey: input.idempotencyKey
                  ? `ra-auth-ev-${input.idempotencyKey}`
                  : undefined,
              },
            });

            const row = await tx.riderAdvance.create({
              data: {
                id: advanceId,
                wkOrderId: order.id,
                fulfillmentId: locked.id,
                agreementId,
                agreementVersionId: versionId,
                customerId: order.userId,
                merchantId: order.merchantId,
                riderId: locked.activeRiderId,
                riderAssignmentId: assignment.id,
                assignmentVersion: locked.assignmentVersion,
                currency: 'PHP',
                authorizedMaximumAmount: max,
                status: RiderAdvanceStatus.CUSTOMER_AUTHORIZED,
                authorizedAt: now,
                authorizeIdempotencyKey: input.idempotencyKey,
                correlationId: input.correlationId,
              },
            });

            await this.events.record({
              tx,
              aggregateType: 'AGREEMENT',
              aggregateId: agreementId,
              wkOrderId: order.id,
              fulfillmentId: locked.id,
              actorId: input.actorUserId,
              actorType: 'CUSTOMER',
              action: 'RIDER_ADVANCE_AUTHORIZED',
              newState: RiderAdvanceStatus.CUSTOMER_AUTHORIZED,
              correlationId: input.correlationId,
              metadata: {
                riderAdvanceId: advanceId,
                authorizedMaximumAmount: max.toFixed(2),
                assignmentVersion: locked.assignmentVersion,
                termsHash: built.termsHash,
              },
            });

            return { riderAdvance: row, idempotent: false };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        input.idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.riderAdvance.findUnique({
          where: { authorizeIdempotencyKey: input.idempotencyKey },
        });
        if (prior) return { riderAdvance: prior, idempotent: true };
      }
      // Concurrent authorize: partial unique active-per-order
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'RIDER_ADVANCE_ALREADY_EXISTS',
          message: 'An active Rider Advance already exists for this order',
        });
      }
      throw err;
    }
  }

  async amendMaximum(input: {
    riderAdvanceId: string;
    actorUserId: string;
    maximumAuthorizedAdvance: string | number;
    correlationId?: string;
  }) {
    const max = MONEY(input.maximumAuthorizedAdvance);
    if (max.lte(0)) {
      throw new BadRequestException(
        'maximumAuthorizedAdvance must be positive',
      );
    }

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
          SELECT id FROM "rider_advances" WHERE id = ${input.riderAdvanceId}::uuid FOR UPDATE
        `;
          const ra = await tx.riderAdvance.findUniqueOrThrow({
            where: { id: input.riderAdvanceId },
          });
          if (ra.customerId !== input.actorUserId) {
            throw new ForbiddenException(
              'Only the authorizing customer may amend maximum',
            );
          }
          if (
            POST_EXPENDITURE.includes(ra.status) ||
            ra.status === RiderAdvanceStatus.CANCELLED ||
            ra.status === RiderAdvanceStatus.DISPUTED
          ) {
            throw new BadRequestException(
              `Cannot amend maximum in status ${ra.status}`,
            );
          }
          if (max.lt(ra.authorizedMaximumAmount) && ra.actualAdvanceAmount) {
            throw new BadRequestException(
              'Cannot reduce maximum below recorded advance',
            );
          }

          const order = await tx.wkOrder.findUniqueOrThrow({
            where: { id: ra.wkOrderId },
            include: { merchant: true, orderItems: true },
          });
          await this.assertAssignmentCurrent(tx, ra);

          const priorVersion = await tx.agreementVersion.findUniqueOrThrow({
            where: { id: ra.agreementVersionId },
          });
          const nextNumber = priorVersion.versionNumber + 1;
          const hasCash = await this.hasEnabledCash(tx, ra.merchantId);
          const built = buildRiderAdvanceTerms({
            wkOrderId: order.id,
            orderCode: order.orderCode,
            buyerId: order.userId,
            merchantId: order.merchantId,
            merchantName: order.merchant.name,
            riderUserId: ra.riderId,
            riderAssignmentId: ra.riderAssignmentId,
            assignmentVersion: ra.assignmentVersion,
            shopId: order.shopId,
            paymentMethod: order.paymentMethod,
            paymentStatus: order.paymentStatus,
            paymentRef: order.paymentRef,
            totalAmount: order.totalAmount,
            deliveryFee: order.deliveryFee,
            discountAmount: order.discountAmount,
            transactionFeeAmount: order.transactionFeeAmount,
            maximumAuthorizedAdvance: max,
            merchantAllowRiderAdvance: order.merchant.allowRiderAdvance,
            merchantHasCashMethod: hasCash,
            items: order.orderItems.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              variantId: item.variantId,
              quantity: item.quantity,
              price: item.price,
              subtotal: item.subtotal,
            })),
          });

          if (priorVersion.status === AgreementVersionStatus.OFFERED) {
            await tx.agreementVersion.update({
              where: { id: priorVersion.id },
              data: { status: AgreementVersionStatus.SUPERSEDED },
            });
          }
          const versionId = randomUUID();
          await tx.agreementVersion.create({
            data: {
              id: versionId,
              agreementId: ra.agreementId,
              versionNumber: nextNumber,
              status: AgreementVersionStatus.OFFERED,
              canonicalSchema: AGREEMENT_CANONICAL_SCHEMA,
              termsSnapshot: built.terms as unknown as Prisma.InputJsonValue,
              termsHash: built.termsHash,
              supersedesVersionId: priorVersion.id,
              amendmentReason: 'customer_maximum_amendment',
              amendedByUserId: input.actorUserId,
            },
          });
          await tx.agreement.update({
            where: { id: ra.agreementId },
            data: {
              currentVersionId: versionId,
              status: AgreementStatus.OFFERED,
            },
          });
          await tx.agreementAcceptance.create({
            data: {
              id: randomUUID(),
              agreementVersionId: versionId,
              actorUserId: input.actorUserId,
              partyRole: AgreementPartyRole.CUSTOMER,
              acceptanceMethod: AgreementAcceptanceMethod.MOBILE_CONFIRMATION,
              termsHash: built.termsHash,
              correlationId: input.correlationId,
            },
          });

          const nextStatus =
            ra.status === RiderAdvanceStatus.RIDER_ACCEPTED
              ? RiderAdvanceStatus.CUSTOMER_AUTHORIZED
              : ra.status;

          const updated = await tx.riderAdvance.update({
            where: { id: ra.id },
            data: {
              authorizedMaximumAmount: max,
              agreementVersionId: versionId,
              status: nextStatus,
              riderAcceptedAt:
                nextStatus === RiderAdvanceStatus.CUSTOMER_AUTHORIZED
                  ? null
                  : ra.riderAcceptedAt,
              version: { increment: 1 },
            },
          });

          await this.events.record({
            tx,
            aggregateType: 'AGREEMENT',
            aggregateId: ra.agreementId,
            wkOrderId: ra.wkOrderId,
            actorId: input.actorUserId,
            actorType: 'CUSTOMER',
            action: 'RIDER_ADVANCE_AMENDED',
            correlationId: input.correlationId,
            metadata: {
              riderAdvanceId: ra.id,
              authorizedMaximumAmount: max.toFixed(2),
              versionId,
            },
          });
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async accept(input: {
    riderAdvanceId: string;
    actorUserId: string;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    if (input.idempotencyKey) {
      const prior = await this.prisma.riderAdvance.findUnique({
        where: { acceptIdempotencyKey: input.idempotencyKey },
      });
      if (prior) return { riderAdvance: prior, idempotent: true };
    }

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`
            SELECT id FROM "rider_advances" WHERE id = ${input.riderAdvanceId}::uuid FOR UPDATE
          `;
            const ra = await tx.riderAdvance.findUniqueOrThrow({
              where: { id: input.riderAdvanceId },
            });
            if (ra.riderId !== input.actorUserId) {
              throw new ForbiddenException(
                'Only the named agreement rider may accept',
              );
            }
            if (ra.status === RiderAdvanceStatus.RIDER_ACCEPTED) {
              return { riderAdvance: ra, idempotent: true };
            }
            if (ra.status !== RiderAdvanceStatus.CUSTOMER_AUTHORIZED) {
              throw new BadRequestException(
                `Cannot accept in status ${ra.status}`,
              );
            }
            await this.assertAssignmentCurrent(tx, ra);
            await this.assertMerchantEligibleById(tx, ra.merchantId);

            const version = await tx.agreementVersion.findUniqueOrThrow({
              where: { id: ra.agreementVersionId },
              include: { acceptances: true },
            });
            const already = version.acceptances.find(
              (a) =>
                a.actorUserId === input.actorUserId &&
                a.partyRole === AgreementPartyRole.RIDER,
            );
            if (!already) {
              await tx.agreementAcceptance.create({
                data: {
                  id: randomUUID(),
                  agreementVersionId: version.id,
                  actorUserId: input.actorUserId,
                  partyRole: AgreementPartyRole.RIDER,
                  acceptanceMethod:
                    AgreementAcceptanceMethod.MOBILE_CONFIRMATION,
                  termsHash: version.termsHash,
                  correlationId: input.correlationId,
                },
              });
            }

            const required = [
              AgreementPartyRole.CUSTOMER,
              AgreementPartyRole.RIDER,
            ];
            const acceptances = await tx.agreementAcceptance.findMany({
              where: { agreementVersionId: version.id },
            });
            const satisfied = required.every((role) =>
              acceptances.some((a) => a.partyRole === role),
            );
            if (satisfied) {
              await tx.agreementVersion.update({
                where: { id: version.id },
                data: {
                  status: AgreementVersionStatus.ACCEPTED,
                },
              });
              await tx.agreement.update({
                where: { id: ra.agreementId },
                data: { status: AgreementStatus.ACCEPTED },
              });
            }

            await tx.agreementEvidence.create({
              data: {
                id: randomUUID(),
                agreementId: ra.agreementId,
                agreementVersionId: ra.agreementVersionId,
                wkOrderId: ra.wkOrderId,
                evidenceType: AgreementEvidenceType.RIDER_ACKNOWLEDGMENT,
                contentHash: hashMeta({
                  kind: 'rider_acceptance',
                  riderAdvanceId: ra.id,
                }),
                submittedBy: input.actorUserId,
                finalized: true,
                metadata: { kind: 'rider_acceptance', riderAdvanceId: ra.id },
                idempotencyKey: input.idempotencyKey
                  ? `ra-accept-ev-${input.idempotencyKey}`
                  : undefined,
              },
            });

            const updated = await tx.riderAdvance.update({
              where: { id: ra.id },
              data: {
                status: RiderAdvanceStatus.RIDER_ACCEPTED,
                riderAcceptedAt: new Date(),
                acceptIdempotencyKey: input.idempotencyKey,
                version: { increment: 1 },
              },
            });

            await this.events.record({
              tx,
              aggregateType: 'AGREEMENT',
              aggregateId: ra.agreementId,
              wkOrderId: ra.wkOrderId,
              actorId: input.actorUserId,
              actorType: 'RIDER',
              action: 'RIDER_ADVANCE_RIDER_ACCEPTED',
              previousState: ra.status,
              newState: RiderAdvanceStatus.RIDER_ACCEPTED,
              correlationId: input.correlationId,
              metadata: { riderAdvanceId: ra.id },
            });

            return { riderAdvance: updated, idempotent: false };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        input.idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.riderAdvance.findUnique({
          where: { acceptIdempotencyKey: input.idempotencyKey },
        });
        if (prior) return { riderAdvance: prior, idempotent: true };
      }
      throw err;
    }
  }

  async recordAdvance(input: {
    riderAdvanceId: string;
    actorUserId: string;
    actualAdvanceAmount: string | number;
    notes?: string;
    receiptStorageReference?: string;
    merchantReceiptReference?: string;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    const amount = MONEY(input.actualAdvanceAmount);
    if (amount.lte(0)) {
      throw new BadRequestException('actualAdvanceAmount must be positive');
    }

    if (input.idempotencyKey) {
      const prior = await this.prisma.riderAdvance.findUnique({
        where: { recordIdempotencyKey: input.idempotencyKey },
      });
      if (prior) {
        if (
          !prior.actualAdvanceAmount ||
          !MONEY(prior.actualAdvanceAmount).eq(amount)
        ) {
          throw new ConflictException('Idempotency key payload conflict');
        }
        return { riderAdvance: prior, idempotent: true };
      }
    }

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`
            SELECT id FROM "rider_advances" WHERE id = ${input.riderAdvanceId}::uuid FOR UPDATE
          `;
            const ra = await tx.riderAdvance.findUniqueOrThrow({
              where: { id: input.riderAdvanceId },
            });
            if (ra.riderId !== input.actorUserId) {
              throw new ForbiddenException(
                'Only the accepting rider may record the advance',
              );
            }
            if (ra.status === RiderAdvanceStatus.ADVANCE_RECORDED) {
              if (
                ra.actualAdvanceAmount &&
                MONEY(ra.actualAdvanceAmount).eq(amount)
              ) {
                return { riderAdvance: ra, idempotent: true };
              }
              throw new ConflictException('Advance already recorded');
            }
            if (ra.status !== RiderAdvanceStatus.RIDER_ACCEPTED) {
              throw new BadRequestException({
                code: 'NOT_READY_TO_RECORD',
                message: `Cannot record advance in status ${ra.status}`,
              });
            }
            await this.assertAssignmentCurrent(tx, ra);
            await this.assertMerchantEligibleById(tx, ra.merchantId);

            if (amount.gt(ra.authorizedMaximumAmount)) {
              throw new BadRequestException({
                code: 'EXCEEDS_AUTHORIZED_MAXIMUM',
                message: 'actualAdvanceAmount exceeds authorized maximum',
                authorizedMaximumAmount: ra.authorizedMaximumAmount.toFixed(2),
                actualAdvanceAmount: amount.toFixed(2),
              });
            }

            const updated = await tx.riderAdvance.update({
              where: { id: ra.id },
              data: {
                actualAdvanceAmount: amount,
                status: RiderAdvanceStatus.ADVANCE_RECORDED,
                advanceRecordedAt: new Date(),
                recordIdempotencyKey: input.idempotencyKey,
                version: { increment: 1 },
              },
            });

            await tx.agreementEvidence.create({
              data: {
                id: randomUUID(),
                agreementId: ra.agreementId,
                agreementVersionId: ra.agreementVersionId,
                wkOrderId: ra.wkOrderId,
                evidenceType: AgreementEvidenceType.PAYMENT_PROOF,
                contentHash: hashMeta({
                  kind: 'rider_recorded_advance',
                  amount: amount.toFixed(2),
                }),
                storageReference: input.receiptStorageReference,
                submittedBy: input.actorUserId,
                finalized: true,
                metadata: {
                  kind: 'rider_recorded_advance',
                  actualAdvanceAmount: amount.toFixed(2),
                  currency: ra.currency,
                  notes: input.notes ?? null,
                  merchantReceiptReference:
                    input.merchantReceiptReference ?? null,
                  notYetVendorAcknowledged: true,
                },
                idempotencyKey: input.idempotencyKey
                  ? `ra-record-ev-${input.idempotencyKey}`
                  : undefined,
              },
            });

            await this.events.record({
              tx,
              aggregateType: 'AGREEMENT',
              aggregateId: ra.agreementId,
              wkOrderId: ra.wkOrderId,
              actorId: input.actorUserId,
              actorType: 'RIDER',
              action: 'RIDER_ADVANCE_RECORDED',
              previousState: ra.status,
              newState: RiderAdvanceStatus.ADVANCE_RECORDED,
              correlationId: input.correlationId,
              metadata: {
                riderAdvanceId: ra.id,
                actualAdvanceAmount: amount.toFixed(2),
                currency: ra.currency,
              },
            });

            return { riderAdvance: updated, idempotent: false };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        input.idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.riderAdvance.findUnique({
          where: { recordIdempotencyKey: input.idempotencyKey },
        });
        if (prior) {
          if (
            !prior.actualAdvanceAmount ||
            !MONEY(prior.actualAdvanceAmount).eq(amount)
          ) {
            throw new ConflictException('Idempotency key payload conflict');
          }
          return { riderAdvance: prior, idempotent: true };
        }
      }
      throw err;
    }
  }

  async vendorAcknowledge(input: {
    riderAdvanceId: string;
    actorUserId: string;
    acknowledgedAmount: string | number;
    idempotencyKey?: string;
    correlationId?: string;
  }) {
    if (input.idempotencyKey) {
      const prior = await this.prisma.riderAdvance.findUnique({
        where: { acknowledgeIdempotencyKey: input.idempotencyKey },
      });
      if (prior) {
        if (
          !prior.vendorAcknowledgedAmount ||
          !MONEY(prior.vendorAcknowledgedAmount).eq(input.acknowledgedAmount)
        ) {
          throw new ConflictException('Idempotency key payload conflict');
        }
        return { riderAdvance: prior, idempotent: true, mismatch: false };
      }
    }

    const ack = MONEY(input.acknowledgedAmount);
    if (ack.lte(0)) {
      throw new BadRequestException('acknowledgedAmount must be positive');
    }

    try {
      return await this.withSerializableRetry(() =>
        this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`
            SELECT id FROM "rider_advances" WHERE id = ${input.riderAdvanceId}::uuid FOR UPDATE
          `;
            const ra = await tx.riderAdvance.findUniqueOrThrow({
              where: { id: input.riderAdvanceId },
            });

            const merchantOk = await tx.merchant.findFirst({
              where: {
                id: ra.merchantId,
                OR: [
                  { userId: input.actorUserId },
                  {
                    merchantStaff: {
                      some: { userId: input.actorUserId, isActive: true },
                    },
                  },
                ],
              },
              select: { id: true },
            });
            if (!merchantOk) {
              throw new ForbiddenException({
                code: 'MERCHANT_UNAUTHORIZED',
                message: 'Only the order merchant may acknowledge cash receipt',
              });
            }
            if (input.actorUserId === ra.riderId) {
              throw new ForbiddenException(
                'Rider cannot self-acknowledge vendor receipt',
              );
            }
            if (input.actorUserId === ra.customerId) {
              throw new ForbiddenException(
                'Customer cannot acknowledge vendor receipt',
              );
            }

            if (
              ra.status === RiderAdvanceStatus.VENDOR_ACKNOWLEDGED ||
              ra.status === RiderAdvanceStatus.REIMBURSEMENT_DUE ||
              ra.status === RiderAdvanceStatus.REIMBURSED
            ) {
              return { riderAdvance: ra, idempotent: true, mismatch: false };
            }
            if (ra.status !== RiderAdvanceStatus.ADVANCE_RECORDED) {
              throw new BadRequestException(
                `Cannot acknowledge in status ${ra.status}`,
              );
            }
            if (!ra.actualAdvanceAmount) {
              throw new BadRequestException('No rider-recorded advance amount');
            }

            // Reassignment race: assignment must still match for ack
            await this.assertAssignmentCurrent(tx, ra);

            if (!MONEY(ra.actualAdvanceAmount).eq(ack)) {
              const disputed = await tx.riderAdvance.update({
                where: { id: ra.id },
                data: {
                  vendorAcknowledgedAmount: ack,
                  status: RiderAdvanceStatus.DISPUTED,
                  disputedAt: new Date(),
                  disputeReason: 'amount_mismatch',
                  version: { increment: 1 },
                },
              });
              await tx.agreementEvidence.create({
                data: {
                  id: randomUUID(),
                  agreementId: ra.agreementId,
                  agreementVersionId: ra.agreementVersionId,
                  wkOrderId: ra.wkOrderId,
                  evidenceType: AgreementEvidenceType.NOTE,
                  contentHash: hashMeta({
                    kind: 'amount_mismatch',
                    rider: ra.actualAdvanceAmount.toFixed(2),
                    merchant: ack.toFixed(2),
                  }),
                  submittedBy: input.actorUserId,
                  finalized: true,
                  metadata: {
                    kind: 'amount_mismatch',
                    riderRecordedAmount: ra.actualAdvanceAmount.toFixed(2),
                    merchantAcknowledgedAmount: ack.toFixed(2),
                    currency: ra.currency,
                  },
                },
              });
              await this.events.record({
                tx,
                aggregateType: 'AGREEMENT',
                aggregateId: ra.agreementId,
                wkOrderId: ra.wkOrderId,
                actorId: input.actorUserId,
                actorType: 'MERCHANT_OWNER',
                action: 'RIDER_ADVANCE_AMOUNT_MISMATCH',
                previousState: ra.status,
                newState: RiderAdvanceStatus.DISPUTED,
                correlationId: input.correlationId,
                metadata: {
                  riderAdvanceId: ra.id,
                  riderRecordedAmount: ra.actualAdvanceAmount.toFixed(2),
                  merchantAcknowledgedAmount: ack.toFixed(2),
                },
              });
              return {
                riderAdvance: disputed,
                idempotent: false,
                mismatch: true,
              };
            }

            const now = new Date();
            const updated = await tx.riderAdvance.update({
              where: { id: ra.id },
              data: {
                vendorAcknowledgedAmount: ack,
                reimbursementPrincipal: ack,
                status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
                vendorAcknowledgedAt: now,
                reimbursementDueAt: now,
                acknowledgeIdempotencyKey: input.idempotencyKey,
                version: { increment: 1 },
              },
            });

            await tx.agreementEvidence.create({
              data: {
                id: randomUUID(),
                agreementId: ra.agreementId,
                agreementVersionId: ra.agreementVersionId,
                wkOrderId: ra.wkOrderId,
                evidenceType: AgreementEvidenceType.MERCHANT_ACKNOWLEDGMENT,
                contentHash: hashMeta({
                  kind: 'vendor_payment_acknowledged',
                  amount: ack.toFixed(2),
                }),
                submittedBy: input.actorUserId,
                finalized: true,
                metadata: {
                  kind: 'vendor_payment_acknowledged',
                  acknowledgedAmount: ack.toFixed(2),
                  currency: ra.currency,
                  notGoodsRelease: true,
                },
                idempotencyKey: input.idempotencyKey
                  ? `ra-ack-ev-${input.idempotencyKey}`
                  : undefined,
              },
            });

            await this.events.record({
              tx,
              aggregateType: 'AGREEMENT',
              aggregateId: ra.agreementId,
              wkOrderId: ra.wkOrderId,
              actorId: input.actorUserId,
              actorType: 'MERCHANT_OWNER',
              action: 'RIDER_ADVANCE_VENDOR_ACKNOWLEDGED',
              previousState: ra.status,
              newState: RiderAdvanceStatus.VENDOR_ACKNOWLEDGED,
              correlationId: input.correlationId,
              metadata: {
                riderAdvanceId: ra.id,
                acknowledgedAmount: ack.toFixed(2),
              },
            });
            await this.events.record({
              tx,
              aggregateType: 'AGREEMENT',
              aggregateId: ra.agreementId,
              wkOrderId: ra.wkOrderId,
              actorId: input.actorUserId,
              actorType: 'SYSTEM',
              action: 'RIDER_ADVANCE_REIMBURSEMENT_DUE',
              newState: RiderAdvanceStatus.REIMBURSEMENT_DUE,
              correlationId: input.correlationId,
              metadata: {
                riderAdvanceId: ra.id,
                reimbursementPrincipal: ack.toFixed(2),
                notAuthorizedMaximum: true,
                convenienceFeeSeparate: true,
                deliveryFeeSeparate: true,
                collectionNotImplemented: true,
              },
            });

            return {
              riderAdvance: updated,
              idempotent: false,
              mismatch: false,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (err) {
      if (
        input.idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.riderAdvance.findUnique({
          where: { acknowledgeIdempotencyKey: input.idempotencyKey },
        });
        if (prior) {
          if (
            !prior.vendorAcknowledgedAmount ||
            !MONEY(prior.vendorAcknowledgedAmount).eq(ack)
          ) {
            throw new ConflictException('Idempotency key payload conflict');
          }
          return { riderAdvance: prior, idempotent: true, mismatch: false };
        }
      }
      throw err;
    }
  }

  /**
   * Cancel before actual advance. After ADVANCE_RECORDED+, preserves obligation
   * (moves to DISPUTED rather than erasing financial history).
   */
  async cancel(input: {
    riderAdvanceId: string;
    actorUserId: string;
    reason?: string;
    correlationId?: string;
  }) {
    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
          SELECT id FROM "rider_advances" WHERE id = ${input.riderAdvanceId}::uuid FOR UPDATE
        `;
          const ra = await tx.riderAdvance.findUniqueOrThrow({
            where: { id: input.riderAdvanceId },
          });
          if (
            ra.customerId !== input.actorUserId &&
            !(await this.isAdmin(tx, input.actorUserId))
          ) {
            throw new ForbiddenException(
              'Only customer (or admin) may cancel Rider Advance',
            );
          }
          if (ra.status === RiderAdvanceStatus.CANCELLED) {
            return { riderAdvance: ra, preservedObligation: false };
          }

          const now = new Date();
          if (POST_EXPENDITURE.includes(ra.status)) {
            const updated = await tx.riderAdvance.update({
              where: { id: ra.id },
              data: {
                status: RiderAdvanceStatus.DISPUTED,
                disputedAt: now,
                disputeReason: input.reason ?? 'order_cancelled_after_advance',
                version: { increment: 1 },
              },
            });
            await this.events.record({
              tx,
              aggregateType: 'AGREEMENT',
              aggregateId: ra.agreementId,
              wkOrderId: ra.wkOrderId,
              actorId: input.actorUserId,
              actorType: 'CUSTOMER',
              action: 'RIDER_ADVANCE_DISPUTED',
              previousState: ra.status,
              newState: RiderAdvanceStatus.DISPUTED,
              correlationId: input.correlationId,
              metadata: {
                riderAdvanceId: ra.id,
                preservedActualAdvanceAmount:
                  ra.actualAdvanceAmount?.toFixed(2),
                preservedReimbursementPrincipal:
                  ra.reimbursementPrincipal?.toFixed(2) ?? null,
                reason: input.reason ?? 'order_cancelled_after_advance',
              },
            });
            return { riderAdvance: updated, preservedObligation: true };
          }

          const updated = await tx.riderAdvance.update({
            where: { id: ra.id },
            data: {
              status: RiderAdvanceStatus.CANCELLED,
              cancelledAt: now,
              cancelReason: input.reason ?? 'cancelled_before_advance',
              version: { increment: 1 },
            },
          });
          await tx.agreement.update({
            where: { id: ra.agreementId },
            data: {
              status: AgreementStatus.CANCELLED,
              cancelledAt: now,
              cancelledBy: input.actorUserId,
              cancellationReason: input.reason ?? 'cancelled_before_advance',
            },
          });
          await this.events.record({
            tx,
            aggregateType: 'AGREEMENT',
            aggregateId: ra.agreementId,
            wkOrderId: ra.wkOrderId,
            actorId: input.actorUserId,
            actorType: 'CUSTOMER',
            action: 'RIDER_ADVANCE_CANCELLED',
            previousState: ra.status,
            newState: RiderAdvanceStatus.CANCELLED,
            correlationId: input.correlationId,
            metadata: { riderAdvanceId: ra.id },
          });
          return { riderAdvance: updated, preservedObligation: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  private async assertCanRead(
    ra: {
      customerId: string;
      riderId: string;
      merchantId: number;
    },
    actorUserId: string,
  ) {
    if (ra.customerId === actorUserId || ra.riderId === actorUserId) return;
    const merchant = await this.prisma.merchant.findFirst({
      where: {
        id: ra.merchantId,
        OR: [
          { userId: actorUserId },
          { merchantStaff: { some: { userId: actorUserId, isActive: true } } },
        ],
      },
      select: { id: true },
    });
    if (merchant) return;
    const admin = await this.isAdmin(this.prisma, actorUserId);
    if (admin) return;
    throw new ForbiddenException('Not authorized to view this Rider Advance');
  }

  private async isAdmin(
    db: Prisma.TransactionClient | PrismaService,
    userId: string,
  ) {
    const u = await db.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return u?.role === 'admin';
  }

  private async assertMerchantEligible(
    tx: Prisma.TransactionClient,
    merchantId: number,
    merchant: { allowRiderAdvance: boolean },
  ) {
    if (!merchant.allowRiderAdvance) {
      throw new BadRequestException({
        code: 'RIDER_ADVANCE_DISABLED',
        message: 'Merchant has not enabled Allow Rider Advance',
      });
    }
    const hasCash = await this.hasEnabledCash(tx, merchantId);
    if (!hasCash) {
      throw new BadRequestException({
        code: 'CASH_METHOD_REQUIRED',
        message: 'Rider Advance requires an enabled CASH payment method',
      });
    }
  }

  private async assertMerchantEligibleById(
    tx: Prisma.TransactionClient,
    merchantId: number,
  ) {
    const merchant = await tx.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      select: { allowRiderAdvance: true },
    });
    await this.assertMerchantEligible(tx, merchantId, merchant);
  }

  private async hasEnabledCash(
    tx: Prisma.TransactionClient,
    merchantId: number,
  ) {
    const cash = await tx.merchantPaymentMethod.findFirst({
      where: {
        merchantId,
        kind: MerchantPaymentMethodKind.CASH,
        enabled: true,
      },
      select: { id: true },
    });
    return Boolean(cash);
  }

  private async assertAssignmentCurrent(
    tx: Prisma.TransactionClient,
    ra: {
      fulfillmentId: string;
      riderId: string;
      riderAssignmentId: string;
      assignmentVersion: number;
    },
  ) {
    const fulfillment = await tx.orderFulfillment.findUniqueOrThrow({
      where: { id: ra.fulfillmentId },
    });
    if (
      fulfillment.activeRiderId !== ra.riderId ||
      fulfillment.assignmentVersion !== ra.assignmentVersion
    ) {
      throw new ConflictException({
        code: 'ASSIGNMENT_CHANGED',
        message: 'Assignment changed; re-authorize Rider Advance',
      });
    }
    const assignment = await tx.riderAssignment.findFirst({
      where: {
        id: ra.riderAssignmentId,
        fulfillmentId: ra.fulfillmentId,
        riderId: ra.riderId,
        status: RiderAssignmentStatus.ACTIVE,
        assignmentVersion: ra.assignmentVersion,
      },
    });
    if (!assignment) {
      throw new ConflictException({
        code: 'ASSIGNMENT_STALE',
        message: 'Rider assignment is no longer active for this authorization',
      });
    }
  }
}

function hashMeta(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function isMissingRiderAdvanceRelation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2021') return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /rider_advances/i.test(msg) && /does not exist|relation/i.test(msg);
}
