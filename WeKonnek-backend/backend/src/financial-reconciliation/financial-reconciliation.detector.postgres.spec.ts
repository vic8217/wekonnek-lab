/**
 * Stage13B-2 PostgreSQL acceptance — dedicated disposable DB.
 * Default: backend/.env.stage13b2.test → wekonnek_stage13b2_test
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertPrismaConnectedToStage13b2AcceptanceDb,
  resolveStage13b2ExpectedDatabase,
  stage13b2AllowedDbUsers,
} from '../test-support/acceptance-database';
import { STAGE13B2_FORBIDDEN_DATABASES } from '../test-support/test-database-guard';

const STAGE13B2_ENV_PRESENT = loadStageTestEnv('.env.stage13b2.test');

import { ExceptionLiablePartyType } from '@prisma/client';
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

const describeIf = STAGE13B2_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = STAGE13B2_ENV_PRESENT
  ? resolveStage13b2ExpectedDatabase()
  : 'wekonnek_stage13b2_test';
const ALLOWED_DB_USERS = stage13b2AllowedDbUsers(EXPECTED_DB);

describeIf(
  `Stage13B-2 financial-reconciliation detectors PostgreSQL (${EXPECTED_DB})`,
  () => {
    const prisma = new PrismaService();
    const reconciliation = new FinancialReconciliationService(prisma);
    const exceptions = new ExceptionFinancialService(prisma);

    beforeAll(async () => {
      await prisma.$connect();
      const identity = await assertPrismaConnectedToStage13b2AcceptanceDb(
        prisma,
        EXPECTED_DB,
        'Stage13B-2 postgres',
      );
      if (
        STAGE13B2_FORBIDDEN_DATABASES.has(identity.database) ||
        !ALLOWED_DB_USERS.has(identity.user)
      ) {
        throw new Error(
          `Stage13B-2 tests require ${EXPECTED_DB}; got database=${identity.database} user=${identity.user}`,
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

    it('RA only → no findings', async () => {
      const fx = await seedOrderParties(prisma);
      await insertRiderAdvance(prisma, fx, {
        riderId: fx.riderAId,
        principal: '800.00',
      });
      const view = await reconciliation.forOrder(fx.orderId);
      expect(view.findings).toEqual([]);
      expect(view.hasReconciliationIssue).toBe(false);
      expect(view.hasOutstanding).toBe(true);
    });

    it('coherent RA→Stage9 transfer → no finding + COLLECTION_TRANSFERRED_TO_RETURN', async () => {
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
      expect(ra.collectibleRemaining?.toFixed(2)).toBe('0.00');
      expect(view.findings).toEqual([]);
      expect(view.hasReconciliationIssue).toBe(false);
      expect(
        view.relatedItems.some(
          (r) =>
            r.relation === 'COLLECTION_TRANSFERRED_TO_RETURN' &&
            r.fromObligationId === raId &&
            r.obligationId === det.riderObligationId,
        ),
      ).toBe(true);
    });

    it('ordinary Stage9 without RA → no transfer finding', async () => {
      const fx = await seedOrderParties(prisma);
      await insertFinalizedReturnDetermination(prisma, fx, {
        riderAdvanceId: null,
        merchantToRider: '0.00',
        merchantToCustomer: '300.00',
        path: 'ORDINARY_MERCHANT_PAYMENT',
        snapshotPrincipal: '300.00',
        snapshotReimbursed: '0.00',
      });
      const view = await reconciliation.forOrder(fx.orderId);
      expect(view.items.some((i) => i.rail === RAIL_RETURN_FINANCIAL)).toBe(true);
      expect(view.findings).toEqual([]);
      expect(
        view.relatedItems.some(
          (r) => r.relation === 'COLLECTION_TRANSFERRED_TO_RETURN',
        ),
      ).toBe(false);
    });

    it('missing restriction → RA_RETURN_RESTRICTION_MISSING', async () => {
      const fx = await seedOrderParties(prisma);
      const raId = await insertRiderAdvance(prisma, fx, {
        riderId: fx.riderAId,
        principal: '800.00',
      });
      await insertRiderAdvanceAck(prisma, fx, raId, '300.00');
      await insertFinalizedReturnDetermination(prisma, fx, {
        riderAdvanceId: raId,
        merchantToRider: '500.00',
        merchantToCustomer: '300.00',
      });
      const view = await reconciliation.forOrder(fx.orderId);
      expect(view.findings.map((f) => f.code)).toContain(
        'RA_RETURN_RESTRICTION_MISSING',
      );
      expect(view.hasReconciliationIssue).toBe(true);
      const ra = view.items.find((i) => i.rail === RAIL_RIDER_ADVANCE_REIMBURSEMENT)!;
      expect(ra.collectibleRemaining?.toFixed(2)).toBe('500.00');
    });

    it('valid successor preserves historical ACK and emits SUCCESSOR_REVIEW_REQUIRED finding', async () => {
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
      expect(original.settledAmount.toFixed(2)).toBe('300.00');
      expect(original.reconciliationState).toBe('SUCCESSOR_REVIEW_REQUIRED');
      expect(view.findings.map((f) => f.code)).toContain('SUCCESSOR_REVIEW_REQUIRED');
      expect(view.hasReconciliationIssue).toBe(true);
    });

    it('settled Stage13A → no overlap finding', async () => {
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
      expect(view.items.find((i) => i.rail === RAIL_EXCEPTION_FINANCIAL)?.financialState).toBe(
        'SETTLED',
      );
      expect(view.findings.some((f) => f.code === 'EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE')).toBe(
        false,
      );
    });

    it('forObligation does not attach findings', async () => {
      const fx = await seedOrderParties(prisma);
      const raId = await insertRiderAdvance(prisma, fx, {
        riderId: fx.riderAId,
        principal: '800.00',
      });
      await insertRiderAdvanceAck(prisma, fx, raId, '300.00');
      await insertFinalizedReturnDetermination(prisma, fx, {
        riderAdvanceId: raId,
        merchantToRider: '500.00',
        merchantToCustomer: '300.00',
      });
      const item = await reconciliation.forObligation(
        RAIL_RIDER_ADVANCE_REIMBURSEMENT,
        raId,
      );
      expect(item?.obligationId).toBe(raId);
      expect(item?.reconciliationState).toBe('CLEAR');
    });
  },
);
