/**
 * Stage13B-2 RepeatableRead concurrency proof.
 * No writer lock. Result must not mix rails from different snapshots.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertPrismaConnectedToStage13b2AcceptanceDb,
  resolveStage13b2ExpectedDatabase,
  stage13b2AllowedDbUsers,
} from '../test-support/acceptance-database';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadRiderAdvanceReimbursementItems } from './rider-advance-reimbursement.adapter';
import { loadReturnFinancialItems } from './return-financial.adapter';
import {
  insertActiveRestriction,
  insertFinalizedReturnDetermination,
  insertRiderAdvance,
  insertRiderAdvanceAck,
  seedOrderParties,
} from './financial-reconciliation.test-seed';

const STAGE13B2_ENV_PRESENT = loadStageTestEnv('.env.stage13b2.test');
const describeIf = STAGE13B2_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = STAGE13B2_ENV_PRESENT
  ? resolveStage13b2ExpectedDatabase()
  : 'wekonnek_stage13b2_test';
const ALLOWED_DB_USERS = stage13b2AllowedDbUsers(EXPECTED_DB);

describeIf(
  `Stage13B-2 RepeatableRead concurrency (${EXPECTED_DB})`,
  () => {
    const prisma = new PrismaService();
    const writer = new PrismaService();

    beforeAll(async () => {
      await prisma.$connect();
      await writer.$connect();
      const identity = await assertPrismaConnectedToStage13b2AcceptanceDb(
        prisma,
        EXPECTED_DB,
        'Stage13B-2 concurrency',
      );
      expect(ALLOWED_DB_USERS.has(identity.user)).toBe(true);
    });

    afterAll(async () => {
      await prisma.onModuleDestroy();
      await writer.onModuleDestroy();
    });

    it('RepeatableRead snapshot does not mix pre-ACK RA with post-ACK RA inside one tx', async () => {
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

      await prisma.$transaction(
        async (tx) => {
          const first = await loadRiderAdvanceReimbursementItems(tx, fx.orderId);
          expect(first[0].settledAmount.toFixed(2)).toBe('300.00');

          await insertRiderAdvanceAck(writer, fx, raId, '50.00');

          const secondRa = await loadRiderAdvanceReimbursementItems(tx, fx.orderId);
          const ret = await loadReturnFinancialItems(tx, fx.orderId);
          expect(secondRa[0].settledAmount.toFixed(2)).toBe('300.00');
          const m2c = ret.find((i) => i.creditor.type === 'CUSTOMER');
          expect(m2c?.originalPrincipal.toFixed(2)).toBe('300.00');
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );

      const after = await loadRiderAdvanceReimbursementItems(prisma, fx.orderId);
      expect(after[0].settledAmount.toFixed(2)).toBe('350.00');
    });
  },
);
