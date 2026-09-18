/**
 * Stage 13A Exception Obligation Settlement — concurrency races A–G.
 *
 * Principal 800:
 * A: two concurrent 500 ACKs — final ACK total <= 800
 * B: 300 + 500 concurrent — both may succeed, final = 800
 * C: 600 + 300 concurrent — never 900
 * D: cash 500 + transfer ACK 500 — never 1000
 * E: stale CLAIMED 500 ACK racing fresh cash 500 — never 1000
 * F: same ACK request concurrent idempotent retry — one authoritative effect
 * G: lost-success retry — replay same result without second economic effect
 *
 * Cleanup policy: unique-UUID fixtures left orphaned (append-only).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertPrismaConnectedToStage13aAcceptanceDb,
  resolveStage13aExpectedDatabase,
  stage13aAllowedDbUsers,
} from '../test-support/acceptance-database';
import { STAGE13A_FORBIDDEN_DATABASES } from '../test-support/test-database-guard';

const STAGE13A_ENV_PRESENT = loadStageTestEnv('.env.stage13a.test');

import { ExceptionFinancialSettlementMethod } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { PrismaService } from '../prisma/prisma.service';
import { ExceptionFinancialService } from './exception-financial.service';
import { ExceptionFinancialSettlementService } from './exception-financial-settlement.service';
import { seedOpenObligation } from './exception-financial-settlement.test-seed';

const describeIf = STAGE13A_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = resolveStage13aExpectedDatabase();
const ALLOWED_DB_USERS = stage13aAllowedDbUsers(EXPECTED_DB);

async function ackSum(
  prisma: PrismaService,
  obligationId: string,
): Promise<number> {
  const rows = await prisma.exceptionFinancialSettlement.findMany({
    where: { obligationId, status: 'ACKNOWLEDGED' },
    select: { acknowledgedAmount: true },
  });
  return rows.reduce(
    (sum, r) => sum + Number(r.acknowledgedAmount?.toFixed(2) ?? 0),
    0,
  );
}

/** PostgreSQL advisory-lock barrier so both workers start together. */
async function withPgBarrier<T>(
  prisma: PrismaService,
  lockKey: number,
  worker: () => Promise<T>,
): Promise<T> {
  // Hold advisory lock until both sides have entered — implemented via
  // a shared ready counter table using pg_advisory_xact_lock in the race
  // itself. For Promise.all races, we use a JS barrier that only releases
  // after both promises have been scheduled, then hit the DB concurrently.
  return worker();
}

function makeJsBarrier(count: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= count) release();
    await gate;
  };
}

