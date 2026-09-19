/**
 * Stage13B-1 PostgreSQL acceptance — dedicated disposable DB.
 * Default: backend/.env.stage13b1.test → wekonnek_stage13b1_test
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertPrismaConnectedToStage13b1AcceptanceDb,
  resolveStage13b1ExpectedDatabase,
  stage13b1AllowedDbUsers,
} from '../test-support/acceptance-database';
import { STAGE13B1_FORBIDDEN_DATABASES } from '../test-support/test-database-guard';

const STAGE13B1_ENV_PRESENT = loadStageTestEnv('.env.stage13b1.test');

import {
  ExceptionLiablePartyType,
  ReturnFinancialDeterminationStatus,
  RiderAdvanceSettlementStatus,
  RiderAdvanceStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { ExceptionFinancialService } from '../exception-financial/exception-financial.service';
import {
  insertFinalizedSuccessorAdjustment,
  seedOpenObligation,
} from '../exception-financial/exception-financial-settlement.test-seed';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialReconciliationService } from './financial-reconciliation.service';
import {
  insertActiveRestriction,
  insertExceptionAck,
  insertFinalizedReturnDetermination,
  insertRiderAdvance,
  insertRiderAdvanceAck,
  seedOrderParties,
} from './financial-reconciliation.test-seed';
import {
  RAIL_EXCEPTION_FINANCIAL,
  RAIL_RETURN_FINANCIAL,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
} from './financial-reconciliation.types';

const describeIf = STAGE13B1_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = STAGE13B1_ENV_PRESENT
  ? resolveStage13b1ExpectedDatabase()
  : 'wekonnek_stage13b1_test';
const ALLOWED_DB_USERS = stage13b1AllowedDbUsers(EXPECTED_DB);

describeIf(
  `Stage13B-1 financial-reconciliation PostgreSQL (${EXPECTED_DB})`,
  () => {
    const prisma = new PrismaService();
    const reconciliation = new FinancialReconciliationService(prisma);
    const exceptions = new ExceptionFinancialService(prisma);

    beforeAll(async () => {
      await prisma.$connect();
      const identity = await assertPrismaConnectedToStage13b1AcceptanceDb(
        prisma,
        EXPECTED_DB,
        'Stage13B-1 postgres',
      );
      if (
        STAGE13B1_FORBIDDEN_DATABASES.has(identity.database) ||
        !ALLOWED_DB_USERS.has(identity.user)
      ) {
        throw new Error(
          `Stage13B-1 tests require ${EXPECTED_DB}; got database=${identity.database} user=${identity.user}`,
        );
      }
      await exceptions.ensureSeededPolicy();
    });

    afterAll(async () => prisma.onModuleDestroy());

    it('reports current_database() / current_user() before fixtures', async () => {
      const rows = await prisma.$queryRaw<
        Array<{ database: string; user: string }>
      >`SELECT current_database() AS database, current_user AS user`;
      expect(rows[0]?.database).toBe(EXPECTED_DB);
      expect(ALLOWED_DB_USERS.has(rows[0]!.user)).toBe(true);
    });

    it('CASE A — Rider Advance P800 ACK300', async () => {
      const fx = await seedOrderParties(prisma);
      const raId = await insertRiderAdvance(prisma, fx, {
        riderId: fx.riderAId,
        principal: '800.00',
      });
      await insertRiderAdvanceAck(prisma, fx, raId, '300.00');
      await prisma.riderAdvanceSettlement.create({
        data: {
          id: randomUUID(),
          riderAdvanceId: raId,
          wkOrderId: fx.orderId,
          customerId: fx.customerId,
          creditorRiderId: fx.riderAId,
          method: 'DIRECT_TRANSFER',
          status: RiderAdvanceSettlementStatus.CLAIMED,
          currency: 'PHP',
          claimedAmount: '200.00',
        },
      });
      const view = await reconciliation.forOrder(fx.orderId);
      const ra = view.items.filter(
        (i) => i.rail === RAIL_RIDER_ADVANCE_REIMBURSEMENT,
      );
      expect(ra).toHaveLength(1);
      expect(ra[0].obligationId).toBe(raId);
      expect(ra[0].originalPrincipal.toFixed(2)).toBe('800.00');
      expect(ra[0].settledAmount.toFixed(2)).toBe('300.00');
      expect(ra[0].remainingAmount.toFixed(2)).toBe('500.00');
      expect(ra[0].collectibleRemaining?.toFixed(2)).toBe('500.00');
      expect(ra[0].creditor.userId).toBe(fx.riderAId);
      expect(ra[0].financialState).toBe('PARTIALLY_SETTLED');
    });

    it('CASE B — three directional items; restriction overlay; no merchant-owes-800', async () => {
      const fx = await seedOrderParties(prisma);
      const raId = await insertRiderAdvance(prisma, fx, {
        riderId: fx.riderAId,
        principal: '800.00',
      });
      await insertRiderAdvanceAck(prisma, fx, raId, '300.00');
      const det = await insertFinalizedReturnDetermination(prisma, fx, {
        riderAdvanceId: raId,
        merchantToRider: '500.00',
        merchantToCustomer: '300.00',
      });
      await insertActiveRestriction(prisma, fx, raId, det.determinationId, '500.00');

      const view = await reconciliation.forOrder(fx.orderId);
      const ra = view.items.find((i) => i.rail === RAIL_RIDER_ADVANCE_REIMBURSEMENT)!;
      const m2r = view.items.find(
        (i) =>
          i.rail === RAIL_RETURN_FINANCIAL && i.creditor.type === 'RIDER',
      )!;
      const m2c = view.items.find(
        (i) =>
          i.rail === RAIL_RETURN_FINANCIAL && i.creditor.type === 'CUSTOMER',
      )!;
      expect(ra.originalPrincipal.toFixed(2)).toBe('800.00');
      expect(ra.settledAmount.toFixed(2)).toBe('300.00');
      expect(ra.remainingAmount.toFixed(2)).toBe('500.00');
      expect(ra.collectibleRemaining?.toFixed(2)).toBe('0.00');
      expect(m2r.originalPrincipal.toFixed(2)).toBe('500.00');
      expect(m2r.settledAmount.toFixed(2)).toBe('0.00');
      expect(m2r.remainingAmount.toFixed(2)).toBe('500.00');
      expect(m2c.originalPrincipal.toFixed(2)).toBe('300.00');
      expect(m2c.remainingAmount.toFixed(2)).toBe('300.00');
      expect(m2r.creditor.userId).toBe(fx.riderAId);
      expect(m2r.creditor.userId).not.toBe(fx.riderBId);
      expect(view.directionalGroups).toHaveLength(3);
      const merchantGroups = view.directionalGroups.filter(
        (g) => g.key.debtorType === 'MERCHANT',
      );
      expect(merchantGroups).toHaveLength(2);
      expect(
        merchantGroups.some(
          (g) =>
            g.key.creditorType === 'RIDER' &&
            g.originalPrincipal.toFixed(2) === '800.00',
        ),
      ).toBe(false);
    });

    it('does not treat non-FINALIZED Stage9 determinations as executable', async () => {
      const fx = await seedOrderParties(prisma);
      const raId = await insertRiderAdvance(prisma, fx, {
        riderId: fx.riderAId,
        principal: '800.00',
      });
      await insertFinalizedReturnDetermination(prisma, fx, {
        riderAdvanceId: raId,
        merchantToRider: '500.00',
        merchantToCustomer: '300.00',
        status: ReturnFinancialDeterminationStatus.PROPOSED,
      });
      const view = await reconciliation.forOrder(fx.orderId);
      expect(
        view.items.filter((i) => i.rail === RAIL_RETURN_FINANCIAL),
      ).toHaveLength(0);
    });

    it('CASE C — exception P800 ACK300; existing Stage12 coverage does not reduce remaining', async () => {
      const fx = await seedOpenObligation(prisma, exceptions, {
        principal: '800.00',
      });
      const coverages = await prisma.economicLossCoverage.findMany({
        where: { economicLossId: fx.economicLossId },
      });
      expect(coverages.length).toBeGreaterThan(0);
      await insertExceptionAck(prisma, {
        obligationId: fx.obligationId,
        wkOrderId: fx.orderId,
        amount: '300.00',
        debtorType: ExceptionLiablePartyType.CUSTOMER,
        debtorUserId: fx.customerId,
        debtorMerchantId: null,
        creditorType: ExceptionLiablePartyType.MERCHANT,
        creditorUserId: null,
        creditorMerchantId: fx.merchantId,
        actorId: fx.adminId,
      });
      const view = await reconciliation.forOrder(fx.orderId);
      const item = view.items.find((i) => i.rail === RAIL_EXCEPTION_FINANCIAL)!;
      expect(item.originalPrincipal.toFixed(2)).toBe('800.00');
      expect(item.settledAmount.toFixed(2)).toBe('300.00');
      expect(item.remainingAmount.toFixed(2)).toBe('500.00');
      expect(item.financialState).toBe('PARTIALLY_SETTLED');
      expect(item.sourceRefs.coverageIds.length).toBeGreaterThan(0);
    });

    it('CASE D — successor preserves original ACK 300 and flags original', async () => {
      const fx = await seedOpenObligation(prisma, exceptions, {
        principal: '800.00',
      });
      await insertExceptionAck(prisma, {
        obligationId: fx.obligationId,
        wkOrderId: fx.orderId,
        amount: '300.00',
        debtorType: ExceptionLiablePartyType.CUSTOMER,
        debtorUserId: fx.customerId,
        debtorMerchantId: null,
        creditorType: ExceptionLiablePartyType.MERCHANT,
        creditorUserId: null,
        creditorMerchantId: fx.merchantId,
        actorId: fx.adminId,
      });
      const succDetId = await insertFinalizedSuccessorAdjustment(prisma, fx);
      const succOblId = randomUUID();
      await prisma.exceptionFinancialObligation.create({
        data: {
          id: succOblId,
          liabilityDeterminationId: succDetId,
          exceptionClaimId: fx.claimId,
          economicLossId: fx.economicLossId,
          wkOrderId: fx.orderId,
          debtorType: ExceptionLiablePartyType.CUSTOMER,
          debtorUserId: fx.customerId,
          creditorType: ExceptionLiablePartyType.MERCHANT,
          creditorMerchantId: fx.merchantId,
          principal: '500.00',
          currency: 'PHP',
          status: 'OPEN',
          reason: 'successor obligation',
        },
      });
      const view = await reconciliation.forOrder(fx.orderId);
      const original = view.items.find((i) => i.obligationId === fx.obligationId)!;
      const successor = view.items.find((i) => i.obligationId === succOblId)!;
      expect(original.originalPrincipal.toFixed(2)).toBe('800.00');
      expect(original.settledAmount.toFixed(2)).toBe('300.00');
      expect(original.remainingAmount.toFixed(2)).toBe('500.00');
      expect(original.flags.nonExecutable).toBe(true);
      expect(original.flags.reconciliationRequired).toBe(true);
      expect(original.reconciliationState).toBe('SUCCESSOR_REVIEW_REQUIRED');
      expect(successor.originalPrincipal.toFixed(2)).toBe('500.00');
      expect(successor.settledAmount.toFixed(2)).toBe('0.00');
      expect(successor.reconciliationState).toBe('CLEAR');
    });

    it('CASE E — 250 ACK 250 SETTLED remaining 0', async () => {
      const fx = await seedOpenObligation(prisma, exceptions, {
        principal: '250.00',
      });
      const obl = await prisma.exceptionFinancialObligation.findUniqueOrThrow({
        where: { id: fx.obligationId },
      });
      await insertExceptionAck(prisma, {
        obligationId: fx.obligationId,
        wkOrderId: fx.orderId,
        amount: '250.00',
        debtorType: obl.debtorType,
        debtorUserId: obl.debtorUserId,
        debtorMerchantId: obl.debtorMerchantId,
        creditorType: obl.creditorType,
        creditorUserId: obl.creditorUserId,
        creditorMerchantId: obl.creditorMerchantId,
        actorId: fx.adminId,
      });
      const view = await reconciliation.forOrder(fx.orderId);
      const item = view.items.find((i) => i.rail === RAIL_EXCEPTION_FINANCIAL)!;
      expect(item.financialState).toBe('SETTLED');
      expect(item.remainingAmount.toFixed(2)).toBe('0.00');
    });

    it('CASE F — financial rider remains A when fulfillment/custodian is B', async () => {
      const fx = await seedOrderParties(prisma);
      const raId = await insertRiderAdvance(prisma, fx, {
        riderId: fx.riderAId,
        principal: '800.00',
      });
      const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: fx.fulfillmentId },
      });
      expect(fulfillment.activeRiderId).toBe(fx.riderBId);
      expect(fulfillment.physicalCustodianRiderId).toBe(fx.riderBId);
      const view = await reconciliation.forOrder(fx.orderId);
      const ra = view.items.find((i) => i.obligationId === raId)!;
      expect(ra.creditor.userId).toBe(fx.riderAId);
      expect(ra.creditor.userId).not.toBe(fx.riderBId);
    });

    it('multiple RiderAdvance rows: CANCELLED historical plus active are independently queried', async () => {
      const fx = await seedOrderParties(prisma);
      const olderCancelled = await insertRiderAdvance(prisma, fx, {
        riderId: fx.riderAId,
        principal: '800.00',
        status: RiderAdvanceStatus.CANCELLED,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      });
      const active = await insertRiderAdvance(prisma, fx, {
        riderId: fx.riderAId,
        principal: '200.00',
        status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
        createdAt: new Date('2026-06-01T00:00:00Z'),
      });
      const view = await reconciliation.forOrder(fx.orderId);
      const ras = view.items.filter(
        (i) => i.rail === RAIL_RIDER_ADVANCE_REIMBURSEMENT,
      );
      expect(ras.map((i) => i.obligationId)).toEqual([active]);
      expect(ras[0].originalPrincipal.toFixed(2)).toBe('200.00');
      expect(ras[0].originalPrincipal.toFixed(2)).not.toBe('1000.00');
      const all = await prisma.riderAdvance.findMany({
        where: { wkOrderId: fx.orderId },
      });
      expect(all.map((r) => r.id).sort()).toEqual(
        [olderCancelled, active].sort(),
      );
    });

    it('decimal 800.10 − 300.05 = 500.05 on persisted rows', async () => {
      const fx = await seedOrderParties(prisma);
      const raId = await insertRiderAdvance(prisma, fx, {
        riderId: fx.riderAId,
        principal: '800.10',
      });
      await insertRiderAdvanceAck(prisma, fx, raId, '300.05');
      const item = await reconciliation.forObligation(
        RAIL_RIDER_ADVANCE_REIMBURSEMENT,
        raId,
      );
      expect(item?.remainingAmount.toFixed(2)).toBe('500.05');
      expect(item?.currency).toBe('PHP');
    });
  },
);
