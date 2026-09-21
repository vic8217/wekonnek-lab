import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClaimEvidenceKind,
  ClaimEvidenceProvenance,
  ClaimEvidenceVisibility,
  ClaimVerificationStatus,
  CustodyEventType,
  EconomicLossCoverageSourceKind,
  EconomicLossKind,
  ExceptionClaimEventType,
  ExceptionClaimStatus,
  ExceptionClaimType,
  ExceptionFinancialObligationStatus,
  ExceptionLiabilityPolicyStatus,
  ExceptionLiablePartyType,
  GoodsNonConformanceReasonCode,
  LiabilityDeterminationStatus,
  Prisma,
  ReturnFinancialDeterminationStatus,
  UserRole,
  VerifiedFactType,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { withSerializableRetry as runSerializableRetry } from '../prisma/serializable-retry';
import {
  AllocationDraft,
  buildEconomicLossKey,
  buildOrderTermsSnapshot,
  computeCompensable,
  EXCEPTION_CLAIM_ACTIVE_STATUSES,
  EXCEPTION_FINANCIAL_CODES as CODES,
  EXCEPTION_LIABILITY_POLICY_V1,
  isServerReservedEvidenceKind,
  isTrustedOrderTermsSnapshot,
  presentClaimEvidenceProvenance,
  evaluateNonConformanceFactAttribution,
  evaluateNonConformanceLiabilityBasis,
  evaluateNonConformanceReasonForOpen,
  evaluateRecoveryEligibility,
  evaluateStage9FinalizeGate,
  isLiablePartyType,
  LIABILITY_DETERMINATION_ACTIVE_STATUSES,
  lossKindForClaimType,
  maxImportableCoverage,
  policyHash,
  remainingCompensable,
  stage9ObligationCoversLossKind,
  sumAmounts,
  toMoney,
  validateAllocations,
} from './exception-financial.policy';

type AdminActor = { type: 'SYSTEM_ADMIN'; id: string };
type Viewer = 'ADMIN' | 'PARTY' | 'DENIED';

@Injectable()
export class ExceptionFinancialService {
  constructor(private readonly prisma: PrismaService) {}

  private async withSerializableRetry<T>(
    run: () => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    return runSerializableRetry(run, attempts);
  }

  // ─── locking ────────────────────────────────────────────

