/**
 * Stage15A trusted evidence provenance — PostgreSQL acceptance.
 * Dedicated disposable DB only: wekonnek_stage15a_*.
 * Never load frozen Stage12–14 historical parents.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  parseAcceptanceDatabaseUrl,
  redactDatabaseUrl,
} from '../test-support/acceptance-database';
import { isStage15aAcceptanceDatabase } from '../test-support/load-stage-test-env';
import { isRecognizedCurrentSchemaDisposableName } from '../test-support/test-database-guard';

const STAGE15A_ENV_PRESENT = loadStageTestEnv('.env.stage15a.test');

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ClaimEvidenceKind,
  ClaimEvidenceProvenance,
  ClaimEvidenceVisibility,
  CommerceDomain,
  ExceptionClaimEventType,
  ExceptionClaimType,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  OperationsRecoveryDisposition,
  OperationsRecoveryStatus,
  OperationsRecoveryTrigger,
  Prisma,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ExceptionFinancialService } from './exception-financial.service';
import {
  CLAIM_EVIDENCE_PROVENANCE_API,
  EXCEPTION_FINANCIAL_CODES,
} from './exception-financial.policy';

const describeIf = STAGE15A_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

function expectedDatabase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing after Stage15A env load');
  return parseAcceptanceDatabaseUrl(url).database;
}

function errCode(e: unknown): string | undefined {
  if (
    e instanceof ForbiddenException ||
    e instanceof BadRequestException ||
    e instanceof ConflictException ||
    e instanceof NotFoundException
  ) {
    const r = e.getResponse() as { code?: string };
    return typeof r === 'object' ? r.code : undefined;
  }
  return undefined;
}

async function expectCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected rejection with code ${code}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Expected rejection'))
      throw e;
    expect(errCode(e)).toBe(code);
  }
}

type SeedIds = {
  customerId: string;
  riderId: string;
  adminId: string;
  merchantUserId: string;
  merchantId: number;
  orderId: number;
  recoveryId: string;
};

describeIf('Stage15A trusted evidence provenance PostgreSQL', () => {
  const prisma = new PrismaService();
  const exceptions = new ExceptionFinancialService(prisma);
  const EXPECTED_DB = expectedDatabase();

  beforeAll(async () => {
    if (!isStage15aAcceptanceDatabase(EXPECTED_DB)) {
      throw new Error(
        `Stage15A refused: ${EXPECTED_DB} is not wekonnek_stage15a_* disposable`,
      );
    }
    if (!isRecognizedCurrentSchemaDisposableName(EXPECTED_DB)) {
      throw new Error(
        `Stage15A refused: ${EXPECTED_DB} failed current-schema disposable grammar`,
      );
    }
    await prisma.$connect();
    const identity = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >`SELECT current_database() AS database, current_user AS user`;
    const db = identity[0]?.database;
    const user = identity[0]?.user;
    if (db !== EXPECTED_DB) {
      throw new Error(
        `Stage15A refused: current_database=${db} expected=${EXPECTED_DB}`,
      );
    }
    if (
      user !== 'victor' &&
      user !== EXPECTED_DB &&
      !(user ?? '').startsWith('wekonnek_stage')
    ) {
      throw new Error(`Stage15A refused: unexpected current_user`);
    }
    void redactDatabaseUrl(process.env.DATABASE_URL ?? '');
    await exceptions.ensureSeededPolicy();
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function seedRecovery(): Promise<SeedIds> {
    const tag = randomUUID();
    const mkUser = (role: UserRole, prefix: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s15a-${prefix}-${tag}@test.invalid`,
          role,
          firstName: `S15A${prefix}`,
        },
      });
    const customer = await mkUser(UserRole.customer, 'c');
    const rider = await mkUser(UserRole.rider, 'r');
    const admin = await mkUser(UserRole.admin, 'a');
    const merchantUser = await mkUser(UserRole.merchant, 'm');
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S15A ${tag}`,
        slug: `s15a-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
        allowRiderAdvance: true,
      },
    });
    await prisma.merchantPaymentMethod.create({
      data: {
        id: randomUUID(),
        merchantId: merchant.id,
        kind: MerchantPaymentMethodKind.CASH,
        displayName: 'Cash',
        enabled: true,
      },
    });
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S15A-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: new Prisma.Decimal('1060.00'),
        deliveryFee: new Prisma.Decimal('50.00'),
        transactionFeeAmount: new Prisma.Decimal('10.00'),
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
        deliveryAddress: '123 Stage15A St, Manila',
        orderItems: {
          create: [
            { productName: 'item', quantity: 1, price: 1000, subtotal: 1000 },
          ],
        },
      },
    });
    const fulfillment = await prisma.orderFulfillment.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        merchantId: merchant.id,
        customerId: customer.id,
        status: FulfillmentStatus.delivery_failed,
        assignmentVersion: 1,
        activeRiderId: rider.id,
        physicalCustodianRiderId: rider.id,
      },
    });
    await prisma.riderAssignment.create({
      data: {
        id: randomUUID(),
        fulfillmentId: fulfillment.id,
        riderId: rider.id,
        status: RiderAssignmentStatus.ACTIVE,
        assignmentVersion: 1,
      },
    });
    const recovery = await prisma.operationsRecovery.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        fulfillmentId: fulfillment.id,
        customerId: customer.id,
        merchantId: merchant.id,
        openingTriggerCode: OperationsRecoveryTrigger.GOODS_REPORTED_LOST,
        openedByActorType: 'SYSTEM_ADMIN',
        openedByActorId: admin.id,
        correlationId: `s15a-rec-${tag.slice(0, 8)}`,
        status: OperationsRecoveryStatus.CLOSED,
        currentDisposition:
          OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED,
        closedAt: new Date(),
        closedByActorType: 'SYSTEM_ADMIN',
        closedByActorId: admin.id,
        closeReason: 'Stage15A acceptance fixture',
      },
    });
    return {
      customerId: customer.id,
      riderId: rider.id,
      adminId: admin.id,
      merchantUserId: merchantUser.id,
      merchantId: merchant.id,
      orderId: order.id,
      recoveryId: recovery.id,
    };
  }

  async function openClaim(fx: SeedIds, idempotencyKey?: string) {
    return exceptions.openClaimFromRecovery({
      operationsRecoveryId: fx.recoveryId,
      actorUserId: fx.adminId,
      claimType: ExceptionClaimType.GOODS_LOSS,
      subjectRef: `order-goods:${fx.orderId}`,
      correlationId: `s15a-open-${randomUUID().slice(0, 8)}`,
      idempotencyKey,
    });
  }

  it('generic ORDER_TERMS_SNAPSHOT is reserved: no row, no event', async () => {
    const fx = await seedRecovery();
    const opened = await openClaim(fx);
    const claimId = opened.claim.id as string;
    const beforeEvidence = await prisma.exceptionClaimEvidence.count({
      where: { exceptionClaimId: claimId },
    });
    const beforeEvents = await prisma.exceptionClaimEvent.count({
      where: {
        exceptionClaimId: claimId,
        eventType: ExceptionClaimEventType.EVIDENCE_ADDED,
      },
    });
    await expectCode(
      exceptions.addEvidence({
        claimId,
        actorUserId: fx.adminId,
        evidenceKind: ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT,
        metadata: { merchantId: 'foreign-merchant' },
        correlationId: `s15a-forge-${randomUUID().slice(0, 8)}`,
      }),
      EXCEPTION_FINANCIAL_CODES.EVIDENCE_KIND_RESERVED,
    );
    expect(
      await prisma.exceptionClaimEvidence.count({
        where: { exceptionClaimId: claimId },
      }),
    ).toBe(beforeEvidence);
    expect(
      await prisma.exceptionClaimEvent.count({
        where: {
          exceptionClaimId: claimId,
          eventType: ExceptionClaimEventType.EVIDENCE_ADDED,
        },
      }),
    ).toBe(beforeEvents);
  });

  it('generic PHOTO_REFERENCE cannot persist server-attested provenance', async () => {
    const fx = await seedRecovery();
    const opened = await openClaim(fx);
    const claimId = opened.claim.id as string;
    const added = await exceptions.addEvidence({
      claimId,
      actorUserId: fx.adminId,
      evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
      notes: 'photo',
      metadata: {
        provenance: 'SERVER_ATTESTED_ORDER_TERMS',
        sourceType: 'SERVER_ATTESTED_ORDER_TERMS',
        serverAttested: true,
      },
      correlationId: `s15a-meta-${randomUUID().slice(0, 8)}`,
    });
    const row = await prisma.exceptionClaimEvidence.findUnique({
      where: { id: added.evidenceId },
    });
    expect(row?.provenance).toBeNull();
    expect(row?.evidenceKind).toBe(ClaimEvidenceKind.PHOTO_REFERENCE);
  });

  it('specialized writer stores attested snapshot bound to the claim order', async () => {
    const fx = await seedRecovery();
    const opened = await openClaim(fx);
    const claimId = opened.claim.id as string;
    const added = await exceptions.attachOrderTermsEvidence({
      claimId,
      actorUserId: fx.adminId,
      correlationId: `s15a-terms-${randomUUID().slice(0, 8)}`,
    });
    const row = await prisma.exceptionClaimEvidence.findUnique({
      where: { id: added.evidenceId },
    });
    expect(row?.evidenceKind).toBe(ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT);
    expect(row?.provenance).toBe(
      ClaimEvidenceProvenance.SERVER_ATTESTED_ORDER_TERMS,
    );
    const meta = row?.metadata as {
      wkOrderId?: number;
      merchantId?: number;
      kind?: string;
    };
    expect(meta.kind).toBe('ORDER_TERMS_SNAPSHOT');
    expect(meta.wkOrderId).toBe(fx.orderId);
    expect(meta.merchantId).toBe(fx.merchantId);

    const read = await exceptions.getClaim(claimId, fx.adminId);
    const evidence = (
      read as {
        claim: {
          evidence: Array<{
            id: string;
            provenance: string;
            isTrustedOrderTermsSnapshot: boolean;
            metadata: { wkOrderId: number };
          }>;
        };
      }
    ).claim.evidence.find((e) => e.id === added.evidenceId);
    expect(evidence?.provenance).toBe(
      CLAIM_EVIDENCE_PROVENANCE_API.SERVER_ATTESTED_ORDER_TERMS,
    );
    expect(evidence?.isTrustedOrderTermsSnapshot).toBe(true);
    expect(evidence?.metadata.wkOrderId).toBe(fx.orderId);
  });

  it('historical NULL provenance ORDER_TERMS_SNAPSHOT is legacy/unverified', async () => {
    const fx = await seedRecovery();
    const opened = await openClaim(fx);
    const claimId = opened.claim.id as string;
    const historicalId = randomUUID();
    await prisma.exceptionClaimEvidence.create({
      data: {
        id: historicalId,
        exceptionClaimId: claimId,
        evidenceKind: ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT,
        visibility: ClaimEvidenceVisibility.ADMIN_ONLY,
        notes: 'pre-Stage15A snapshot',
        metadata: {
          kind: 'ORDER_TERMS_SNAPSHOT',
          wkOrderId: fx.orderId,
          merchantId: 999999,
        },
        provenance: null,
        submittedByActorType: 'SYSTEM_ADMIN',
        submittedByActorId: fx.adminId,
      },
    });
    const dbRow = await prisma.exceptionClaimEvidence.findUnique({
      where: { id: historicalId },
    });
    expect(dbRow?.provenance).toBeNull();

    const read = await exceptions.getClaim(claimId, fx.adminId);
    const evidence = (
      read as {
        claim: {
          evidence: Array<{
            id: string;
            evidenceKind: string;
            provenance: string;
            isTrustedOrderTermsSnapshot: boolean;
          }>;
        };
      }
    ).claim.evidence.find((e) => e.id === historicalId);
    expect(evidence?.evidenceKind).toBe(ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT);
    expect(evidence?.provenance).toBe(
      CLAIM_EVIDENCE_PROVENANCE_API.LEGACY_UNVERIFIED,
    );
    expect(evidence?.isTrustedOrderTermsSnapshot).toBe(false);
  });

  it('generic PHOTO remains readable alongside historical snapshots', async () => {
    const fx = await seedRecovery();
    const opened = await openClaim(fx);
    const claimId = opened.claim.id as string;
    await exceptions.addEvidence({
      claimId,
      actorUserId: fx.adminId,
      evidenceKind: ClaimEvidenceKind.PHOTO_REFERENCE,
      notes: 'still generic',
      correlationId: `s15a-photo-${randomUUID().slice(0, 8)}`,
    });
    const read = await exceptions.getClaim(claimId, fx.adminId);
    const kinds = (
      read as { claim: { evidence: Array<{ evidenceKind: string; provenance: string }> } }
    ).claim.evidence.map((e) => e.evidenceKind);
    expect(kinds).toContain(ClaimEvidenceKind.PHOTO_REFERENCE);
  });

  it('specialized idempotent replay returns the same evidence without mutation', async () => {
    const fx = await seedRecovery();
    const opened = await openClaim(fx);
    const claimId = opened.claim.id as string;
    const key = `s15a-idem-${randomUUID()}`;
    const first = await exceptions.attachOrderTermsEvidence({
      claimId,
      actorUserId: fx.adminId,
      correlationId: `s15a-idem-c-${randomUUID().slice(0, 8)}`,
      idempotencyKey: key,
    });
    const row1 = await prisma.exceptionClaimEvidence.findUnique({
      where: { id: first.evidenceId },
    });
    const second = await exceptions.attachOrderTermsEvidence({
      claimId,
      actorUserId: fx.adminId,
      correlationId: `s15a-idem-c2-${randomUUID().slice(0, 8)}`,
      idempotencyKey: key,
    });
    expect(second.idempotent).toBe(true);
    expect(second.evidenceId).toBe(first.evidenceId);
    const row2 = await prisma.exceptionClaimEvidence.findUnique({
      where: { id: first.evidenceId },
    });
    expect(row2?.metadata).toEqual(row1?.metadata);
    expect(row2?.provenance).toBe(row1?.provenance);
    expect(
      await prisma.exceptionClaimEvidence.count({
        where: {
          exceptionClaimId: claimId,
          evidenceKind: ClaimEvidenceKind.ORDER_TERMS_SNAPSHOT,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.exceptionClaimEvent.count({
        where: {
          exceptionClaimId: claimId,
          eventType: ExceptionClaimEventType.EVIDENCE_ADDED,
        },
      }),
    ).toBe(1);
  });

  it('same specialized key on another claim is a cross-context conflict', async () => {
    const fx1 = await seedRecovery();
    const fx2 = await seedRecovery();
    const claim1 = (await openClaim(fx1)).claim.id as string;
    const claim2 = (await openClaim(fx2)).claim.id as string;
    const key = `s15a-cross-${randomUUID()}`;
    await exceptions.attachOrderTermsEvidence({
      claimId: claim1,
      actorUserId: fx1.adminId,
      correlationId: `s15a-c1-${randomUUID().slice(0, 8)}`,
      idempotencyKey: key,
    });
    await expectCode(
      exceptions.attachOrderTermsEvidence({
        claimId: claim2,
        actorUserId: fx1.adminId,
        correlationId: `s15a-c2-${randomUUID().slice(0, 8)}`,
        idempotencyKey: key,
      }),
      EXCEPTION_FINANCIAL_CODES.IDEMPOTENCY_CROSS_ORDER_CONFLICT,
    );
  });

  it('rolls back trusted evidence when the event write fails', async () => {
    const fx = await seedRecovery();
    const opened = await openClaim(fx);
    const claimId = opened.claim.id as string;
    const before = await prisma.exceptionClaimEvidence.count({
      where: { exceptionClaimId: claimId },
    });
    const orig = (
      exceptions as unknown as {
        appendClaimEvent: (...args: unknown[]) => Promise<unknown>;
      }
    ).appendClaimEvent.bind(exceptions);
    (
      exceptions as unknown as {
        appendClaimEvent: (...args: unknown[]) => Promise<unknown>;
      }
    ).appendClaimEvent = async () => {
      throw new Error('forced-event-failure');
    };
    try {
      await expect(
        exceptions.attachOrderTermsEvidence({
          claimId,
          actorUserId: fx.adminId,
          correlationId: `s15a-boom-${randomUUID().slice(0, 8)}`,
        }),
      ).rejects.toThrow('forced-event-failure');
    } finally {
      (
        exceptions as unknown as {
          appendClaimEvent: (...args: unknown[]) => Promise<unknown>;
        }
      ).appendClaimEvent = orig;
    }
    expect(
      await prisma.exceptionClaimEvidence.count({
        where: { exceptionClaimId: claimId },
      }),
    ).toBe(before);
  });
});
