/**
 * Stage 13A Exception Obligation Settlement — direct SQL integrity probes.
 * Captures SQLSTATE; verifies zero unintended side effects after failed probes.
 *
 * Never DISABLE TRIGGER. Never DELETE protected settlement/obligation rows
 * as cleanup (DELETE probes expect rejection).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertPrismaConnectedToStage13aAcceptanceDb,
  resolveStage13aExpectedDatabase,
  stage13aAllowedDbUsers,
} from '../test-support/acceptance-database';
import { STAGE13A_FORBIDDEN_DATABASES } from '../test-support/test-database-guard';

const STAGE13A_ENV_PRESENT = loadStageTestEnv('.env.stage13a.test');

import {
  ExceptionFinancialSettlementMethod,
  ExceptionFinancialSettlementStatus,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ExceptionFinancialService } from './exception-financial.service';
import { ExceptionFinancialSettlementService } from './exception-financial-settlement.service';
import {
  expectCode,
  seedOpenObligation,
} from './exception-financial-settlement.test-seed';

const describeIf = STAGE13A_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = resolveStage13aExpectedDatabase();
const ALLOWED_DB_USERS = stage13aAllowedDbUsers(EXPECTED_DB);

type SqlProbeResult = {
  rejected: boolean;
  sqlstate?: string;
  message?: string;
};

async function probeSql(
  prisma: PrismaService,
  sql: Prisma.Sql,
): Promise<SqlProbeResult> {
  try {
    await prisma.$executeRaw(sql);
    return { rejected: false };
  } catch (e) {
    const err = e as {
      meta?: { code?: string };
      code?: string;
      message?: string;
    };
    const sqlstate =
      err.meta?.code ??
      (typeof err.code === 'string' && /^\d{5}$/.test(err.code)
        ? err.code
        : undefined);
    // Prisma wraps PG errors; dig for SQLSTATE in message when needed.
    const fromMsg = err.message?.match(/\b([0-9A-Z]{5})\b/);
    return {
      rejected: true,
      sqlstate: sqlstate ?? fromMsg?.[1],
      message: err.message,
    };
  }
}

async function ackSum(
  prisma: PrismaService,
  obligationId: string,
): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ sum: Prisma.Decimal | null }>>`
    SELECT COALESCE(SUM(acknowledged_amount), 0) AS sum
    FROM exception_financial_settlements
    WHERE obligation_id = ${obligationId}::uuid
      AND status = 'ACKNOWLEDGED'
  `;
  return Number(rows[0]?.sum ?? 0).toFixed(2);
}

type ObligationIdentityRow = {
  id: string;
  liability_determination_id: string;
  exception_claim_id: string;
  economic_loss_id: string;
  wk_order_id: number;
  debtor_type: string;
  debtor_user_id: string | null;
  debtor_merchant_id: number | null;
  creditor_type: string;
  creditor_user_id: string | null;
  creditor_merchant_id: number | null;
  principal: Prisma.Decimal;
  currency: string;
  status: string;
  reason: string | null;
  correlation_id: string | null;
  created_at: Date;
  updated_at: Date;
};

async function readObligationIdentity(
  prisma: PrismaService,
  obligationId: string,
): Promise<ObligationIdentityRow> {
  const rows = await prisma.$queryRaw<ObligationIdentityRow[]>`
    SELECT id, liability_determination_id, exception_claim_id, economic_loss_id,
           wk_order_id, debtor_type, debtor_user_id, debtor_merchant_id,
           creditor_type, creditor_user_id, creditor_merchant_id,
           principal, currency, status, reason, correlation_id,
           created_at, updated_at
    FROM exception_financial_obligations
    WHERE id = ${obligationId}::uuid
  `;
  const row = rows[0];
  if (!row) throw new Error(`obligation ${obligationId} not found`);
  return row;
}

function identityMinusTimestamps(row: ObligationIdentityRow) {
  return {
    id: row.id,
    liability_determination_id: row.liability_determination_id,
    exception_claim_id: row.exception_claim_id,
    economic_loss_id: row.economic_loss_id,
    wk_order_id: row.wk_order_id,
    debtor_type: row.debtor_type,
    debtor_user_id: row.debtor_user_id,
    debtor_merchant_id: row.debtor_merchant_id,
    creditor_type: row.creditor_type,
    creditor_user_id: row.creditor_user_id,
    creditor_merchant_id: row.creditor_merchant_id,
    principal: Number(row.principal).toFixed(2),
    currency: row.currency,
    reason: row.reason,
    correlation_id: row.correlation_id,
    created_at: row.created_at.toISOString(),
  };
}

async function remainingRaw(
  prisma: PrismaService,
  obligationId: string,
): Promise<{ principal: string; settled: string; remaining: string }> {
  const rows = await prisma.$queryRaw<
    Array<{
      principal: Prisma.Decimal;
      settled: Prisma.Decimal;
      remaining: Prisma.Decimal;
    }>
  >`
    SELECT o.principal,
           COALESCE((
             SELECT SUM(s.acknowledged_amount)
             FROM exception_financial_settlements s
             WHERE s.obligation_id = o.id AND s.status = 'ACKNOWLEDGED'
           ), 0) AS settled,
           o.principal - COALESCE((
             SELECT SUM(s.acknowledged_amount)
             FROM exception_financial_settlements s
             WHERE s.obligation_id = o.id AND s.status = 'ACKNOWLEDGED'
           ), 0) AS remaining
    FROM exception_financial_obligations o
    WHERE o.id = ${obligationId}::uuid
  `;
  const row = rows[0];
  if (!row) throw new Error(`obligation ${obligationId} not found`);
  return {
    principal: Number(row.principal).toFixed(2),
    settled: Number(row.settled).toFixed(2),
    remaining: Number(row.remaining).toFixed(2),
  };
}

describeIf(
  `Stage 13A Exception Settlement raw SQL probes (${EXPECTED_DB})`,
  () => {
    const prisma = new PrismaService();
    const exceptions = new ExceptionFinancialService(prisma);
    const settlements = new ExceptionFinancialSettlementService(prisma);

    beforeAll(async () => {
      await prisma.$connect();
      const identity = await assertPrismaConnectedToStage13aAcceptanceDb(
        prisma,
        EXPECTED_DB,
        'Stage 13A settlement raw-sql',
      );
      if (
        STAGE13A_FORBIDDEN_DATABASES.has(identity.database) ||
        !ALLOWED_DB_USERS.has(identity.user)
      ) {
        throw new Error(
          `Stage 13A raw-sql requires ${EXPECTED_DB}; got database=${identity.database} user=${identity.user}`,
        );
      }
      await exceptions.ensureSeededPolicy();
    });

    afterAll(async () => prisma.onModuleDestroy());

    it('insert ACK beyond principal → rejected; ack sum unchanged', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '700.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const before = await ackSum(prisma, fx.obligationId);
      expect(before).toBe('700.00');

      const id = randomUUID();
      const result = await probeSql(
        prisma,
        Prisma.sql`
          INSERT INTO exception_financial_settlements (
            id, obligation_id, wk_order_id,
            debtor_type_snapshot, debtor_user_id_snapshot, debtor_merchant_id_snapshot,
            creditor_type_snapshot, creditor_user_id_snapshot, creditor_merchant_id_snapshot,
            method, status, currency, claimed_amount, acknowledged_amount,
            claimed_by_type, claimed_by_id, claimed_at,
            acknowledged_by_type, acknowledged_by_id, acknowledged_at
          ) VALUES (
            ${id}::uuid, ${fx.obligationId}::uuid, ${fx.orderId},
            'CUSTOMER', ${fx.customerId}::uuid, NULL,
            'MERCHANT', NULL, ${fx.merchantId},
            'CASH', 'ACKNOWLEDGED', 'PHP', 200.00, 200.00,
            'MERCHANT_OWNER', ${fx.merchantUserId}::uuid, NOW(),
            'MERCHANT_OWNER', ${fx.merchantUserId}::uuid, NOW()
          )
        `,
      );
      expect(result.rejected).toBe(true);
      expect(result.message).toMatch(/overpayment|check_violation|23514/i);
      expect(await ackSum(prisma, fx.obligationId)).toBe(before);
    });

    it('two ACKs sum > principal → rejected', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '500.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const before = await ackSum(prisma, fx.obligationId);
      const id = randomUUID();
      const result = await probeSql(
        prisma,
        Prisma.sql`
          INSERT INTO exception_financial_settlements (
            id, obligation_id, wk_order_id,
            debtor_type_snapshot, debtor_user_id_snapshot, debtor_merchant_id_snapshot,
            creditor_type_snapshot, creditor_user_id_snapshot, creditor_merchant_id_snapshot,
            method, status, currency, claimed_amount, acknowledged_amount,
            claimed_by_type, claimed_by_id, claimed_at,
            acknowledged_by_type, acknowledged_by_id, acknowledged_at
          ) VALUES (
            ${id}::uuid, ${fx.obligationId}::uuid, ${fx.orderId},
            'CUSTOMER', ${fx.customerId}::uuid, NULL,
            'MERCHANT', NULL, ${fx.merchantId},
            'CASH', 'ACKNOWLEDGED', 'PHP', 400.00, 400.00,
            'MERCHANT_OWNER', ${fx.merchantUserId}::uuid, NOW(),
            'MERCHANT_OWNER', ${fx.merchantUserId}::uuid, NOW()
          )
        `,
      );
      expect(result.rejected).toBe(true);
      expect(await ackSum(prisma, fx.obligationId)).toBe(before);
    });

    it('UPDATE acknowledged amount on terminal ACK → rejected', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const cash = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '100.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const before = await ackSum(prisma, fx.obligationId);
      const result = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_settlements
          SET acknowledged_amount = 1.00
          WHERE id = ${cash.settlement.id}::uuid
        `,
      );
      expect(result.rejected).toBe(true);
      expect(result.message).toMatch(/immutable|check_violation|23514/i);
      expect(await ackSum(prisma, fx.obligationId)).toBe(before);
    });

    it('UPDATE ACK status → rejected', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const cash = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '50.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const before = await ackSum(prisma, fx.obligationId);
      const result = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_settlements
          SET status = 'CLAIMED'
          WHERE id = ${cash.settlement.id}::uuid
        `,
      );
      expect(result.rejected).toBe(true);
      expect(await ackSum(prisma, fx.obligationId)).toBe(before);
    });

    it('DELETE ACK → rejected', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const cash = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '40.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const before = await ackSum(prisma, fx.obligationId);
      const result = await probeSql(
        prisma,
        Prisma.sql`
          DELETE FROM exception_financial_settlements
          WHERE id = ${cash.settlement.id}::uuid
        `,
      );
      expect(result.rejected).toBe(true);
      expect(result.message).toMatch(/no_delete|forbidden|check_violation|23514/i);
      expect(await ackSum(prisma, fx.obligationId)).toBe(before);
      expect(
        await prisma.exceptionFinancialSettlement.count({
          where: { id: cash.settlement.id },
        }),
      ).toBe(1);
    });

    it('change obligationId after terminal → rejected', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const other = await seedOpenObligation(prisma, exceptions);
      const cash = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '30.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const before = await ackSum(prisma, fx.obligationId);
      const result = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_settlements
          SET obligation_id = ${other.obligationId}::uuid
          WHERE id = ${cash.settlement.id}::uuid
        `,
      );
      expect(result.rejected).toBe(true);
      expect(await ackSum(prisma, fx.obligationId)).toBe(before);
    });

    it('change parties after terminal → rejected', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const cash = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '20.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const before = await ackSum(prisma, fx.obligationId);
      const result = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_settlements
          SET debtor_user_id_snapshot = ${fx.foreignId}::uuid
          WHERE id = ${cash.settlement.id}::uuid
        `,
      );
      expect(result.rejected).toBe(true);
      expect(await ackSum(prisma, fx.obligationId)).toBe(before);
    });

    it('change currency after terminal → rejected', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const cash = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '15.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const before = await ackSum(prisma, fx.obligationId);
      const result = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_settlements
          SET currency = 'USD'
          WHERE id = ${cash.settlement.id}::uuid
        `,
      );
      expect(result.rejected).toBe(true);
      expect(await ackSum(prisma, fx.obligationId)).toBe(before);
    });

    it('evidence UPDATE / DELETE → rejected', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const claim = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.DIRECT_TRANSFER,
        amount: '10.00',
        idempotencyKey: `claim-${randomUUID()}`,
      });
      const attached = await settlements.attachEvidence({
        settlementId: claim.settlement.id,
        actorUserId: fx.customerId,
        kind: 'TRANSFER_RECEIPT',
        storageReference: `s3://ev/${randomUUID()}`,
        idempotencyKey: `ev-${randomUUID()}`,
      });
      const evidenceId = attached.evidence.id as string;
      const upd = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_settlement_evidence
          SET note = 'tampered'
          WHERE id = ${evidenceId}::uuid
        `,
      );
      expect(upd.rejected).toBe(true);
      expect(upd.message).toMatch(/immutable|check_violation|23514/i);
      const del = await probeSql(
        prisma,
        Prisma.sql`
          DELETE FROM exception_financial_settlement_evidence
          WHERE id = ${evidenceId}::uuid
        `,
      );
      expect(del.rejected).toBe(true);
      expect(del.message).toMatch(/no_delete|forbidden|check_violation|23514/i);
    });

    it('terminal REJECTED / CANCELLED mutation → rejected', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const claimR = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.DIRECT_TRANSFER,
        amount: '10.00',
        idempotencyKey: `claim-r-${randomUUID()}`,
      });
      await settlements.reject({
        settlementId: claimR.settlement.id,
        actorUserId: fx.merchantUserId,
        reason: 'nope',
        idempotencyKey: `rej-${randomUUID()}`,
      });
      const rejAmt = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_settlements
          SET claimed_amount = 1.00
          WHERE id = ${claimR.settlement.id}::uuid
        `,
      );
      expect(rejAmt.rejected).toBe(true);

      const claimC = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.BANK_TRANSFER,
        amount: '10.00',
        idempotencyKey: `claim-c-${randomUUID()}`,
      });
      await settlements.cancelClaim({
        settlementId: claimC.settlement.id,
        actorUserId: fx.customerId,
        idempotencyKey: `cancel-${randomUUID()}`,
      });
      const cancelMut = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_settlements
          SET status = 'CLAIMED'
          WHERE id = ${claimC.settlement.id}::uuid
        `,
      );
      expect(cancelMut.rejected).toBe(true);

      const rejected =
        await prisma.exceptionFinancialSettlement.findUniqueOrThrow({
          where: { id: claimR.settlement.id },
        });
      expect(rejected.status).toBe(
        ExceptionFinancialSettlementStatus.REJECTED,
      );
      const cancelled =
        await prisma.exceptionFinancialSettlement.findUniqueOrThrow({
          where: { id: claimC.settlement.id },
        });
      expect(cancelled.status).toBe(
        ExceptionFinancialSettlementStatus.CANCELLED,
      );
    });

    it('principal 800→2000 after ACK 15 is rejected; remaining stays 785', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '15.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const before = await readObligationIdentity(prisma, fx.obligationId);
      const result = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET principal = 2000.00
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      expect(result.rejected).toBe(true);
      expect(result.message).toMatch(
        /stage13a_exception_obligation_immutable|check_violation|23514/i,
      );
      expect(identityMinusTimestamps(await readObligationIdentity(prisma, fx.obligationId))).toEqual(
        identityMinusTimestamps(before),
      );
      expect(await remainingRaw(prisma, fx.obligationId)).toEqual({
        principal: '800.00',
        settled: '15.00',
        remaining: '785.00',
      });
    });

    it('principal 800→200 after ACK 700 is rejected; remaining stays 100 (never negative)', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '700.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const result = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET principal = 200.00
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      expect(result.rejected).toBe(true);
      expect(result.message).toMatch(
        /stage13a_exception_obligation_immutable|check_violation|23514/i,
      );
      expect(await remainingRaw(prisma, fx.obligationId)).toEqual({
        principal: '800.00',
        settled: '700.00',
        remaining: '100.00',
      });
    });

    it('principal 800→0 / negative / NULL are rejected', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const before = identityMinusTimestamps(
        await readObligationIdentity(prisma, fx.obligationId),
      );
      for (const sql of [
        Prisma.sql`UPDATE exception_financial_obligations SET principal = 0 WHERE id = ${fx.obligationId}::uuid`,
        Prisma.sql`UPDATE exception_financial_obligations SET principal = -1 WHERE id = ${fx.obligationId}::uuid`,
        Prisma.sql`UPDATE exception_financial_obligations SET principal = NULL WHERE id = ${fx.obligationId}::uuid`,
      ]) {
        const result = await probeSql(prisma, sql);
        expect(result.rejected).toBe(true);
      }
      expect(
        identityMinusTimestamps(
          await readObligationIdentity(prisma, fx.obligationId),
        ),
      ).toEqual(before);
    });

    it('debtor and creditor identity cannot be rewritten to other valid parties', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '15.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const before = identityMinusTimestamps(
        await readObligationIdentity(prisma, fx.obligationId),
      );
      const debtorUser = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET debtor_user_id = ${fx.foreignId}::uuid
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      const debtorType = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET debtor_type = 'RIDER', debtor_user_id = ${fx.riderId}::uuid
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      const creditorMerchant = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET creditor_merchant_id = ${fx.foreignMerchantId}
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      const creditorType = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET creditor_type = 'CUSTOMER',
              creditor_user_id = ${fx.foreignId}::uuid,
              creditor_merchant_id = NULL
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      expect(debtorUser.rejected).toBe(true);
      expect(debtorType.rejected).toBe(true);
      expect(creditorMerchant.rejected).toBe(true);
      expect(creditorType.rejected).toBe(true);
      expect(
        identityMinusTimestamps(
          await readObligationIdentity(prisma, fx.obligationId),
        ),
      ).toEqual(before);

      await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '10.00',
        idempotencyKey: `cash-orig-${randomUUID()}`,
      });
      await expectCode(
        settlements.recordCashReceipt({
          obligationId: fx.obligationId,
          actorUserId: fx.foreignMerchantUserId,
          amount: '10.00',
          idempotencyKey: `cash-foreign-${randomUUID()}`,
        }),
        'NOT_OBLIGATION_CREDITOR',
      );
      await expectCode(
        settlements.claimTransfer({
          obligationId: fx.obligationId,
          actorUserId: fx.foreignId,
          method: ExceptionFinancialSettlementMethod.DIRECT_TRANSFER,
          amount: '10.00',
          idempotencyKey: `claim-foreign-${randomUUID()}`,
        }),
        'NOT_OBLIGATION_DEBTOR',
      );
      const claim = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.DIRECT_TRANSFER,
        amount: '10.00',
        idempotencyKey: `claim-orig-${randomUUID()}`,
      });
      expect(claim.settlement.status).toBe(
        ExceptionFinancialSettlementStatus.CLAIMED,
      );
    });

    it('currency PHP→USD is rejected; settlement currency stays bound', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const cash = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '15.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const result = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET currency = 'USD'
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      expect(result.rejected).toBe(true);
      const obl = await readObligationIdentity(prisma, fx.obligationId);
      expect(obl.currency).toBe('PHP');
      const snap = await prisma.exceptionFinancialSettlement.findUniqueOrThrow({
        where: { id: cash.settlement.id },
      });
      expect(snap.currency).toBe('PHP');
    });

    it('economic loss / determination / claim / order rebinding to other valid targets is rejected', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const other = await seedOpenObligation(prisma, exceptions);
      const before = identityMinusTimestamps(
        await readObligationIdentity(prisma, fx.obligationId),
      );
      const loss = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET economic_loss_id = ${other.economicLossId}::uuid
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      const determination = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET liability_determination_id = ${other.determinationId}::uuid
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      const claim = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET exception_claim_id = ${other.claimId}::uuid
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      const order = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET wk_order_id = ${other.orderId}
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      expect(loss.rejected).toBe(true);
      expect(determination.rejected).toBe(true);
      expect(claim.rejected).toBe(true);
      expect(order.rejected).toBe(true);
      expect(loss.message).toMatch(
        /stage13a_exception_obligation_immutable|check_violation|23514/i,
      );
      expect(
        identityMinusTimestamps(
          await readObligationIdentity(prisma, fx.obligationId),
        ),
      ).toEqual(before);
    });

    it('reason, correlation_id, created_at, and id cannot be rewritten', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const before = await readObligationIdentity(prisma, fx.obligationId);
      const reason = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET reason = 'tampered'
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      const correlation = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET correlation_id = 'tampered-correlation'
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      const created = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET created_at = created_at - INTERVAL '1 year'
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      const id = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET id = ${randomUUID()}::uuid
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      expect(reason.rejected).toBe(true);
      expect(correlation.rejected).toBe(true);
      expect(created.rejected).toBe(true);
      expect(id.rejected).toBe(true);
      const after = await readObligationIdentity(prisma, fx.obligationId);
      expect(identityMinusTimestamps(after)).toEqual(
        identityMinusTimestamps(before),
      );
    });

    it('DELETE of authoritative obligation is rejected by Stage12 no-delete trigger', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '15.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const result = await probeSql(
        prisma,
        Prisma.sql`
          DELETE FROM exception_financial_obligations
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      expect(result.rejected).toBe(true);
      expect(result.message).toMatch(/stage12_obligation_no_delete|no_delete|forbidden/i);
      expect(
        await prisma.exceptionFinancialObligation.count({
          where: { id: fx.obligationId },
        }),
      ).toBe(1);
    });

    it('status transition authority: CANCELLED/WRITTEN_OFF and mismatched SETTLED are rejected', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '15.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      const before = await readObligationIdentity(prisma, fx.obligationId);
      expect(before.status).toBe('PARTIALLY_SETTLED');

      const settledTamper = await probeSql(
        prisma,
        Prisma.sql`
          UPDATE exception_financial_obligations
          SET status = 'SETTLED'
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      expect(settledTamper.rejected).toBe(true);
      expect(settledTamper.message).toMatch(
        /status_authority|check_violation|23514/i,
      );

      for (const status of ['CANCELLED', 'WRITTEN_OFF', 'OPEN'] as const) {
        const result = await probeSql(
          prisma,
          Prisma.sql`
            UPDATE exception_financial_obligations
            SET status = ${status}::"ExceptionFinancialObligationStatus"
            WHERE id = ${fx.obligationId}::uuid
        `,
        );
        expect(result.rejected).toBe(true);
        expect(result.message).toMatch(
          /status_authority|CANCELLED\/WRITTEN_OFF|check_violation|23514/i,
        );
      }

      const after = await readObligationIdentity(prisma, fx.obligationId);
      expect(after.status).toBe('PARTIALLY_SETTLED');
      expect(identityMinusTimestamps(after)).toEqual(
        identityMinusTimestamps(before),
      );
      expect(await remainingRaw(prisma, fx.obligationId)).toEqual({
        principal: '800.00',
        settled: '15.00',
        remaining: '785.00',
      });

      const still = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '10.00',
        idempotencyKey: `cash-exec-${randomUUID()}`,
      });
      expect(still.remainingAmount.toFixed(2)).toBe('775.00');
    });

    it('status transition matrix matches derived ACK state for every enum value', async () => {
      const enums = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
        SELECT e.enumlabel
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'ExceptionFinancialObligationStatus'
        ORDER BY e.enumsortorder
      `;
      expect(enums.map((r) => r.enumlabel)).toEqual([
        'OPEN',
        'PARTIALLY_SETTLED',
        'SETTLED',
        'CANCELLED',
        'WRITTEN_OFF',
      ]);

      const fx = await seedOpenObligation(prisma, exceptions);
      expect(
        (await readObligationIdentity(prisma, fx.obligationId)).status,
      ).toBe('OPEN');

      const fromOpen = async (to: string) =>
        probeSql(
          prisma,
          Prisma.sql`
            UPDATE exception_financial_obligations
            SET status = ${to}::"ExceptionFinancialObligationStatus"
            WHERE id = ${fx.obligationId}::uuid
          `,
        );

      expect((await fromOpen('PARTIALLY_SETTLED')).rejected).toBe(true);
      expect((await fromOpen('SETTLED')).rejected).toBe(true);
      expect((await fromOpen('CANCELLED')).rejected).toBe(true);
      expect((await fromOpen('WRITTEN_OFF')).rejected).toBe(true);

      const ackId = randomUUID();
      const ins = await probeSql(
        prisma,
        Prisma.sql`
          INSERT INTO exception_financial_settlements (
            id, obligation_id, wk_order_id,
            debtor_type_snapshot, debtor_user_id_snapshot, debtor_merchant_id_snapshot,
            creditor_type_snapshot, creditor_user_id_snapshot, creditor_merchant_id_snapshot,
            method, status, currency, claimed_amount, acknowledged_amount,
            claimed_by_type, claimed_by_id, claimed_at,
            acknowledged_by_type, acknowledged_by_id, acknowledged_at
          ) VALUES (
            ${ackId}::uuid, ${fx.obligationId}::uuid, ${fx.orderId},
            'CUSTOMER', ${fx.customerId}::uuid, NULL,
            'MERCHANT', NULL, ${fx.merchantId},
            'CASH', 'ACKNOWLEDGED', 'PHP', 15.00, 15.00,
            'MERCHANT_OWNER', ${fx.merchantUserId}::uuid, NOW(),
            'MERCHANT_OWNER', ${fx.merchantUserId}::uuid, NOW()
          )
        `,
      );
      expect(ins.rejected).toBe(false);
      expect(
        (await readObligationIdentity(prisma, fx.obligationId)).status,
      ).toBe('OPEN');

      expect((await fromOpen('PARTIALLY_SETTLED')).rejected).toBe(false);
      expect(
        (await readObligationIdentity(prisma, fx.obligationId)).status,
      ).toBe('PARTIALLY_SETTLED');

      expect((await fromOpen('SETTLED')).rejected).toBe(true);
      expect((await fromOpen('OPEN')).rejected).toBe(true);
      expect((await fromOpen('CANCELLED')).rejected).toBe(true);
      expect((await fromOpen('WRITTEN_OFF')).rejected).toBe(true);

      const cloneCancelled = await probeSql(
        prisma,
        Prisma.sql`
          INSERT INTO exception_financial_obligations (
            id, liability_determination_id, exception_claim_id, economic_loss_id,
            wk_order_id, debtor_type, debtor_user_id, debtor_merchant_id,
            creditor_type, creditor_user_id, creditor_merchant_id,
            principal, currency, status, reason, correlation_id, created_at, updated_at
          )
          SELECT ${randomUUID()}::uuid, liability_determination_id, exception_claim_id,
                 economic_loss_id, wk_order_id, debtor_type, debtor_user_id,
                 debtor_merchant_id, creditor_type, creditor_user_id,
                 creditor_merchant_id, principal, currency, 'CANCELLED',
                 reason, correlation_id, created_at, updated_at
          FROM exception_financial_obligations
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      expect(cloneCancelled.rejected).toBe(true);
      const cloneWrittenOff = await probeSql(
        prisma,
        Prisma.sql`
          INSERT INTO exception_financial_obligations (
            id, liability_determination_id, exception_claim_id, economic_loss_id,
            wk_order_id, debtor_type, debtor_user_id, debtor_merchant_id,
            creditor_type, creditor_user_id, creditor_merchant_id,
            principal, currency, status, reason, correlation_id, created_at, updated_at
          )
          SELECT ${randomUUID()}::uuid, liability_determination_id, exception_claim_id,
                 economic_loss_id, wk_order_id, debtor_type, debtor_user_id,
                 debtor_merchant_id, creditor_type, creditor_user_id,
                 creditor_merchant_id, principal, currency, 'WRITTEN_OFF',
                 reason, correlation_id, created_at, updated_at
          FROM exception_financial_obligations
          WHERE id = ${fx.obligationId}::uuid
        `,
      );
      expect(cloneWrittenOff.rejected).toBe(true);

      await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '785.00',
        idempotencyKey: `cash-full-${randomUUID()}`,
      });
      expect(
        (await readObligationIdentity(prisma, fx.obligationId)).status,
      ).toBe('SETTLED');
      expect(await remainingRaw(prisma, fx.obligationId)).toEqual({
        principal: '800.00',
        settled: '800.00',
        remaining: '0.00',
      });

      const fromSettled = async (to: string) =>
        probeSql(
          prisma,
          Prisma.sql`
            UPDATE exception_financial_obligations
            SET status = ${to}::"ExceptionFinancialObligationStatus"
            WHERE id = ${fx.obligationId}::uuid
          `,
        );
      expect((await fromSettled('OPEN')).rejected).toBe(true);
      expect((await fromSettled('PARTIALLY_SETTLED')).rejected).toBe(true);
      expect((await fromSettled('CANCELLED')).rejected).toBe(true);
      expect((await fromSettled('WRITTEN_OFF')).rejected).toBe(true);
      expect(
        (await readObligationIdentity(prisma, fx.obligationId)).status,
      ).toBe('SETTLED');
    });

    it('policy_version and coverage columns are not stored on the obligation', async () => {
      const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'exception_financial_obligations'
        ORDER BY ordinal_position
      `;
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual([
        'id',
        'liability_determination_id',
        'exception_claim_id',
        'economic_loss_id',
        'wk_order_id',
        'debtor_type',
        'debtor_user_id',
        'debtor_merchant_id',
        'creditor_type',
        'creditor_user_id',
        'creditor_merchant_id',
        'principal',
        'currency',
        'status',
        'reason',
        'correlation_id',
        'created_at',
        'updated_at',
      ]);
      expect(names).not.toContain('policy_version_id');
      expect(names).not.toContain('fulfillment_id');
      expect(names).not.toContain('company_id');
      expect(names).not.toContain('tenant_id');
    });
  },
);
