/**
 * Stage 9 Return Financial Determination — PostgreSQL acceptance.
 * Requires backend/.env.stage9.test → wekonnek_stage9_test
 * (or WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 → wekonnek_stage9_regression_test).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  STAGE9_ACCEPTANCE_DATABASE,
  STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE9_FORBIDDEN_DATABASES,
  isCurrentSchemaRegressionMode,
} from '../test-support/test-database-guard';

const STAGE9_ENV_PRESENT = loadStageTestEnv('.env.stage9.test');

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AgreementStatus,
  AgreementType,
  CommerceDomain,
  CustodyEventType,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  Prisma,
  ReturnFinancialDeterminationOutcome,
  ReturnFinancialDeterminationStatus,
  ReturnFinancialObligationType,
  ReturnFinancialSettlementMethod,
  ReturnFinancialSettlementStatus,
  ReturnFinancialTermsKind,
  RiderAdvanceSettlementStatus,
  RiderAdvanceStatus,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceSettlementService } from '../rider-advance-settlement/rider-advance-settlement.service';
import { RiderAdvanceCollectibilityService } from './rider-advance-collectibility.service';
import { ReturnFinancialDeterminationService } from './return-financial-determination.service';
import { ReturnFinancialResolutionService } from './return-financial-resolution.service';
import { ReturnFinancialSettlementService } from './return-financial-settlement.service';
import { ReturnFinancialTermsService } from './return-financial-terms.service';

const describeIf = STAGE9_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const ALLOWED_DB_USERS = new Set([
  'victor',
  'wekonnek_stage9_test',
  'wekonnek_stage9_regression_test',
  'wekonnek_stage10_regression_test',
]);
const EXPECTED_DB = isCurrentSchemaRegressionMode()
  ? STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE
  : STAGE9_ACCEPTANCE_DATABASE;

function errCode(e: unknown): string | undefined {
  if (
    e instanceof ForbiddenException ||
    e instanceof BadRequestException ||
    e instanceof ConflictException
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
    throw new Error(`Expected error ${code}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Expected error')) throw e;
    expect(errCode(e)).toBe(code);
  }
}

describeIf(`Stage 9 Return Financial PostgreSQL (${EXPECTED_DB})`, () => {
  const prisma = new PrismaService();
  const events = new OrderDomainEventService(prisma);
  const collectibility = new RiderAdvanceCollectibilityService(prisma);
  const terms = new ReturnFinancialTermsService(prisma);
  const determinations = new ReturnFinancialDeterminationService(
    prisma,
    events,
    collectibility,
    terms,
  );
  const settlements = new ReturnFinancialSettlementService(prisma, events);
  const resolution = new ReturnFinancialResolutionService(
    prisma,
    collectibility,
  );
  const stage5b = new RiderAdvanceSettlementService(
    prisma,
    events,
    collectibility,
  );
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    await prisma.$connect();
    const target = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
    const database = target[0]?.database;
    const user = target[0]?.user;
    if (
      !database ||
      STAGE9_FORBIDDEN_DATABASES.has(database) ||
      database !== EXPECTED_DB ||
      !user ||
      !ALLOWED_DB_USERS.has(user)
    ) {
      throw new Error(
        `Stage 9 tests require ${EXPECTED_DB}; got database=${database} user=${user}`,
      );
    }
    await terms.ensureSeededTerms();
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function seedReturnedOrder(opts?: {
    principal?: string;
    reimbursed?: string;
    path?: 'RA' | 'ORDINARY';
    acceptTerms?: boolean;
    creditorRiderSeparate?: boolean;
  }) {
    const tag = randomUUID();
    const mkUser = (role: UserRole, prefix: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s9-${prefix}-${tag}@test.invalid`,
          role,
          firstName: `S9${prefix}`,
        },
      });
    const customer = await mkUser(UserRole.customer, 'c');
    const rider = await mkUser(UserRole.rider, 'r');
    const returnRider = await mkUser(UserRole.rider, 'rr');
    const creditorRider = opts?.creditorRiderSeparate
      ? await mkUser(UserRole.rider, 'cr')
      : rider;
    const admin = await mkUser(UserRole.admin, 'a');
    const merchantUser = await mkUser(UserRole.merchant, 'm');
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S9 ${tag}`,
        slug: `s9-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
        allowRiderAdvance: opts?.path !== 'ORDINARY',
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
        orderCode: `WK-S9-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 1000,
        deliveryFee: 50,
        transactionFeeAmount: 0,
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        merchantPaymentStatus:
          opts?.path === 'ORDINARY'
            ? MerchantPaymentStatus.VERIFIED
            : MerchantPaymentStatus.NOT_REQUIRED,
        orderItems: {
          create: [
            {
              productName: 'item',
              quantity: 1,
              price: 1000,
              subtotal: 1000,
            },
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
        status: FulfillmentStatus.returned,
        assignmentVersion: 1,
        activeRiderId: returnRider.id,
        physicalCustodianRiderId: null,
      },
    });
    const assignment = await prisma.riderAssignment.create({
      data: {
        id: randomUUID(),
        fulfillmentId: fulfillment.id,
        riderId: creditorRider.id,
        status: RiderAssignmentStatus.SUPERSEDED,
        assignmentVersion: 1,
        assignedByType: 'SYSTEM',
      },
    });
    const returnCustody = await prisma.custodyEvent.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        fulfillmentId: fulfillment.id,
        eventType: CustodyEventType.RETURN_RECEIVED,
        actorUserId: merchantUser.id,
        toPartyRole: 'MERCHANT',
        fromPartyRole: 'RIDER',
        fromUserId: returnRider.id,
      },
    });

    let raId: string | null = null;
    if (opts?.path !== 'ORDINARY') {
      const agreementId = randomUUID();
      const versionId = randomUUID();
      await prisma.agreement.create({
        data: {
          id: agreementId,
          wkOrderId: order.id,
          agreementType: AgreementType.RIDER_ADVANCE,
          status: AgreementStatus.ACTIVE,
          requiredPartyRoles: ['CUSTOMER', 'RIDER'],
          parties: {
            create: [
              { id: randomUUID(), role: 'CUSTOMER', userId: customer.id },
              { id: randomUUID(), role: 'RIDER', userId: creditorRider.id },
            ],
          },
        },
      });
      await prisma.agreementVersion.create({
        data: {
          id: versionId,
          agreementId,
          versionNumber: 1,
          canonicalSchema: 'rider_advance.v1',
          termsSnapshot: { kind: 's9_test' },
          termsHash: randomUUID().replace(/-/g, ''),
        },
      });
      await prisma.agreement.update({
        where: { id: agreementId },
        data: { currentVersionId: versionId },
      });
      raId = randomUUID();
      const principal = opts?.principal ?? '800.00';
      await prisma.riderAdvance.create({
        data: {
          id: raId,
          wkOrderId: order.id,
          fulfillmentId: fulfillment.id,
          agreementId,
          agreementVersionId: versionId,
          customerId: customer.id,
          merchantId: merchant.id,
          riderId: creditorRider.id,
          riderAssignmentId: assignment.id,
          assignmentVersion: 1,
          currency: 'PHP',
          authorizedMaximumAmount: new Prisma.Decimal(principal),
          actualAdvanceAmount: new Prisma.Decimal(principal),
          reimbursementPrincipal: new Prisma.Decimal(principal),
          status:
            opts?.reimbursed && opts.reimbursed === principal
              ? RiderAdvanceStatus.REIMBURSED
              : RiderAdvanceStatus.REIMBURSEMENT_DUE,
        },
      });
      if (opts?.reimbursed && Number(opts.reimbursed) > 0) {
        await prisma.riderAdvanceSettlement.create({
          data: {
            id: randomUUID(),
            riderAdvanceId: raId,
            wkOrderId: order.id,
            customerId: customer.id,
            creditorRiderId: creditorRider.id,
            method: 'CASH',
            status: RiderAdvanceSettlementStatus.ACKNOWLEDGED,
            claimedAmount: new Prisma.Decimal(opts.reimbursed),
            acknowledgedAmount: new Prisma.Decimal(opts.reimbursed),
            claimedAt: new Date(),
            acknowledgedAt: new Date(),
            claimedByUserId: creditorRider.id,
            acknowledgedByUserId: creditorRider.id,
          },
        });
      }
    }

    if (opts?.acceptTerms !== false) {
      await terms.acceptTerms({
        wkOrderId: order.id,
        actorUserId: merchantUser.id,
        kind: ReturnFinancialTermsKind.MERCHANT_RETURN_FINANCIAL,
      });
      await terms.acceptTerms({
        wkOrderId: order.id,
        actorUserId: customer.id,
        kind: ReturnFinancialTermsKind.CUSTOMER_RETURN_FINANCIAL,
      });
    }

    cleanup = async () => {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE return_financial_settlements DISABLE TRIGGER USER;
        ALTER TABLE rider_advance_collection_restrictions DISABLE TRIGGER USER;
        ALTER TABLE return_financial_determinations DISABLE TRIGGER USER;
        ALTER TABLE rider_advance_settlements DISABLE TRIGGER USER;
      `);
      try {
        await prisma.returnFinancialSettlement.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.returnFinancialObligation.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.riderAdvanceCollectionRestriction.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.returnFinancialDetermination.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.returnFinancialTermsAcceptance.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.riderAdvanceSettlement.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.riderAdvance.deleteMany({ where: { wkOrderId: order.id } });
        await prisma.custodyEvent.deleteMany({ where: { wkOrderId: order.id } });
        const agreements = await prisma.agreement.findMany({
          where: { wkOrderId: order.id },
          select: { id: true },
        });
        for (const ag of agreements) {
          await prisma.agreement.update({
            where: { id: ag.id },
            data: { currentVersionId: null },
          });
          await prisma.agreementAcceptance.deleteMany({
            where: { agreementVersion: { agreementId: ag.id } },
          });
          await prisma.agreementEvidence.deleteMany({
            where: { agreementId: ag.id },
          });
          await prisma.agreementParty.deleteMany({
            where: { agreementId: ag.id },
          });
          await prisma.agreementVersion.deleteMany({
            where: { agreementId: ag.id },
          });
        }
        await prisma.agreement.deleteMany({ where: { wkOrderId: order.id } });
        await prisma.orderDomainEvent.deleteMany({
          where: { wkOrderId: order.id },
        });
        await prisma.riderAssignment.deleteMany({
          where: { fulfillmentId: fulfillment.id },
        });
        await prisma.orderFulfillment.delete({ where: { id: fulfillment.id } });
        await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
        await prisma.wkOrder.delete({ where: { id: order.id } });
        await prisma.merchantPaymentMethod.deleteMany({
          where: { merchantId: merchant.id },
        });
        await prisma.merchant.delete({ where: { id: merchant.id } });
        await prisma.user.deleteMany({
          where: {
            id: {
              in: [
                customer.id,
                rider.id,
                returnRider.id,
                creditorRider.id,
                admin.id,
                merchantUser.id,
              ].filter((v, i, a) => a.indexOf(v) === i),
            },
          },
        });
      } finally {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE return_financial_settlements ENABLE TRIGGER USER;
          ALTER TABLE rider_advance_collection_restrictions ENABLE TRIGGER USER;
          ALTER TABLE return_financial_determinations ENABLE TRIGGER USER;
          ALTER TABLE rider_advance_settlements ENABLE TRIGGER USER;
        `);
      }
    };

    return {
      orderId: order.id,
      fulfillmentId: fulfillment.id,
      customerId: customer.id,
      riderId: rider.id,
      returnRiderId: returnRider.id,
      creditorRiderId: creditorRider.id,
      adminId: admin.id,
      merchantUserId: merchantUser.id,
      merchantId: merchant.id,
      raId,
      returnCustodyId: returnCustody.id,
    };
  }

  async function finalizeQualifying(fx: Awaited<ReturnType<typeof seedReturnedOrder>>) {
    const created = await determinations.createOrPropose({
      wkOrderId: fx.orderId,
      actorUserId: fx.merchantUserId,
      outcome: ReturnFinancialDeterminationOutcome.QUALIFYING_FULL_RETURN,
    });
    await determinations.acknowledge({
      determinationId: created.determination.id,
      actorUserId: fx.merchantUserId,
    });
    return determinations.finalize({
      determinationId: created.determination.id,
      actorUserId: fx.merchantUserId,
    });
  }

  it('P=800 R=0 → repayment 800, refund 0, restriction ACTIVE, collectible 0', async () => {
    const fx = await seedReturnedOrder({ principal: '800.00', reimbursed: '0' });
    const result = await finalizeQualifying(fx);
    expect(result.determination.status).toBe(
      ReturnFinancialDeterminationStatus.FINALIZED,
    );
    expect(result.determination.merchantToRiderAmount?.toFixed(2)).toBe('800.00');
    expect(result.determination.merchantToCustomerAmount?.toFixed(2)).toBe(
      '0.00',
    );
    const obls = await prisma.returnFinancialObligation.findMany({
      where: { determinationId: result.determination.id },
    });
    expect(obls).toHaveLength(1);
    expect(obls[0].type).toBe(
      ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
    );
    expect(obls[0].principal.toFixed(2)).toBe('800.00');
    expect(obls[0].creditorUserId).toBe(fx.creditorRiderId);
    const restr = await prisma.riderAdvanceCollectionRestriction.findFirst({
      where: { riderAdvanceId: fx.raId!, status: 'ACTIVE' },
    });
    expect(restr?.restrictedAmount.toFixed(2)).toBe('800.00');
    const view = await collectibility.customerCollectibleRemaining(prisma, {
      id: fx.raId!,
      reimbursementPrincipal: new Prisma.Decimal(800),
    });
    expect(view.collectibleRemaining.toFixed(2)).toBe('0.00');
    // Stage 5B history unchanged
    const ra = await prisma.riderAdvance.findUniqueOrThrow({
      where: { id: fx.raId! },
    });
    expect(ra.reimbursementPrincipal?.toFixed(2)).toBe('800.00');
    expect(ra.status).toBe(RiderAdvanceStatus.REIMBURSEMENT_DUE);
  });

  it('P=800 R=300 → repayment 500, refund 300, collectible 0', async () => {
    const fx = await seedReturnedOrder({
      principal: '800.00',
      reimbursed: '300.00',
    });
    const result = await finalizeQualifying(fx);
    expect(result.determination.merchantToRiderAmount?.toFixed(2)).toBe('500.00');
    expect(result.determination.merchantToCustomerAmount?.toFixed(2)).toBe(
      '300.00',
    );
    const types = (
      await prisma.returnFinancialObligation.findMany({
        where: { determinationId: result.determination.id },
      })
    ).map((o) => ({ type: o.type, p: o.principal.toFixed(2) }));
    expect(types).toEqual(
      expect.arrayContaining([
        {
          type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
          p: '500.00',
        },
        {
          type: ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
          p: '300.00',
        },
      ]),
    );
    const view = await collectibility.customerCollectibleRemaining(prisma, {
      id: fx.raId!,
      reimbursementPrincipal: new Prisma.Decimal(800),
    });
    expect(view.collectibleRemaining.toFixed(2)).toBe('0.00');
  });

  it('P=800 R=800 → repayment 0, refund 800, no restriction', async () => {
    const fx = await seedReturnedOrder({
      principal: '800.00',
      reimbursed: '800.00',
    });
    const result = await finalizeQualifying(fx);
    expect(result.determination.merchantToRiderAmount?.toFixed(2)).toBe('0.00');
    expect(result.determination.merchantToCustomerAmount?.toFixed(2)).toBe(
      '800.00',
    );
    const obls = await prisma.returnFinancialObligation.findMany({
      where: { determinationId: result.determination.id },
    });
    expect(obls).toHaveLength(1);
    expect(obls[0].type).toBe(
      ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
    );
    expect(
      await prisma.riderAdvanceCollectionRestriction.count({
        where: { riderAdvanceId: fx.raId! },
      }),
    ).toBe(0);
  });

  it('no principal invent — ADVANCE_RECORDED without principal fails finalize formula', async () => {
    const fx = await seedReturnedOrder({ principal: '800.00' });
    await prisma.riderAdvance.update({
      where: { id: fx.raId! },
      data: {
        reimbursementPrincipal: null,
        status: RiderAdvanceStatus.ADVANCE_RECORDED,
      },
    });
    const created = await determinations.createOrPropose({
      wkOrderId: fx.orderId,
      actorUserId: fx.merchantUserId,
      outcome: ReturnFinancialDeterminationOutcome.QUALIFYING_FULL_RETURN,
    });
    await determinations.acknowledge({
      determinationId: created.determination.id,
      actorUserId: fx.merchantUserId,
    });
    await expectCode(
      determinations.finalize({
        determinationId: created.determination.id,
        actorUserId: fx.merchantUserId,
      }),
      'NO_PRINCIPAL',
    );
  });

  it('Stage5B vs Stage9 finalize race — exactly one coherent Outcome A or B', async () => {
    const fx = await seedReturnedOrder({
      principal: '800.00',
      reimbursed: '300.00',
    });
    const created = await determinations.createOrPropose({
      wkOrderId: fx.orderId,
      actorUserId: fx.merchantUserId,
      outcome: ReturnFinancialDeterminationOutcome.QUALIFYING_FULL_RETURN,
    });
    await determinations.acknowledge({
      determinationId: created.determination.id,
      actorUserId: fx.merchantUserId,
    });

    const results = await Promise.allSettled([
      stage5b.createCashReceipt({
        riderAdvanceId: fx.raId!,
        actorUserId: fx.creditorRiderId,
        amount: '500.00',
        idempotencyKey: `race-5b-${randomUUID()}`,
      }),
      determinations.finalize({
        determinationId: created.determination.id,
        actorUserId: fx.merchantUserId,
        idempotencyKey: `race-s9-${randomUUID()}`,
      }),
    ]);

    const det = await prisma.returnFinancialDetermination.findUniqueOrThrow({
      where: { id: created.determination.id },
    });
    expect(det.status).toBe(ReturnFinancialDeterminationStatus.FINALIZED);

    const ackSum = await collectibility.sumAcknowledgedReimbursement(
      prisma,
      fx.raId!,
    );
    const view = await collectibility.customerCollectibleRemaining(prisma, {
      id: fx.raId!,
      reimbursementPrincipal: new Prisma.Decimal(800),
    });
    const m2r = Number(det.merchantToRiderAmount?.toFixed(2) ?? '0');
    const m2c = Number(det.merchantToCustomerAmount?.toFixed(2) ?? '0');

    // Outcome A: 5B wins first → R=800, m2r=0, m2c=800
    // Outcome B: Stage9 wins first → R=300, m2r=500, m2c=300; later 5B rejected
    const outcomeA = ackSum.eq(800) && m2r === 0 && m2c === 800;
    const outcomeB = ackSum.eq(300) && m2r === 500 && m2c === 300;
    expect(outcomeA || outcomeB).toBe(true);
    // Forbidden: customer paid remaining AND merchant owes same remaining
    expect(!(ackSum.eq(800) && m2r === 500)).toBe(true);
    expect(view.collectibleRemaining.toFixed(2)).toBe('0.00');
    expect(results.length).toBe(2);
  });

  it('stale Stage5B claim ACK after restriction fails', async () => {
    const fx = await seedReturnedOrder({
      principal: '800.00',
      reimbursed: '300.00',
    });
    // Create claim for remaining 500 before finalize
    const claim = await stage5b.createDirectTransferClaim({
      riderAdvanceId: fx.raId!,
      actorUserId: fx.customerId,
      amount: '500.00',
      idempotencyKey: `stale-${randomUUID()}`,
    });
    await finalizeQualifying(fx);
    await expectCode(
      stage5b.acknowledge({
        settlementId: claim.settlement.id,
        actorUserId: fx.creditorRiderId,
        acknowledgedAmount: '500.00',
      }),
      'CUSTOMER_REIMBURSEMENT_COLLECTION_RESTRICTED',
    );
  });

  it('dual finalize uniqueness — one FINALIZED per order', async () => {
    const fx = await seedReturnedOrder({ principal: '800.00' });
    const a = await determinations.createOrPropose({
      wkOrderId: fx.orderId,
      actorUserId: fx.merchantUserId,
    });
    await determinations.acknowledge({
      determinationId: a.determination.id,
      actorUserId: fx.merchantUserId,
    });
    await determinations.finalize({
      determinationId: a.determination.id,
      actorUserId: fx.merchantUserId,
    });
    await expectCode(
      determinations.createOrPropose({
        wkOrderId: fx.orderId,
        actorUserId: fx.merchantUserId,
      }),
      'DETERMINATION_ALREADY_FINALIZED',
    );
  });

  it('dual determination finalize race — exactly one FINALIZED row', async () => {
    const fx = await seedReturnedOrder({ principal: '800.00' });
    const a = await determinations.createOrPropose({
      wkOrderId: fx.orderId,
      actorUserId: fx.merchantUserId,
    });
    await determinations.acknowledge({
      determinationId: a.determination.id,
      actorUserId: fx.merchantUserId,
    });
    const results = await Promise.allSettled([
      determinations.finalize({
        determinationId: a.determination.id,
        actorUserId: fx.merchantUserId,
        idempotencyKey: `dual-a-${randomUUID()}`,
      }),
      determinations.finalize({
        determinationId: a.determination.id,
        actorUserId: fx.merchantUserId,
        idempotencyKey: `dual-b-${randomUUID()}`,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const finalized = await prisma.returnFinancialDetermination.count({
      where: {
        wkOrderId: fx.orderId,
        status: ReturnFinancialDeterminationStatus.FINALIZED,
      },
    });
    expect(finalized).toBe(1);
    const obligations = await prisma.returnFinancialObligation.count({
      where: { wkOrderId: fx.orderId },
    });
    expect(obligations).toBeGreaterThanOrEqual(1);
  });

  it('A/B/C rider creditor separation — only RiderAdvance.riderId is creditor', async () => {
    const fx = await seedReturnedOrder({
      principal: '800.00',
      creditorRiderSeparate: true,
    });
    expect(fx.creditorRiderId).not.toBe(fx.returnRiderId);
    expect(fx.creditorRiderId).not.toBe(fx.riderId);
    const result = await finalizeQualifying(fx);
    const repayment = await prisma.returnFinancialObligation.findFirstOrThrow({
      where: {
        determinationId: result.determination.id,
        type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
      },
    });
    expect(repayment.creditorUserId).toBe(fx.creditorRiderId);
    await expectCode(
      settlements.createSettlement({
        obligationId: repayment.id,
        actorUserId: fx.returnRiderId,
        method: ReturnFinancialSettlementMethod.CASH,
        amount: '100.00',
      }),
      'NOT_FINANCIAL_CREDITOR',
    );
    await expectCode(
      settlements.createSettlement({
        obligationId: repayment.id,
        actorUserId: fx.riderId,
        method: ReturnFinancialSettlementMethod.CASH,
        amount: '100.00',
      }),
      'NOT_FINANCIAL_CREDITOR',
    );
    const ok = await settlements.createSettlement({
      obligationId: repayment.id,
      actorUserId: fx.creditorRiderId,
      method: ReturnFinancialSettlementMethod.CASH,
      amount: '100.00',
    });
    expect(ok.settlement.status).toBe(
      ReturnFinancialSettlementStatus.ACKNOWLEDGED,
    );
  });

  it('settlement partial then settle remaining', async () => {
    const fx = await seedReturnedOrder({ principal: '800.00' });
    const fin = await finalizeQualifying(fx);
    const repayment = await prisma.returnFinancialObligation.findFirstOrThrow({
      where: {
        determinationId: fin.determination.id,
        type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
      },
    });
    await settlements.createSettlement({
      obligationId: repayment.id,
      actorUserId: fx.creditorRiderId,
      method: 'CASH',
      amount: '300.00',
    });
    let obl = await prisma.returnFinancialObligation.findUniqueOrThrow({
      where: { id: repayment.id },
    });
    expect(obl.status).toBe('PARTIALLY_SETTLED');
    await settlements.createSettlement({
      obligationId: repayment.id,
      actorUserId: fx.creditorRiderId,
      method: 'CASH',
      amount: '500.00',
    });
    obl = await prisma.returnFinancialObligation.findUniqueOrThrow({
      where: { id: repayment.id },
    });
    expect(obl.status).toBe('SETTLED');
  });

  it('settlement overpayment blocked', async () => {
    const fx = await seedReturnedOrder({ principal: '800.00' });
    const fin = await finalizeQualifying(fx);
    const repayment = await prisma.returnFinancialObligation.findFirstOrThrow({
      where: {
        determinationId: fin.determination.id,
        type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
      },
    });
    await expectCode(
      settlements.createSettlement({
        obligationId: repayment.id,
        actorUserId: fx.creditorRiderId,
        method: 'CASH',
        amount: '801.00',
      }),
      'SETTLEMENT_AMOUNT_EXCEEDS_REMAINING',
    );
  });

  it('cross-order settlement idempotency key is not a cache hit', async () => {
    const fx1 = await seedReturnedOrder({ principal: '800.00' });
    const fin1 = await finalizeQualifying(fx1);
    const obl1 = await prisma.returnFinancialObligation.findFirstOrThrow({
      where: {
        determinationId: fin1.determination.id,
        type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
      },
    });
    const sharedKey = `cross-order-${randomUUID()}`;
    await settlements.createSettlement({
      obligationId: obl1.id,
      actorUserId: fx1.creditorRiderId,
      method: 'CASH',
      amount: '50.00',
      idempotencyKey: sharedKey,
    });
    // Keep fx1 cleanup for later — seed second order under nested cleanup swap
    const cleanup1 = cleanup!;
    cleanup = undefined;
    const fx2 = await seedReturnedOrder({ principal: '800.00' });
    const fin2 = await finalizeQualifying(fx2);
    const obl2 = await prisma.returnFinancialObligation.findFirstOrThrow({
      where: {
        determinationId: fin2.determination.id,
        type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
      },
    });
    await expectCode(
      settlements.createSettlement({
        obligationId: obl2.id,
        actorUserId: fx2.creditorRiderId,
        method: 'CASH',
        amount: '50.00',
        idempotencyKey: sharedKey,
      }),
      'IDEMPOTENCY_PAYLOAD_CONFLICT',
    );
    const cleanup2 = cleanup!;
    cleanup = async () => {
      await cleanup2();
      await cleanup1();
    };
  });

  it('terminal settlement financial fields immutable via trigger', async () => {
    const fx = await seedReturnedOrder({ principal: '800.00' });
    const fin = await finalizeQualifying(fx);
    const repayment = await prisma.returnFinancialObligation.findFirstOrThrow({
      where: {
        determinationId: fin.determination.id,
        type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
      },
    });
    const settled = await settlements.createSettlement({
      obligationId: repayment.id,
      actorUserId: fx.creditorRiderId,
      method: 'CASH',
      amount: '25.00',
    });
    await expect(
      prisma.$executeRaw`
        UPDATE return_financial_settlements
        SET acknowledged_amount = 1
        WHERE id = ${settled.settlement.id}::uuid
      `,
    ).rejects.toThrow(/immutable/i);
  });

  it('terms/legacy gate — no auto formula without Stage 9 terms', async () => {
    const fx = await seedReturnedOrder({
      principal: '800.00',
      acceptTerms: false,
    });
    await expectCode(
      determinations.createOrPropose({
        wkOrderId: fx.orderId,
        actorUserId: fx.merchantUserId,
        outcome: ReturnFinancialDeterminationOutcome.QUALIFYING_FULL_RETURN,
        termsHash: 'spoofed-hash-not-authoritative',
      }),
      'RETURN_FINANCIAL_MANUAL_DETERMINATION_REQUIRED',
    );
  });

  it('ordinary payment path — VERIFIED unchanged, explicit refundPrincipal, no RA restriction', async () => {
    const fx = await seedReturnedOrder({ path: 'ORDINARY' });
    const before = (
      await prisma.wkOrder.findUniqueOrThrow({ where: { id: fx.orderId } })
    ).merchantPaymentStatus;
    expect(before).toBe(MerchantPaymentStatus.VERIFIED);
    const created = await determinations.createOrPropose({
      wkOrderId: fx.orderId,
      actorUserId: fx.merchantUserId,
      path: 'ORDINARY_MERCHANT_PAYMENT',
      ordinaryRefundPrincipal: '250.00',
      outcome: ReturnFinancialDeterminationOutcome.QUALIFYING_FULL_RETURN,
    });
    await determinations.acknowledge({
      determinationId: created.determination.id,
      actorUserId: fx.merchantUserId,
    });
    const result = await determinations.finalize({
      determinationId: created.determination.id,
      actorUserId: fx.merchantUserId,
    });
    const after = (
      await prisma.wkOrder.findUniqueOrThrow({ where: { id: fx.orderId } })
    ).merchantPaymentStatus;
    expect(after).toBe(MerchantPaymentStatus.VERIFIED);
    const obls = await prisma.returnFinancialObligation.findMany({
      where: { determinationId: result.determination.id },
    });
    expect(obls).toHaveLength(1);
    expect(obls[0].type).toBe(
      ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
    );
    expect(obls[0].principal.toFixed(2)).toBe('250.00');
    expect(
      await prisma.riderAdvanceCollectionRestriction.count({
        where: { wkOrderId: fx.orderId },
      }),
    ).toBe(0);
  });

  it('cash/transfer/partial/overpay/idempotency/auth-before-cache', async () => {
    const fx = await seedReturnedOrder({
      principal: '800.00',
      reimbursed: '300.00',
    });
    const fin = await finalizeQualifying(fx);
    const repayment = await prisma.returnFinancialObligation.findFirstOrThrow({
      where: {
        determinationId: fin.determination.id,
        type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
      },
    });
    const refund = await prisma.returnFinancialObligation.findFirstOrThrow({
      where: {
        determinationId: fin.determination.id,
        type: ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
      },
    });

    // Partial cash
    await settlements.createSettlement({
      obligationId: repayment.id,
      actorUserId: fx.creditorRiderId,
      method: 'CASH',
      amount: '200.00',
      idempotencyKey: `cash-partial-${fx.orderId}`,
    });
    // Idempotent cash
    const again = await settlements.createSettlement({
      obligationId: repayment.id,
      actorUserId: fx.creditorRiderId,
      method: 'CASH',
      amount: '200.00',
      idempotencyKey: `cash-partial-${fx.orderId}`,
    });
    expect(again.idempotent).toBe(true);

    // Auth-before-cache: wrong actor on same key
    await expectCode(
      settlements.createSettlement({
        obligationId: repayment.id,
        actorUserId: fx.returnRiderId,
        method: 'CASH',
        amount: '200.00',
        idempotencyKey: `cash-partial-${fx.orderId}`,
      }),
      'NOT_FINANCIAL_CREDITOR',
    );

    // Transfer claim + ack (partial remaining after cash 200 of 500)
    const claim = await settlements.createSettlement({
      obligationId: repayment.id,
      actorUserId: fx.merchantUserId,
      method: 'DIRECT_TRANSFER',
      amount: '200.00',
      externalReference: 'TXN-1',
      idempotencyKey: `xfer-${fx.orderId}`,
    });
    await settlements.acknowledge({
      settlementId: claim.settlement.id,
      actorUserId: fx.creditorRiderId,
      acknowledgedAmount: '200.00',
    });

    // Overpay rejected while still OPEN/PARTIAL
    await expectCode(
      settlements.createSettlement({
        obligationId: repayment.id,
        actorUserId: fx.creditorRiderId,
        method: 'CASH',
        amount: '200.00',
      }),
      'SETTLEMENT_AMOUNT_EXCEEDS_REMAINING',
    );

    // Finish repayment
    await settlements.createSettlement({
      obligationId: repayment.id,
      actorUserId: fx.creditorRiderId,
      method: 'CASH',
      amount: '100.00',
    });

    // Customer cash refund
    await settlements.createSettlement({
      obligationId: refund.id,
      actorUserId: fx.customerId,
      method: 'CASH',
      amount: '300.00',
    });

    const res = await resolution.getForOrder(fx.orderId, fx.merchantUserId);
    expect(res.merchantToRiderRepayment?.remaining).toBe('0.00');
    expect(res.merchantToCustomerRefund?.remaining).toBe('0.00');
  });

  it('merchant owner only; staff/return rider denied determination', async () => {
    const fx = await seedReturnedOrder({ principal: '800.00' });
    await expectCode(
      determinations.createOrPropose({
        wkOrderId: fx.orderId,
        actorUserId: fx.returnRiderId,
      }),
      'NOT_MERCHANT_OWNER',
    );
    await expectCode(
      determinations.createOrPropose({
        wkOrderId: fx.orderId,
        actorUserId: fx.customerId,
      }),
      'NOT_MERCHANT_OWNER',
    );
  });

  it('eligibility requires returned + RETURN_RECEIVED', async () => {
    const fx = await seedReturnedOrder({ principal: '800.00' });
    await prisma.orderFulfillment.update({
      where: { id: fx.fulfillmentId },
      data: { status: FulfillmentStatus.returning },
    });
    await expectCode(
      determinations.createOrPropose({
        wkOrderId: fx.orderId,
        actorUserId: fx.merchantUserId,
      }),
      'RETURN_NOT_FINANCIALLY_ELIGIBLE',
    );
  });

  it('FINALIZED financial fields immutable via trigger', async () => {
    const fx = await seedReturnedOrder({ principal: '800.00' });
    const fin = await finalizeQualifying(fx);
    await expect(
      prisma.$executeRaw`
        UPDATE return_financial_determinations
        SET merchant_to_rider_amount = 1
        WHERE id = ${fin.determination.id}::uuid
      `,
    ).rejects.toThrow(/immutable/i);
  });

  it('append-only DELETE blocked on settlements and restrictions', async () => {
    const fx = await seedReturnedOrder({ principal: '800.00' });
    const fin = await finalizeQualifying(fx);
    const restr = await prisma.riderAdvanceCollectionRestriction.findFirstOrThrow({
      where: { returnFinancialDeterminationId: fin.determination.id },
    });
    await expect(
      prisma.$executeRaw`
        DELETE FROM rider_advance_collection_restrictions WHERE id = ${restr.id}::uuid
      `,
    ).rejects.toThrow(/append_only/i);
  });

  it('guards finalized terms, finalized deletion, and derived restriction allocation', async () => {
    const fx = await seedReturnedOrder({ principal: '800.00' });
    const fin = await finalizeQualifying(fx);
    const restriction =
      await prisma.riderAdvanceCollectionRestriction.findFirstOrThrow({
        where: { returnFinancialDeterminationId: fin.determination.id },
      });
    await expect(
      prisma.$executeRaw`
        UPDATE return_financial_determinations
        SET merchant_terms_hash = 'forged'
        WHERE id = ${fin.determination.id}::uuid
      `,
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.$executeRaw`
        UPDATE rider_advance_collection_restrictions
        SET restricted_amount = 1
        WHERE id = ${restriction.id}::uuid
      `,
    ).rejects.toThrow(/immutable/i);
    await expect(
      prisma.$executeRaw`
        DELETE FROM return_financial_determinations
        WHERE id = ${fin.determination.id}::uuid
      `,
    ).rejects.toThrow(/append_only/i);
  });
});
