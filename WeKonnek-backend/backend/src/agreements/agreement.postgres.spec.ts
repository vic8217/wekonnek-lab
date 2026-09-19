/**
 * Stage 2A PostgreSQL concurrency / immutability suite.
 * Historical: backend/.env.stage2.test and database wekonnek_stage2_test.
 * Current-schema: centralized disposable identity (WEKONNEK_CURRENT_SCHEMA_REGRESSION=1).
 * Does NOT fall back to stage0/stage1 databases.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { assertLegacyPostgresSuiteIdentity } from '../test-support/acceptance-database';

const STAGE2_ENV_PRESENT = loadStageTestEnv('.env.stage2.test');

import {
  AgreementAcceptanceMethod,
  AgreementPartyRole,
  AgreementProvenance,
  AgreementStatus,
  AgreementType,
  AgreementVersionStatus,
  CommerceDomain,
  Prisma,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { TrustTradeEligibilityService } from '../trust-trade/trust-trade-eligibility.service';
import { TrustTradeService } from '../trust-trade/trust-trade.service';
import { AgreementService } from './agreement.service';
import { AgreementEvidenceService } from './agreement-evidence.service';
import {
  buildMerchantTradeTerms,
  canonicalizeJson,
  sha256Hex,
} from './agreement-canonical';

const describeIf = STAGE2_ENV_PRESENT ? describe : describe.skip;

jest.setTimeout(90_000);

describeIf('Stage 2A agreements PostgreSQL (wekonnek_stage2_test)', () => {
  const prisma = new PrismaService();
  const events = new OrderDomainEventService(prisma);
  const agreements = new AgreementService(prisma, events);
  const evidence = new AgreementEvidenceService(prisma, events, agreements);
  const trustTrade = new TrustTradeService(
    prisma,
    new TrustTradeEligibilityService(prisma),
    agreements,
  );
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    await prisma.$connect();
    await assertLegacyPostgresSuiteIdentity(prisma, {
      label: 'Stage 2A agreements PostgreSQL',
      historicalDatabases: ['wekonnek_stage2_test'],
      historicalUsers: new Set(['wekonnek_stage2_test']),
    });
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function seed() {
    const token = randomUUID();
    const buyer = await prisma.user.create({
      data: {
        phone: `+6391${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s2a-b-${token}@test.invalid`,
      },
    });
    const merchantUser = await prisma.user.create({
      data: {
        phone: `+6392${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`,
        email: `s2a-m-${token}@test.invalid`,
        role: UserRole.merchant,
      },
    });
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S2A ${token}`,
        slug: `s2a-${token}`,
        commerceDomain: CommerceDomain.NON_FOOD,
      },
    });
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S2A-${token.slice(0, 8)}`,
        userId: buyer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 100,
        deliveryFee: 0,
        transactionFeeAmount: 0,
        paymentMethod: 'cod',
        paymentStatus: 'pending',
        orderItems: {
          create: [
            {
              productName: 'Item',
              quantity: 1,
              price: 100,
              subtotal: 100,
            },
          ],
        },
      },
    });

    cleanup = async () => {
      const ags = await prisma.agreement.findMany({
        where: { wkOrderId: order.id },
      });
      for (const ag of ags) {
        await prisma.agreementAcceptance.deleteMany({
          where: { agreementVersion: { agreementId: ag.id } },
        });
        await prisma.custodyEventEvidence.deleteMany({
          where: { evidence: { agreementId: ag.id } },
        });
        await prisma.custodyEvent.deleteMany({ where: { agreementId: ag.id } });
        await prisma.agreementEvidence.deleteMany({
          where: { agreementId: ag.id },
        });
        await prisma.agreementParty.deleteMany({
          where: { agreementId: ag.id },
        });
        await prisma.agreement.update({
          where: { id: ag.id },
          data: { currentVersionId: null },
        });
        await prisma.agreementVersion.deleteMany({
          where: { agreementId: ag.id },
        });
        await prisma.orderDomainEvent.deleteMany({
          where: { aggregateId: ag.id },
        });
        await prisma.trustTradeTransaction.deleteMany({
          where: { agreementId: ag.id },
        });
        await prisma.agreement.delete({ where: { id: ag.id } });
      }
      await prisma.trustTradeTransaction.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.wkOrder.delete({ where: { id: order.id } });
      await prisma.merchant.delete({ where: { id: merchant.id } });
      await prisma.user.deleteMany({
        where: { id: { in: [buyer.id, merchantUser.id] } },
      });
    };

    return { buyer, merchantUser, merchant, order };
  }

  function termsFromOrder(fullOrder: {
    id: number;
    orderCode: string;
    userId: string;
    merchantId: number;
    shopId: number | null;
    paymentMethod: string;
    paymentStatus: string;
    paymentRef: string | null;
    totalAmount: unknown;
    deliveryFee: unknown;
    discountAmount: unknown;
    transactionFeeAmount: unknown;
    merchant: { name: string };
    orderItems: Array<{
      productId: number | null;
      productName: string;
      variantId: number | null;
      quantity: number;
      price: unknown;
      subtotal: unknown;
    }>;
  }) {
    return buildMerchantTradeTerms({
      wkOrderId: fullOrder.id,
      orderCode: fullOrder.orderCode,
      buyerId: fullOrder.userId,
      merchantId: fullOrder.merchantId,
      merchantName: fullOrder.merchant.name,
      shopId: fullOrder.shopId,
      paymentMethod: fullOrder.paymentMethod,
      paymentStatus: fullOrder.paymentStatus,
      paymentRef: fullOrder.paymentRef,
      totalAmount: fullOrder.totalAmount,
      deliveryFee: fullOrder.deliveryFee,
      discountAmount: fullOrder.discountAmount,
      transactionFeeAmount: fullOrder.transactionFeeAmount,
      items: fullOrder.orderItems.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        variantId: item.variantId,
        quantity: item.quantity,
        price: item.price,
        subtotal: item.subtotal,
      })),
    });
  }

  it('creates agreement and handles concurrent duplicate acceptance idempotently', async () => {
    const { buyer, order } = await seed();
    const agreement = await agreements.offerMerchantTradeForOrder(order.id, {
      provenance: AgreementProvenance.EXPLICIT_ACCEPTANCE,
    });
    const versionId = agreement.currentVersionId!;
    const results = await Promise.allSettled([
      agreements.acceptVersion({
        agreementVersionId: versionId,
        actor: { userId: buyer.id, partyRole: AgreementPartyRole.CUSTOMER },
        method: AgreementAcceptanceMethod.WEB_CONFIRMATION,
      }),
      agreements.acceptVersion({
        agreementVersionId: versionId,
        actor: { userId: buyer.id, partyRole: AgreementPartyRole.CUSTOMER },
        method: AgreementAcceptanceMethod.WEB_CONFIRMATION,
      }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const count = await prisma.agreementAcceptance.count({
      where: { agreementVersionId: versionId },
    });
    expect(count).toBe(1);
    expect(ok.length).toBe(2);
    const integrity = await agreements.verifyIntegrity(versionId);
    expect(integrity.status).toBe('valid');
  });

  it('accept vs supersede cannot create contradictory authoritative state', async () => {
    const { buyer, merchantUser, order } = await seed();
    const agreement = await agreements.offerMerchantTradeForOrder(order.id, {
      provenance: AgreementProvenance.EXPLICIT_ACCEPTANCE,
    });
    const v1 = agreement.currentVersionId!;
    const fullOrder = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { merchant: true, orderItems: true },
    });

    const results = await Promise.allSettled([
      agreements.acceptVersion({
        agreementVersionId: v1,
        actor: { userId: buyer.id, partyRole: AgreementPartyRole.CUSTOMER },
        method: AgreementAcceptanceMethod.WEB_CONFIRMATION,
      }),
      agreements.offerAmendment({
        agreementId: agreement.id,
        actorUserId: merchantUser.id,
        reason: 'race amendment',
        termsBuilder: () => termsFromOrder(fullOrder),
      }),
    ]);

    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const version = await prisma.agreementVersion.findUniqueOrThrow({
      where: { id: v1 },
    });
    const acceptCount = await prisma.agreementAcceptance.count({
      where: { agreementVersionId: v1 },
    });
    const current = await prisma.agreement.findUniqueOrThrow({
      where: { id: agreement.id },
      include: { currentVersion: true, versions: true },
    });

    // If accept won against open offer: v1 ACCEPTED (or SUPERSEDED only if
    // amendment treated it as open offer before accept committed — never both
    // ACCEPTED-as-current and SUPERSEDED as contradictory finals).
    if (version.status === AgreementVersionStatus.ACCEPTED) {
      expect(acceptCount).toBe(1);
      // Accepted historical version may remain accepted while a newer offer exists.
      if (current.currentVersionId === v1) {
        expect(current.status).toBe(AgreementStatus.ACCEPTED);
      } else {
        expect(current.currentVersion?.status).toBe(
          AgreementVersionStatus.OFFERED,
        );
        expect(current.currentVersionId).not.toBe(v1);
      }
    } else if (version.status === AgreementVersionStatus.SUPERSEDED) {
      // Accept must not leave a dangling acceptance on a superseded open offer
      // without a coherent agreement current version.
      expect(current.currentVersionId).not.toBe(v1);
      expect(current.currentVersion?.status).toBe(
        AgreementVersionStatus.OFFERED,
      );
      if (acceptCount > 0) {
        // Acceptance of a superseded offer is not agreement-level ACCEPTED.
        expect(current.status).not.toBe(AgreementStatus.ACCEPTED);
      }
    } else if (version.status === AgreementVersionStatus.OFFERED) {
      // Amendment failed; accept should have succeeded.
      expect(acceptCount).toBe(1);
      expect(current.status).toBe(AgreementStatus.ACCEPTED);
    } else {
      throw new Error(`Unexpected v1 status ${version.status}`);
    }

    const numbers = current.versions.map((v) => v.versionNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('rejects accept of expired version', async () => {
    const { buyer, order } = await seed();
    const agreement = await agreements.offerMerchantTradeForOrder(order.id, {
      provenance: AgreementProvenance.EXPLICIT_ACCEPTANCE,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(
      agreements.acceptVersion({
        agreementVersionId: agreement.currentVersionId!,
        actor: { userId: buyer.id, partyRole: AgreementPartyRole.CUSTOMER },
        method: AgreementAcceptanceMethod.WEB_CONFIRMATION,
      }),
    ).rejects.toThrow(/expired/i);
  });

  it('competing amendments cannot create duplicate version numbers', async () => {
    const { merchantUser, order } = await seed();
    const agreement = await agreements.offerMerchantTradeForOrder(order.id, {
      provenance: AgreementProvenance.EXPLICIT_ACCEPTANCE,
    });
    const fullOrder = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { merchant: true, orderItems: true },
    });

    const results = await Promise.allSettled([
      agreements.offerAmendment({
        agreementId: agreement.id,
        actorUserId: merchantUser.id,
        reason: 'amend-a',
        termsBuilder: () => termsFromOrder(fullOrder),
      }),
      agreements.offerAmendment({
        agreementId: agreement.id,
        actorUserId: merchantUser.id,
        reason: 'amend-b',
        termsBuilder: () => termsFromOrder(fullOrder),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const versions = await prisma.agreementVersion.findMany({
      where: { agreementId: agreement.id },
      orderBy: { versionNumber: 'asc' },
    });
    const numbers = versions.map((v) => v.versionNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(Math.max(...numbers)).toBe(versions.length);
  });

  it('keeps accepted version immutable with stable hash; amendment is new version', async () => {
    const { buyer, merchantUser, order } = await seed();
    const agreement = await agreements.offerMerchantTradeForOrder(order.id, {
      provenance: AgreementProvenance.EXPLICIT_ACCEPTANCE,
    });
    const v1 = agreement.currentVersionId!;
    await agreements.acceptVersion({
      agreementVersionId: v1,
      actor: { userId: buyer.id, partyRole: AgreementPartyRole.CUSTOMER },
      method: AgreementAcceptanceMethod.WEB_CONFIRMATION,
    });
    const before = await prisma.agreementVersion.findUniqueOrThrow({
      where: { id: v1 },
    });
    await expect(agreements.assertVersionImmutable(v1)).rejects.toThrow(
      /cannot be mutated/i,
    );
    const integrityBefore = await agreements.verifyIntegrity(v1);
    expect(integrityBefore.status).toBe('valid');

    const fullOrder = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { merchant: true, orderItems: true },
    });
    const v2 = await agreements.offerAmendment({
      agreementId: agreement.id,
      actorUserId: merchantUser.id,
      reason: 'price clarification',
      termsBuilder: () => termsFromOrder(fullOrder),
    });
    expect(v2.versionNumber).toBe(2);
    expect(v2.status).toBe(AgreementVersionStatus.OFFERED);
    const prior = await prisma.agreementVersion.findUniqueOrThrow({
      where: { id: v1 },
    });
    expect(prior.status).toBe(AgreementVersionStatus.ACCEPTED);
    expect(prior.termsHash).toBe(before.termsHash);
    expect(JSON.stringify(prior.termsSnapshot)).toBe(
      JSON.stringify(before.termsSnapshot),
    );
    const integrityAfter = await agreements.verifyIntegrity(v1);
    expect(integrityAfter.status).toBe('valid');
  });

  it('concurrent same-key evidence submission produces one authoritative record', async () => {
    const { buyer, order } = await seed();
    const agreement = await agreements.offerMerchantTradeForOrder(order.id, {
      provenance: AgreementProvenance.EXPLICIT_ACCEPTANCE,
    });
    const key = `ev-${order.id}-${randomUUID()}`;
    const results = await Promise.allSettled([
      evidence.addEvidence({
        agreementId: agreement.id,
        actorUserId: buyer.id,
        evidenceType: 'NOTE',
        storageReference: 's3://bucket/a',
        idempotencyKey: key,
      }),
      evidence.addEvidence({
        agreementId: agreement.id,
        actorUserId: buyer.id,
        evidenceType: 'NOTE',
        storageReference: 's3://bucket/a',
        idempotencyKey: key,
      }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled') as Array<{
      status: 'fulfilled';
      value: Awaited<ReturnType<AgreementEvidenceService['addEvidence']>>;
    }>;
    expect(ok.length).toBe(2);
    expect(ok[0].value.evidence.id).toBe(ok[1].value.evidence.id);
    const count = await prisma.agreementEvidence.count({
      where: { idempotencyKey: key },
    });
    expect(count).toBe(1);
    await expect(
      evidence.assertImmutable(ok[0].value.evidence.id),
    ).rejects.toThrow(/cannot be mutated/i);
  });

  it('finalized evidence cannot be silently rewritten or deleted via service', async () => {
    const { buyer, order } = await seed();
    const agreement = await agreements.offerMerchantTradeForOrder(order.id, {
      provenance: AgreementProvenance.EXPLICIT_ACCEPTANCE,
    });
    const created = await evidence.addEvidence({
      agreementId: agreement.id,
      actorUserId: buyer.id,
      evidenceType: 'NOTE',
      storageReference: 's3://bucket/note',
      idempotencyKey: `note-${order.id}`,
    });
    await expect(
      evidence.assertImmutable(created.evidence.id),
    ).rejects.toThrow(/cannot be mutated/i);

    // Service-level correction path is supersession, not rewrite.
    const replaced = await evidence.supersedeEvidence({
      evidenceId: created.evidence.id,
      actorUserId: buyer.id,
      replacement: {
        evidenceType: 'NOTE',
        storageReference: 's3://bucket/note-corrected',
      },
    });
    const prior = await prisma.agreementEvidence.findUniqueOrThrow({
      where: { id: created.evidence.id },
    });
    expect(prior.storageReference).toBe('s3://bucket/note');
    expect(prior.supersededById).toBe(replaced.replacement.id);
  });

  it('detects tampering via SHA-256 integrity verification', async () => {
    const { order } = await seed();
    const agreement = await agreements.offerMerchantTradeForOrder(order.id, {
      provenance: AgreementProvenance.EXPLICIT_ACCEPTANCE,
    });
    const versionId = agreement.currentVersionId!;
    const original = await prisma.agreementVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    expect((await agreements.verifyIntegrity(versionId)).status).toBe('valid');

    const tampered = {
      ...(original.termsSnapshot as Record<string, unknown>),
      money: {
        ...((original.termsSnapshot as { money?: Record<string, unknown> })
          .money ?? {}),
        total: '0.01',
      },
    };
    await prisma.agreementVersion.update({
      where: { id: versionId },
      data: { termsSnapshot: tampered as Prisma.InputJsonValue },
    });
    const failed = await agreements.verifyIntegrity(versionId);
    expect(failed.status).toBe('invalid');

    // Restore for cleanup integrity and prove hash stability of restored content.
    await prisma.agreementVersion.update({
      where: { id: versionId },
      data: {
        termsSnapshot: original.termsSnapshot as Prisma.InputJsonValue,
      },
    });
    expect((await agreements.verifyIntegrity(versionId)).status).toBe('valid');
    expect(sha256Hex(canonicalizeJson(original.termsSnapshot))).toBe(
      original.termsHash,
    );
  });

  it('Trust Trade dual-write links MERCHANT_TRADE with LEGACY_SNAPSHOT until explicit accept', async () => {
    const { buyer, order } = await seed();
    await trustTrade.ensureForWkOrder(order.id);

    const tt = await prisma.trustTradeTransaction.findUniqueOrThrow({
      where: { wkOrderId: order.id },
    });
    expect(tt.agreementId).toBeTruthy();

    const agreement = await prisma.agreement.findUniqueOrThrow({
      where: { id: tt.agreementId! },
      include: { currentVersion: true },
    });
    expect(agreement.agreementType).toBe(AgreementType.MERCHANT_TRADE);
    expect(agreement.provenance).toBe(AgreementProvenance.LEGACY_SNAPSHOT);
    expect(agreement.status).toBe(AgreementStatus.OFFERED);

    // Legacy row remains readable and does not claim explicit acceptance.
    const snap = tt.agreementSnapshot as {
      stage2?: { provenance?: string; note?: string };
    };
    expect(snap.stage2?.provenance).toBe(AgreementProvenance.LEGACY_SNAPSHOT);
    expect(snap.stage2?.note).toMatch(/not explicit/i);

    await agreements.acceptVersion({
      agreementVersionId: agreement.currentVersionId!,
      actor: { userId: buyer.id, partyRole: AgreementPartyRole.CUSTOMER },
      method: AgreementAcceptanceMethod.WEB_CONFIRMATION,
    });
    const after = await prisma.agreement.findUniqueOrThrow({
      where: { id: agreement.id },
    });
    expect(after.provenance).toBe(AgreementProvenance.EXPLICIT_ACCEPTANCE);
    expect(after.status).toBe(AgreementStatus.ACCEPTED);

    // Legacy TT still readable after provenance upgrade.
    const ttAfter = await prisma.trustTradeTransaction.findUniqueOrThrow({
      where: { wkOrderId: order.id },
    });
    expect(ttAfter.id).toBe(tt.id);
    expect(ttAfter.agreementId).toBe(agreement.id);
  });
});

describe('Stage 2A PostgreSQL environment gate', () => {
  it('documents .env.stage2.test presence for gated suite', () => {
    expect(STAGE2_ENV_PRESENT).toBe(true);
  });
});
