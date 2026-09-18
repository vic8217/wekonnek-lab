/**
 * Provision wekonnek_stage12_cursor_regression_test and write local override env.
 */
import { loadStageTestEnv } from './load-stage-test-env';
import {
  ACCEPTANCE_DATABASE_URL_ENV,
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  assertPrismaConnectedToStage12AcceptanceDb,
  resolveStage12ExpectedDatabase,
} from './acceptance-database';
import { Client } from 'pg';
import { writeFileSync, chmodSync } from 'fs';
import { resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';

const STAGE_ENV = loadStageTestEnv('.env.stage12.test');
const describeIf = STAGE_ENV ? describe : describe.skip;
jest.setTimeout(120_000);

const CURSOR_DB = 'wekonnek_stage12_cursor_regression_test';

function adminUrlFrom(url: string): string {
  return url.replace(/\/[^/?]+(\?|$)/, '/postgres$1').replace(/[?&]sslmode=[^&]*/g, '');
}

function rewriteDatabase(url: string, database: string): string {
  return url.replace(/\/[^/?]+(\?|$)/, `/${database}$1`);
}

describeIf('Stage 12 Cursor regression disposable DB provision', () => {
  beforeAll(async () => {
    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) throw new Error('DATABASE_URL missing');
    const admin = new Client({ connectionString: adminUrlFrom(baseUrl) });
    await admin.connect();
    try {
      const exists = await admin.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [CURSOR_DB],
      );
      if (exists.rowCount === 0) {
        await admin.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'wekonnek_stage12_test' AND pid <> pg_backend_pid()`,
        );
        await admin.query(
          `CREATE DATABASE ${CURSOR_DB} TEMPLATE wekonnek_stage12_test`,
        );
      }
    } finally {
      await admin.end();
    }

    const override = rewriteDatabase(baseUrl, CURSOR_DB);
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] = override;
    process.env.DATABASE_URL = override;

    const localPath = resolve(__dirname, '../../.env.stage12.cursor.regression.local');
    writeFileSync(
      localPath,
      `WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1\nWEKONNEK_CURRENT_SCHEMA_REGRESSION=1\nWEKONNEK_ACCEPTANCE_DATABASE_URL=${override}\n`,
      { mode: 0o600 },
    );
    chmodSync(localPath, 0o600);
  });

  afterAll(async () => {
    if (process.env.WEKONNEK_ACCEPTANCE_DROP_CURSOR_REGRESSION !== '1') return;
    const base = process.env[ACCEPTANCE_DATABASE_URL_ENV];
    if (!base) return;
    const admin = new Client({ connectionString: adminUrlFrom(base) });
    try {
      await admin.connect();
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [CURSOR_DB],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${CURSOR_DB}`);
    } catch {
      /* best-effort */
    } finally {
      try {
        await admin.end();
      } catch {
        /* ignore */
      }
    }
  });

  it('provisions cursor regression DB and proves Prisma identity', async () => {
    expect(resolveStage12ExpectedDatabase()).toBe(CURSOR_DB);
    const prisma = new PrismaService();
    await prisma.$connect();
    try {
      const id = await assertPrismaConnectedToStage12AcceptanceDb(
        prisma,
        CURSOR_DB,
        'Cursor regression provision',
      );
      expect(id.database).toBe(CURSOR_DB);
      const raw = new Client({
        connectionString: (process.env.DATABASE_URL || '').replace(
          /[?&]sslmode=[^&]*/g,
          '',
        ),
      });
      await raw.connect();
      try {
        const r = await raw.query<{ database: string }>(
          'SELECT current_database() AS database',
        );
        expect(r.rows[0]?.database).toBe(CURSOR_DB);
      } finally {
        await raw.end();
      }
    } finally {
      await prisma.onModuleDestroy();
    }
  });
});
