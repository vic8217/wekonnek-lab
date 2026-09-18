/**
 * Stage 13A migration object presence on the selected disposable acceptance DB
 * (default wekonnek_stage13a_test, or WEKONNEK_ACCEPTANCE_DATABASE_URL override).
 *
 * Proves enums, tables, indexes, and triggers from
 * 20260918120000_stage13_exception_obligation_settlement exist.
 * Does not rollback (append-only acceptance DB).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertPrismaConnectedToStage13aAcceptanceDb,
  resolveStage13aExpectedDatabase,
} from '../test-support/acceptance-database';
import { execSync } from 'child_process';
import { PrismaService } from '../prisma/prisma.service';

const enabled = loadStageTestEnv('.env.stage13a.test');
const describeIf = enabled ? describe : describe.skip;
const EXPECTED_DB = resolveStage13aExpectedDatabase();

describeIf(`Stage 13A settlement migration objects (${EXPECTED_DB})`, () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
    await assertPrismaConnectedToStage13aAcceptanceDb(
      prisma,
      EXPECTED_DB,
      'Stage 13A settlement migration',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('psql current_database matches expected Stage 13A disposable DB', () => {
    const url = process.env.DATABASE_URL!;
    const psqlDb = execSync(
      `psql "${url}" -tAc "SELECT current_database()"`,
      { encoding: 'utf8' },
    ).trim();
    expect(psqlDb).toBe(EXPECTED_DB);
  });

  it('enums exist', () => {
    const url = process.env.DATABASE_URL!;
    for (const typ of [
      'ExceptionFinancialSettlementMethod',
      'ExceptionFinancialSettlementStatus',
      'ExceptionFinancialSettlementEvidenceKind',
    ]) {
      const found = execSync(
        `psql "${url}" -tAc "SELECT typname FROM pg_type WHERE typname='${typ}'"`,
        { encoding: 'utf8' },
      ).trim();
      expect(found).toBe(typ);
    }
  });

  it('tables exist', () => {
    const url = process.env.DATABASE_URL!;
    for (const table of [
      'exception_financial_settlements',
      'exception_financial_settlement_evidence',
    ]) {
      const present = execSync(
        `psql "${url}" -tAc "SELECT to_regclass('public.${table}')"`,
        { encoding: 'utf8' },
      ).trim();
      expect(present).toBe(table);
    }
  });

  it('indexes exist', () => {
    const url = process.env.DATABASE_URL!;
    for (const index of [
      'exception_financial_settlements_claim_idempotency_key_key',
      'exception_financial_settlements_ack_idempotency_key_key',
      'exception_financial_settlements_cash_idempotency_key_key',
      'exception_financial_settlements_reject_idempotency_key_key',
      'exception_financial_settlements_cancel_idempotency_key_key',
      'exception_financial_settlements_obligation_id_status_idx',
      'exception_financial_settlements_wk_order_id_status_idx',
      'exception_financial_settlement_evidence_idempotency_key_key',
    ]) {
      const found = execSync(
        `psql "${url}" -tAc "SELECT indexname FROM pg_indexes WHERE indexname='${index}'"`,
        { encoding: 'utf8' },
      ).trim();
      expect(found).toBe(index);
    }
    // Truncated PG identifier for long evidence settlement_id index
    const evidenceIdx = execSync(
      `psql "${url}" -tAc "SELECT indexname FROM pg_indexes WHERE indexname LIKE 'exception_financial_settlement_evidence_settlement_id_created_%'"`,
      { encoding: 'utf8' },
    ).trim();
    expect(evidenceIdx.length).toBeGreaterThan(0);
  });

  it('triggers exist', () => {
    const url = process.env.DATABASE_URL!;
    for (const trigger of [
      'stage13a_efs_overpayment_ins_trg',
      'stage13a_efs_overpayment_upd_trg',
      'stage13a_efs_immutable_trg',
      'stage13a_efs_no_delete_trg',
      'stage13a_efse_immutable_upd_trg',
      'stage13a_efse_no_delete_trg',
      'stage13a_efs_reject_platform_trg',
      'stage13a_efo_economic_identity_trg',
      'stage13a_efo_status_authority_trg',
    ]) {
      const found = execSync(
        `psql "${url}" -tAc "SELECT tgname FROM pg_trigger WHERE tgname='${trigger}'"`,
        { encoding: 'utf8' },
      ).trim();
      expect(found).toBe(trigger);
    }
  });

  it('leaves Stage 12 obligation rails intact', () => {
    const url = process.env.DATABASE_URL!;
    for (const table of [
      'exception_financial_obligations',
      'liability_determinations',
      'exception_claims',
      'economic_losses',
    ]) {
      const present = execSync(
        `psql "${url}" -tAc "SELECT to_regclass('public.${table}')"`,
        { encoding: 'utf8' },
      ).trim();
      expect(present).toBe(table);
    }
  });
});
