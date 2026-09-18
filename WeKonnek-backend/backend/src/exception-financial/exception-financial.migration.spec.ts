/**
 * Stage 12 migration apply / rollback / reapply on the selected disposable
 * acceptance DB only (default wekonnek_stage12_test, or
 * WEKONNEK_ACCEPTANCE_DATABASE_URL override).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertPrismaConnectedToStage12AcceptanceDb,
  resolveStage12ExpectedDatabase,
} from '../test-support/acceptance-database';
import { STAGE12_ACCEPTANCE_DATABASE } from '../test-support/test-database-guard';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';

const enabled = loadStageTestEnv('.env.stage12.test');
const EXPECTED_DB = resolveStage12ExpectedDatabase();
/**
 * Destructive Stage 12 rollback/reapply is confined to the Stage 12 acceptance
 * DB (or Stage12 terra/cursor ephemerals). Never run on Stage13A tip —
 * rolling back Stage 12 drops ExceptionFinancialObligation parents that
 * Stage13A settlements reference.
 */
const allowDestructiveRollback =
  EXPECTED_DB === STAGE12_ACCEPTANCE_DATABASE ||
  /^wekonnek_stage12_(terra|cursor)_/.test(EXPECTED_DB);
const describeIf =
  enabled && allowDestructiveRollback ? describe : describe.skip;

describeIf(`Stage 12 migration rollback/reapply (${EXPECTED_DB})`, () => {
  const prisma = new PrismaService();
  const migDir = resolve(
    __dirname,
    '../../prisma/migrations/20260917200000_stage12_exception_financial_liability',
  );
  const amendmentDir = resolve(
    __dirname,
    '../../prisma/migrations/20260917210000_stage12_trust_trade_non_conformance',
  );

  beforeAll(async () => {
    await prisma.$connect();
    await assertPrismaConnectedToStage12AcceptanceDb(
      prisma,
      EXPECTED_DB,
      'Stage 12 migration',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rollback then reapply restores Stage 12 objects', () => {
    const url = process.env.DATABASE_URL!;
    const psqlDb = execSync(
      `psql "${url}" -tAc "SELECT current_database()"`,
      { encoding: 'utf8' },
    ).trim();
    expect(psqlDb).toBe(EXPECTED_DB);

    execSync(`psql "${url}" -v ON_ERROR_STOP=1 -f "${migDir}/rollback.sql"`, {
      stdio: 'pipe',
    });
    for (const table of [
      'exception_claims',
      'economic_losses',
      'liability_determinations',
      'exception_financial_obligations',
    ]) {
      const gone = execSync(
        `psql "${url}" -tAc "SELECT to_regclass('public.${table}')"`,
        { encoding: 'utf8' },
      ).trim();
      expect(gone === '' || gone === 'null').toBe(true);
    }

    execSync(`psql "${url}" -v ON_ERROR_STOP=1 -f "${migDir}/migration.sql"`, {
      stdio: 'pipe',
    });
    // Trust Trade amendment (Stage 8/11 additive labels + reason column if missing)
    execSync(
      `psql "${url}" -v ON_ERROR_STOP=1 -f "${amendmentDir}/migration.sql"`,
      { stdio: 'pipe' },
    );
    for (const table of [
      'exception_liability_policy_versions',
      'economic_losses',
      'economic_loss_coverages',
      'exception_claims',
      'exception_claim_events',
      'exception_claim_evidence',
      'exception_claim_verifications',
      'verified_facts',
      'liability_determinations',
      'liability_allocations',
      'exception_financial_obligations',
    ]) {
      const present = execSync(
        `psql "${url}" -tAc "SELECT to_regclass('public.${table}')"`,
        { encoding: 'utf8' },
      ).trim();
      expect(present).toBe(table);
    }
    const reasonCol = execSync(
      `psql "${url}" -tAc "SELECT column_name FROM information_schema.columns WHERE table_name='exception_claims' AND column_name='non_conformance_reason_code'"`,
      { encoding: 'utf8' },
    ).trim();
    expect(reasonCol).toBe('non_conformance_reason_code');
  });

  it('reapply restores the Stage 12 partial unique indexes', () => {
    const url = process.env.DATABASE_URL!;
    for (const index of [
      'exception_claims_one_active_per_economic_loss',
      'liability_determinations_one_active_per_claim',
      'economic_losses_order_kind_subject_key',
      'economic_loss_coverages_loss_source_key',
    ]) {
      const found = execSync(
        `psql "${url}" -tAc "SELECT indexname FROM pg_indexes WHERE indexname='${index}'"`,
        { encoding: 'utf8' },
      ).trim();
      expect(found).toBe(index);
    }
  });

  it('reapply restores the Stage 12 integrity triggers', () => {
    const url = process.env.DATABASE_URL!;
    for (const trigger of [
      'stage12_coverage_ceiling_trg',
      'stage12_verified_fact_immutable_upd_trg',
      'stage12_verified_fact_immutable_del_trg',
      'stage12_determination_finalized_immutable_trg',
      'stage12_determination_allocation_sum_trg',
      'stage12_allocation_guard_ins_trg',
      'stage12_obligation_reject_platform_trg',
      'stage12_obligation_no_delete_trg',
      'stage12_exception_claim_terminal_immutable_trg',
      'stage12_exception_claim_no_delete_trg',
      'stage12_claim_events_append_only_del_trg',
      'stage12_claim_evidence_append_only_del_trg',
      'stage12_claim_verifications_append_only_del_trg',
      'stage12_coverage_append_only_del_trg',
      'stage12_economic_loss_guard_del_trg',
    ]) {
      const found = execSync(
        `psql "${url}" -tAc "SELECT tgname FROM pg_trigger WHERE tgname='${trigger}'"`,
        { encoding: 'utf8' },
      ).trim();
      expect(found).toBe(trigger);
    }
  });

  it('leaves Stage 9 and Stage 11 objects intact across rollback/reapply', () => {
    const url = process.env.DATABASE_URL!;
    for (const table of [
      'return_financial_determinations',
      'return_financial_obligations',
      'operations_recoveries',
      'operations_recovery_events',
    ]) {
      const present = execSync(
        `psql "${url}" -tAc "SELECT to_regclass('public.${table}')"`,
        { encoding: 'utf8' },
      ).trim();
      expect(present).toBe(table);
    }
    const stage11Trigger = execSync(
      `psql "${url}" -tAc "SELECT tgname FROM pg_trigger WHERE tgname='stage11_operations_recovery_terminal_immutable_trg'"`,
      { encoding: 'utf8' },
    ).trim();
    expect(stage11Trigger).toBe(
      'stage11_operations_recovery_terminal_immutable_trg',
    );
  });

  it('is idempotent: applying twice does not fail', () => {
    const url = process.env.DATABASE_URL!;
    execSync(`psql "${url}" -v ON_ERROR_STOP=1 -f "${migDir}/migration.sql"`, {
      stdio: 'pipe',
    });
    const present = execSync(
      `psql "${url}" -tAc "SELECT to_regclass('public.exception_claims')"`,
      { encoding: 'utf8' },
    ).trim();
    expect(present).toBe('exception_claims');
  });
});
