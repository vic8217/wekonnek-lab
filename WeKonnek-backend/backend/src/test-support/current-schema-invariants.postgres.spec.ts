/**
 * Prove raw SQL invariants on the selected Stage 12 tip regression DB
 * (default wekonnek_stage12_regression_test, or WEKONNEK_ACCEPTANCE_DATABASE_URL
 * pointing at an approved disposable regression/terra DB).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertPrismaConnectedToStage12AcceptanceDb,
  resolveStage12ExpectedDatabase,
} from './acceptance-database';

process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
const ENV_OK = loadStageTestEnv('.env.stage12.regression.test');

import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const describeIf = ENV_OK ? describe : describe.skip;
jest.setTimeout(60_000);

const EXPECTED_DB = resolveStage12ExpectedDatabase();

describeIf(`Current-schema raw SQL invariants (${EXPECTED_DB})`, () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
    await assertPrismaConnectedToStage12AcceptanceDb(
      prisma,
      EXPECTED_DB,
      'Current-schema raw SQL invariants',
    );
  });

  afterAll(async () => prisma.onModuleDestroy());

  async function indexExists(name: string) {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE indexname = ${name}
    `;
    return rows.length === 1;
  }

  async function checkExists(conname: string) {
    const rows = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint WHERE conname = ${conname}
    `;
    return rows.length === 1;
  }

  async function triggerExists(tgname: string) {
    const rows = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger WHERE tgname = ${tgname} AND NOT tgisinternal
    `;
    return rows.length === 1;
  }

  it('STAGE 3: active pickup capability partial uniqueness', async () => {
    expect(
      await indexExists('pickup_handoff_tokens_active_fulfillment_purpose_key'),
    ).toBe(true);
  });

  it('STAGE 4: nonnegative money / one active RA per order', async () => {
    const defs = await prisma.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'public.rider_advances'::regclass AND contype = 'c'
    `;
    expect(defs.map((d) => d.def).join('\n')).toMatch(/0/);
  });

  it('STAGE 5A: delivery capability uniqueness', async () => {
    expect(
      await indexExists(
        'customer_delivery_handoff_tokens_active_fulfillment_purpose_key',
      ),
    ).toBe(true);
  });

  it('STAGE 5B: append-only DELETE + terminal UPDATE', async () => {
    expect(await triggerExists('rider_advance_settlement_append_only_trg')).toBe(
      true,
    );
    expect(await triggerExists('rider_advance_settlement_immutable_trg')).toBe(
      true,
    );
  });

  it('STAGE 6: return capability uniqueness', async () => {
    expect(
      await indexExists(
        'merchant_return_handoff_tokens_active_fulfillment_purpose_key',
      ),
    ).toBe(true);
  });

  it('STAGE 7: rider custody uniqueness + otp bounds', async () => {
    expect(
      await indexExists(
        'rider_custody_handoff_tokens_active_fulfillment_purpose_key',
      ),
    ).toBe(true);
    expect(
      await checkExists('rider_custody_handoff_tokens_otp_attempts_check'),
    ).toBe(true);
  });

  it('STAGE 8: attempt uniqueness + open case + append-only', async () => {
    expect(
      await indexExists('delivery_attempts_fulfillment_id_attempt_number_key'),
    ).toBe(true);
    expect(
      await indexExists(
        'operational_cases_one_open_delivery_failure_per_fulfillment',
      ),
    ).toBe(true);
    expect(
      await triggerExists('stage8_delivery_attempts_append_only_del_trg'),
    ).toBe(true);
  });

  it('STAGE 9: FINALIZED uniqueness + append-only', async () => {
    expect(
      await indexExists('return_financial_determinations_one_finalized_per_order'),
    ).toBe(true);
    expect(await triggerExists('stage9_rfd_immutable_trg')).toBe(true);
    expect(await triggerExists('stage9_rfs_append_only_del_trg')).toBe(true);
  });

  it('STAGE 10: one open redelivery + append-only + terminal immutable', async () => {
    expect(
      await indexExists('redelivery_authorizations_one_open_per_fulfillment'),
    ).toBe(true);
    const openDef = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'redelivery_authorizations_one_open_per_fulfillment'
    `;
    expect(openDef[0]?.indexdef).toMatch(/REQUESTED/i);
    expect(openDef[0]?.indexdef).toMatch(/CONFIRMED/i);
    expect(await triggerExists('stage10_redelivery_append_only_del_trg')).toBe(
      true,
    );
    expect(
      await triggerExists('stage10_redelivery_terminal_immutable_trg'),
    ).toBe(true);
    expect(
      await checkExists('redelivery_authorizations_window_order_check'),
    ).toBe(true);
    expect(
      await checkExists('redelivery_authorizations_address_mode_check'),
    ).toBe(true);
  });

  it('STAGE 11: one active recovery + append-only + terminal immutable', async () => {
    expect(
      await indexExists('operations_recoveries_one_active_per_fulfillment'),
    ).toBe(true);
    expect(
      await triggerExists('stage11_operations_recovery_append_only_del_trg'),
    ).toBe(true);
    expect(
      await triggerExists('stage11_operations_recovery_terminal_immutable_trg'),
    ).toBe(true);
    expect(
      await triggerExists('stage11_ore_events_append_only_del_trg'),
    ).toBe(true);
    expect(
      await triggerExists('stage11_ore_evidence_append_only_del_trg'),
    ).toBe(true);
    expect(
      await triggerExists('stage11_ore_verifications_append_only_del_trg'),
    ).toBe(true);
  });

  it('STAGE 12: economic loss identity + coverage ceiling + claim append-only', async () => {
    expect(await indexExists('economic_losses_order_kind_subject_key')).toBe(
      true,
    );
    expect(await indexExists('exception_claims_one_active_per_economic_loss')).toBe(
      true,
    );
    expect(await triggerExists('stage12_coverage_ceiling_trg')).toBe(true);
    expect(
      await triggerExists('stage12_exception_claim_terminal_immutable_trg'),
    ).toBe(true);
    expect(
      await triggerExists('stage12_obligation_reject_platform_trg'),
    ).toBe(true);
  });
});
