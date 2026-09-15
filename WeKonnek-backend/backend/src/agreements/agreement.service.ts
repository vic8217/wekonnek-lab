import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgreementAcceptanceMethod,
  AgreementPartyRole,
  AgreementProvenance,
  AgreementStatus,
  AgreementType,
  AgreementVersionStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import {
  AGREEMENT_CANONICAL_SCHEMA,
  buildMerchantTradeTerms,
  verifyTermsIntegrity,
} from './agreement-canonical';

export type AgreementActor = {
  userId: string;
  /** Server-derived role for this action */
  partyRole: AgreementPartyRole;
};

@Injectable()
export class AgreementService {
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

  /**
   * Create MERCHANT_TRADE agreement + version for a WkOrder.
   * provenance LEGACY_SNAPSHOT when auto-created (no explicit acceptance claimed).
   */
  async offerMerchantTradeForOrder(
    wkOrderId: number,
    options: {
      provenance: AgreementProvenance;
      correlationId?: string;
      expiresAt?: Date | null;
      tx?: Prisma.TransactionClient;
    },
  ) {
    const run = async (tx: Prisma.TransactionClient) => {
      const existing = await tx.agreement.findFirst({
        where: { wkOrderId, agreementType: AgreementType.MERCHANT_TRADE },
      });
      if (existing) return existing;

      const order = await tx.wkOrder.findUniqueOrThrow({
        where: { id: wkOrderId },
        include: {
          merchant: true,
          orderItems: true,
        },
      });

      const { terms, termsHash } = buildMerchantTradeTerms({
        wkOrderId: order.id,
        orderCode: order.orderCode,
        buyerId: order.userId,
        merchantId: order.merchantId,
        merchantName: order.merchant.name,
        shopId: order.shopId,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        paymentRef: order.paymentRef,
        totalAmount: order.totalAmount,
        deliveryFee: order.deliveryFee,
        discountAmount: order.discountAmount,
        transactionFeeAmount: order.transactionFeeAmount,
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
      const requiredPartyRoles: AgreementPartyRole[] = [
        AgreementPartyRole.CUSTOMER,
      ];

      await tx.agreement.create({
        data: {
          id: agreementId,
          agreementType: AgreementType.MERCHANT_TRADE,
          status: AgreementStatus.OFFERED,
          provenance: options.provenance,
          wkOrderId: order.id,
          requiredPartyRoles,
        },
      });

      await tx.agreementVersion.create({
        data: {
          id: versionId,
          agreementId,
          versionNumber: 1,
          status: AgreementVersionStatus.OFFERED,
          canonicalSchema: AGREEMENT_CANONICAL_SCHEMA,
          termsSnapshot: terms as unknown as Prisma.InputJsonValue,
          termsHash,
          expiresAt: options.expiresAt ?? undefined,
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
            role: AgreementPartyRole.MERCHANT,
            merchantId: order.merchantId,
            historicalLabel: order.merchant.name,
          },
        ],
      });

      await this.events.record({
        tx,
        aggregateType: 'AGREEMENT',
        aggregateId: agreementId,
        wkOrderId: order.id,
        action: 'AGREEMENT_CREATED',
        newState: AgreementStatus.OFFERED,
        correlationId: options.correlationId,
        metadata: {
          agreementType: AgreementType.MERCHANT_TRADE,
          provenance: options.provenance,
          versionId,
          termsHash,
        },
      });
      await this.events.record({
        tx,
        aggregateType: 'AGREEMENT',
        aggregateId: agreementId,
        wkOrderId: order.id,
        action: 'AGREEMENT_VERSION_OFFERED',
        newState: AgreementVersionStatus.OFFERED,
        correlationId: options.correlationId,
        metadata: { versionId, versionNumber: 1, termsHash },
      });

      return tx.agreement.findUniqueOrThrow({ where: { id: agreementId } });
    };

    if (options.tx) return run(options.tx);
    return this.prisma.$transaction(run);
  }

  /** RIDER_ADVANCE is schema-only in Stage 2A — refuse operational activation. */
  assertRiderAdvanceNotActivated(agreementType: AgreementType) {
    if (agreementType === AgreementType.RIDER_ADVANCE) {
      throw new BadRequestException({
        code: 'RIDER_ADVANCE_NOT_ACTIVATED',
        message:
          'Rider Advance is schema/framework capability only in Stage 2A',
      });
    }
  }

  async getAgreement(agreementId: string, actorUserId: string) {
    const agreement = await this.prisma.agreement.findUnique({
      where: { id: agreementId },
      include: {
        versions: { orderBy: { versionNumber: 'asc' } },
        parties: true,
        currentVersion: { include: { acceptances: true } },
        evidences: { orderBy: { createdAt: 'asc' } },
        custodyEvents: { orderBy: { occurredAt: 'asc' } },
        trustTrade: true,
      },
    });
    if (!agreement) throw new NotFoundException('Agreement not found');
    await this.assertCanRead(agreement, actorUserId);
    return agreement;
  }

  async acceptVersion(input: {
    agreementVersionId: string;
    actor: AgreementActor;
    method: AgreementAcceptanceMethod;
    correlationId?: string;
  }) {
    if (
      input.method === AgreementAcceptanceMethod.QR_CONFIRMATION ||
      input.method === AgreementAcceptanceMethod.OTP_CONFIRMATION
    ) {
      throw new BadRequestException(
        'QR/OTP acceptance methods are not active in Stage 2A',
      );
    }

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "agreement_versions" WHERE id = ${input.agreementVersionId}::uuid FOR UPDATE
        `;
        if (!locked.length) throw new NotFoundException('Agreement version not found');

        const version = await tx.agreementVersion.findUniqueOrThrow({
          where: { id: input.agreementVersionId },
          include: {
            agreement: { include: { parties: true } },
            acceptances: true,
          },
        });
        this.assertRiderAdvanceNotActivated(version.agreement.agreementType);

        await this.assertPartyRole(
          version.agreement,
          input.actor.userId,
          input.actor.partyRole,
        );

        if (
          version.status === AgreementVersionStatus.EXPIRED ||
          (version.expiresAt && version.expiresAt.getTime() <= Date.now())
        ) {
          if (version.status !== AgreementVersionStatus.EXPIRED) {
            await tx.agreementVersion.update({
              where: { id: version.id },
              data: { status: AgreementVersionStatus.EXPIRED },
            });
          }
          throw new BadRequestException('Agreement version has expired');
        }

        const blockedVersion: AgreementVersionStatus[] = [
          AgreementVersionStatus.SUPERSEDED,
          AgreementVersionStatus.CANCELLED,
          AgreementVersionStatus.DECLINED,
        ];
        if (blockedVersion.includes(version.status)) {
          throw new BadRequestException(
            `Cannot accept version in status ${version.status}`,
          );
        }

        const blockedAgreement: AgreementStatus[] = [
          AgreementStatus.CANCELLED,
          AgreementStatus.SUPERSEDED,
          AgreementStatus.EXPIRED,
        ];
        if (blockedAgreement.includes(version.agreement.status)) {
          throw new BadRequestException(
            `Cannot accept agreement in status ${version.agreement.status}`,
          );
        }

        const existing = version.acceptances.find(
          (a) =>
            a.actorUserId === input.actor.userId &&
            a.partyRole === input.actor.partyRole,
        );
        if (existing) {
          return { acceptance: existing, idempotent: true, agreement: version.agreement };
        }

        let acceptance;
        try {
          acceptance = await tx.agreementAcceptance.create({
            data: {
              id: randomUUID(),
              agreementVersionId: version.id,
              actorUserId: input.actor.userId,
              partyRole: input.actor.partyRole,
              acceptanceMethod: input.method,
              termsHash: version.termsHash,
              correlationId: input.correlationId,
            },
          });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            const raced = await tx.agreementAcceptance.findFirst({
              where: {
                agreementVersionId: version.id,
                actorUserId: input.actor.userId,
                partyRole: input.actor.partyRole,
              },
            });
            if (raced) {
              return {
                acceptance: raced,
                idempotent: true,
                agreement: version.agreement,
              };
            }
          }
          throw err;
        }

        const allAcceptances = [...version.acceptances, acceptance];
        const required = (version.agreement.requiredPartyRoles as AgreementPartyRole[]) ?? [];
        const satisfied = required.every((role) =>
          allAcceptances.some((a) => a.partyRole === role),
        );

        if (satisfied) {
          await tx.agreementVersion.update({
            where: { id: version.id },
            data: { status: AgreementVersionStatus.ACCEPTED },
          });
          await tx.agreement.update({
            where: { id: version.agreementId },
            data: {
              status: AgreementStatus.ACCEPTED,
              provenance:
                version.agreement.provenance === AgreementProvenance.LEGACY_SNAPSHOT
                  ? AgreementProvenance.EXPLICIT_ACCEPTANCE
                  : version.agreement.provenance,
            },
          });
        }

        await this.events.record({
          tx,
          aggregateType: 'AGREEMENT',
          aggregateId: version.agreementId,
          wkOrderId: version.agreement.wkOrderId,
          actorId: input.actor.userId,
          actorType:
            input.actor.partyRole === 'CUSTOMER'
              ? 'CUSTOMER'
              : input.actor.partyRole === 'RIDER'
                ? 'RIDER'
                : 'MERCHANT_OWNER',
          action: 'AGREEMENT_ACCEPTED',
          previousState: version.status,
          newState: satisfied
            ? AgreementVersionStatus.ACCEPTED
            : version.status,
          correlationId: input.correlationId,
          metadata: {
            versionId: version.id,
            partyRole: input.actor.partyRole,
            fullyAccepted: satisfied,
            termsHash: version.termsHash,
          },
        });

        return {
          acceptance,
          idempotent: false,
          agreement: await tx.agreement.findUniqueOrThrow({
            where: { id: version.agreementId },
          }),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async declineVersion(input: {
    agreementVersionId: string;
    actor: AgreementActor;
    correlationId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "agreement_versions" WHERE id = ${input.agreementVersionId}::uuid FOR UPDATE
      `;
      const version = await tx.agreementVersion.findUniqueOrThrow({
        where: { id: input.agreementVersionId },
        include: { agreement: { include: { parties: true } } },
      });
      await this.assertPartyRole(
        version.agreement,
        input.actor.userId,
        input.actor.partyRole,
      );
      if (version.status !== AgreementVersionStatus.OFFERED) {
        throw new BadRequestException('Only offered versions can be declined');
      }
      await tx.agreementVersion.update({
        where: { id: version.id },
        data: { status: AgreementVersionStatus.DECLINED },
      });
      await tx.agreement.update({
        where: { id: version.agreementId },
        data: { status: AgreementStatus.DECLINED },
      });
      await this.events.record({
        tx,
        aggregateType: 'AGREEMENT',
        aggregateId: version.agreementId,
        wkOrderId: version.agreement.wkOrderId,
        actorId: input.actor.userId,
        action: 'AGREEMENT_DECLINED',
        previousState: AgreementVersionStatus.OFFERED,
        newState: AgreementVersionStatus.DECLINED,
        correlationId: input.correlationId,
      });
      return { ok: true };
    });
  }

  async offerAmendment(input: {
    agreementId: string;
    actorUserId: string;
    reason: string;
    termsBuilder: () => ReturnType<typeof buildMerchantTradeTerms>;
    correlationId?: string;
  }) {
    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM "agreements" WHERE id = ${input.agreementId}::uuid FOR UPDATE
        `;
        const agreement = await tx.agreement.findUniqueOrThrow({
          where: { id: input.agreementId },
          include: {
            parties: true,
            currentVersion: true,
            versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
          },
        });
        this.assertRiderAdvanceNotActivated(agreement.agreementType);
        await this.assertMerchantOperator(input.actorUserId, agreement);

        if (!agreement.currentVersion) {
          throw new BadRequestException('Agreement has no current version');
        }
        if (agreement.currentVersion.status === AgreementVersionStatus.OFFERED) {
          // Competing amendment: supersede open offer first
        }

        const nextNumber = (agreement.versions[0]?.versionNumber ?? 0) + 1;
        const built = input.termsBuilder();
        const versionId = randomUUID();

        if (agreement.currentVersion.status === AgreementVersionStatus.OFFERED) {
          await tx.agreementVersion.update({
            where: { id: agreement.currentVersion.id },
            data: { status: AgreementVersionStatus.SUPERSEDED },
          });
        }
        // ACCEPTED prior versions remain ACCEPTED historically (immutable).

        try {
          await tx.agreementVersion.create({
            data: {
              id: versionId,
              agreementId: agreement.id,
              versionNumber: nextNumber,
              status: AgreementVersionStatus.OFFERED,
              canonicalSchema: AGREEMENT_CANONICAL_SCHEMA,
              termsSnapshot: built.terms as unknown as Prisma.InputJsonValue,
              termsHash: built.termsHash,
              supersedesVersionId: agreement.currentVersion.id,
              amendmentReason: input.reason,
              amendedByUserId: input.actorUserId,
            },
          });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            throw new ConflictException('Agreement version number conflict');
          }
          throw err;
        }

        await tx.agreement.update({
          where: { id: agreement.id },
          data: {
            currentVersionId: versionId,
            status: AgreementStatus.OFFERED,
          },
        });

        // Mark prior accepted agreement as superseded at agreement level only when replacing accepted
        if (agreement.status === AgreementStatus.ACCEPTED) {
          await tx.agreement.update({
            where: { id: agreement.id },
            data: { status: AgreementStatus.OFFERED },
          });
        }

        await this.events.record({
          tx,
          aggregateType: 'AGREEMENT',
          aggregateId: agreement.id,
          wkOrderId: agreement.wkOrderId,
          actorId: input.actorUserId,
          actorType: 'MERCHANT_OWNER',
          action: 'AGREEMENT_SUPERSEDED',
          reason: input.reason,
          correlationId: input.correlationId,
          metadata: {
            priorVersionId: agreement.currentVersion.id,
            newVersionId: versionId,
            versionNumber: nextNumber,
            termsHash: built.termsHash,
          },
        });
        await this.events.record({
          tx,
          aggregateType: 'AGREEMENT',
          aggregateId: agreement.id,
          wkOrderId: agreement.wkOrderId,
          actorId: input.actorUserId,
          action: 'AGREEMENT_VERSION_OFFERED',
          correlationId: input.correlationId,
          metadata: { versionId, versionNumber: nextNumber },
        });

        return tx.agreementVersion.findUniqueOrThrow({ where: { id: versionId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async cancelAgreement(input: {
    agreementId: string;
    actorUserId: string;
    reason?: string;
    correlationId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "agreements" WHERE id = ${input.agreementId}::uuid FOR UPDATE
      `;
      const agreement = await tx.agreement.findUniqueOrThrow({
        where: { id: input.agreementId },
        include: { parties: true, currentVersion: true },
      });
      await this.assertMerchantOperator(input.actorUserId, agreement);

      await tx.agreement.update({
        where: { id: agreement.id },
        data: {
          status: AgreementStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: input.actorUserId,
          cancellationReason: input.reason,
        },
      });
      // Do not delete versions/acceptances
      await this.events.record({
        tx,
        aggregateType: 'AGREEMENT',
        aggregateId: agreement.id,
        wkOrderId: agreement.wkOrderId,
        actorId: input.actorUserId,
        action: 'AGREEMENT_CANCELLED',
        previousState: agreement.status,
        newState: AgreementStatus.CANCELLED,
        reason: input.reason,
        correlationId: input.correlationId,
      });
      return { ok: true };
    });
  }

  async expireOfferedVersion(versionId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "agreement_versions" WHERE id = ${versionId}::uuid FOR UPDATE
      `;
      const version = await tx.agreementVersion.findUniqueOrThrow({
        where: { id: versionId },
        include: { agreement: true },
      });
      if (version.status !== AgreementVersionStatus.OFFERED) {
        return { expired: false };
      }
      if (!version.expiresAt || version.expiresAt.getTime() > Date.now()) {
        throw new BadRequestException('Version is not past expiry');
      }
      await tx.agreementVersion.update({
        where: { id: version.id },
        data: { status: AgreementVersionStatus.EXPIRED },
      });
      if (version.agreement.currentVersionId === version.id) {
        await tx.agreement.update({
          where: { id: version.agreementId },
          data: { status: AgreementStatus.EXPIRED },
        });
      }
      await this.events.record({
        tx,
        aggregateType: 'AGREEMENT',
        aggregateId: version.agreementId,
        wkOrderId: version.agreement.wkOrderId,
        action: 'AGREEMENT_EXPIRED',
        newState: AgreementVersionStatus.EXPIRED,
      });
      return { expired: true };
    });
  }

  async verifyIntegrity(versionId: string) {
    const version = await this.prisma.agreementVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new NotFoundException('Agreement version not found');
    const result = verifyTermsIntegrity(version.termsSnapshot, version.termsHash);
    if (result.status === 'invalid') {
      await this.events.record({
        aggregateType: 'AGREEMENT',
        aggregateId: version.agreementId,
        action: 'AGREEMENT_INTEGRITY_CHECK_FAILED',
        metadata: { versionId, expected: result.expected, actual: result.actual },
      });
    }
    return result;
  }

  /** Integrity is private agreement information; a version id is not authority. */
  async verifyIntegrityForActor(versionId: string, actorUserId: string) {
    const version = await this.prisma.agreementVersion.findUnique({
      where: { id: versionId },
      include: { agreement: { include: { parties: true } } },
    });
    if (!version) throw new NotFoundException('Agreement version not found');
    await this.assertCanRead(version.agreement, actorUserId);
    return this.verifyIntegrity(versionId);
  }

  /**
   * Accepted versions are immutable — refuse any terms mutation API.
   */
  async assertVersionImmutable(versionId: string) {
    const version = await this.prisma.agreementVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new NotFoundException('Agreement version not found');
    if (version.status === AgreementVersionStatus.ACCEPTED) {
      throw new ForbiddenException(
        'Accepted agreement versions cannot be mutated',
      );
    }
    return version;
  }

  private async assertCanRead(
    agreement: {
      wkOrderId: number | null;
      parties: Array<{
        role: AgreementPartyRole;
        userId: string | null;
        merchantId: number | null;
      }>;
    },
    actorUserId: string,
  ) {
    const asCustomer = agreement.parties.some(
      (p) => p.role === AgreementPartyRole.CUSTOMER && p.userId === actorUserId,
    );
    if (asCustomer) return;

    const merchantParty = agreement.parties.find(
      (p) => p.role === AgreementPartyRole.MERCHANT && p.merchantId != null,
    );
    if (merchantParty?.merchantId != null) {
      const op = await this.prisma.merchant.findFirst({
        where: {
          id: merchantParty.merchantId,
          OR: [
            { userId: actorUserId },
            { merchantStaff: { some: { userId: actorUserId, isActive: true } } },
          ],
        },
        select: { id: true },
      });
      if (op) return;
    }

    const asRider = agreement.parties.some(
      (p) => p.role === AgreementPartyRole.RIDER && p.userId === actorUserId,
    );
    if (asRider) return;

    // Active fulfillment assignment may grant read for custody context without rewriting party
    if (agreement.wkOrderId != null) {
      const fulfillment = await this.prisma.orderFulfillment.findUnique({
        where: { wkOrderId: agreement.wkOrderId },
        select: { activeRiderId: true },
      });
      if (fulfillment?.activeRiderId === actorUserId) return;
    }

    throw new ForbiddenException('Not authorized to view this agreement');
  }

  private async assertPartyRole(
    agreement: {
      parties: Array<{
        role: AgreementPartyRole;
        userId: string | null;
        merchantId: number | null;
      }>;
    },
    actorUserId: string,
    partyRole: AgreementPartyRole,
  ) {
    const party = agreement.parties.find((p) => p.role === partyRole);
    if (!party) {
      throw new ForbiddenException(`Agreement has no ${partyRole} party`);
    }
    if (partyRole === AgreementPartyRole.CUSTOMER) {
      if (party.userId !== actorUserId) {
        throw new ForbiddenException('Customer may only accept as themselves');
      }
      return;
    }
    if (partyRole === AgreementPartyRole.RIDER) {
      // Named rider party identity — not current assignment overwrite
      if (party.userId !== actorUserId) {
        throw new ForbiddenException(
          'Rider acceptance requires the named agreement party rider',
        );
      }
      return;
    }
    if (partyRole === AgreementPartyRole.MERCHANT) {
      if (party.merchantId == null) {
        throw new ForbiddenException('Merchant party missing merchantId');
      }
      await this.assertMerchantOperator(actorUserId, {
        parties: agreement.parties,
      });
      return;
    }
    throw new ForbiddenException('Unsupported party role for acceptance');
  }

  private async assertMerchantOperator(
    actorUserId: string,
    agreement: {
      parties: Array<{
        role: AgreementPartyRole;
        merchantId: number | null;
      }>;
    },
  ) {
    const merchantParty = agreement.parties.find(
      (p) => p.role === AgreementPartyRole.MERCHANT,
    );
    if (merchantParty?.merchantId == null) {
      throw new ForbiddenException('No merchant party on agreement');
    }
    const op = await this.prisma.merchant.findFirst({
      where: {
        id: merchantParty.merchantId,
        OR: [
          { userId: actorUserId },
          { merchantStaff: { some: { userId: actorUserId, isActive: true } } },
        ],
      },
      select: { id: true },
    });
    if (!op) {
      throw new ForbiddenException(
        'Not an authorized merchant operator for this agreement',
      );
    }
  }
}

/** Stable content hash helper for evidence metadata (not encryption). */
export function hashEvidencePayload(parts: {
  contentType?: string | null;
  storageReference?: string | null;
  sizeBytes?: number | null;
}): string | null {
  if (!parts.storageReference && !parts.contentType) return null;
  return createHash('sha256')
    .update(
      JSON.stringify({
        contentType: parts.contentType ?? null,
        storageReference: parts.storageReference ?? null,
        sizeBytes: parts.sizeBytes ?? null,
      }),
    )
    .digest('hex');
}
