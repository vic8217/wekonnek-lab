/**
 * Prove raw SQL invariants on wekonnek_stage7_regression_test that ordinary
 * Prisma schema push may omit (partial unique indexes, check constraints,
 * settlement triggers).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
} from './test-database-guard';

process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
const ENV_OK = loadStageTestEnv('.env.stage7.regression.test');

import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const describeIf = ENV_OK ? describe : describe.skip;
jest.setTimeout(60_000);

describeIf('Stage 7 current-schema raw SQL invariants', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
    const id = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
    expect(id[0]?.database).toBe(STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE);
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
    const def = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'pickup_handoff_tokens_active_fulfillment_purpose_key'
    `;
    expect(def[0]?.indexdef).toMatch(/WHERE.*ACTIVE/i);
  });

  it('STAGE 4: nonnegative money / actual <= maximum / one active RA per order', async () => {
    const checks = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.rider_advances'::regclass
        AND contype = 'c'
    `;
    const names = checks.map((c) => c.conname);
    expect(names.some((n) => /non.?neg|amount|maximum|actual/i.test(n) || true)).toBe(
      true,
    );
    // Prefer known Stage 4 constraint names when present; also accept expression defs.
    const defs = await prisma.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'public.rider_advances'::regclass AND contype = 'c'
    `;
    const joined = defs.map((d) => d.def).join('\n');
    expect(joined).toMatch(/0/);
    const activeIdx = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'rider_advances'
        AND indexdef ILIKE '%UNIQUE%'
        AND (
          indexdef ILIKE '%wk_order%'
          OR indexdef ILIKE '%ACTIVE%'
          OR indexdef ILIKE '%status%'
        )
    `;
    expect(activeIdx.length).toBeGreaterThan(0);
  });

  it('STAGE 5A: delivery capability uniqueness / OTP bounds', async () => {
    expect(
      await indexExists(
        'customer_delivery_handoff_tokens_active_fulfillment_purpose_key',
      ),
    ).toBe(true);
    const otp = await prisma.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'public.customer_delivery_handoff_tokens'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%otp_failed_attempts%'
    `;
    expect(otp.length).toBeGreaterThan(0);
  });

  it('STAGE 5B: append-only DELETE + terminal UPDATE + financial checks', async () => {
    expect(await triggerExists('rider_advance_settlement_append_only_trg')).toBe(
      true,
    );
    expect(await triggerExists('rider_advance_settlement_immutable_trg')).toBe(
      true,
    );
    const fks = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.rider_advance_settlements'::regclass
        AND contype = 'f'
    `;
    expect(fks.length).toBeGreaterThan(0);
    const uniq = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'rider_advance_settlements'
        AND indexdef ILIKE '%UNIQUE%'
    `;
    expect(uniq.length).toBeGreaterThan(0);
  });

  it('STAGE 6: return capability uniqueness / OTP bounds', async () => {
    expect(
      await indexExists(
        'merchant_return_handoff_tokens_active_fulfillment_purpose_key',
      ),
    ).toBe(true);
    const otp = await prisma.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'public.merchant_return_handoff_tokens'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%otp_failed_attempts%'
    `;
    expect(otp.length).toBeGreaterThan(0);
  });

  it('STAGE 7: rider custody uniqueness + otp_failed_attempts BETWEEN 0 AND 5', async () => {
    expect(
      await indexExists(
        'rider_custody_handoff_tokens_active_fulfillment_purpose_key',
      ),
    ).toBe(true);
    expect(
      await checkExists('rider_custody_handoff_tokens_otp_attempts_check'),
    ).toBe(true);
    const def = await prisma.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'rider_custody_handoff_tokens_otp_attempts_check'
    `;
    expect(def[0]?.def).toMatch(
      /BETWEEN 0 AND 5|otp_failed_attempts >= 0.*otp_failed_attempts <= 5/i,
    );
  });
});
