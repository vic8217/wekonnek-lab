/**
 * Stage 8 migration SQL acceptance against wekonnek_stage8_test.
 * Controlled raw-SQL apply/rollback. Does NOT fabricate _prisma_migrations rows.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';

const STAGE8_ENV = resolve(__dirname, '../../.env.stage8.test');
const STAGE8_ENV_PRESENT = existsSync(STAGE8_ENV);

if (STAGE8_ENV_PRESENT) {
  loadEnv({ path: STAGE8_ENV, override: true });
}

import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  STAGE8_ACCEPTANCE_DATABASE,
  STAGE8_FORBIDDEN_DATABASES,
} from '../test-support/test-database-guard';

const describeIf = STAGE8_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(120_000);

const MIGRATION_DIR = resolve(
  __dirname,
  '../../prisma/migrations/20260916230000_stage8_delivery_failure_operational_case',
);
const MIGRATION_SQL = resolve(MIGRATION_DIR, 'migration.sql');
const ROLLBACK_SQL = resolve(MIGRATION_DIR, 'rollback.sql');

describeIf('Stage 8 migration SQL proof (wekonnek_stage8_test)', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
    const target = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
    expect(target[0]?.database).toBe(STAGE8_ACCEPTANCE_DATABASE);
    expect(STAGE8_FORBIDDEN_DATABASES.has(target[0]!.database)).toBe(false);
    expect(['victor', 'wekonnek_stage8_test']).toContain(target[0]?.user);
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

  async function assertStage8SchemaPresent() {
    const tables = await prisma.$queryRaw<Array<{ exists: string | null }>>`
      SELECT to_regclass('public.delivery_attempts')::text AS exists
      UNION ALL SELECT to_regclass('public.delivery_attempt_evidences')::text
      UNION ALL SELECT to_regclass('public.operational_cases')::text
      UNION ALL SELECT to_regclass('public.operational_case_events')::text
    `;
    expect(tables.map((t) => t.exists)).toEqual([
      'delivery_attempts',
      'delivery_attempt_evidences',
      'operational_cases',
      'operational_case_events',
    ]);

    const partialIdem = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'delivery_attempts_reported_by_actor_id_idempotency_key_key'
    `;
    expect(partialIdem[0]?.indexdef).toMatch(/WHERE.*idempotency_key IS NOT NULL/i);

    const partialCase = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'operational_cases_one_open_delivery_failure_per_fulfillment'
    `;
    expect(partialCase[0]?.indexdef).toMatch(/DELIVERY_FAILURE/i);
    expect(partialCase[0]?.indexdef).toMatch(/OPEN/i);

    const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger
      WHERE tgname LIKE 'stage8_%'
      ORDER BY tgname
    `;
    expect(triggers.map((t) => t.tgname)).toEqual(
      expect.arrayContaining([
        'stage8_delivery_attempts_append_only_upd_trg',
        'stage8_delivery_attempts_append_only_del_trg',
        'stage8_delivery_attempt_evidences_append_only_upd_trg',
        'stage8_delivery_attempt_evidences_append_only_del_trg',
        'stage8_operational_case_events_append_only_upd_trg',
        'stage8_operational_case_events_append_only_del_trg',
      ]),
    );
  }

  async function assertStage8SchemaAbsent() {
    const tables = await prisma.$queryRaw<Array<{ exists: string | null }>>`
      SELECT to_regclass('public.delivery_attempts')::text AS exists
      UNION ALL SELECT to_regclass('public.delivery_attempt_evidences')::text
      UNION ALL SELECT to_regclass('public.operational_cases')::text
      UNION ALL SELECT to_regclass('public.operational_case_events')::text
    `;
    expect(tables.every((t) => t.exists == null)).toBe(true);
    const types = await prisma.$queryRaw<Array<{ typname: string }>>`
      SELECT typname FROM pg_type
      WHERE typname IN (
        'DeliveryAttemptOutcome',
        'DeliveryFailureReasonCode',
        'OperationalCaseType',
        'OperationalDisposition'
      )
    `;
    expect(types).toHaveLength(0);
  }

  it('has migration and rollback SQL files', () => {
    expect(existsSync(MIGRATION_SQL)).toBe(true);
    expect(existsSync(ROLLBACK_SQL)).toBe(true);
    expect(readFileSync(ROLLBACK_SQL, 'utf8')).toMatch(/Residue/i);
  });

  it('rollback removes Stage 8 structure and reapply succeeds', async () => {
    applySqlFile(MIGRATION_SQL);
    await assertStage8SchemaPresent();
    applySqlFile(ROLLBACK_SQL);
    await assertStage8SchemaAbsent();
    applySqlFile(MIGRATION_SQL);
    await assertStage8SchemaPresent();
  });
});
