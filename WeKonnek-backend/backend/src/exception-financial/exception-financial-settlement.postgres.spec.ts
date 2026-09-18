/**
 * Stage 13A Exception Obligation Settlement — PostgreSQL acceptance.
 * Default: backend/.env.stage13a.test → wekonnek_stage13a_test
 * Override: WEKONNEK_ACCEPTANCE_DATABASE_URL + WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1
 *
 * Cleanup policy: unique-UUID fixtures are left orphaned on the disposable DB.
 * Stage 13A history is append-only — never DISABLE TRIGGER, never DELETE
 * protected rows.
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
  ExceptionFinancialObligationStatus,
  ExceptionFinancialSettlementEvidenceKind,
  ExceptionFinancialSettlementMethod,
  ExceptionFinancialSettlementStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ExceptionFinancialService } from './exception-financial.service';
import { ExceptionFinancialSettlementService } from './exception-financial-settlement.service';
import { CODES } from './exception-financial-settlement.policy';
import {
  expectCode,
  insertFinalizedSuccessorAdjustment,
  seedOpenObligation,
} from './exception-financial-settlement.test-seed';

const describeIf = STAGE13A_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = resolveStage13aExpectedDatabase();
const ALLOWED_DB_USERS = stage13aAllowedDbUsers(EXPECTED_DB);

describeIf(
  `Stage 13A Exception Obligation Settlement PostgreSQL (${EXPECTED_DB})`,
  () => {
    const prisma = new PrismaService();
    const exceptions = new ExceptionFinancialService(prisma);
    const settlements = new ExceptionFinancialSettlementService(prisma);

    beforeAll(async () => {
      await prisma.$connect();
      const identity = await assertPrismaConnectedToStage13aAcceptanceDb(
        prisma,
        EXPECTED_DB,
        'Stage 13A settlement postgres',
      );
      if (
        STAGE13A_FORBIDDEN_DATABASES.has(identity.database) ||
        !ALLOWED_DB_USERS.has(identity.user)
      ) {
        throw new Error(
          `Stage 13A tests require ${EXPECTED_DB}; got database=${identity.database} user=${identity.user}`,
        );
      }
      await exceptions.ensureSeededPolicy();
    });

    afterAll(async () => prisma.onModuleDestroy());

    it('wrong debtor cannot claim transfer', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      await expectCode(
        settlements.claimTransfer({
          obligationId: fx.obligationId,
          actorUserId: fx.foreignId,
          method: ExceptionFinancialSettlementMethod.DIRECT_TRANSFER,
          amount: '100.00',
          idempotencyKey: `claim-${randomUUID()}`,
        }),
        CODES.NOT_OBLIGATION_DEBTOR,
      );
    });

    it('wrong creditor cannot ACK or reject', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const claim = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.BANK_TRANSFER,
        amount: '100.00',
        idempotencyKey: `claim-${randomUUID()}`,
      });
      await expectCode(
        settlements.acknowledge({
          settlementId: claim.settlement.id,
          actorUserId: fx.foreignMerchantUserId,
          acknowledgedAmount: '100.00',
          idempotencyKey: `ack-${randomUUID()}`,
        }),
        CODES.NOT_OBLIGATION_CREDITOR,
      );
      await expectCode(
        settlements.reject({
          settlementId: claim.settlement.id,
          actorUserId: fx.foreignId,
          reason: 'not mine',
          idempotencyKey: `rej-${randomUUID()}`,
        }),
        CODES.NOT_OBLIGATION_CREDITOR,
      );
    });

    it('debtor cannot self-ACK transfer', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const claim = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.DIRECT_TRANSFER,
        amount: '100.00',
        idempotencyKey: `claim-${randomUUID()}`,
      });
      await expectCode(
        settlements.acknowledge({
          settlementId: claim.settlement.id,
          actorUserId: fx.customerId,
          acknowledgedAmount: '100.00',
          idempotencyKey: `ack-${randomUUID()}`,
        }),
        CODES.NOT_OBLIGATION_CREDITOR,
      );
    });

    it('debtor cannot self-ACK cash (CASH_DEBTOR_SELF_ACK_FORBIDDEN)', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      await expectCode(
        settlements.recordCashReceipt({
          obligationId: fx.obligationId,
          actorUserId: fx.customerId,
          amount: '100.00',
          idempotencyKey: `cash-${randomUUID()}`,
        }),
        CODES.CASH_DEBTOR_SELF_ACK_FORBIDDEN,
      );
    });

    it('creditor can record cash receipt → ACKNOWLEDGED, remaining reduced', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const cash = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '300.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      expect(cash.settlement.status).toBe(
        ExceptionFinancialSettlementStatus.ACKNOWLEDGED,
      );
      expect(cash.settlement.method).toBe(
        ExceptionFinancialSettlementMethod.CASH,
      );
      expect(cash.settledAmount.toFixed(2)).toBe('300.00');
      expect(cash.remainingAmount.toFixed(2)).toBe('500.00');
      expect(cash.derivedState).toBe('PARTIALLY_SETTLED');
    });

    it('admin cannot claim / cash / ack', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      await expectCode(
        settlements.claimTransfer({
          obligationId: fx.obligationId,
          actorUserId: fx.adminId,
          method: ExceptionFinancialSettlementMethod.MERCHANT_QR,
          amount: '50.00',
          idempotencyKey: `claim-${randomUUID()}`,
        }),
        CODES.ADMIN_CANNOT_FABRICATE_ACK,
      );
      await expectCode(
        settlements.recordCashReceipt({
          obligationId: fx.obligationId,
          actorUserId: fx.adminId,
          amount: '50.00',
          idempotencyKey: `cash-${randomUUID()}`,
        }),
        CODES.ADMIN_CANNOT_FABRICATE_ACK,
      );
      const claim = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.DIRECT_TRANSFER,
        amount: '50.00',
        idempotencyKey: `claim-${randomUUID()}`,
      });
      await expectCode(
        settlements.acknowledge({
          settlementId: claim.settlement.id,
          actorUserId: fx.adminId,
          acknowledgedAmount: '50.00',
          idempotencyKey: `ack-${randomUUID()}`,
        }),
        CODES.ADMIN_CANNOT_FABRICATE_ACK,
      );
    });

    it('unrelated customer / merchant / rider cannot view', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const cash = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '10.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      for (const actor of [
        fx.foreignId,
        fx.foreignMerchantUserId,
        fx.riderId,
      ]) {
        await expectCode(
          settlements.getSettlement(cash.settlement.id, actor),
          CODES.FORBIDDEN_VIEW,
        );
        await expectCode(
          settlements.getObligationSettlementSummary(fx.obligationId, actor),
          CODES.FORBIDDEN_VIEW,
        );
      }
    });

    it('auth before idempotency disclosure (wrong actor + existing key → FORBIDDEN)', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const key = `cash-auth-${randomUUID()}`;
      await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '25.00',
        idempotencyKey: key,
      });
      await expectCode(
        settlements.recordCashReceipt({
          obligationId: fx.obligationId,
          actorUserId: fx.foreignMerchantUserId,
          amount: '25.00',
          idempotencyKey: key,
        }),
        CODES.NOT_OBLIGATION_CREDITOR,
      );
      await expectCode(
        settlements.claimTransfer({
          obligationId: fx.obligationId,
          actorUserId: fx.foreignId,
          method: ExceptionFinancialSettlementMethod.DIRECT_TRANSFER,
          amount: '25.00',
          idempotencyKey: `claim-auth-${randomUUID()}`,
        }),
        CODES.NOT_OBLIGATION_DEBTOR,
      );
    });

    it('partial: 300 then 500 → SETTLED', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const first = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '300.00',
        idempotencyKey: `cash-a-${randomUUID()}`,
      });
      expect(first.derivedState).toBe('PARTIALLY_SETTLED');
      const second = await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '500.00',
        idempotencyKey: `cash-b-${randomUUID()}`,
      });
      expect(second.settledAmount.toFixed(2)).toBe('800.00');
      expect(second.remainingAmount.toFixed(2)).toBe('0.00');
      expect(second.derivedState).toBe('SETTLED');

      const summary = await settlements.getObligationSettlementSummary(
        fx.obligationId,
        fx.customerId,
      );
      expect(summary.derivedState).toBe('SETTLED');
      expect(summary.settledAmount.toFixed(2)).toBe('800.00');
    });

    it('further ACK beyond principal is rejected', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      await settlements.recordCashReceipt({
        obligationId: fx.obligationId,
        actorUserId: fx.merchantUserId,
        amount: '800.00',
        idempotencyKey: `cash-${randomUUID()}`,
      });
      await expectCode(
        settlements.recordCashReceipt({
          obligationId: fx.obligationId,
          actorUserId: fx.merchantUserId,
          amount: '1.00',
          idempotencyKey: `cash-over-${randomUUID()}`,
        }),
        CODES.SETTLEMENT_AMOUNT_EXCEEDS_REMAINING,
      );
    });

    it('claim → reject does not reduce remaining', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const claim = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.DIRECT_TRANSFER,
        amount: '200.00',
        idempotencyKey: `claim-${randomUUID()}`,
      });
      const rejected = await settlements.reject({
        settlementId: claim.settlement.id,
        actorUserId: fx.merchantUserId,
        reason: 'not received',
        idempotencyKey: `rej-${randomUUID()}`,
      });
      expect(rejected.settlement.status).toBe(
        ExceptionFinancialSettlementStatus.REJECTED,
      );
      expect(rejected.settledAmount.toFixed(2)).toBe('0.00');
      expect(rejected.remainingAmount.toFixed(2)).toBe('800.00');
      expect(rejected.derivedState).toBe('UNPAID');
    });

    it('claim → cancel does not reduce remaining', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const claim = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.BANK_TRANSFER,
        amount: '150.00',
        idempotencyKey: `claim-${randomUUID()}`,
      });
      const cancelled = await settlements.cancelClaim({
        settlementId: claim.settlement.id,
        actorUserId: fx.customerId,
        idempotencyKey: `cancel-${randomUUID()}`,
      });
      expect(cancelled.settlement.status).toBe(
        ExceptionFinancialSettlementStatus.CANCELLED,
      );
      expect(cancelled.settledAmount.toFixed(2)).toBe('0.00');
      expect(cancelled.remainingAmount.toFixed(2)).toBe('800.00');
    });

    it('evidence attach does not change status or remaining', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const claim = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.MERCHANT_QR,
        amount: '100.00',
        idempotencyKey: `claim-${randomUUID()}`,
      });
      const before = await settlements.getObligationSettlementSummary(
        fx.obligationId,
        fx.merchantUserId,
      );
      const attached = await settlements.attachEvidence({
        settlementId: claim.settlement.id,
        actorUserId: fx.customerId,
        kind: ExceptionFinancialSettlementEvidenceKind.QR_RECEIPT,
        storageReference: `s3://receipts/${randomUUID()}`,
        note: 'proof of QR payment',
        idempotencyKey: `ev-${randomUUID()}`,
      });
      expect(attached.settlement.status).toBe(
        ExceptionFinancialSettlementStatus.CLAIMED,
      );
      expect(attached.settledAmount.toFixed(2)).toBe(
        before.settledAmount.toFixed(2),
      );
      expect(attached.remainingAmount.toFixed(2)).toBe(
        before.remainingAmount.toFixed(2),
      );
      expect(attached.evidence).toBeDefined();
    });

    it('transfer claim by debtor then creditor ACK', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const claim = await settlements.claimTransfer({
        obligationId: fx.obligationId,
        actorUserId: fx.customerId,
        method: ExceptionFinancialSettlementMethod.DIRECT_TRANSFER,
        amount: '400.00',
        externalReference: 'REF-13A-400',
        idempotencyKey: `claim-${randomUUID()}`,
      });
      expect(claim.settlement.status).toBe(
        ExceptionFinancialSettlementStatus.CLAIMED,
      );
      const ack = await settlements.acknowledge({
        settlementId: claim.settlement.id,
        actorUserId: fx.merchantUserId,
        acknowledgedAmount: '400.00',
        idempotencyKey: `ack-${randomUUID()}`,
      });
      expect(ack.settlement.status).toBe(
        ExceptionFinancialSettlementStatus.ACKNOWLEDGED,
      );
      expect(ack.settledAmount.toFixed(2)).toBe('400.00');
      expect(ack.remainingAmount.toFixed(2)).toBe('400.00');
      expect(ack.derivedState).toBe('PARTIALLY_SETTLED');
    });

    it('CANCELLED / WRITTEN_OFF cannot be fabricated; remaining stays executable', async () => {
      for (const status of [
        ExceptionFinancialObligationStatus.WRITTEN_OFF,
        ExceptionFinancialObligationStatus.CANCELLED,
      ] as const) {
        const fx = await seedOpenObligation(prisma, exceptions);
        await settlements.recordCashReceipt({
          obligationId: fx.obligationId,
          actorUserId: fx.merchantUserId,
          amount: '15.00',
          idempotencyKey: `cash-${randomUUID()}`,
        });
        await expect(
          prisma.exceptionFinancialObligation.update({
            where: { id: fx.obligationId },
            data: { status },
          }),
        ).rejects.toThrow(
          /status_authority|CANCELLED\/WRITTEN_OFF|check_violation|23514/i,
        );
        const cash = await settlements.recordCashReceipt({
          obligationId: fx.obligationId,
          actorUserId: fx.merchantUserId,
          amount: '10.00',
          idempotencyKey: `cash-still-${randomUUID()}`,
        });
        expect(cash.settledAmount.toFixed(2)).toBe('25.00');
        expect(cash.remainingAmount.toFixed(2)).toBe('775.00');
        expect(cash.derivedState).toBe('PARTIALLY_SETTLED');
      }
    });

    it('FINALIZED successor adjustment → RECONCILIATION_REQUIRED', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      await insertFinalizedSuccessorAdjustment(prisma, fx);
      await expectCode(
        settlements.claimTransfer({
          obligationId: fx.obligationId,
          actorUserId: fx.customerId,
          method: ExceptionFinancialSettlementMethod.DIRECT_TRANSFER,
          amount: '10.00',
          idempotencyKey: `claim-${randomUUID()}`,
        }),
        CODES.RECONCILIATION_REQUIRED,
      );
      await expectCode(
        settlements.recordCashReceipt({
          obligationId: fx.obligationId,
          actorUserId: fx.merchantUserId,
          amount: '10.00',
          idempotencyKey: `cash-${randomUUID()}`,
        }),
        CODES.RECONCILIATION_REQUIRED,
      );
    });

    it('admin can view settlement summary (read-only)', async () => {
      const fx = await seedOpenObligation(prisma, exceptions);
      const summary = await settlements.getObligationSettlementSummary(
        fx.obligationId,
        fx.adminId,
      );
      expect(summary.principal.toFixed(2)).toBe('800.00');
      expect(summary.derivedState).toBe('UNPAID');
    });
  },
);
