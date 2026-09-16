/**
 * Stage 6 migration SQL acceptance against wekonnek_stage6_test.
 * Controlled raw-SQL apply (repository historical baseline may lack full
 * from-zero migrate deploy). Does NOT fabricate _prisma_migrations rows.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';

const STAGE6_ENV = resolve(__dirname, '../../.env.stage6.test');
const STAGE6_ENV_PRESENT = existsSync(STAGE6_ENV);

if (STAGE6_ENV_PRESENT) {
  loadEnv({ path: STAGE6_ENV, override: true });
}

import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const describeIf = STAGE6_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(120_000);

const MIGRATION_DIR = resolve(
  __dirname,
  '../../prisma/migrations/20260916210000_stage6_secure_merchant_return_handoff',
);
const MIGRATION_SQL = resolve(MIGRATION_DIR, 'migration.sql');
const ROLLBACK_SQL = resolve(MIGRATION_DIR, 'rollback.sql');

describeIf('Stage 6 migration SQL proof (wekonnek_stage6_test)', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
    const target = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
    expect(target[0]?.database).toBe('wekonnek_stage6_test');
    expect(['victor', 'wekonnek_stage6_test']).toContain(target[0]?.user);
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

  async function assertStage6SchemaPresent() {
    const table = await prisma.$queryRaw<Array<{ exists: string | null }>>`
      SELECT to_regclass('public.merchant_return_handoff_tokens')::text AS exists
    `;
    expect(table[0]?.exists).toBe('merchant_return_handoff_tokens');

    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'merchant_return_handoff_tokens'
      ORDER BY indexname
    `;
    const names = indexes.map((i) => i.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        'merchant_return_handoff_tokens_pkey',
        'merchant_return_handoff_tokens_token_hash_key',
        'merchant_return_handoff_tokens_otp_hash_key',
        'merchant_return_handoff_tokens_custody_event_id_key',
        'merchant_return_handoff_tokens_confirm_idempotency_key_key',
        'merchant_return_handoff_tokens_active_fulfillment_purpose_key',
        'merchant_return_handoff_tokens_fulfillment_id_status_idx',
        'merchant_return_handoff_tokens_wk_order_id_status_idx',
        'merchant_return_handoff_tokens_merchant_id_status_idx',
        'merchant_return_handoff_tokens_return_rider_id_status_idx',
        'merchant_return_handoff_tokens_status_expires_at_idx',
        'merchant_return_handoff_tokens_assignment_idx',
      ]),
    );

    const partial = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'merchant_return_handoff_tokens_active_fulfillment_purpose_key'
    `;
    expect(partial[0]?.indexdef).toMatch(/WHERE.*status.*=.*'ACTIVE'/i);

    const fks = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.merchant_return_handoff_tokens'::regclass
        AND contype = 'f'
      ORDER BY conname
    `;
    expect(fks.map((f) => f.conname)).toEqual(
      expect.arrayContaining([
        'merchant_return_handoff_tokens_wk_order_id_fkey',
        'merchant_return_handoff_tokens_fulfillment_id_fkey',
        'merchant_return_handoff_tokens_merchant_id_fkey',
        'merchant_return_handoff_tokens_return_rider_id_fkey',
        'merchant_return_handoff_tokens_rider_assignment_id_fkey',
        'merchant_return_handoff_tokens_custody_event_id_fkey',
      ]),
    );

    const check = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.merchant_return_handoff_tokens'::regclass
        AND contype = 'c'
    `;
    expect(check.map((c) => c.conname)).toContain(
      'merchant_return_handoff_tokens_otp_attempts_check',
    );

    const enums = await prisma.$queryRaw<Array<{ typname: string }>>`
      SELECT typname FROM pg_type
      WHERE typname IN (
        'MerchantReturnHandoffPurpose',
        'MerchantReturnHandoffTokenStatus'
      )
      ORDER BY typname
    `;
    expect(enums.map((e) => e.typname)).toEqual([
      'MerchantReturnHandoffPurpose',
      'MerchantReturnHandoffTokenStatus',
    ]);
  }

  it('migration.sql + rollback.sql establish and remove Stage 6 schema', async () => {
    expect(existsSync(MIGRATION_SQL)).toBe(true);
    expect(existsSync(ROLLBACK_SQL)).toBe(true);
    const migrationBody = readFileSync(MIGRATION_SQL, 'utf8');
    const rollbackBody = readFileSync(ROLLBACK_SQL, 'utf8');
    expect(migrationBody).toMatch(/merchant_return_handoff_tokens/);
    expect(migrationBody).toMatch(/WHERE "status" = 'ACTIVE'/);
    expect(rollbackBody).toMatch(/DROP TABLE IF EXISTS "merchant_return_handoff_tokens"/);
    expect(rollbackBody).toMatch(/DROP TYPE IF EXISTS "MerchantReturnHandoffTokenStatus"/);

    // Controlled destructive proof on dedicated Stage 6 DB only.
    applySqlFile(ROLLBACK_SQL);
    const gone = await prisma.$queryRaw<Array<{ exists: string | null }>>`
      SELECT to_regclass('public.merchant_return_handoff_tokens')::text AS exists
    `;
    expect(gone[0]?.exists).toBeNull();

    applySqlFile(MIGRATION_SQL);
    await assertStage6SchemaPresent();

    // Leave schema applied for subsequent Stage 6 suites.
    applySqlFile(ROLLBACK_SQL);
    applySqlFile(MIGRATION_SQL);
    await assertStage6SchemaPresent();

    // Historical baseline note: _prisma_migrations may be absent on this DB
    // (db-push / controlled SQL acceptance). Do not fabricate history rows.
    const history = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
       ) AS exists`,
    );
    // Record observation only — absence is historical baseline limitation.
    expect(typeof history[0]?.exists).toBe('boolean');
  });
});
