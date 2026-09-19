/**
 * Live proofs: grammar-valid disposable DBs are created from canonical
 * current-schema parents (wekonnek_stage13b2_test, …), never from
 * wekonnek_stage13b3_test, then dropped. Harness only.
 */
import { Client } from 'pg';
import { loadStageTestEnv } from './load-stage-test-env';
import {
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  stage13b2AllowedDbUsers,
} from './acceptance-database';
import {
  adminUrlFrom,
  databaseExists,
  dropCurrentSchemaDisposable,
  provisionCurrentSchemaDisposable,
  rewriteDatabase,
} from './current-schema-disposable-provision';
import { isRecognizedCurrentSchemaDisposableName } from './test-database-guard';

process.env.NODE_ENV = 'test';
process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';

const STAGE_ENV =
  loadStageTestEnv('.env.stage13b2.test') ||
  loadStageTestEnv('.env.stage13b1.test') ||
  loadStageTestEnv('.env.stage13a.test') ||
  loadStageTestEnv('.env.stage12.test') ||
  loadStageTestEnv('.env.stage13b3b.test');

const describeIf = STAGE_ENV && process.env.DATABASE_URL ? describe : describe.skip;
jest.setTimeout(180_000);

const PROOF1 = 'wekonnek_stage13b3_b_cursor_repro_test';
const PROOF2 = 'wekonnek_stage13b3_b_cursor_repro2_test';
const TERRA = 'wekonnek_stage13b3_b_terra_test';

const REQUIRED_TABLES = [
  'rider_advances',
  'rider_advance_settlements',
  'rider_advance_collection_restrictions',
  'return_financial_obligations',
  'return_financial_settlements',
  'exception_financial_obligations',
  'exception_financial_settlements',
  'economic_loss_coverages',
  'liability_determinations',
] as const;

const REQUIRED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'rider_advance_settlements', column: 'claimed_amount' },
  { table: 'rider_advance_settlements', column: 'acknowledged_amount' },
  { table: 'return_financial_settlements', column: 'claimed_amount' },
  { table: 'exception_financial_settlements', column: 'claimed_amount' },
  { table: 'rider_advances', column: 'reimbursement_principal' },
];

function adminConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing after stage env load');
  return adminUrlFrom(url);
}

async function verifyTargetIdentityAndSchema(target: string): Promise<{
  database: string;
  user: string;
  templateNotUsed: string;
}> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const client = new Client({ connectionString: rewriteDatabase(url, target) });
  await client.connect();
  try {
    const identity = await client.query<{ database: string; user: string }>(
      'SELECT current_database() AS database, current_user AS user',
    );
    const database = identity.rows[0]?.database;
    const user = identity.rows[0]?.user;
    if (database !== target) {
      throw new Error(`current_database()=${database} expected ${target}`);
    }
    const allowed = stage13b2AllowedDbUsers(target);
    // Connecting role may be the canonical parent role (same as CREATE DATABASE user).
    const parentRoles = new Set([
      'victor',
      'wekonnek_stage13b2_test',
      'wekonnek_stage13b1_test',
      'wekonnek_stage13a_test',
      'wekonnek_stage12_test',
      target,
    ]);
    if (!allowed.has(user ?? '') && !parentRoles.has(user ?? '')) {
      throw new Error(`unexpected current_user()=${user}`);
    }
    const tables = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [REQUIRED_TABLES],
    );
    const have = new Set(tables.rows.map((r) => r.tablename));
    for (const t of REQUIRED_TABLES) {
      if (!have.has(t)) {
        throw new Error(`current schema missing required table ${t}`);
      }
    }
    for (const col of REQUIRED_COLUMNS) {
      const found = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [col.table, col.column],
      );
      if ((found.rowCount ?? 0) === 0) {
        throw new Error(`current schema missing ${col.table}.${col.column}`);
      }
    }
    return {
      database,
      user: user ?? '',
      templateNotUsed: 'wekonnek_stage13b3_test',
    };
  } finally {
    await client.end();
  }
}

