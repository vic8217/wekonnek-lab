/**
 * Stage 10 migration SQL acceptance against wekonnek_stage10_test.
 * Controlled raw-SQL apply/rollback. Does NOT fabricate _prisma_migrations rows.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';

const STAGE10_ENV = resolve(__dirname, '../../.env.stage10.test');
const STAGE10_ENV_PRESENT = existsSync(STAGE10_ENV);

if (STAGE10_ENV_PRESENT) {
  loadEnv({ path: STAGE10_ENV, override: true });
}

import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  STAGE10_ACCEPTANCE_DATABASE,
  STAGE10_FORBIDDEN_DATABASES,
} from '../test-support/test-database-guard';

const describeIf = STAGE10_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(120_000);

const MIGRATION_DIR = resolve(
  __dirname,
  '../../prisma/migrations/20260917120000_stage10_redelivery_authorization',
);
const MIGRATION_SQL = resolve(MIGRATION_DIR, 'migration.sql');
const ROLLBACK_SQL = resolve(MIGRATION_DIR, 'rollback.sql');

describeIf('Stage 10 migration SQL proof (wekonnek_stage10_test)', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
    const target = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
    expect(target[0]?.database).toBe(STAGE10_ACCEPTANCE_DATABASE);
    expect(STAGE10_FORBIDDEN_DATABASES.has(target[0]!.database)).toBe(false);
    expect(['victor', 'wekonnek_stage10_test']).toContain(target[0]?.user);
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

  async function assertStage10SchemaPresent() {
    const tables = await prisma.$queryRaw<Array<{ exists: string | null }>>`
      SELECT to_regclass('public.redelivery_authorizations')::text AS exists
    `;
    expect(tables[0]?.exists).toBeTruthy();

    const partial = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'redelivery_authorizations_one_open_per_fulfillment'
    `;
    expect(partial[0]?.indexdef).toMatch(/REQUESTED/i);

    const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger
      WHERE tgname LIKE 'stage10_%'
      ORDER BY tgname
    `;
    expect(triggers.map((t) => t.tgname)).toEqual(
      expect.arrayContaining([
        'stage10_redelivery_append_only_del_trg',
        'stage10_redelivery_terminal_immutable_trg',
      ]),
    );
    expect(existsSync(MIGRATION_SQL)).toBe(true);
    expect(existsSync(ROLLBACK_SQL)).toBe(true);
    expect(readFileSync(ROLLBACK_SQL, 'utf8')).toContain(
      'DROP TYPE IF EXISTS "RedeliveryAuthorizationStatus"',
    );
  }

  async function assertStage10SchemaAbsent() {
    const tables = await prisma.$queryRaw<Array<{ exists: string | null }>>`
      SELECT to_regclass('public.redelivery_authorizations')::text AS exists
    `;
    expect(tables[0]?.exists).toBeNull();
  }

  it('rollback then reapply restores Stage 10 schema', async () => {
    await assertStage10SchemaPresent();
    applySqlFile(ROLLBACK_SQL);
    await assertStage10SchemaAbsent();
    applySqlFile(MIGRATION_SQL);
    await assertStage10SchemaPresent();
  });
});
