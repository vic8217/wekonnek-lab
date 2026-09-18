/**
 * Live proof: Stage 12 acceptance override targets a fresh Terra-style disposable DB.
 * Creates wekonnek_stage12_terra_harness_test from TEMPLATE wekonnek_stage12_test when missing,
 * then proves Prisma + raw SQL see the same current_database.
 *
 * Harness infrastructure only — does not claim product freeze readiness.
 */
import { loadStageTestEnv } from './load-stage-test-env';
import {
  ACCEPTANCE_DATABASE_URL_ENV,
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  assertPrismaConnectedToStage12AcceptanceDb,
  resolveStage12ExpectedDatabase,
} from './acceptance-database';
import { Client } from 'pg';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const STAGE_ENV = loadStageTestEnv('.env.stage12.test');
const describeIf = STAGE_ENV ? describe : describe.skip;
jest.setTimeout(120_000);

const TERRA_DB = 'wekonnek_stage12_terra_harness_test';

function adminUrlFrom(url: string): string {
  return url.replace(/\/[^/?]+(\?|$)/, '/postgres$1').replace(/[?&]sslmode=[^&]*/g, '');
}

function rewriteDatabase(url: string, database: string): string {
  return url.replace(/\/[^/?]+(\?|$)/, `/${database}$1`);
}

describeIf('Stage 12 Terra-style disposable DB override (live)', () => {
  beforeAll(async () => {
    const baseUrl = process.env.DATABASE_URL;
    if (!baseUrl) throw new Error('DATABASE_URL missing after loadStageTestEnv');

    const admin = new Client({ connectionString: adminUrlFrom(baseUrl) });
    await admin.connect();
    try {
      const exists = await admin.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [TERRA_DB],
      );
      if (exists.rowCount === 0) {
        await admin.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'wekonnek_stage12_test' AND pid <> pg_backend_pid()`,
        );
        await admin.query(
          `CREATE DATABASE ${TERRA_DB} TEMPLATE wekonnek_stage12_test`,
        );
      }
    } finally {
      await admin.end();
    }

    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[ACCEPTANCE_DATABASE_URL_ENV] = rewriteDatabase(baseUrl, TERRA_DB);
    process.env.DATABASE_URL = process.env[ACCEPTANCE_DATABASE_URL_ENV];
  });

  afterAll(async () => {
    // Optional cleanup — leave DB for follow-on suite verification unless asked.
    if (process.env.WEKONNEK_ACCEPTANCE_DROP_TERRA_HARNESS !== '1') return;
    const base = process.env[ACCEPTANCE_DATABASE_URL_ENV];
    if (!base) return;
    const admin = new Client({ connectionString: adminUrlFrom(base) });
    try {
      await admin.connect();
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [TERRA_DB],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${TERRA_DB}`);
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

  it('C/D: Prisma and raw PG agree on override current_database', async () => {
    expect(resolveStage12ExpectedDatabase()).toBe(TERRA_DB);
    const prisma = new PrismaService();
    await prisma.$connect();
    try {
      const identity = await assertPrismaConnectedToStage12AcceptanceDb(
        prisma,
        TERRA_DB,
        'Terra harness prisma',
      );
      expect(identity.database).toBe(TERRA_DB);

      const raw = new Client({
        connectionString: (process.env.DATABASE_URL || '').replace(
          /[?&]sslmode=[^&]*/g,
          '',
        ),
      });
      await raw.connect();
      try {
        const r = await raw.query<{ database: string; user: string }>(
          'SELECT current_database() AS database, current_user AS user',
        );
        expect(r.rows[0]?.database).toBe(TERRA_DB);
        expect(r.rows[0]?.database).toBe(identity.database);
      } finally {
        await raw.end();
      }

      const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>(
        Prisma.sql`
          SELECT tgname FROM pg_trigger
          WHERE tgname LIKE 'stage12_%' AND NOT tgisinternal
          ORDER BY tgname
        `,
      );
      expect(triggers.length).toBeGreaterThan(5);
    } finally {
      await prisma.onModuleDestroy();
    }
  });
});