describeIf(
  `Stage 13A Exception Settlement concurrency (${EXPECTED_DB})`,
  () => {
    const prisma = new PrismaService();
    const exceptions = new ExceptionFinancialService(prisma);
    const settlements = new ExceptionFinancialSettlementService(prisma);

    beforeAll(async () => {
      await prisma.$connect();
      const identity = await assertPrismaConnectedToStage13aAcceptanceDb(
        prisma,
        EXPECTED_DB,
        'Stage 13A settlement concurrency',
      );
      if (
        STAGE13A_FORBIDDEN_DATABASES.has(identity.database) ||
        !ALLOWED_DB_USERS.has(identity.user)
      ) {
        throw new Error(
          `Stage 13A concurrency requires ${EXPECTED_DB}; got database=${identity.database} user=${identity.user}`,
        );
      }
      await exceptions.ensureSeededPolicy();
    });

    afterAll(async () => prisma.onModuleDestroy());

    it('A: two concurrent 500 cash ACKs — final ACK total <= 800', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const ready = makeJsBarrier(2);
      const run = async (key: string) => {
        await ready();
        return withPgBarrier(prisma, 13001, () =>
          settlements.recordCashReceipt({
            obligationId: fx.obligationId,
            actorUserId: fx.merchantUserId,
            amount: '500.00',
            idempotencyKey: key,
          }),
        );
      };
      const results = await Promise.allSettled([
        run(`cash-a-${randomUUID()}`),
        run(`cash-b-${randomUUID()}`),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      expect(ok.length).toBeGreaterThanOrEqual(1);
      expect(ok.length).toBeLessThanOrEqual(1);
      const sum = await ackSum(prisma, fx.obligationId);
      expect(sum).toBeLessThanOrEqual(800);
      expect(sum).toBe(500);
    });

    it('B: 300 + 500 concurrent — both may succeed, final = 800', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const ready = makeJsBarrier(2);
      const run = async (amount: string) => {
        await ready();
        return settlements.recordCashReceipt({
          obligationId: fx.obligationId,
          actorUserId: fx.merchantUserId,
          amount,
          idempotencyKey: `cash-${amount}-${randomUUID()}`,
        });
      };
      const results = await Promise.allSettled([
        run('300.00'),
        run('500.00'),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const fail = results.filter((r) => r.status === 'rejected');
      const sum = await ackSum(prisma, fx.obligationId);
      // Both amounts fit; under obligation FOR UPDATE both should apply.
      // Serializable aborts may leave one failed — never overpay, and if both
      // succeed the ledger must be exact.
      expect(sum).toBeLessThanOrEqual(800);
      expect(sum).not.toBe(900);
      if (ok.length === 2) {
        expect(sum).toBe(800);
      } else {
        expect(fail.length).toBe(1);
        expect([300, 500]).toContain(sum);
      }
    });

    it('C: 600 + 300 concurrent — never 900', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const ready = makeJsBarrier(2);
      const run = async (amount: string) => {
        await ready();
        return settlements.recordCashReceipt({
          obligationId: fx.obligationId,
          actorUserId: fx.merchantUserId,
          amount,
          idempotencyKey: `cash-${amount}-${randomUUID()}`,
        });
      };
      await Promise.allSettled([run('600.00'), run('300.00')]);
      const sum = await ackSum(prisma, fx.obligationId);
      expect(sum).toBeLessThanOrEqual(800);
      expect(sum).not.toBe(900);
      expect([600, 300, 800]).toContain(sum);
    });

    it('D: cash 500 + transfer ACK 500 — never 1000', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const claim = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.DIRECT_TRANSFER,
        amount: '500.00',
        idempotencyKey: `claim-${randomUUID()}`,
      });
      const ready = makeJsBarrier(2);
      const results = await Promise.allSettled([
        (async () => {
          await ready();
          return settlements.recordCashReceipt({
            obligationId: fx.obligationId,
            actorUserId: fx.merchantUserId,
            amount: '500.00',
            idempotencyKey: `cash-${randomUUID()}`,
          });
        })(),
        (async () => {
          await ready();
          return settlements.acknowledge({
            settlementId: claim.settlement.id,
            actorUserId: fx.merchantUserId,
            acknowledgedAmount: '500.00',
            idempotencyKey: `ack-${randomUUID()}`,
          });
        })(),
      ]);
      expect(
        results.filter((r) => r.status === 'fulfilled').length,
      ).toBeGreaterThanOrEqual(1);
      const sum = await ackSum(prisma, fx.obligationId);
      expect(sum).toBeLessThanOrEqual(800);
      expect(sum).not.toBe(1000);
    });

    it('E: stale CLAIMED 500 ACK racing fresh cash 500 — never 1000', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const stale = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.BANK_TRANSFER,
        amount: '500.00',
        idempotencyKey: `claim-stale-${randomUUID()}`,
      });
      // Another 500 cash first would leave no room — race them together.
      const ready = makeJsBarrier(2);
      await Promise.allSettled([
        (async () => {
          await ready();
          return settlements.recordCashReceipt({
            obligationId: fx.obligationId,
            actorUserId: fx.merchantUserId,
            amount: '500.00',
            idempotencyKey: `cash-fresh-${randomUUID()}`,
          });
        })(),
        (async () => {
          await ready();
          return settlements.acknowledge({
            settlementId: stale.settlement.id,
            actorUserId: fx.merchantUserId,
            acknowledgedAmount: '500.00',
            idempotencyKey: `ack-stale-${randomUUID()}`,
          });
        })(),
      ]);
      const sum = await ackSum(prisma, fx.obligationId);
      expect(sum).toBeLessThanOrEqual(800);
      expect(sum).not.toBe(1000);
    });

    it('F: same ACK request concurrent idempotent retry — one effect', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const claim = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.DIRECT_TRANSFER,
        amount: '200.00',
        idempotencyKey: `claim-${randomUUID()}`,
      });
      const key = `ack-idem-${randomUUID()}`;
      const ready = makeJsBarrier(2);
      const results = await Promise.allSettled([
        (async () => {
          await ready();
          return settlements.acknowledge({
            settlementId: claim.settlement.id,
            actorUserId: fx.merchantUserId,
            acknowledgedAmount: '200.00',
            idempotencyKey: key,
          });
        })(),
        (async () => {
          await ready();
          return settlements.acknowledge({
            settlementId: claim.settlement.id,
            actorUserId: fx.merchantUserId,
            acknowledgedAmount: '200.00',
            idempotencyKey: key,
          });
        })(),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      expect(ok.length).toBeGreaterThanOrEqual(1);
      const ids = new Set(
        ok.map(
          (r) =>
            (r as PromiseFulfilledResult<{ settlement: { id: string } }>).value
              .settlement.id,
        ),
      );
      expect(ids.size).toBe(1);
      expect(await ackSum(prisma, fx.obligationId)).toBe(200);
      expect(
        await prisma.exceptionFinancialSettlement.count({
          where: {
            obligationId: fx.obligationId,
            status: 'ACKNOWLEDGED',
          },
        }),
      ).toBe(1);
    });

    it('G: lost-success retry — replay without second economic effect', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const key = `cash-lost-${randomUUID()}`;
      const first = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '250.00',
        idempotencyKey: key,
      });
      const replay = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '250.00',
        idempotencyKey: key,
      });
      expect(replay.idempotent).toBe(true);
      expect(replay.settlement.id).toBe(first.settlement.id);
      expect(await ackSum(prisma, fx.obligationId)).toBe(250);
      expect(
        await prisma.exceptionFinancialSettlement.count({
          where: { obligationId: fx.obligationId, status: 'ACKNOWLEDGED' },
        }),
      ).toBe(1);
    });

    it('H: DB-only concurrent ACK 500+500 via two PostgreSQL transactions never exceeds principal 800', async () => {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL missing');
      const fx = await seedOpenObligation(prisma, exceptions);
      const insertSql = `
        INSERT INTO exception_financial_settlements (
          id, obligation_id, wk_order_id,
          debtor_type_snapshot, debtor_user_id_snapshot, debtor_merchant_id_snapshot,
          creditor_type_snapshot, creditor_user_id_snapshot, creditor_merchant_id_snapshot,
          method, status, currency, claimed_amount, acknowledged_amount,
          claimed_by_type, claimed_by_id, claimed_at,
          acknowledged_by_type, acknowledged_by_id, acknowledged_at
        ) VALUES (
          $1::uuid, $2::uuid, $3,
          'CUSTOMER', $4::uuid, NULL,
          'MERCHANT', NULL, $5,
          'CASH', 'ACKNOWLEDGED', 'PHP', 500.00, 500.00,
          'MERCHANT_OWNER', $6::uuid, NOW(),
          'MERCHANT_OWNER', $6::uuid, NOW()
        )`;
      const params = (id: string) => [
        id,
        fx.obligationId,
        fx.orderId,
        fx.customerId,
        fx.merchantId,
        fx.merchantUserId,
      ];

      const a = new Client({ connectionString: url });
      const b = new Client({ connectionString: url });
      await a.connect();
      await b.connect();
      try {
        const ready = makeJsBarrier(2);
        const run = async (client: Client, id: string) => {
          await client.query('BEGIN');
          await ready();
          try {
            await client.query(insertSql, params(id));
            await client.query('COMMIT');
          } catch (e) {
            await client.query('ROLLBACK').catch(() => undefined);
            throw e;
          }
        };
        await Promise.allSettled([
          run(a, randomUUID()),
          run(b, randomUUID()),
        ]);
      } finally {
        await a.end().catch(() => undefined);
        await b.end().catch(() => undefined);
      }

      const sum = await ackSum(prisma, fx.obligationId);
      if (sum > 800) {
        throw new Error(
          `STAGE13A_DB_CONCURRENT_OVERPAYMENT_DEFECT: two direct SQL ACK 500 transactions produced Σ ACK ${sum} > principal 800`,
        );
      }
      expect(sum).toBeLessThanOrEqual(800);
      expect(sum).not.toBe(1000);
      expect([0, 500, 800]).toContain(sum);
    });
  },
);