  /**
   * Stage 12 lock order (extends the Stage 11 order without reordering it):
   *   orders → order_fulfillments → operations_recoveries → economic_losses
   *   → exception_claims → verified_facts → liability_determinations
   *   → exception_financial_obligations
   *
   * Every Stage 12 write path acquires the prefix it needs in this order, so
   * Stage 12 can never deadlock against Stage 9 / 11 which stop at
   * operations_recoveries.
   */
  private async lockOrderAndFulfillment(
    tx: Prisma.TransactionClient,
    wkOrderId: number,
  ) {
    await tx.$queryRaw`
      SELECT id FROM "orders" WHERE id = ${wkOrderId} FOR UPDATE
    `;
    const order = await tx.wkOrder.findUnique({ where: { id: wkOrderId } });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }
    const fulfillment = await tx.orderFulfillment.findUnique({
      where: { wkOrderId },
    });
    if (!fulfillment) {
      throw new NotFoundException({
        code: 'FULFILLMENT_MISSING',
        message: 'Fulfillment missing for order',
      });
    }
    await tx.$queryRaw`
      SELECT id FROM "order_fulfillments" WHERE id = ${fulfillment.id}::uuid FOR UPDATE
    `;
    const locked = await tx.orderFulfillment.findUnique({
      where: { id: fulfillment.id },
    });
    if (!locked) {
      throw new NotFoundException({
        code: 'FULFILLMENT_MISSING',
        message: 'Fulfillment missing',
      });
    }
    return { order, fulfillment: locked };
  }

  private async lockRecovery(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`
      SELECT id FROM "operations_recoveries" WHERE id = ${id}::uuid FOR UPDATE
    `;
    return tx.operationsRecovery.findUnique({ where: { id } });
  }

  private async lockEconomicLoss(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`
      SELECT id FROM "economic_losses" WHERE id = ${id}::uuid FOR UPDATE
    `;
    return tx.economicLoss.findUnique({ where: { id } });
  }

  private async lockClaim(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`
      SELECT id FROM "exception_claims" WHERE id = ${id}::uuid FOR UPDATE
    `;
    return tx.exceptionClaim.findUnique({ where: { id } });
  }

  private async lockVerifiedFacts(
    tx: Prisma.TransactionClient,
    claimId: string,
  ) {
    await tx.$queryRaw`
      SELECT id FROM "verified_facts"
      WHERE exception_claim_id = ${claimId}::uuid
      FOR UPDATE
    `;
    return tx.verifiedFact.findMany({
      where: { exceptionClaimId: claimId },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async lockDetermination(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`
      SELECT id FROM "liability_determinations" WHERE id = ${id}::uuid FOR UPDATE
    `;
    return tx.liabilityDetermination.findUnique({ where: { id } });
  }

  private async lockObligations(tx: Prisma.TransactionClient, claimId: string) {
    await tx.$queryRaw`
      SELECT id FROM "exception_financial_obligations"
      WHERE exception_claim_id = ${claimId}::uuid
      FOR UPDATE
    `;
  }

  // ─── helpers ────────────────────────────────────────────

  private stablePayloadHash(parts: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(parts))
      .digest('hex')
      .slice(0, 64);
  }

  private truncKey(key?: string | null): string | null {
    if (!key) return null;
    return key.slice(0, 64);
  }

  /** Stage 12 administration is SYSTEM_ADMIN only (UserRole.admin). */
  private async requireAdmin(actorUserId: string): Promise<AdminActor> {
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
    });
    if (!user || user.role !== UserRole.admin) {
      throw new ForbiddenException({
        code: CODES.FORBIDDEN,
        message: 'Only SYSTEM_ADMIN may manage exception financial liability',
      });
    }
    return { type: 'SYSTEM_ADMIN', id: actorUserId };
  }

  private requireAudit(correlationId?: string | null) {
    if (!correlationId?.trim()) {
      throw new BadRequestException({
        code: CODES.AUDIT_FIELDS_REQUIRED,
        message: 'correlationId is required',
      });
    }
  }

  private assertClaimActive(
    claim: { status: ExceptionClaimStatus },
    opts?: { allowFinalizedForAdjustment?: boolean },
  ) {
    if (
      opts?.allowFinalizedForAdjustment &&
      claim.status === ExceptionClaimStatus.FINALIZED
    ) {
      return;
    }
    if (!EXCEPTION_CLAIM_ACTIVE_STATUSES.includes(claim.status)) {
      throw new ConflictException({
        code: CODES.CLAIM_TERMINAL,
        message: `Claim is terminal (${claim.status})`,
      });
    }
  }

  private async appendClaimEvent(
    tx: Prisma.TransactionClient,
    input: {
      claimId: string;
      eventType: ExceptionClaimEventType;
      fromStatus?: ExceptionClaimStatus | null;
      toStatus?: ExceptionClaimStatus | null;
      actor: AdminActor;
      reason?: string | null;
      correlationId?: string | null;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    await tx.exceptionClaimEvent.create({
      data: {
        id: randomUUID(),
        exceptionClaimId: input.claimId,
        eventType: input.eventType,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        actorType: input.actor.type,
        actorId: input.actor.id,
        reason: input.reason?.slice(0, 2000) ?? null,
        correlationId: input.correlationId?.slice(0, 64) ?? null,
        metadata: input.metadata,
      },
    });
  }

  private async coveredAmount(
    tx: Prisma.TransactionClient,
    economicLossId: string,
  ): Promise<Prisma.Decimal> {
    const rows = await tx.economicLossCoverage.findMany({
      where: { economicLossId },
      select: { amount: true },
    });
    return sumAmounts(rows.map((r) => r.amount));
  }

  // ─── serialization ──────────────────────────────────────

  private serializeClaim(c: {
    id: string;
    wkOrderId: number;
    fulfillmentId: string;
    operationsRecoveryId: string;
    economicLossId: string;
    claimType: ExceptionClaimType;
    nonConformanceReasonCode: GoodsNonConformanceReasonCode | null;
    status: ExceptionClaimStatus;
    subjectRef: string;
    currency: string;
    claimedAmount: Prisma.Decimal | null;
    policyVersionId: string;
    policyHash: string;
    notes: string | null;
    correlationId: string;
    terminalReason: string | null;
    finalizedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: c.id,
      wkOrderId: c.wkOrderId,
      fulfillmentId: c.fulfillmentId,
      operationsRecoveryId: c.operationsRecoveryId,
      economicLossId: c.economicLossId,
      claimType: c.claimType,
      nonConformanceReasonCode: c.nonConformanceReasonCode,
      status: c.status,
      subjectRef: c.subjectRef,
      currency: c.currency,
      claimedAmount: c.claimedAmount?.toFixed(2) ?? null,
      policyVersionId: c.policyVersionId,
      policyHash: c.policyHash,
      notes: c.notes,
      correlationId: c.correlationId,
      terminalReason: c.terminalReason,
      finalizedAt: c.finalizedAt,
      createdAt: c.createdAt,
    };
  }

  /**
   * Party projection: lifecycle facts only. No evidence bodies, no other
   * parties' allocations, no admin-only investigation trail.
   */
  private minimalClaim(c: {
    id: string;
    wkOrderId: number;
    claimType: ExceptionClaimType;
    status: ExceptionClaimStatus;
    subjectRef: string;
    currency: string;
    createdAt: Date;
  }) {
    return {
      id: c.id,
      wkOrderId: c.wkOrderId,
      claimType: c.claimType,
      status: c.status,
      subjectRef: c.subjectRef,
      currency: c.currency,
      createdAt: c.createdAt,
    };
  }

  // ─── policy seeding ─────────────────────────────────────

  /** Idempotently ensures an ACTIVE Stage 12 liability policy version exists. */
  async ensureSeededPolicy() {
    const hash = policyHash(EXCEPTION_LIABILITY_POLICY_V1).slice(0, 64);
    const existing =
      await this.prisma.exceptionLiabilityPolicyVersion.findFirst({
        where: { policyHash: hash },
      });
    if (existing) {
      if (existing.status === ExceptionLiabilityPolicyStatus.ACTIVE) {
        return existing;
      }
      return this.prisma.exceptionLiabilityPolicyVersion.update({
        where: { id: existing.id },
        data: {
          status: ExceptionLiabilityPolicyStatus.ACTIVE,
          activatedAt: existing.activatedAt ?? new Date(),
        },
      });
    }
    try {
      return await this.prisma.exceptionLiabilityPolicyVersion.create({
        data: {
          id: randomUUID(),
          versionNumber: EXCEPTION_LIABILITY_POLICY_V1.version,
          policyHash: hash,
          canonicalPolicy: EXCEPTION_LIABILITY_POLICY_V1,
          status: ExceptionLiabilityPolicyStatus.ACTIVE,
          activatedAt: new Date(),
        },
      });
    } catch (e) {
      // Concurrent seed — re-read the winner.
      const raced = await this.prisma.exceptionLiabilityPolicyVersion.findFirst(
        {
          where: { policyHash: hash },
        },
      );
      if (raced) return raced;
      throw e;
    }
  }

  private async requireActivePolicy(tx: Prisma.TransactionClient) {
    const policy = await tx.exceptionLiabilityPolicyVersion.findFirst({
      where: { status: ExceptionLiabilityPolicyStatus.ACTIVE },
      orderBy: { versionNumber: 'desc' },
    });
    if (!policy) {
      throw new ConflictException({
        code: CODES.POLICY_NOT_ACTIVE,
        message:
          'No ACTIVE exception liability policy version; seed one before opening claims',
      });
    }
    return policy;
  }

  // ─── Trust Trade order-terms evidence ─────────────────────

  /**
   * Read-only immutable snapshot of authoritative WkOrder / OrderItem terms.
   * Never mutates historical order rows. Used as Stage12 evidence authority.
   */
  async snapshotOrderTerms(wkOrderId: number) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
      include: {
        orderItems: {
          include: {
            product: { select: { sku: true } },
            variant: { select: { sku: true } },
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException({
        code: CODES.CLAIM_NOT_FOUND,
        message: 'Order not found for terms snapshot',
      });
    }
    return buildOrderTermsSnapshot({
      wkOrderId: order.id,
      orderCode: order.orderCode,
      merchantId: order.merchantId,
      lines: order.orderItems.map((li) => ({
        id: li.id,
        productId: li.productId,
        variantId: li.variantId,
        productName: li.productName,
        quantity: li.quantity,
        price: li.price,
        subtotal: li.subtotal,
        productSku: li.product?.sku ?? null,
        variantSku: li.variant?.sku ?? null,
      })),
    });
  }

  /**
   * Attach an ORDER_TERMS_SNAPSHOT evidence row to a claim (admin-only).
   * Trusted internal writer: sets SERVER_ATTESTED_ORDER_TERMS. No HTTP caller
   * can opt into this provenance.
   */
  async attachOrderTermsEvidence(input: {
    claimId: string;
    actorUserId: string;
    correlationId: string;
    idempotencyKey?: string;
  }) {
    const actor = await this.requireAdmin(input.actorUserId);
    const claim = await this.prisma.exceptionClaim.findUnique({
      where: { id: input.claimId },
    });
    if (!claim) {
      throw new NotFoundException({
        code: CODES.CLAIM_NOT_FOUND,
        message: 'Exception claim not found',
      });
    }
    const snapshot = await this.snapshotOrderTerms(claim.wkOrderId);
    const payloadHash = this.stablePayloadHash({
      action: 'attachOrderTermsEvidence',
      claimId: input.claimId,
      wkOrderId: snapshot.wkOrderId,
      merchantId: snapshot.merchantId,
      orderCode: snapshot.orderCode,
    });
    return this.persistClaimEvidence({
      actor,
      claimId: input.claimId,
      evidenceKind: ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT,
      visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
      notes: 'Authoritative WkOrder / OrderItem terms snapshot',
      metadata: snapshot,
      provenance: ClaimEvidenceProvenance.SERVER_ATTESTED_ORDER_TERMS,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
    });
  }

  // ─── openClaimFromRecovery ──────────────────────────────

  async openClaimFromRecovery(input: {
    operationsRecoveryId: string;
    actorUserId: string;
    claimType: ExceptionClaimType | string;
    subjectRef: string;
    claimedAmount?: string | number | null;
    nonConformanceReasonCode?: string | null;
    correlationId: string;
    idempotencyKey?: string;
    notes?: string;
  }) {
    this.requireAudit(input.correlationId);
    const actor = await this.requireAdmin(input.actorUserId);

    const claimType = input.claimType as ExceptionClaimType;
    if (!Object.values(ExceptionClaimType).includes(claimType)) {
      throw new BadRequestException({
        code: CODES.CLAIM_TYPE_INVALID,
        message: 'Invalid claimType',
      });
    }
    const reasonGate = evaluateNonConformanceReasonForOpen({
      claimType,
      nonConformanceReasonCode: input.nonConformanceReasonCode,
    });
    if (!reasonGate.ok) {
      throw new BadRequestException({
        code: reasonGate.code,
        message: reasonGate.message,
      });
    }
    const nonConformanceReasonCode =
      claimType === ExceptionClaimType.GOODS_NON_CONFORMANCE
        ? (input.nonConformanceReasonCode as GoodsNonConformanceReasonCode)
        : null;
    const subjectRef = input.subjectRef?.trim();
    if (!subjectRef) {
      throw new BadRequestException({
        code: CODES.SUBJECT_REF_REQUIRED,
        message: 'subjectRef is required',
      });
    }

    const idemKey = this.truncKey(input.idempotencyKey);
    const payloadHash = this.stablePayloadHash({
      action: 'openClaimFromRecovery',
      operationsRecoveryId: input.operationsRecoveryId,
      claimType,
      subjectRef,
      claimedAmount: input.claimedAmount ?? null,
      nonConformanceReasonCode,
      notes: input.notes ?? null,
    });

    if (idemKey) {
      const prior = await this.prisma.exceptionClaim.findFirst({
        where: { openedByActorId: actor.id, openIdempotencyKey: idemKey },
      });
      if (prior) {
        return this.replayOpen(prior, input.operationsRecoveryId, payloadHash);
      }
    }

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const recoveryPeek = await tx.operationsRecovery.findUnique({
            where: { id: input.operationsRecoveryId },
          });
          if (!recoveryPeek) {
            throw new NotFoundException({
              code: CODES.RECOVERY_NOT_FOUND,
              message: 'Operations recovery not found',
            });
          }
          const { order, fulfillment } = await this.lockOrderAndFulfillment(
            tx,
            recoveryPeek.wkOrderId,
          );
          const recovery = await this.lockRecovery(
            tx,
            input.operationsRecoveryId,
          );
          if (!recovery) {
            throw new NotFoundException({
              code: CODES.RECOVERY_NOT_FOUND,
              message: 'Operations recovery not found',
            });
          }

          const eligibility = evaluateRecoveryEligibility({
            status: recovery.status,
            currentDisposition: recovery.currentDisposition,
          });
          if (!eligibility.ok) {
            throw new ForbiddenException({
              code: eligibility.code,
              message: eligibility.message,
            });
          }

          if (idemKey) {
            const racePrior = await tx.exceptionClaim.findFirst({
              where: {
                openedByActorId: actor.id,
                openIdempotencyKey: idemKey,
              },
            });
            if (racePrior) {
              return this.replayOpen(
                racePrior,
                input.operationsRecoveryId,
                payloadHash,
              );
            }
          }

          const policy = await this.requireActivePolicy(tx);
          const lossKind = lossKindForClaimType(claimType);
          const economicLoss = await this.upsertEconomicLoss(tx, {
            order,
            fulfillmentId: fulfillment.id,
            operationsRecoveryId: recovery.id,
            lossKind,
            subjectRef,
            claimedAmount: input.claimedAmount ?? null,
            actor,
            correlationId: input.correlationId,
          });

          const activeClaim = await tx.exceptionClaim.findFirst({
            where: {
              economicLossId: economicLoss.id,
              status: { in: EXCEPTION_CLAIM_ACTIVE_STATUSES },
            },
          });
          if (activeClaim) {
            throw new ConflictException({
              code: CODES.CLAIM_ALREADY_ACTIVE,
              message:
                'An active exception claim already exists for this economic loss',
            });
          }

          const claim = await tx.exceptionClaim.create({
            data: {
              id: randomUUID(),
              wkOrderId: order.id,
              fulfillmentId: fulfillment.id,
              operationsRecoveryId: recovery.id,
              economicLossId: economicLoss.id,
              policyVersionId: policy.id,
              policyHash: policy.policyHash,
              claimType,
              nonConformanceReasonCode,
              status: ExceptionClaimStatus.OPEN,
              subjectRef: subjectRef.slice(0, 200),
              currency: economicLoss.currency,
              claimedAmount:
                input.claimedAmount == null
                  ? null
                  : toMoney(input.claimedAmount),
              notes: input.notes?.slice(0, 2000) ?? null,
              openedByActorType: actor.type,
              openedByActorId: actor.id,
              correlationId: input.correlationId.slice(0, 64),
              openIdempotencyKey: idemKey,
              openPayloadHash: idemKey ? payloadHash : null,
            },
          });

          await this.appendClaimEvent(tx, {
            claimId: claim.id,
            eventType: ExceptionClaimEventType.CLAIM_OPENED,
            toStatus: ExceptionClaimStatus.OPEN,
            actor,
            reason: input.notes ?? null,
            correlationId: input.correlationId,
            metadata: {
              claimType,
              nonConformanceReasonCode,
              economicLossId: economicLoss.id,
              economicLossKey: economicLoss.economicLossKey,
              operationsRecoveryId: recovery.id,
            },
          });

          await tx.orderDomainEvent.create({
            data: {
              eventId: randomUUID().replace(/-/g, '').slice(0, 64),
              aggregateType: 'ORDER_FULFILLMENT',
              aggregateId: fulfillment.id,
              wkOrderId: order.id,
              fulfillmentId: fulfillment.id,
              actorId: actor.id,
              actorType: actor.type,
              action: 'EXCEPTION_CLAIM_OPENED',
              previousState: null,
              newState: ExceptionClaimStatus.OPEN,
              reason: claimType,
              correlationId: input.correlationId.slice(0, 64),
              metadata: {
                exceptionClaimId: claim.id,
                economicLossId: economicLoss.id,
                operationsRecoveryId: recovery.id,
              },
            },
          });

          return {
            code: 'EXCEPTION_CLAIM_OPENED',
            idempotent: false,
            claim: this.serializeClaim(claim),
            economicLoss: this.serializeEconomicLoss(economicLoss),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  private replayOpen(
    prior: Parameters<ExceptionFinancialService['serializeClaim']>[0] & {
      operationsRecoveryId: string;
      openPayloadHash: string | null;
    },
    operationsRecoveryId: string,
    payloadHash: string,
  ) {
    if (prior.operationsRecoveryId !== operationsRecoveryId) {
      throw new ConflictException({
        code: CODES.IDEMPOTENCY_CROSS_ORDER_CONFLICT,
        message:
          'Idempotency key already used for a different operations recovery by this actor',
      });
    }
    if (prior.openPayloadHash !== payloadHash) {
      throw new ConflictException({
        code: CODES.IDEMPOTENCY_PAYLOAD_CONFLICT,
        message: 'Idempotency key reused with different payload',
      });
    }
    return {
      code: 'EXCEPTION_CLAIM_OPENED',
      idempotent: true,
      claim: this.serializeClaim(prior),
    };
  }

  private serializeEconomicLoss(l: {
    id: string;
    economicLossKey: string;
    wkOrderId: number;
    lossKind: EconomicLossKind;
    subjectRef: string;
    currency: string;
    grossLossAmount: Prisma.Decimal;
    feeComponentAmount: Prisma.Decimal;
    compensableAmount: Prisma.Decimal;
  }) {
    return {
      id: l.id,
      economicLossKey: l.economicLossKey,
      wkOrderId: l.wkOrderId,
      lossKind: l.lossKind,
      subjectRef: l.subjectRef,
      currency: l.currency,
      grossLossAmount: l.grossLossAmount.toFixed(2),
      feeComponentAmount: l.feeComponentAmount.toFixed(2),
      compensableAmount: l.compensableAmount.toFixed(2),
    };
  }

  /**
   * EconomicLoss is the server-owned subject of recovery. Its key and
   * compensable amount are derived here; clients never supply either.
   */
  private async upsertEconomicLoss(
    tx: Prisma.TransactionClient,
    input: {
      order: {
        id: number;
        totalAmount: Prisma.Decimal;
        deliveryFee: Prisma.Decimal | null;
        transactionFeeAmount: Prisma.Decimal | null;
      };
      fulfillmentId: string;
      operationsRecoveryId: string;
      lossKind: EconomicLossKind;
      subjectRef: string;
      claimedAmount: string | number | null;
      actor: AdminActor;
      correlationId: string;
    },
  ) {
    const economicLossKey = buildEconomicLossKey({
      wkOrderId: input.order.id,
      lossKind: input.lossKind,
      subjectRef: input.subjectRef,
    });

    const existing = await tx.economicLoss.findUnique({
      where: { economicLossKey },
    });
    if (existing) {
      return this.lockEconomicLoss(tx, existing.id).then((locked) => {
        if (!locked) {
          throw new ConflictException({
            code: CODES.CLAIM_STATE_INVALID,
            message: 'Economic loss disappeared during lock',
          });
        }
        return locked;
      });
    }

    const computed = computeCompensable({
      orderTotalAmount: input.order.totalAmount,
      deliveryFee: input.order.deliveryFee ?? 0,
      transactionFeeAmount: input.order.transactionFeeAmount ?? 0,
      claimedAmount: input.claimedAmount,
    });

    return tx.economicLoss.create({
      data: {
        id: randomUUID(),
        economicLossKey,
        wkOrderId: input.order.id,
        fulfillmentId: input.fulfillmentId,
        operationsRecoveryId: input.operationsRecoveryId,
        lossKind: input.lossKind,
        subjectRef: input.subjectRef.slice(0, 200),
        grossLossAmount: computed.grossLossAmount,
        feeComponentAmount: computed.feeComponentAmount,
        compensableAmount: computed.compensableAmount,
        createdByActorType: input.actor.type,
        createdByActorId: input.actor.id,
        correlationId: input.correlationId.slice(0, 64),
      },
    });
  }

  // ─── addEvidence ────────────────────────────────────────

  async addEvidence(input: {
    claimId: string;
    actorUserId: string;
    evidenceKind: ClaimEvidenceKind | string;
    visibility?: ClaimEvidenceVisibility | string;
    notes?: string;
    storageReference?: string;
    contentHash?: string;
    contentType?: string;
    correlationId?: string;
    idempotencyKey?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const actor = await this.requireAdmin(input.actorUserId);
    const kind = input.evidenceKind as ClaimEvidenceKind;
    if (!Object.values(ClaimEvidenceKind).includes(kind)) {
      throw new BadRequestException({
        code: CODES.EVIDENCE_KIND_INVALID,
        message: 'Invalid evidenceKind',
      });
    }
    const visibility = (input.visibility ??
      ClaimEvidenceVisibility.ADMIN_ONLY) as ClaimEvidenceVisibility;
    if (!Object.values(ClaimEvidenceVisibility).includes(visibility)) {
      throw new BadRequestException({
        code: CODES.EVIDENCE_KIND_INVALID,
        message: 'Invalid evidence visibility',
      });
    }
    if (isServerReservedEvidenceKind(kind)) {
      throw new BadRequestException({
        code: CODES.EVIDENCE_KIND_RESERVED,
        message:
          'Evidence kind is server-reserved and cannot be submitted through the generic evidence route',
      });
    }

    const payloadHash = this.stablePayloadHash({
      action: 'addEvidence',
      claimId: input.claimId,
      kind,
      visibility,
      notes: input.notes ?? null,
      storageReference: input.storageReference ?? null,
    });
    return this.persistClaimEvidence({
      actor,
      claimId: input.claimId,
      evidenceKind: kind,
      visibility,
      notes: input.notes,
      storageReference: input.storageReference,
      contentHash: input.contentHash,
      contentType: input.contentType,
      metadata: input.metadata,
      provenance: null,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
    });
  }

  /**
   * Shared evidence insert. Provenance is never taken from an HTTP DTO —
   * only the specialized order-terms writer passes SERVER_ATTESTED_ORDER_TERMS.
   */
  private async persistClaimEvidence(input: {
    actor: { type: 'SYSTEM_ADMIN'; id: string };
    claimId: string;
    evidenceKind: ClaimEvidenceKind;
    visibility: ClaimEvidenceVisibility;
    notes?: string;
    storageReference?: string;
    contentHash?: string;
    contentType?: string;
    metadata?: Prisma.InputJsonValue;
    provenance: ClaimEvidenceProvenance | null;
    correlationId?: string;
    idempotencyKey?: string;
    payloadHash: string;
  }) {
    const idemKey = this.truncKey(input.idempotencyKey);

    if (idemKey) {
      const prior = await this.prisma.exceptionClaimEvidence.findFirst({
        where: { submittedByActorId: input.actor.id, idempotencyKey: idemKey },
      });
      if (prior) {
        if (prior.exceptionClaimId !== input.claimId) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_CROSS_ORDER_CONFLICT,
            message: 'Evidence idempotency key scoped to another claim',
          });
        }
        if (prior.payloadHash !== input.payloadHash) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_PAYLOAD_CONFLICT,
            message: 'Idempotency key reused with different payload',
          });
        }
        return {
          code: 'EXCEPTION_CLAIM_EVIDENCE_ADDED',
          idempotent: true,
          evidenceId: prior.id,
        };
      }
    }

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const claim = await this.loadAndLockClaimChain(tx, input.claimId);
          this.assertClaimActive(claim);

          const evidenceId = randomUUID();
          await tx.exceptionClaimEvidence.create({
            data: {
              id: evidenceId,
              exceptionClaimId: claim.id,
              evidenceKind: input.evidenceKind,
              visibility: input.visibility,
              storageReference: input.storageReference?.slice(0, 1000) ?? null,
              contentHash: input.contentHash?.slice(0, 64) ?? null,
              contentType: input.contentType?.slice(0, 120) ?? null,
              notes: input.notes?.slice(0, 2000) ?? null,
              metadata: input.metadata,
              provenance: input.provenance ?? undefined,
              submittedByActorType: input.actor.type,
              submittedByActorId: input.actor.id,
              idempotencyKey: idemKey,
              payloadHash: idemKey ? input.payloadHash : null,
              correlationId: input.correlationId?.slice(0, 64) ?? null,
            },
          });

          if (claim.status === ExceptionClaimStatus.OPEN) {
            await tx.exceptionClaim.update({
              where: { id: claim.id },
              data: { status: ExceptionClaimStatus.EVIDENCE_REVIEW },
            });
          }

          await this.appendClaimEvent(tx, {
            claimId: claim.id,
            eventType: ExceptionClaimEventType.EVIDENCE_ADDED,
            fromStatus: claim.status,
            toStatus:
              claim.status === ExceptionClaimStatus.OPEN
                ? ExceptionClaimStatus.EVIDENCE_REVIEW
                : claim.status,
            actor: input.actor,
            reason: input.notes ?? null,
            correlationId: input.correlationId,
            metadata: {
              evidenceId,
              evidenceKind: input.evidenceKind,
              visibility: input.visibility,
            },
          });

          return {
            code: 'EXCEPTION_CLAIM_EVIDENCE_ADDED',
            idempotent: false,
            evidenceId,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─── verifyEvidence ─────────────────────────────────────

  async verifyEvidence(input: {
    claimId: string;
    evidenceId: string;
    actorUserId: string;
    verificationStatus: ClaimVerificationStatus | string;
    notes?: string;
    correlationId?: string;
    idempotencyKey?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const actor = await this.requireAdmin(input.actorUserId);
    const status = input.verificationStatus as ClaimVerificationStatus;
    if (!Object.values(ClaimVerificationStatus).includes(status)) {
      throw new BadRequestException({
        code: CODES.VERIFICATION_STATUS_INVALID,
        message: 'Invalid verificationStatus',
      });
    }

    const idemKey = this.truncKey(input.idempotencyKey);
    const payloadHash = this.stablePayloadHash({
      action: 'verifyEvidence',
      claimId: input.claimId,
      evidenceId: input.evidenceId,
      status,
      notes: input.notes ?? null,
    });

    if (idemKey) {
      const prior = await this.prisma.exceptionClaimVerification.findFirst({
        where: { verifiedByActorId: actor.id, idempotencyKey: idemKey },
      });
      if (prior) {
        if (prior.exceptionClaimId !== input.claimId) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_CROSS_ORDER_CONFLICT,
            message: 'Verification idempotency key scoped to another claim',
          });
        }
        if (prior.payloadHash !== payloadHash) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_PAYLOAD_CONFLICT,
            message: 'Idempotency key reused with different payload',
          });
        }
        return {
          code: 'EXCEPTION_CLAIM_EVIDENCE_VERIFIED',
          idempotent: true,
          verificationId: prior.id,
        };
      }
    }

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const claim = await this.loadAndLockClaimChain(tx, input.claimId);
          this.assertClaimActive(claim);

          const evidence = await tx.exceptionClaimEvidence.findUnique({
            where: { id: input.evidenceId },
          });
          if (!evidence || evidence.exceptionClaimId !== claim.id) {
            throw new NotFoundException({
              code: CODES.EVIDENCE_NOT_FOUND,
              message: 'Evidence not found for this claim',
            });
          }

          const verificationId = randomUUID();
          await tx.exceptionClaimVerification.create({
            data: {
              id: verificationId,
              exceptionClaimId: claim.id,
              evidenceId: evidence.id,
              verificationStatus: status,
              notes: input.notes?.slice(0, 2000) ?? null,
              metadata: input.metadata,
              verifiedByActorType: actor.type,
              verifiedByActorId: actor.id,
              idempotencyKey: idemKey,
              payloadHash: idemKey ? payloadHash : null,
              correlationId: input.correlationId?.slice(0, 64) ?? null,
            },
          });

          await this.appendClaimEvent(tx, {
            claimId: claim.id,
            eventType: ExceptionClaimEventType.EVIDENCE_VERIFIED,
            fromStatus: claim.status,
            toStatus: claim.status,
            actor,
            reason: input.notes ?? null,
            correlationId: input.correlationId,
            metadata: {
              verificationId,
              evidenceId: evidence.id,
              verificationStatus: status,
            },
          });

          return {
            code: 'EXCEPTION_CLAIM_EVIDENCE_VERIFIED',
            idempotent: false,
            verificationId,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─── concludeVerifiedFact ───────────────────────────────

  async concludeVerifiedFact(input: {
    claimId: string;
    actorUserId: string;
    factType: VerifiedFactType | string;
    statement: string;
    subjectRef?: string;
    attributedPartyType?: ExceptionLiablePartyType | string | null;
    attributedPartyUserId?: string | null;
    attributedMerchantId?: number | null;
    supportingEvidenceId?: string | null;
    correlationId?: string;
    idempotencyKey?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    const actor = await this.requireAdmin(input.actorUserId);
    const factType = input.factType as VerifiedFactType;
    if (!Object.values(VerifiedFactType).includes(factType)) {
      throw new BadRequestException({
        code: CODES.FACT_TYPE_INVALID,
        message: 'Invalid factType',
      });
    }
    if (!input.statement?.trim()) {
      throw new BadRequestException({
        code: CODES.AUDIT_FIELDS_REQUIRED,
        message: 'statement is required for a verified fact',
      });
    }
    if (
      input.attributedPartyType != null &&
      !isLiablePartyType(String(input.attributedPartyType))
    ) {
      throw new BadRequestException({
        code: CODES.PLATFORM_NEVER_LIABLE,
        message: `attributedPartyType ${String(input.attributedPartyType)} is not permitted`,
      });
    }
    const attributionGate = evaluateNonConformanceFactAttribution({
      factType,
      attributedPartyType: input.attributedPartyType,
    });
    if (!attributionGate.ok) {
      throw new BadRequestException({
        code: attributionGate.code,
        message: attributionGate.message,
      });
    }

    const idemKey = this.truncKey(input.idempotencyKey);
    const payloadHash = this.stablePayloadHash({
      action: 'concludeVerifiedFact',
      claimId: input.claimId,
      factType,
      statement: input.statement,
      attributedPartyType: input.attributedPartyType ?? null,
      attributedPartyUserId: input.attributedPartyUserId ?? null,
      attributedMerchantId: input.attributedMerchantId ?? null,
    });

    if (idemKey) {
      const prior = await this.prisma.verifiedFact.findFirst({
        where: { concludedByActorId: actor.id, idempotencyKey: idemKey },
      });
      if (prior) {
        if (prior.exceptionClaimId !== input.claimId) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_CROSS_ORDER_CONFLICT,
            message: 'Verified fact idempotency key scoped to another claim',
          });
        }
        if (prior.payloadHash !== payloadHash) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_PAYLOAD_CONFLICT,
            message: 'Idempotency key reused with different payload',
          });
        }
        return {
          code: 'VERIFIED_FACT_CONCLUDED',
          idempotent: true,
          verifiedFactId: prior.id,
        };
      }
    }

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const claim = await this.loadAndLockClaimChain(tx, input.claimId);
          this.assertClaimActive(claim);
          await this.lockVerifiedFacts(tx, claim.id);

          // A verified fact must rest on evidence that was actually VERIFIED.
          const verifiedCount = await tx.exceptionClaimVerification.count({
            where: {
              exceptionClaimId: claim.id,
              verificationStatus: ClaimVerificationStatus.VERIFIED,
              ...(input.supportingEvidenceId
                ? { evidenceId: input.supportingEvidenceId }
                : {}),
            },
          });
          if (verifiedCount === 0) {
            throw new ForbiddenException({
              code: CODES.VERIFIED_EVIDENCE_REQUIRED,
              message:
                'A verified fact requires at least one VERIFIED evidence verification',
            });
          }

          const verifiedFactId = randomUUID();
          await tx.verifiedFact.create({
            data: {
              id: verifiedFactId,
              exceptionClaimId: claim.id,
              factType,
              subjectRef: (input.subjectRef ?? claim.subjectRef).slice(0, 200),
              attributedPartyType:
                (input.attributedPartyType as ExceptionLiablePartyType) ?? null,
              attributedPartyUserId: input.attributedPartyUserId ?? null,
              attributedMerchantId: input.attributedMerchantId ?? null,
              supportingEvidenceId: input.supportingEvidenceId ?? null,
              statement: input.statement.slice(0, 2000),
              metadata: input.metadata,
              concludedByActorType: actor.type,
              concludedByActorId: actor.id,
              idempotencyKey: idemKey,
              payloadHash: idemKey ? payloadHash : null,
              correlationId: input.correlationId?.slice(0, 64) ?? null,
            },
          });

          const toStatus =
            claim.status === ExceptionClaimStatus.DETERMINATION_PROPOSED
              ? claim.status
              : ExceptionClaimStatus.VERIFIED;
          if (toStatus !== claim.status) {
            await tx.exceptionClaim.update({
              where: { id: claim.id },
              data: { status: toStatus },
            });
          }

          await this.appendClaimEvent(tx, {
            claimId: claim.id,
            eventType: ExceptionClaimEventType.FACT_CONCLUDED,
            fromStatus: claim.status,
            toStatus,
            actor,
            reason: input.statement,
            correlationId: input.correlationId,
            metadata: { verifiedFactId, factType },
          });

          return {
            code: 'VERIFIED_FACT_CONCLUDED',
            idempotent: false,
            verifiedFactId,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─── createDetermination ────────────────────────────────

  async createDetermination(input: {
    claimId: string;
    actorUserId: string;
    allocations: AllocationDraft[];
    reason?: string;
    correlationId: string;
    idempotencyKey?: string;
    adjustmentOfDeterminationId?: string | null;
  }) {
    this.requireAudit(input.correlationId);
    const actor = await this.requireAdmin(input.actorUserId);

    const idemKey = this.truncKey(input.idempotencyKey);
    const payloadHash = this.stablePayloadHash({
      action: 'createDetermination',
      claimId: input.claimId,
      allocations: input.allocations.map((a) => ({
        partyType: a.partyType,
        partyUserId: a.partyUserId ?? null,
        partyMerchantId: a.partyMerchantId ?? null,
        amount: toMoney(a.amount).toFixed(2),
      })),
      adjustmentOfDeterminationId: input.adjustmentOfDeterminationId ?? null,
      reason: input.reason ?? null,
    });

    if (idemKey) {
      const prior = await this.prisma.liabilityDetermination.findFirst({
        where: { createdByActorId: actor.id, createIdempotencyKey: idemKey },
      });
      if (prior) {
        if (prior.exceptionClaimId !== input.claimId) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_CROSS_ORDER_CONFLICT,
            message: 'Determination idempotency key scoped to another claim',
          });
        }
        if (prior.createPayloadHash !== payloadHash) {
          throw new ConflictException({
            code: CODES.IDEMPOTENCY_PAYLOAD_CONFLICT,
            message: 'Idempotency key reused with different payload',
          });
        }
        return {
          code: 'LIABILITY_DETERMINATION_CREATED',
          idempotent: true,
          determination: this.serializeDetermination(prior),
        };
      }
    }

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const claim = await this.loadAndLockClaimChain(tx, input.claimId);
          this.assertClaimActive(claim, {
            allowFinalizedForAdjustment: Boolean(
              input.adjustmentOfDeterminationId,
            ),
          });

          const facts = await this.lockVerifiedFacts(tx, claim.id);
          if (facts.length === 0) {
            throw new ForbiddenException({
              code: CODES.FACT_REQUIRED,
              message:
                'A liability determination requires at least one verified fact',
            });
          }

          const existingActive = await tx.liabilityDetermination.findFirst({
            where: {
              exceptionClaimId: claim.id,
              status: { in: LIABILITY_DETERMINATION_ACTIVE_STATUSES },
            },
          });
          if (existingActive) {
            throw new ConflictException({
              code: CODES.DETERMINATION_ALREADY_ACTIVE,
              message:
                'An active (DRAFT/PROPOSED) determination already exists for this claim',
            });
          }

          const economicLoss = await this.lockEconomicLoss(
            tx,
            claim.economicLossId,
          );
          if (!economicLoss) {
            throw new NotFoundException({
              code: CODES.CLAIM_NOT_FOUND,
              message: 'Economic loss missing for claim',
            });
          }

          const covered = await this.coveredAmount(tx, economicLoss.id);
          const remaining = remainingCompensable({
            compensableAmount: economicLoss.compensableAmount,
            coveredAmount: covered,
          });

          const total = sumAmounts(input.allocations.map((a) => a.amount));
          const validation = validateAllocations({
            allocations: input.allocations,
            totalLiabilityAmount: total,
            remainingAmount: remaining,
          });
          if (!validation.ok) {
            throw new BadRequestException({
              code: validation.code,
              message: validation.message,
            });
          }

          const nonConformanceBasis = evaluateNonConformanceLiabilityBasis({
            claimType: claim.claimType,
            allocations: input.allocations,
            facts: facts.map((f) => ({ id: f.id, factType: f.factType })),
          });
          if (!nonConformanceBasis.ok) {
            throw new ForbiddenException({
              code: nonConformanceBasis.code,
              message: nonConformanceBasis.message,
            });
          }

          if (input.adjustmentOfDeterminationId) {
            const source = await this.lockDetermination(
              tx,
              input.adjustmentOfDeterminationId,
            );
            if (
              !source ||
              source.exceptionClaimId !== claim.id ||
              source.status !== LiabilityDeterminationStatus.FINALIZED
            ) {
              throw new ConflictException({
                code: CODES.ADJUSTMENT_SOURCE_INVALID,
                message:
                  'Adjustments must reference a FINALIZED determination on the same claim',
              });
            }
          }

          const determinationId = randomUUID();
          const determination = await tx.liabilityDetermination.create({
            data: {
              id: determinationId,
              exceptionClaimId: claim.id,
              economicLossId: economicLoss.id,
              policyVersionId: claim.policyVersionId,
              policyHash: claim.policyHash,
              status: LiabilityDeterminationStatus.DRAFT,
              currency: economicLoss.currency,
              totalLiabilityAmount: total,
              compensableAmountSnapshot: economicLoss.compensableAmount,
              priorCoverageAmountSnapshot: covered,
              remainingAmountSnapshot: remaining,
              adjustmentOfDeterminationId:
                input.adjustmentOfDeterminationId ?? null,
              reason: input.reason?.slice(0, 2000) ?? null,
              createdByActorType: actor.type,
              createdByActorId: actor.id,
              correlationId: input.correlationId.slice(0, 64),
              createIdempotencyKey: idemKey,
              createPayloadHash: idemKey ? payloadHash : null,
            },
          });

          for (const a of input.allocations) {
            await tx.liabilityAllocation.create({
              data: {
                id: randomUUID(),
                liabilityDeterminationId: determination.id,
                partyType: a.partyType,
                partyUserId: a.partyUserId ?? null,
                partyMerchantId: a.partyMerchantId ?? null,
                amount: toMoney(a.amount),
                currency: economicLoss.currency,
                verifiedFactId: a.verifiedFactId ?? null,
                basis: a.basis?.slice(0, 2000) ?? null,
              },
            });
          }

          await this.appendClaimEvent(tx, {
            claimId: claim.id,
            eventType: ExceptionClaimEventType.DETERMINATION_CREATED,
            fromStatus: claim.status,
            toStatus: claim.status,
            actor,
            reason: input.reason ?? null,
            correlationId: input.correlationId,
            metadata: {
              determinationId: determination.id,
              totalLiabilityAmount: total.toFixed(2),
              remainingAmountSnapshot: remaining.toFixed(2),
            },
          });

          return {
            code: 'LIABILITY_DETERMINATION_CREATED',
            idempotent: false,
            determination: this.serializeDetermination(determination),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─── proposeDetermination ───────────────────────────────

  async proposeDetermination(input: {
    determinationId: string;
    actorUserId: string;
    reason?: string;
    correlationId: string;
    idempotencyKey?: string;
  }) {
    this.requireAudit(input.correlationId);
    const actor = await this.requireAdmin(input.actorUserId);
    const idemKey = this.truncKey(input.idempotencyKey);
    const payloadHash = this.stablePayloadHash({
      action: 'proposeDetermination',
      determinationId: input.determinationId,
      reason: input.reason ?? null,
    });

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const peek = await tx.liabilityDetermination.findUnique({
            where: { id: input.determinationId },
          });
          if (!peek) {
            throw new NotFoundException({
              code: CODES.DETERMINATION_NOT_FOUND,
              message: 'Determination not found',
            });
          }
          const claim = await this.loadAndLockClaimChain(
            tx,
            peek.exceptionClaimId,
          );
          const determination = await this.lockDetermination(
            tx,
            input.determinationId,
          );
          if (!determination) {
            throw new NotFoundException({
              code: CODES.DETERMINATION_NOT_FOUND,
              message: 'Determination not found',
            });
          }

          if (determination.status === LiabilityDeterminationStatus.PROPOSED) {
            if (
              idemKey &&
              determination.proposeIdempotencyKey === idemKey &&
              determination.proposePayloadHash !== payloadHash
            ) {
              throw new ConflictException({
                code: CODES.IDEMPOTENCY_PAYLOAD_CONFLICT,
                message: 'Idempotency key reused with different payload',
              });
            }
            return {
              code: 'LIABILITY_DETERMINATION_PROPOSED',
              idempotent: true,
              determination: this.serializeDetermination(determination),
            };
          }
          if (determination.status !== LiabilityDeterminationStatus.DRAFT) {
            throw new ConflictException({
              code: CODES.DETERMINATION_STATE_INVALID,
              message: 'Propose requires DRAFT',
            });
          }
          this.assertClaimActive(claim);

          const updated = await tx.liabilityDetermination.update({
            where: { id: determination.id },
            data: {
              status: LiabilityDeterminationStatus.PROPOSED,
              proposedAt: new Date(),
              proposedByActorType: actor.type,
              proposedByActorId: actor.id,
              proposeIdempotencyKey: idemKey,
              proposePayloadHash: idemKey ? payloadHash : null,
            },
          });

          if (claim.status !== ExceptionClaimStatus.DETERMINATION_PROPOSED) {
            await tx.exceptionClaim.update({
              where: { id: claim.id },
              data: { status: ExceptionClaimStatus.DETERMINATION_PROPOSED },
            });
          }

          await this.appendClaimEvent(tx, {
            claimId: claim.id,
            eventType: ExceptionClaimEventType.DETERMINATION_PROPOSED,
            fromStatus: claim.status,
            toStatus: ExceptionClaimStatus.DETERMINATION_PROPOSED,
            actor,
            reason: input.reason ?? null,
            correlationId: input.correlationId,
            metadata: { determinationId: determination.id },
          });

          return {
            code: 'LIABILITY_DETERMINATION_PROPOSED',
            idempotent: false,
            determination: this.serializeDetermination(updated),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  // ─── finalizeDetermination ──────────────────────────────

  /**
   * The money-moving step. Ordering matters:
   *   1. full lock chain (orders … obligations)
   *   2. Stage 9 race gate — refuse while Stage 9 could still pay
   *   3. import same-subject coverage from a FINALIZED Stage 9 determination
   *   4. recompute remaining from real coverage rows
   *   5. revalidate allocations, then write coverage + obligations
   */
  async finalizeDetermination(input: {
    determinationId: string;
    actorUserId: string;
    reason?: string;
    correlationId: string;
    idempotencyKey?: string;
  }) {
    this.requireAudit(input.correlationId);
    const actor = await this.requireAdmin(input.actorUserId);
    const idemKey = this.truncKey(input.idempotencyKey);
    const payloadHash = this.stablePayloadHash({
      action: 'finalizeDetermination',
      determinationId: input.determinationId,
      reason: input.reason ?? null,
    });

    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const peek = await tx.liabilityDetermination.findUnique({
            where: { id: input.determinationId },
          });
          if (!peek) {
            throw new NotFoundException({
              code: CODES.DETERMINATION_NOT_FOUND,
              message: 'Determination not found',
            });
          }

          const claim = await this.loadAndLockClaimChain(
            tx,
            peek.exceptionClaimId,
          );
          await this.lockVerifiedFacts(tx, claim.id);
          const determination = await this.lockDetermination(
            tx,
            input.determinationId,
          );
          if (!determination) {
            throw new NotFoundException({
              code: CODES.DETERMINATION_NOT_FOUND,
              message: 'Determination not found',
            });
          }
          await this.lockObligations(tx, claim.id);

          if (determination.status === LiabilityDeterminationStatus.FINALIZED) {
            if (
              idemKey &&
              determination.finalizeIdempotencyKey === idemKey &&
              determination.finalizePayloadHash === payloadHash
            ) {
              return {
                code: 'LIABILITY_DETERMINATION_FINALIZED',
                idempotent: true,
                determination: this.serializeDetermination(determination),
                obligations: await this.listObligations(tx, determination.id),
              };
            }
            throw new ConflictException({
              code: CODES.DETERMINATION_STATE_INVALID,
              message: 'Determination already FINALIZED',
            });
          }
          if (
            determination.status !== LiabilityDeterminationStatus.DRAFT &&
            determination.status !== LiabilityDeterminationStatus.PROPOSED
          ) {
            throw new ConflictException({
              code: CODES.DETERMINATION_STATE_INVALID,
              message: `Cannot finalize determination in ${determination.status}`,
            });
          }

          const economicLoss = await this.lockEconomicLoss(
            tx,
            determination.economicLossId,
          );
          if (!economicLoss) {
            throw new NotFoundException({
              code: CODES.CLAIM_NOT_FOUND,
              message: 'Economic loss missing for determination',
            });
          }

          // ── Stage 9 race gate (no Stage 9 code is touched) ──
          const fulfillment = await tx.orderFulfillment.findUniqueOrThrow({
            where: { id: claim.fulfillmentId },
          });
          const stage9Determinations =
            await tx.returnFinancialDetermination.findMany({
              where: { wkOrderId: claim.wkOrderId },
              orderBy: { createdAt: 'asc' },
            });
          const hasReturnReceivedCustody =
            (await tx.custodyEvent.count({
              where: {
                fulfillmentId: claim.fulfillmentId,
                eventType: CustodyEventType.RETURN_RECEIVED,
              },
            })) > 0;

          const gate = evaluateStage9FinalizeGate({
            stage9Statuses: stage9Determinations.map((d) => d.status),
            fulfillmentStatus: fulfillment.status,
            hasReturnReceivedCustody,
          });
          if (!gate.ok) {
            throw new ConflictException({
              code: gate.code,
              message: gate.message,
            });
          }

          // ── Import same-subject Stage 9 coverage ──
          const finalizedStage9 = stage9Determinations.find(
            (d) => d.status === ReturnFinancialDeterminationStatus.FINALIZED,
          );
          const imported = finalizedStage9
            ? await this.importStage9Coverage(tx, {
                stage9DeterminationId: finalizedStage9.id,
                economicLoss,
                actor,
                correlationId: input.correlationId,
                claimId: claim.id,
              })
            : [];

          // ── Recompute remaining from real coverage rows ──
          const covered = await this.coveredAmount(tx, economicLoss.id);
          const remaining = remainingCompensable({
            compensableAmount: economicLoss.compensableAmount,
            coveredAmount: covered,
          });
          if (remaining.lte(0)) {
            throw new ConflictException({
              code: CODES.NOTHING_REMAINING,
              message:
                'Economic loss is already fully covered; nothing remains for Stage 12 recovery',
            });
          }

          const allocations = await tx.liabilityAllocation.findMany({
            where: { liabilityDeterminationId: determination.id },
            orderBy: { createdAt: 'asc' },
          });
          const total = sumAmounts(allocations.map((a) => a.amount));
          const validation = validateAllocations({
            allocations: allocations.map((a) => ({
              partyType: a.partyType,
              partyUserId: a.partyUserId,
              partyMerchantId: a.partyMerchantId,
              amount: a.amount,
            })),
            totalLiabilityAmount: total,
            remainingAmount: remaining,
          });
          if (!validation.ok) {
            throw new ConflictException({
              code: validation.code,
              message: validation.message,
            });
          }

          const finalizedAt = new Date();
          const updated = await tx.liabilityDetermination.update({
            where: { id: determination.id },
            data: {
              status: LiabilityDeterminationStatus.FINALIZED,
              totalLiabilityAmount: total,
              compensableAmountSnapshot: economicLoss.compensableAmount,
              priorCoverageAmountSnapshot: covered,
              remainingAmountSnapshot: remaining,
              stage9DeterminationId: finalizedStage9?.id ?? null,
              finalizedAt,
              finalizedByActorType: actor.type,
              finalizedByActorId: actor.id,
              reason: input.reason?.slice(0, 2000) ?? determination.reason,
              finalizeIdempotencyKey: idemKey,
              finalizePayloadHash: idemKey ? payloadHash : null,
            },
          });

          // ── Obligations: each liable party owes the loss-bearing creditor ──
          const creditor = await this.resolveCreditor(tx, {
            wkOrderId: claim.wkOrderId,
            lossKind: economicLoss.lossKind,
          });
          const obligations: string[] = [];
          for (const a of allocations) {
            if (
              a.partyType === creditor.type &&
              ((creditor.type === ExceptionLiablePartyType.MERCHANT &&
                a.partyMerchantId === creditor.merchantId) ||
                (creditor.type !== ExceptionLiablePartyType.MERCHANT &&
                  a.partyUserId === creditor.userId))
            ) {
              // Self-liability is absorbed by the party itself: it is real
              // coverage of the loss, but never a payable obligation.
              continue;
            }
            const obligationId = randomUUID();
            await tx.exceptionFinancialObligation.create({
              data: {
                id: obligationId,
                liabilityDeterminationId: determination.id,
                exceptionClaimId: claim.id,
                economicLossId: economicLoss.id,
                wkOrderId: claim.wkOrderId,
                debtorType: a.partyType,
                debtorUserId: a.partyUserId,
                debtorMerchantId: a.partyMerchantId,
                creditorType: creditor.type,
                creditorUserId: creditor.userId,
                creditorMerchantId: creditor.merchantId,
                principal: a.amount,
                currency: economicLoss.currency,
                status: ExceptionFinancialObligationStatus.OPEN,
                reason: input.reason?.slice(0, 2000) ?? null,
                correlationId: input.correlationId.slice(0, 64),
              },
            });
            obligations.push(obligationId);
          }

          // ── Coverage: this determination now covers `total` of the loss ──
          await tx.economicLossCoverage.create({
            data: {
              id: randomUUID(),
              economicLossId: economicLoss.id,
              sourceKind: EconomicLossCoverageSourceKind.STAGE12_OBLIGATION,
              sourceRef: determination.id,
              subjectRefSnapshot: economicLoss.subjectRef,
              amount: total,
              currency: economicLoss.currency,
              createdByActorType: actor.type,
              createdByActorId: actor.id,
              correlationId: input.correlationId.slice(0, 64),
            },
          });

          await tx.exceptionClaim.update({
            where: { id: claim.id },
            data: {
              status: ExceptionClaimStatus.FINALIZED,
              finalizedAt,
            },
          });

          await this.appendClaimEvent(tx, {
            claimId: claim.id,
            eventType: ExceptionClaimEventType.DETERMINATION_FINALIZED,
            fromStatus: claim.status,
            toStatus: ExceptionClaimStatus.FINALIZED,
            actor,
            reason: input.reason ?? null,
            correlationId: input.correlationId,
            metadata: {
              determinationId: determination.id,
              totalLiabilityAmount: total.toFixed(2),
              priorCoverageAmount: covered.toFixed(2),
              remainingAmount: remaining.toFixed(2),
              importedStage9Coverage: imported,
              obligationIds: obligations,
              stage9DeterminationId: finalizedStage9?.id ?? null,
            },
          });

          await tx.orderDomainEvent.create({
            data: {
              eventId: randomUUID().replace(/-/g, '').slice(0, 64),
              aggregateType: 'ORDER_FULFILLMENT',
              aggregateId: claim.fulfillmentId,
              wkOrderId: claim.wkOrderId,
              fulfillmentId: claim.fulfillmentId,
              actorId: actor.id,
              actorType: actor.type,
              action: 'EXCEPTION_LIABILITY_FINALIZED',
              previousState: determination.status,
              newState: LiabilityDeterminationStatus.FINALIZED,
              reason: input.reason?.slice(0, 255) ?? null,
              correlationId: input.correlationId.slice(0, 64),
              metadata: {
                exceptionClaimId: claim.id,
                determinationId: determination.id,
                obligationIds: obligations,
              },
            },
          });

          return {
            code: 'LIABILITY_DETERMINATION_FINALIZED',
            idempotent: false,
            determination: this.serializeDetermination(updated),
            obligations: await this.listObligations(tx, determination.id),
            importedStage9Coverage: imported,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  /**
   * Copies a FINALIZED Stage 9 determination's obligations into Stage 12
   * coverage, but only for obligations that compensate the *same subject* as
   * this economic loss. Amounts are capped at the remaining headroom so the
   * coverage ceiling trigger can never fire from an import.
   */
  private async importStage9Coverage(
    tx: Prisma.TransactionClient,
    input: {
      stage9DeterminationId: string;
      economicLoss: {
        id: string;
        lossKind: EconomicLossKind;
        subjectRef: string;
        currency: string;
        compensableAmount: Prisma.Decimal;
      };
      actor: AdminActor;
      correlationId: string;
      claimId: string;
    },
  ): Promise<Array<{ obligationId: string; amount: string }>> {
    const stage9Obligations = await tx.returnFinancialObligation.findMany({
      where: { determinationId: input.stage9DeterminationId },
      orderBy: { createdAt: 'asc' },
    });

    const imported: Array<{ obligationId: string; amount: string }> = [];
    for (const obligation of stage9Obligations) {
      if (
        !stage9ObligationCoversLossKind(
          obligation.type,
          input.economicLoss.lossKind,
        )
      ) {
        continue;
      }
      const already = await tx.economicLossCoverage.findFirst({
        where: {
          economicLossId: input.economicLoss.id,
          sourceKind: EconomicLossCoverageSourceKind.STAGE9_OBLIGATION,
          sourceRef: obligation.id,
        },
      });
      if (already) continue;

      const covered = await this.coveredAmount(tx, input.economicLoss.id);
      const amount = maxImportableCoverage({
        compensableAmount: input.economicLoss.compensableAmount,
        alreadyCoveredAmount: covered,
        candidateAmount: obligation.principal,
      });
      if (amount.lte(0)) continue;

      await tx.economicLossCoverage.create({
        data: {
          id: randomUUID(),
          economicLossId: input.economicLoss.id,
          sourceKind: EconomicLossCoverageSourceKind.STAGE9_OBLIGATION,
          sourceRef: obligation.id,
          stage9ObligationId: obligation.id,
          subjectRefSnapshot: input.economicLoss.subjectRef,
          amount,
          currency: input.economicLoss.currency,
          notes: `Imported from Stage 9 obligation ${obligation.type}`,
          createdByActorType: input.actor.type,
          createdByActorId: input.actor.id,
          correlationId: input.correlationId.slice(0, 64),
        },
      });
      imported.push({ obligationId: obligation.id, amount: amount.toFixed(2) });
    }

    if (imported.length > 0) {
      await this.appendClaimEvent(tx, {
        claimId: input.claimId,
        eventType: ExceptionClaimEventType.COVERAGE_IMPORTED,
        actor: input.actor,
        correlationId: input.correlationId,
        metadata: {
          stage9DeterminationId: input.stage9DeterminationId,
          imported,
        },
      });
    }
    return imported;
  }

  /**
   * The creditor is whoever actually bore the loss: the merchant for goods,
   * the rider for an unrecovered advance, the customer for unrecovered payment.
   */
  private async resolveCreditor(
    tx: Prisma.TransactionClient,
    input: { wkOrderId: number; lossKind: EconomicLossKind },
  ): Promise<{
    type: ExceptionLiablePartyType;
    userId: string | null;
    merchantId: number | null;
  }> {
    const order = await tx.wkOrder.findUniqueOrThrow({
      where: { id: input.wkOrderId },
    });

    if (input.lossKind === EconomicLossKind.RIDER_ADVANCE_UNRECOVERED) {
      const ra = await tx.riderAdvance.findFirst({
        where: { wkOrderId: input.wkOrderId, status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
      });
      if (ra) {
        return {
          type: ExceptionLiablePartyType.RIDER,
          userId: ra.riderId,
          merchantId: null,
        };
      }
    }
    if (input.lossKind === EconomicLossKind.CUSTOMER_PAYMENT_UNRECOVERED) {
      return {
        type: ExceptionLiablePartyType.CUSTOMER,
        userId: order.userId,
        merchantId: null,
      };
    }
    return {
      type: ExceptionLiablePartyType.MERCHANT,
      userId: null,
      merchantId: order.merchantId,
    };
  }

  private async listObligations(
    tx: Prisma.TransactionClient,
    determinationId: string,
  ) {
    const rows = await tx.exceptionFinancialObligation.findMany({
      where: { liabilityDeterminationId: determinationId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((o) => ({
      id: o.id,
      debtorType: o.debtorType,
      debtorUserId: o.debtorUserId,
      debtorMerchantId: o.debtorMerchantId,
      creditorType: o.creditorType,
      creditorUserId: o.creditorUserId,
      creditorMerchantId: o.creditorMerchantId,
      principal: o.principal.toFixed(2),
      currency: o.currency,
      status: o.status,
    }));
  }

  private serializeDetermination(d: {
    id: string;
    exceptionClaimId: string;
    economicLossId: string;
    status: LiabilityDeterminationStatus;
    currency: string;
    totalLiabilityAmount: Prisma.Decimal;
    compensableAmountSnapshot: Prisma.Decimal | null;
    priorCoverageAmountSnapshot: Prisma.Decimal | null;
    remainingAmountSnapshot: Prisma.Decimal | null;
    adjustmentOfDeterminationId: string | null;
    stage9DeterminationId: string | null;
    reason: string | null;
    finalizedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: d.id,
      exceptionClaimId: d.exceptionClaimId,
      economicLossId: d.economicLossId,
      status: d.status,
      currency: d.currency,
      totalLiabilityAmount: d.totalLiabilityAmount.toFixed(2),
      compensableAmountSnapshot:
        d.compensableAmountSnapshot?.toFixed(2) ?? null,
      priorCoverageAmountSnapshot:
        d.priorCoverageAmountSnapshot?.toFixed(2) ?? null,
      remainingAmountSnapshot: d.remainingAmountSnapshot?.toFixed(2) ?? null,
      adjustmentOfDeterminationId: d.adjustmentOfDeterminationId,
      stage9DeterminationId: d.stage9DeterminationId,
      reason: d.reason,
      finalizedAt: d.finalizedAt,
      createdAt: d.createdAt,
    };
  }

  // ─── createAdjustment ───────────────────────────────────

  /**
   * An adjustment never edits the finalized determination. It opens a fresh
   * claim-scoped determination bound to the original, so the audit trail keeps
   * both the original decision and the correction.
   */
  async createAdjustment(input: {
    determinationId: string;
    actorUserId: string;
    allocations: AllocationDraft[];
    reason: string;
    correlationId: string;
    idempotencyKey?: string;
  }) {
    this.requireAudit(input.correlationId);
    if (!input.reason?.trim()) {
      throw new BadRequestException({
        code: CODES.AUDIT_FIELDS_REQUIRED,
        message: 'reason is required for an adjustment',
      });
    }
    await this.requireAdmin(input.actorUserId);

    const source = await this.prisma.liabilityDetermination.findUnique({
      where: { id: input.determinationId },
    });
    if (!source) {
      throw new NotFoundException({
        code: CODES.DETERMINATION_NOT_FOUND,
        message: 'Determination not found',
      });
    }
    if (source.status !== LiabilityDeterminationStatus.FINALIZED) {
      throw new ConflictException({
        code: CODES.ADJUSTMENT_SOURCE_INVALID,
        message: 'Only a FINALIZED determination can be adjusted',
      });
    }

    // FINALIZED claims stay terminal. Adjustments create a successor
    // determination linked via adjustmentOfDeterminationId without mutating
    // the claim status (terminal immutability trigger forbids reopen).
    return this.createDetermination({
      claimId: source.exceptionClaimId,
      actorUserId: input.actorUserId,
      allocations: input.allocations,
      reason: input.reason,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      adjustmentOfDeterminationId: source.id,
    });
  }

  // ─── shared load + lock ─────────────────────────────────

  private async loadAndLockClaimChain(
    tx: Prisma.TransactionClient,
    claimId: string,
  ) {
    const peek = await tx.exceptionClaim.findUnique({ where: { id: claimId } });
    if (!peek) {
      throw new NotFoundException({
        code: CODES.CLAIM_NOT_FOUND,
        message: 'Exception claim not found',
      });
    }
    await this.lockOrderAndFulfillment(tx, peek.wkOrderId);
    await this.lockRecovery(tx, peek.operationsRecoveryId);
    await this.lockEconomicLoss(tx, peek.economicLossId);
    const claim = await this.lockClaim(tx, claimId);
    if (!claim) {
      throw new NotFoundException({
        code: CODES.CLAIM_NOT_FOUND,
        message: 'Exception claim not found',
      });
    }
    return claim;
  }

  // ─── read APIs ──────────────────────────────────────────

  async getClaim(claimId: string, viewerUserId: string) {
    const claim = await this.prisma.exceptionClaim.findUnique({
      where: { id: claimId },
      include: {
        economicLoss: { include: { coverages: true } },
        events: { orderBy: { createdAt: 'asc' } },
        evidence: { orderBy: { createdAt: 'asc' } },
        verifications: { orderBy: { createdAt: 'asc' } },
        verifiedFacts: { orderBy: { createdAt: 'asc' } },
        determinations: {
          orderBy: { createdAt: 'asc' },
          include: { allocations: true },
        },
        obligations: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!claim) {
      throw new NotFoundException({
        code: CODES.CLAIM_NOT_FOUND,
        message: 'Exception claim not found',
      });
    }
    const viewer = await this.resolveViewer(claim.wkOrderId, viewerUserId);
    if (viewer === 'DENIED') {
      throw new ForbiddenException({
        code: CODES.FORBIDDEN,
        message: 'Not authorized',
      });
    }
    if (viewer === 'ADMIN') {
      return {
        code: 'EXCEPTION_CLAIM',
        claim: this.presentAdminClaim(claim),
      };
    }
    return {
      code: 'EXCEPTION_CLAIM',
      claim: {
        ...this.minimalClaim(claim),
        // Parties see only evidence explicitly published to them.
        evidence: claim.evidence
          .filter(
            (e) => e.visibility === ClaimEvidenceVisibility.ALL_ORDER_PARTIES,
          )
          .map((e) => this.presentPartyEvidence(e)),
        obligations: claim.obligations
          .filter((o) => this.obligationInvolves(o, viewerUserId))
          .map((o) => ({
            id: o.id,
            principal: o.principal.toFixed(2),
            currency: o.currency,
            status: o.status,
            debtorType: o.debtorType,
            creditorType: o.creditorType,
          })),
      },
    };
  }

  async listClaimsForOrder(wkOrderId: number, viewerUserId: string) {
    const viewer = await this.resolveViewer(wkOrderId, viewerUserId);
    if (viewer === 'DENIED') {
      throw new ForbiddenException({
        code: CODES.FORBIDDEN,
        message: 'Not authorized',
      });
    }
    if (viewer === 'ADMIN') {
      const rows = await this.prisma.exceptionClaim.findMany({
        where: { wkOrderId },
        orderBy: { createdAt: 'desc' },
        include: {
          economicLoss: { include: { coverages: true } },
          events: { orderBy: { createdAt: 'asc' } },
          evidence: { orderBy: { createdAt: 'asc' } },
          verifications: { orderBy: { createdAt: 'asc' } },
          verifiedFacts: { orderBy: { createdAt: 'asc' } },
          determinations: {
            orderBy: { createdAt: 'asc' },
            include: { allocations: true },
          },
          obligations: { orderBy: { createdAt: 'asc' } },
        },
      });
      return {
        code: 'EXCEPTION_CLAIMS',
        claims: rows.map((c) => this.presentAdminClaim(c)),
      };
    }
    const rows = await this.prisma.exceptionClaim.findMany({
      where: { wkOrderId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      code: 'EXCEPTION_CLAIMS',
      claims: rows.map((c) => this.minimalClaim(c)),
    };
  }

  private presentEvidenceProvenance(e: {
    evidenceKind: ClaimEvidenceKind;
    provenance: ClaimEvidenceProvenance | null;
  }) {
    return {
      provenance: presentClaimEvidenceProvenance(e.provenance),
      isTrustedOrderTermsSnapshot: isTrustedOrderTermsSnapshot(
        e.evidenceKind,
        e.provenance,
      ),
    };
  }

  private presentPartyEvidence(e: {
    id: string;
    evidenceKind: ClaimEvidenceKind;
    createdAt: Date;
    provenance: ClaimEvidenceProvenance | null;
  }) {
    return {
      id: e.id,
      evidenceKind: e.evidenceKind,
      createdAt: e.createdAt,
      ...this.presentEvidenceProvenance(e),
    };
  }

  private presentAdminClaim<
    T extends { evidence: Array<{
      evidenceKind: ClaimEvidenceKind;
      provenance: ClaimEvidenceProvenance | null;
    }> },
  >(claim: T) {
    return {
      ...claim,
      evidence: claim.evidence.map((e) => ({
        ...e,
        ...this.presentEvidenceProvenance(e),
      })),
    };
  }

  private obligationInvolves(
    obligation: {
      debtorUserId: string | null;
      creditorUserId: string | null;
    },
    userId: string,
  ): boolean {
    return (
      obligation.debtorUserId === userId || obligation.creditorUserId === userId
    );
  }

  private async resolveViewer(
    wkOrderId: number,
    actorUserId: string,
  ): Promise<Viewer> {
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
    });
    if (!user) return 'DENIED';
    if (user.role === UserRole.admin || user.role === UserRole.staff) {
      return 'ADMIN';
    }
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
      include: { fulfillment: true },
    });
    if (!order) return 'DENIED';
    if (order.userId === actorUserId) return 'PARTY';
    if (order.fulfillment?.activeRiderId === actorUserId) return 'PARTY';
    if (order.fulfillment?.physicalCustodianRiderId === actorUserId) {
      return 'PARTY';
    }
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: order.merchantId },
    });
    if (merchant?.userId === actorUserId) return 'PARTY';
    return 'DENIED';
  }
}
