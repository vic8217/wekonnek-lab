/**
 * Stage 9 migration SQL acceptance against wekonnek_stage9_test.
 * Controlled raw-SQL apply/rollback. Does NOT fabricate _prisma_migrations rows.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';

const STAGE9_ENV = resolve(__dirname, '../../.env.stage9.test');
const STAGE9_ENV_PRESENT = existsSync(STAGE9_ENV);

if (STAGE9_ENV_PRESENT) {
  loadEnv({ path: STAGE9_ENV, override: true });
}

import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  STAGE9_ACCEPTANCE_DATABASE,
  STAGE9_FORBIDDEN_DATABASES,
} from '../test-support/test-database-guard';

const describeIf = STAGE9_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(120_000);

const MIGRATION_DIR = resolve(
  __dirname,
  '../../prisma/migrations/20260917010000_stage9_return_financial_determination',
);
const MIGRATION_SQL = resolve(MIGRATION_DIR, 'migration.sql');
const ROLLBACK_SQL = resolve(MIGRATION_DIR, 'rollback.sql');

describeIf('Stage 9 migration SQL proof (wekonnek_stage9_test)', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
    const target = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
    expect(target[0]?.database).toBe(STAGE9_ACCEPTANCE_DATABASE);
    expect(STAGE9_FORBIDDEN_DATABASES.has(target[0]!.database)).toBe(false);
    expect(['victor', 'wekonnek_stage9_test']).toContain(target[0]?.user);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  function applySqlFile(path: string) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL required');
    execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', path], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  }

  async function assertStage9SchemaPresent() {
    const tables = await prisma.$queryRaw<Array<{ exists: string | null }>>`
      SELECT to_regclass('public.return_financial_terms_versions')::text AS exists
      UNION ALL SELECT to_regclass('public.return_financial_terms_acceptances')::text
      UNION ALL SELECT to_regclass('public.return_financial_determinations')::text
      UNION ALL SELECT to_regclass('public.return_financial_obligations')::text
      UNION ALL SELECT to_regclass('public.return_financial_settlements')::text
      UNION ALL SELECT to_regclass('public.rider_advance_collection_restrictions')::text
    `;
    expect(tables.every((t) => t.exists != null)).toBe(true);

    const partial = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'return_financial_determinations_one_finalized_per_order'
    `;
    expect(partial[0]?.indexdef).toMatch(/FINALIZED/i);

    const restr = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'rider_advance_collection_restrictions_one_active_per_ra'
    `;
    expect(restr[0]?.indexdef).toMatch(/ACTIVE/i);

    const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger
      WHERE tgname LIKE 'stage9_%'
      ORDER BY tgname
    `;
    expect(triggers.map((t) => t.tgname)).toEqual(
      expect.arrayContaining([
        'stage9_rfd_immutable_trg',
        'stage9_rfs_immutable_trg',
        'stage9_rfs_append_only_del_trg',
        'stage9_racr_append_only_del_trg',
      ]),
    );
  }

  async function assertStage9SchemaAbsent() {
    const tables = await prisma.$queryRaw<Array<{ exists: string | null }>>`
      SELECT to_regclass('public.return_financial_determinations')::text AS exists
      UNION ALL SELECT to_regclass('public.return_financial_obligations')::text
      UNION ALL SELECT to_regclass('public.return_financial_settlements')::text
      UNION ALL SELECT to_regclass('public.rider_advance_collection_restrictions')::text
      UNION ALL SELECT to_regclass('public.return_financial_terms_versions')::text
    `;
    expect(tables.every((t) => t.exists == null)).toBe(true);
    const types = await prisma.$queryRaw<Array<{ typname: string }>>`
      SELECT typname FROM pg_type
      WHERE typname IN (
        'ReturnFinancialDeterminationStatus',
        'ReturnFinancialObligationType',
        'RiderAdvanceCollectionRestrictionStatus'
      )
    `;
    expect(types).toHaveLength(0);
  }

  it('rollback then reapply restores Stage 9 schema; Stage 8 tables untouched', async () => {
    expect(readFileSync(MIGRATION_SQL, 'utf8').length).toBeGreaterThan(100);
    expect(readFileSync(ROLLBACK_SQL, 'utf8').length).toBeGreaterThan(100);

    await assertStage9SchemaPresent();

    const stage8Before = await prisma.$queryRaw<Array<{ exists: string | null }>>`
      SELECT to_regclass('public.delivery_attempts')::text AS exists
      UNION ALL SELECT to_regclass('public.operational_cases')::text
      UNION ALL SELECT to_regclass('public.rider_advance_settlements')::text
    `;

    applySqlFile(ROLLBACK_SQL);
    await assertStage9SchemaAbsent();

    const stage8After = await prisma.$queryRaw<Array<{ exists: string | null }>>`
      SELECT to_regclass('public.delivery_attempts')::text AS exists
      UNION ALL SELECT to_regclass('public.operational_cases')::text
      UNION ALL SELECT to_regclass('public.rider_advance_settlements')::text
    `;
    expect(stage8After).toEqual(stage8Before);

    applySqlFile(MIGRATION_SQL);
    await assertStage9SchemaPresent();
  });
});
