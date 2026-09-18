import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CustodyEventType,
  FulfillmentStatus,
  MerchantPaymentStatus,
  Prisma,
  ReturnFinancialDeterminationOutcome,
  ReturnFinancialDeterminationStatus,
  ReturnFinancialObligationStatus,
  ReturnFinancialObligationType,
  ReturnFinancialPartyType,
  RiderAdvanceCollectionRestrictionEffect,
  RiderAdvanceCollectionRestrictionStatus,
  RiderAdvanceStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildStage9EconomicScope,
  evaluateStage9Stage12OverlapGuard,
} from '../exception-financial/exception-financial.policy';
import { RiderAdvanceCollectibilityService } from './rider-advance-collectibility.service';
import { ReturnFinancialTermsService } from './return-financial-terms.service';

const MONEY = (v: unknown) =>
  new Prisma.Decimal((v ?? 0) as Prisma.Decimal.Value).toDecimalPlaces(2);

const PATH_RA = 'RIDER_ADVANCE';
const PATH_ORDINARY = 'ORDINARY_MERCHANT_PAYMENT';

@Injectable()
export class ReturnFinancialDeterminationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
    private readonly collectibility: RiderAdvanceCollectibilityService,
    private readonly terms: ReturnFinancialTermsService,
  ) {}

  private async withSerializableRetry<T>(
    run: () => Promise<T>,
    attempts = 8,
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
            err.code === 'P2002' ||
            (err.code === 'P2010' &&
              /could not serialize|40001|40P01|concurrent update|deadlock/i.test(
                err.message,
              )));
        if (!retryable || i === attempts - 1) throw err;
      }
    }
    throw last;
  }

  /** Merchant OWNER only for determination propose/ack/finalize. */
  private async assertMerchantOwner(merchantId: number, actorUserId: string) {
    const merchant = await this.prisma.merchant.findFirst({
      where: { id: merchantId, userId: actorUserId },
    });
    if (!merchant) {
      throw new ForbiddenException({
        code: 'NOT_MERCHANT_OWNER',
        message: 'Only the merchant owner may operate return financial determinations',
      });
    }
    return merchant;
  }

  private async assertAdminOrMerchantOwner(
    merchantId: number,
    actorUserId: string,
  ): Promise<'MERCHANT' | 'ADMIN'> {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
    });
    if (actor?.role === UserRole.admin) return 'ADMIN';
    await this.assertMerchantOwner(merchantId, actorUserId);
    return 'MERCHANT';
  }

  /**
   * Stage 12 integration guard (authorized Stage 9 change).
   * After authoritative Stage 9 locks (determination → orders → fulfillment →
   * RiderAdvance) and before any FINALIZED mutation / obligation / restriction:
   * build Stage9EconomicScope, predicate-lock contained EconomicLoss rows
   * (Serializable SIREAD protects phantoms), refuse if any positive effective
   * Stage 12 STAGE12_OBLIGATION coverage is economically contained in the
   * proposed whole-order principal. No auto-netting.
   *
   * On pre-Stage12 schemas (frozen Stage 9 acceptance DBs) `economic_losses`
   * does not exist — no Stage 12 authority can exist, so the guard is a no-op.
   */
  private async assertNoOverlappingStage12Authority(
    tx: Prisma.TransactionClient,
    input: {
      wkOrderId: number;
      path: 'RIDER_ADVANCE' | 'ORDINARY_MERCHANT_PAYMENT';
      grossPrincipal: Prisma.Decimal;
      merchantToRiderAmount: Prisma.Decimal;
      merchantToCustomerAmount: Prisma.Decimal;
      riderAdvanceId: string | null;
    },
  ): Promise<void> {
    if (
      input.merchantToRiderAmount.lte(0) &&
      input.merchantToCustomerAmount.lte(0)
    ) {
      return;
    }

    const present = await tx.$queryRaw<Array<{ present: boolean | null }>>`
      SELECT to_regclass('public.economic_losses') IS NOT NULL AS present
    `;
    if (!present[0]?.present) return;

    const scope = buildStage9EconomicScope({
      wkOrderId: input.wkOrderId,
      path: input.path,
      grossPrincipal: input.grossPrincipal,
      merchantToRiderAmount: input.merchantToRiderAmount,
      merchantToCustomerAmount: input.merchantToCustomerAmount,
      riderAdvanceId: input.riderAdvanceId,
    });
    if (scope.includedLossKinds.length === 0) return;

    // Predicate lock under Serializable: even an empty result establishes
    // SIREAD range protection against concurrent EconomicLoss inserts that
    // match wk_order_id + included loss kinds (phantom containment race).
    const kindList = scope.includedLossKinds.map((k) => k);
    await tx.$queryRaw`
      SELECT id FROM "economic_losses"
      WHERE wk_order_id = ${input.wkOrderId}
        AND loss_kind::text IN (${Prisma.join(kindList)})
      ORDER BY id
      FOR UPDATE
    `;

    const losses = await tx.economicLoss.findMany({
      where: {
        wkOrderId: input.wkOrderId,
        lossKind: { in: scope.includedLossKinds },
      },
      orderBy: { id: 'asc' },
      include: { coverages: true },
    });

    const gate = evaluateStage9Stage12OverlapGuard({
      scope,
      losses: losses.map((l) => ({
        id: l.id,
        lossKind: l.lossKind,
        subjectRef: l.subjectRef,
        coverages: l.coverages.map((c) => ({
          sourceKind: c.sourceKind,
          amount: c.amount,
        })),
      })),
    });
    if (!gate.ok) {
      throw new ConflictException({
        code: gate.code,
        message: gate.message,
      });
    }
  }

  private async requireReturnEligibility(tx: Prisma.TransactionClient, wkOrderId: number) {
    const order = await tx.wkOrder.findUnique({ where: { id: wkOrderId } });
    if (!order) throw new NotFoundException('Order not found');

    await tx.$queryRaw`
      SELECT id FROM "orders" WHERE id = ${wkOrderId} FOR UPDATE
    `;

    const fulfillment = await tx.orderFulfillment.findUnique({
      where: { wkOrderId },
    });
    if (!fulfillment) {
      throw new ForbiddenException({
        code: 'RETURN_NOT_FINANCIALLY_ELIGIBLE',
        message: 'Fulfillment required for return financial determination',
      });
    }
    await tx.$queryRaw`
      SELECT id FROM "order_fulfillments" WHERE id = ${fulfillment.id}::uuid FOR UPDATE
    `;

    if (fulfillment.status !== FulfillmentStatus.returned) {
      throw new ForbiddenException({
        code: 'RETURN_NOT_FINANCIALLY_ELIGIBLE',
        message: 'Fulfillment must be returned for financial determination',
      });
    }

    const returnCustody = await tx.custodyEvent.findFirst({
      where: {
        fulfillmentId: fulfillment.id,
        eventType: CustodyEventType.RETURN_RECEIVED,
      },
      orderBy: { occurredAt: 'asc' },
    });
    if (!returnCustody) {
      throw new ForbiddenException({
        code: 'RETURN_NOT_FINANCIALLY_ELIGIBLE',
        message: 'RETURN_RECEIVED custody event required',
      });
    }

    return { order, fulfillment, returnCustody };
  }

  async createOrPropose(input: {
    wkOrderId: number;
    actorUserId: string;
    outcome?: ReturnFinancialDeterminationOutcome | string;
    reason?: string;
    ordinaryRefundPrincipal?: string | number;
    path?: string;
    termsHash?: string;
    correlationId?: string;
    idempotencyKey?: string;
    /** Admin adjudication only */
    adminAdjudication?: boolean;
  }) {
    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const { order, fulfillment, returnCustody } =
            await this.requireReturnEligibility(tx, input.wkOrderId);

          const actorRole = await this.assertAdminOrMerchantOwner(
            order.merchantId,
            input.actorUserId,
          );
          if (actorRole === 'ADMIN' && !input.adminAdjudication) {
            // Admin may propose only as audited adjudication.
            throw new ForbiddenException({
              code: 'ADMIN_ADJUDICATION_REQUIRED',
              message: 'Admin must set adminAdjudication=true with reason',
            });
          }
          if (actorRole === 'ADMIN' && !input.reason) {
            throw new BadRequestException({
              code: 'ADMIN_REASON_REQUIRED',
              message: 'Admin adjudication requires an audited reason',
            });
          }

          // Never disclose a cached determination before authorization of the
          // requested order.  A key is also bound to that order.
          if (input.idempotencyKey) {
            const prior = await tx.returnFinancialDetermination.findFirst({
              where: { proposeIdempotencyKey: input.idempotencyKey },
            });
            if (prior) {
              if (prior.wkOrderId !== input.wkOrderId) {
                throw new ConflictException({
                  code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
                  message: 'Idempotency key is bound to a different order',
                });
              }
              return { determination: prior, idempotent: true };
            }
          }

          const existingFinal = await tx.returnFinancialDetermination.findFirst({
            where: {
              wkOrderId: input.wkOrderId,
              status: ReturnFinancialDeterminationStatus.FINALIZED,
            },
          });
          if (existingFinal) {
            throw new ConflictException({
              code: 'DETERMINATION_ALREADY_FINALIZED',
              message: 'A FINALIZED return financial determination already exists',
            });
          }

          const ra = await tx.riderAdvance.findFirst({
            where: {
              wkOrderId: input.wkOrderId,
              status: { not: RiderAdvanceStatus.CANCELLED },
            },
            orderBy: { createdAt: 'desc' },
          });

          const wantsOrdinary =
            input.path === PATH_ORDINARY ||
            input.ordinaryRefundPrincipal != null;

          if (wantsOrdinary && ra?.reimbursementPrincipal != null) {
            throw new ConflictException({
              code: 'RA_ORDINARY_PATH_EXCLUSIVE',
              message:
                'Rider Advance path and ordinary merchant payment refund path are mutually exclusive',
            });
          }

          let path = wantsOrdinary ? PATH_ORDINARY : PATH_RA;
          if (!ra && !wantsOrdinary) {
            if (order.merchantPaymentStatus === MerchantPaymentStatus.VERIFIED) {
              path = PATH_ORDINARY;
            } else {
              path = PATH_RA;
            }
          }

          // Terms gate for automatic formula outcomes
          const outcomeRaw = String(
            input.outcome ??
              ReturnFinancialDeterminationOutcome.QUALIFYING_FULL_RETURN,
          );
          const outcome =
            outcomeRaw as ReturnFinancialDeterminationOutcome;
          let merchantTermsVersionId: string | undefined;
          let merchantTermsHash: string | undefined;
          let customerTermsVersionId: string | undefined;
          let customerTermsHash: string | undefined;

          if (
            outcome ===
            ReturnFinancialDeterminationOutcome.QUALIFYING_FULL_RETURN
          ) {
            // Resolve via service (uses non-tx prisma for seed/lookup — acceptable)
            const applicable =
              await this.terms.assertAutomaticFormulaApplicable(input.wkOrderId);
            if (input.termsHash) {
              await this.terms.resolveApplicableTerms(input.termsHash);
            }
            merchantTermsVersionId = applicable.merchantTerms.id;
            merchantTermsHash = applicable.merchantTerms.termsHash;
            customerTermsVersionId = applicable.customerTerms.id;
            customerTermsHash = applicable.customerTerms.termsHash;
          }

          let ordinaryRefundPrincipal: Prisma.Decimal | null = null;
          if (path === PATH_ORDINARY) {
            if (order.merchantPaymentStatus !== MerchantPaymentStatus.VERIFIED) {
              throw new ForbiddenException({
                code: 'ORDINARY_PAYMENT_NOT_VERIFIED',
                message:
                  'Ordinary refund path requires VERIFIED merchant payment status (status is not mutated)',
              });
            }
            if (input.ordinaryRefundPrincipal == null) {
              throw new BadRequestException({
                code: 'ORDINARY_REFUND_PRINCIPAL_REQUIRED',
                message:
                  'Explicit merchant-acknowledged refundPrincipal is required; declaredAmount is not authoritative',
              });
            }
            ordinaryRefundPrincipal = MONEY(input.ordinaryRefundPrincipal);
            if (ordinaryRefundPrincipal.lte(0)) {
              throw new BadRequestException({
                code: 'INVALID_AMOUNT',
                message: 'ordinaryRefundPrincipal must be positive',
              });
            }
            const orderTotal = MONEY(order.totalAmount);
            if (ordinaryRefundPrincipal.gt(orderTotal)) {
              throw new BadRequestException({
                code: 'ORDINARY_REFUND_EXCEEDS_ORDER',
                message: 'Refund principal cannot exceed order totalAmount',
              });
            }
          }

          const operationalCase = await tx.operationalCase.findFirst({
            where: { fulfillmentId: fulfillment.id },
            orderBy: { openedAt: 'desc' },
          });

          const now = new Date();
          const determination = await tx.returnFinancialDetermination.create({
            data: {
              id: randomUUID(),
              wkOrderId: order.id,
              fulfillmentId: fulfillment.id,
              operationalCaseId: operationalCase?.id,
              deliveryAttemptId: operationalCase?.deliveryAttemptId,
              returnCustodyEventId: returnCustody.id,
              riderAdvanceId: path === PATH_RA ? ra?.id : null,
              status: ReturnFinancialDeterminationStatus.PROPOSED,
              outcome,
              currency: 'PHP',
              merchantPaymentStatusSnapshot: order.merchantPaymentStatus,
              merchantTermsVersionId,
              merchantTermsHash,
              customerTermsVersionId,
              customerTermsHash,
              raAgreementVersionId: ra?.agreementVersionId,
              ordinaryRefundPrincipal,
              path,
              reason: input.reason,
              proposedByActorType: actorRole === 'ADMIN' ? 'SYSTEM_ADMIN' : 'MERCHANT_OWNER',
              proposedByActorId: input.actorUserId,
              proposedAt: now,
              correlationId: input.correlationId,
              proposeIdempotencyKey: input.idempotencyKey,
            },
          });

          await this.events.record({
            tx,
            aggregateType: 'WK_ORDER',
            aggregateId: String(order.id),
            wkOrderId: order.id,
            fulfillmentId: fulfillment.id,
            actorId: input.actorUserId,
            actorType: actorRole === 'ADMIN' ? 'SYSTEM_ADMIN' : 'MERCHANT_OWNER',
            action: 'RETURN_FINANCIAL_DETERMINATION_OPENED',
            previousState: null,
            newState: determination.status,
            correlationId: input.correlationId,
            metadata: {
              determinationId: determination.id,
              outcome,
              path,
              adminAdjudication: actorRole === 'ADMIN',
            },
          });

          return { determination, idempotent: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async acknowledge(input: {
    determinationId: string;
    actorUserId: string;
    correlationId?: string;
  }) {
    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM "return_financial_determinations"
            WHERE id = ${input.determinationId}::uuid FOR UPDATE
          `;
          const det = await tx.returnFinancialDetermination.findUnique({
            where: { id: input.determinationId },
          });
          if (!det) throw new NotFoundException('Determination not found');

          const order = await tx.wkOrder.findUniqueOrThrow({
            where: { id: det.wkOrderId },
          });
          await this.assertMerchantOwner(order.merchantId, input.actorUserId);

          if (det.status === ReturnFinancialDeterminationStatus.ACKNOWLEDGED) {
            return { determination: det, idempotent: true };
          }
          if (det.status === ReturnFinancialDeterminationStatus.FINALIZED) {
            throw new ConflictException({
              code: 'DETERMINATION_ALREADY_FINALIZED',
              message: 'Already finalized',
            });
          }
          if (det.status === ReturnFinancialDeterminationStatus.DISPUTED) {
            throw new ConflictException({
              code: 'RETURN_FINANCIAL_DISPUTED',
              message: 'Cannot acknowledge a disputed determination',
            });
          }
          if (
            det.status !== ReturnFinancialDeterminationStatus.PROPOSED &&
            det.status !== ReturnFinancialDeterminationStatus.PENDING
          ) {
            throw new BadRequestException({
              code: 'INVALID_DETERMINATION_STATUS',
              message: `Cannot acknowledge from ${det.status}`,
            });
          }

          const updated = await tx.returnFinancialDetermination.update({
            where: { id: det.id },
            data: {
              status: ReturnFinancialDeterminationStatus.ACKNOWLEDGED,
              acknowledgedByActorType: 'MERCHANT_OWNER',
              acknowledgedByActorId: input.actorUserId,
              acknowledgedAt: new Date(),
              correlationId: input.correlationId ?? det.correlationId,
            },
          });
          return { determination: updated, idempotent: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async dispute(input: {
    determinationId: string;
    actorUserId: string;
    reason?: string;
    correlationId?: string;
  }) {
    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM "return_financial_determinations"
            WHERE id = ${input.determinationId}::uuid FOR UPDATE
          `;
          const det = await tx.returnFinancialDetermination.findUnique({
            where: { id: input.determinationId },
          });
          if (!det) throw new NotFoundException('Determination not found');

          const order = await tx.wkOrder.findUniqueOrThrow({
            where: { id: det.wkOrderId },
          });
          const actorRole = await this.assertAdminOrMerchantOwner(
            order.merchantId,
            input.actorUserId,
          );

          if (det.status === ReturnFinancialDeterminationStatus.FINALIZED) {
            throw new ConflictException({
              code: 'DETERMINATION_ALREADY_FINALIZED',
              message: 'Cannot dispute a finalized determination',
            });
          }
          if (det.status === ReturnFinancialDeterminationStatus.DISPUTED) {
            return { determination: det, idempotent: true };
          }

          const updated = await tx.returnFinancialDetermination.update({
            where: { id: det.id },
            data: {
              status: ReturnFinancialDeterminationStatus.DISPUTED,
              disputedByActorType: actorRole === 'ADMIN' ? 'SYSTEM_ADMIN' : 'MERCHANT_OWNER',
              disputedByActorId: input.actorUserId,
              disputedAt: new Date(),
              disputeReason: input.reason,
              correlationId: input.correlationId ?? det.correlationId,
            },
          });

          await this.events.record({
            tx,
            aggregateType: 'WK_ORDER',
            aggregateId: String(order.id),
            wkOrderId: order.id,
            actorId: input.actorUserId,
            actorType: actorRole === 'ADMIN' ? 'SYSTEM_ADMIN' : 'MERCHANT_OWNER',
            action: 'RETURN_FINANCIAL_DETERMINATION_DISPUTED',
            previousState: det.status,
            newState: updated.status,
            correlationId: input.correlationId,
            metadata: { determinationId: det.id, reason: input.reason },
          });

          return { determination: updated, idempotent: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  /**
   * Finalize with atomic formula under RA lock.
   * Race with Stage 5B: exactly one coherent Outcome A or B.
   */
  async finalize(input: {
    determinationId: string;
    actorUserId: string;
    correlationId?: string;
    idempotencyKey?: string;
    adminAdjudication?: boolean;
    reason?: string;
  }) {
    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT id FROM "return_financial_determinations"
            WHERE id = ${input.determinationId}::uuid FOR UPDATE
          `;
          const det = await tx.returnFinancialDetermination.findUnique({
            where: { id: input.determinationId },
          });
          if (!det) throw new NotFoundException('Determination not found');

          if (det.status === ReturnFinancialDeterminationStatus.FINALIZED) {
            const obligations = await tx.returnFinancialObligation.findMany({
              where: { determinationId: det.id },
            });
            return { determination: det, obligations, idempotent: true };
          }

          const { order, fulfillment } = await this.requireReturnEligibility(
            tx,
            det.wkOrderId,
          );

          const actorRole = await this.assertAdminOrMerchantOwner(
            order.merchantId,
            input.actorUserId,
          );
          if (actorRole === 'ADMIN' && !input.adminAdjudication) {
            throw new ForbiddenException({
              code: 'ADMIN_ADJUDICATION_REQUIRED',
              message: 'Admin finalize requires adminAdjudication=true',
            });
          }

          // Authorization of the target determination precedes all cache
          // reads; a finalize key cannot be replayed for another order.
          if (input.idempotencyKey) {
            const prior = await tx.returnFinancialDetermination.findFirst({
              where: { finalizeIdempotencyKey: input.idempotencyKey },
            });
            if (prior && prior.id !== det.id) {
              throw new ConflictException({
                code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
                message: 'Idempotency key is bound to a different determination',
              });
            }
            if (prior?.status === ReturnFinancialDeterminationStatus.FINALIZED) {
              const obligations = await tx.returnFinancialObligation.findMany({
                where: { determinationId: prior.id },
              });
              return { determination: prior, obligations, idempotent: true };
            }
          }

          if (det.status === ReturnFinancialDeterminationStatus.DISPUTED) {
            throw new ConflictException({
              code: 'RETURN_FINANCIAL_DISPUTED',
              message: 'Cannot finalize a disputed determination',
            });
          }
          if (
            det.status !== ReturnFinancialDeterminationStatus.ACKNOWLEDGED &&
            det.status !== ReturnFinancialDeterminationStatus.PROPOSED &&
            actorRole !== 'ADMIN'
          ) {
            // Merchant must acknowledge before finalize in normal path;
            // allow PROPOSED→FINALIZED when already merchant-owned propose+finalize in one flow via ack first.
            // Spec: PENDING → PROPOSED → ACKNOWLEDGED → FINALIZED
            throw new BadRequestException({
              code: 'DETERMINATION_ACK_REQUIRED',
              message: 'Determination must be ACKNOWLEDGED before finalize',
            });
          }

          if (
            det.outcome !==
            ReturnFinancialDeterminationOutcome.QUALIFYING_FULL_RETURN
          ) {
            // Non-money outcomes: finalize status only, no obligations
            const updated = await tx.returnFinancialDetermination.update({
              where: { id: det.id },
              data: {
                status: ReturnFinancialDeterminationStatus.FINALIZED,
                finalizedByActorType:
                  actorRole === 'ADMIN' ? 'SYSTEM_ADMIN' : 'MERCHANT_OWNER',
                finalizedByActorId: input.actorUserId,
                finalizedAt: new Date(),
                finalizeIdempotencyKey: input.idempotencyKey,
                reason: input.reason ?? det.reason,
                correlationId: input.correlationId ?? det.correlationId,
              },
            });
            await this.events.record({
              tx,
              aggregateType: 'WK_ORDER',
              aggregateId: String(order.id),
              wkOrderId: order.id,
              fulfillmentId: fulfillment.id,
              actorId: input.actorUserId,
              actorType: actorRole === 'ADMIN' ? 'SYSTEM_ADMIN' : 'MERCHANT_OWNER',
              action: 'RETURN_FINANCIAL_DETERMINATION_FINALIZED',
              previousState: det.status,
              newState: updated.status,
              correlationId: input.correlationId,
              metadata: {
                determinationId: det.id,
                outcome: det.outcome,
                moneyCreated: false,
              },
            });
            return { determination: updated, obligations: [], idempotent: false };
          }

          // Re-check terms (never mutate old hashes)
          if (!det.merchantTermsVersionId || !det.customerTermsVersionId) {
            throw new ForbiddenException({
              code: 'RETURN_FINANCIAL_MANUAL_DETERMINATION_REQUIRED',
              message: 'Automatic formula requires accepted Stage 9 terms binding',
            });
          }
          await this.terms.assertTermsImmutable(det.merchantTermsVersionId);
          await this.terms.assertTermsImmutable(det.customerTermsVersionId);
          const applicable = await this.terms.assertAutomaticFormulaApplicable(
            det.wkOrderId,
          );
          if (
            applicable.merchantTerms.id !== det.merchantTermsVersionId ||
            applicable.customerTerms.id !== det.customerTermsVersionId
          ) {
            throw new ForbiddenException({
              code: 'RETURN_FINANCIAL_MANUAL_DETERMINATION_REQUIRED',
              message:
                'Applicable Stage 9 terms changed after determination proposal',
            });
          }

          let snapshotPrincipal: Prisma.Decimal | null = null;
          let snapshotReimbursed: Prisma.Decimal | null = null;
          let merchantToRider = MONEY(0);
          let merchantToCustomer = MONEY(0);
          let raId: string | null = det.riderAdvanceId;
          let creditorRiderId: string | null = null;

          if (det.path === PATH_ORDINARY) {
            if (det.ordinaryRefundPrincipal == null) {
              throw new BadRequestException({
                code: 'ORDINARY_REFUND_PRINCIPAL_REQUIRED',
                message: 'ordinaryRefundPrincipal required for ordinary path',
              });
            }
            // VERIFIED stays VERIFIED — do not mutate
            if (order.merchantPaymentStatus !== MerchantPaymentStatus.VERIFIED) {
              throw new ForbiddenException({
                code: 'ORDINARY_PAYMENT_NOT_VERIFIED',
                message: 'Merchant payment must remain VERIFIED',
              });
            }
            merchantToCustomer = MONEY(det.ordinaryRefundPrincipal);
            snapshotPrincipal = merchantToCustomer;
            snapshotReimbursed = MONEY(0);
          } else {
            // RA path
            if (!raId) {
              const raLookup = await tx.riderAdvance.findFirst({
                where: {
                  wkOrderId: order.id,
                  status: { not: RiderAdvanceStatus.CANCELLED },
                },
                orderBy: { createdAt: 'desc' },
              });
              raId = raLookup?.id ?? null;
            }
            if (!raId) {
              throw new BadRequestException({
                code: 'NO_PRINCIPAL',
                message:
                  'No Rider Advance on order; cannot invent reimbursement principal',
              });
            }

            await tx.$queryRaw`
              SELECT id FROM "rider_advances" WHERE id = ${raId}::uuid FOR UPDATE
            `;
            const ra = await tx.riderAdvance.findUniqueOrThrow({
              where: { id: raId },
            });
            creditorRiderId = ra.riderId;

            if (ra.reimbursementPrincipal == null) {
              throw new BadRequestException({
                code: 'NO_PRINCIPAL',
                message:
                  'Rider Advance has no reimbursementPrincipal; return alone never invents P',
              });
            }

            const P = MONEY(ra.reimbursementPrincipal);
            if (P.lte(0)) {
              throw new BadRequestException({
                code: 'NO_PRINCIPAL',
                message: 'reimbursementPrincipal must be > 0',
              });
            }

            // Re-read R under RA lock
            const R = await this.collectibility.sumAcknowledgedReimbursement(
              tx,
              ra.id,
            );
            if (R.lt(0) || R.gt(P)) {
              throw new ConflictException({
                code: 'INVALID_REIMBURSEMENT_SNAPSHOT',
                message: 'Acknowledged reimbursement R must satisfy 0 ≤ R ≤ P',
              });
            }

            snapshotPrincipal = P;
            snapshotReimbursed = R;
            merchantToRider = P.sub(R).toDecimalPlaces(2);
            merchantToCustomer = R;
          }

          // Cross-stage authority check BEFORE any Stage 9 FINALIZED mutation.
          await this.assertNoOverlappingStage12Authority(tx, {
            wkOrderId: order.id,
            path:
              det.path === PATH_ORDINARY
                ? 'ORDINARY_MERCHANT_PAYMENT'
                : 'RIDER_ADVANCE',
            grossPrincipal: snapshotPrincipal ?? MONEY(0),
            merchantToRiderAmount: merchantToRider,
            merchantToCustomerAmount: merchantToCustomer,
            riderAdvanceId: raId,
          });

          const now = new Date();
          const updated = await tx.returnFinancialDetermination.update({
            where: { id: det.id },
            data: {
              status: ReturnFinancialDeterminationStatus.FINALIZED,
              riderAdvanceId: raId,
              snapshotPrincipal,
              snapshotReimbursed,
              merchantToRiderAmount: merchantToRider.gt(0)
                ? merchantToRider
                : MONEY(0),
              merchantToCustomerAmount: merchantToCustomer.gt(0)
                ? merchantToCustomer
                : MONEY(0),
              finalizedByActorType:
                actorRole === 'ADMIN' ? 'SYSTEM_ADMIN' : 'MERCHANT_OWNER',
              finalizedByActorId: input.actorUserId,
              finalizedAt: now,
              finalizeIdempotencyKey: input.idempotencyKey,
              correlationId: input.correlationId ?? det.correlationId,
              // Ensure ACK if jumping from PROPOSED via owner finalize after implicit ack
              acknowledgedAt: det.acknowledgedAt ?? now,
              acknowledgedByActorId:
                det.acknowledgedByActorId ?? input.actorUserId,
              acknowledgedByActorType:
                det.acknowledgedByActorType ??
                (actorRole === 'ADMIN' ? 'SYSTEM_ADMIN' : 'MERCHANT_OWNER'),
            },
          });

          const obligations: Array<{
            id: string;
            type: ReturnFinancialObligationType;
            principal: Prisma.Decimal;
          }> = [];

          if (merchantToRider.gt(0)) {
            if (!creditorRiderId) {
              throw new ConflictException({
                code: 'CREDITOR_RIDER_REQUIRED',
                message: 'Creditor rider missing for repayment obligation',
              });
            }
            const obl = await tx.returnFinancialObligation.create({
              data: {
                id: randomUUID(),
                determinationId: det.id,
                wkOrderId: order.id,
                merchantId: order.merchantId,
                type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
                debtorType: ReturnFinancialPartyType.MERCHANT,
                debtorMerchantId: order.merchantId,
                creditorType: ReturnFinancialPartyType.RIDER,
                creditorUserId: creditorRiderId,
                principal: merchantToRider,
                currency: det.currency,
                status: ReturnFinancialObligationStatus.OPEN,
                reason: 'Stage 9 P−R merchant→rider repayment',
                correlationId: input.correlationId,
              },
            });
            obligations.push(obl);
            await this.events.record({
              tx,
              aggregateType: 'WK_ORDER',
              aggregateId: String(order.id),
              wkOrderId: order.id,
              actorId: input.actorUserId,
              actorType: 'SYSTEM',
              action: 'RETURN_REPAYMENT_OBLIGATION_CREATED',
              previousState: null,
              newState: obl.status,
              correlationId: input.correlationId,
              metadata: {
                obligationId: obl.id,
                principal: merchantToRider.toFixed(2),
                creditorUserId: creditorRiderId,
              },
            });
          }

          if (merchantToCustomer.gt(0)) {
            const obl = await tx.returnFinancialObligation.create({
              data: {
                id: randomUUID(),
                determinationId: det.id,
                wkOrderId: order.id,
                merchantId: order.merchantId,
                type: ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
                debtorType: ReturnFinancialPartyType.MERCHANT,
                debtorMerchantId: order.merchantId,
                creditorType: ReturnFinancialPartyType.CUSTOMER,
                creditorUserId: order.userId,
                principal: merchantToCustomer,
                currency: det.currency,
                status: ReturnFinancialObligationStatus.OPEN,
                reason:
                  det.path === PATH_ORDINARY
                    ? 'Stage 9 ordinary merchant→customer refund'
                    : 'Stage 9 R merchant→customer refund',
                correlationId: input.correlationId,
              },
            });
            obligations.push(obl);
            await this.events.record({
              tx,
              aggregateType: 'WK_ORDER',
              aggregateId: String(order.id),
              wkOrderId: order.id,
              actorId: input.actorUserId,
              actorType: 'SYSTEM',
              action: 'RETURN_REFUND_OBLIGATION_CREATED',
              previousState: null,
              newState: obl.status,
              correlationId: input.correlationId,
              metadata: {
                obligationId: obl.id,
                principal: merchantToCustomer.toFixed(2),
                creditorUserId: order.userId,
              },
            });
          }

          // Collection restriction when P−R > 0 on RA path
          if (
            det.path !== PATH_ORDINARY &&
            raId &&
            merchantToRider.gt(0)
          ) {
            await tx.riderAdvanceCollectionRestriction.create({
              data: {
                id: randomUUID(),
                riderAdvanceId: raId,
                wkOrderId: order.id,
                returnFinancialDeterminationId: det.id,
                restrictedAmount: merchantToRider,
                effect:
                  RiderAdvanceCollectionRestrictionEffect.TRANSFER_OUTSTANDING_TO_MERCHANT_RETURN_RESOLUTION,
                status: RiderAdvanceCollectionRestrictionStatus.ACTIVE,
                createdByActorType:
                  actorRole === 'ADMIN' ? 'SYSTEM_ADMIN' : 'MERCHANT_OWNER',
                createdByActorId: input.actorUserId,
                correlationId: input.correlationId,
              },
            });
            await this.events.record({
              tx,
              aggregateType: 'WK_ORDER',
              aggregateId: String(order.id),
              wkOrderId: order.id,
              actorId: input.actorUserId,
              actorType: 'SYSTEM',
              action: 'CUSTOMER_REIMBURSEMENT_COLLECTION_RESTRICTED',
              previousState: null,
              newState: 'ACTIVE',
              correlationId: input.correlationId,
              metadata: {
                riderAdvanceId: raId,
                restrictedAmount: merchantToRider.toFixed(2),
                determinationId: det.id,
              },
            });
          }

          await this.events.record({
            tx,
            aggregateType: 'WK_ORDER',
            aggregateId: String(order.id),
            wkOrderId: order.id,
            fulfillmentId: fulfillment.id,
            actorId: input.actorUserId,
            actorType: actorRole === 'ADMIN' ? 'SYSTEM_ADMIN' : 'MERCHANT_OWNER',
            action: 'RETURN_FINANCIAL_DETERMINATION_FINALIZED',
            previousState: det.status,
            newState: updated.status,
            correlationId: input.correlationId,
            metadata: {
              determinationId: det.id,
              snapshotPrincipal: snapshotPrincipal?.toFixed(2),
              snapshotReimbursed: snapshotReimbursed?.toFixed(2),
              merchantToRiderAmount: merchantToRider.toFixed(2),
              merchantToCustomerAmount: merchantToCustomer.toFixed(2),
              path: det.path,
            },
          });

          return { determination: updated, obligations, idempotent: false };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }
}