async function cycle(target: string): Promise<{
  template: string;
  database: string;
  user: string;
}> {
  expect(isRecognizedCurrentSchemaDisposableName(target)).toBe(true);
  const admin = adminConnectionString();
  expect(await databaseExists(admin, target)).toBe(false);
  const created = await provisionCurrentSchemaDisposable({
    targetDatabase: target,
    adminConnectionString: admin,
  });
  expect(created.created).toBe(true);
  expect(created.database).toBe(target);
  expect(created.template).not.toBe('wekonnek_stage13b3_test');
  expect(created.template).toBe('wekonnek_stage13b2_test');
  expect(await databaseExists(admin, target)).toBe(true);
  const identity = await verifyTargetIdentityAndSchema(target);
  await dropCurrentSchemaDisposable({
    targetDatabase: target,
    adminConnectionString: admin,
  });
  expect(await databaseExists(admin, target)).toBe(false);
  return { template: created.template, ...identity };
}

describeIf('current-schema disposable provision (live PostgreSQL)', () => {
  afterAll(async () => {
    const admin = adminConnectionString();
    for (const db of [PROOF1, PROOF2, TERRA]) {
      if (await databaseExists(admin, db)) {
        await dropCurrentSchemaDisposable({
          targetDatabase: db,
          adminConnectionString: admin,
        });
      }
    }
  });

  it('proof 1: wekonnek_stage13b3_b_cursor_repro_test absent→provision→verify→drop', async () => {
    const result = await cycle(PROOF1);
    expect(result.database).toBe(PROOF1);
    expect(result.template).toBe('wekonnek_stage13b2_test');
  });

  it('proof 2: second fresh name is reproducible', async () => {
    const result = await cycle(PROOF2);
    expect(result.database).toBe(PROOF2);
    expect(result.template).toBe('wekonnek_stage13b2_test');
  });

  it('terra-name: wekonnek_stage13b3_b_terra_test from absent, then dropped', async () => {
    const result = await cycle(TERRA);
    expect(result.database).toBe(TERRA);
    expect(result.template).toBe('wekonnek_stage13b2_test');
    expect(await databaseExists(adminConnectionString(), TERRA)).toBe(false);
  });

  it('refuses to clobber an already-existing disposable', async () => {
    const admin = adminConnectionString();
    const created = await provisionCurrentSchemaDisposable({
      targetDatabase: PROOF1,
      adminConnectionString: admin,
    });
    expect(created.created).toBe(true);
    await expect(
      provisionCurrentSchemaDisposable({
        targetDatabase: PROOF1,
        adminConnectionString: admin,
      }),
    ).rejects.toThrow(/already exists/);
    await dropCurrentSchemaDisposable({
      targetDatabase: PROOF1,
      adminConnectionString: admin,
    });
    expect(await databaseExists(admin, PROOF1)).toBe(false);
  });

  it('negative: rejected names never reach CREATE DATABASE', async () => {
    const admin = adminConnectionString();
    const stage5bExisted = await databaseExists(admin, 'wekonnek_stage5b_test');
    const stage6Existed = await databaseExists(admin, 'wekonnek_stage6_test');
    const denied = [
      'wekonnek_stage5b_test',
      'wekonnek_stage6_test',
      'wekonnek_production',
      'wekonnek_development',
      'wekonnek_staging',
      'wekonnek_stage13b3b_cursor_test',
      'wekonnek_stage13b3_prod_test',
    ];
    for (const db of denied) {
      await expect(
        provisionCurrentSchemaDisposable({
          targetDatabase: db,
          adminConnectionString: admin,
        }),
      ).rejects.toThrow(/provision refused|historical acceptance database/);
    }
    await expect(
      provisionCurrentSchemaDisposable({
        targetDatabase: PROOF1,
        adminConnectionString:
          'postgresql://wekonnek@db.example.com:5432/postgres',
      }),
    ).rejects.toThrow(/not a local PostgreSQL target/);
    expect(await databaseExists(admin, 'wekonnek_stage5b_test')).toBe(
      stage5bExisted,
    );
    expect(await databaseExists(admin, 'wekonnek_stage6_test')).toBe(
      stage6Existed,
    );
    expect(await databaseExists(admin, PROOF1)).toBe(false);
  });
});
