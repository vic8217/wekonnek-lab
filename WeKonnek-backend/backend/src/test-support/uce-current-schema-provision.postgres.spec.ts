/**
 * Live UCE-H1 provision cycle. Opt-in only.
 * WEKONNEK_UCE_H1_LIVE=1 + WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1 + local DATABASE_URL.
 * Target: wekonnek_uce_h1_cursor_test
 */
import { Client } from 'pg';
import { loadStageTestEnv } from './load-stage-test-env';
import {
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  isSafeLocalAcceptanceHost,
  parseAcceptanceDatabaseUrl,
} from './acceptance-database';
import {
  adminUrlFrom,
  databaseExists,
  rewriteDatabase,
} from './current-schema-disposable-provision';
import {
  isRecognizedCurrentSchemaDisposableName,
  isRecognizedUceDisposableName,
} from './test-database-guard';
import {
  UCE_RESET_OK_ENV,
  dropUceCurrentSchemaDisposable,
  provisionUceCurrentSchema,
  uceSafeConnectionDiagnostics,
} from './uce-current-schema-provision';

process.env.NODE_ENV = 'test';

if (!process.env.DATABASE_URL) {
  loadStageTestEnv('.env.stage13b2.test') ||
    loadStageTestEnv('.env.stage13b1.test') ||
    loadStageTestEnv('.env.stage13a.test');
}

const TARGET = 'wekonnek_uce_h1_cursor_test';
const url = process.env.DATABASE_URL || '';
let localHost = false;
try {
  if (url) {
    localHost = isSafeLocalAcceptanceHost(parseAcceptanceDatabaseUrl(url).host);
  }
} catch {
  localHost = false;
}

const LIVE =
  process.env.WEKONNEK_UCE_H1_LIVE === '1' &&
  process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] === '1' &&
  Boolean(url) &&
  localHost;

const describeIf = LIVE ? describe : describe.skip;
jest.setTimeout(180_000);

const REQUIRED_TABLES = [
  'orders',
  'order_fulfillments',
  'rider_assignments',
  'custody_events',
  'rider_advances',
  'liability_determinations',
  'financial_reconciliation_reviews',
] as const;

describeIf('UCE-H1 live current-schema provision', () => {
  const admin = adminUrlFrom(url);

  afterAll(async () => {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[UCE_RESET_OK_ENV] = '1';
    if (await databaseExists(admin, TARGET)) {
      await dropUceCurrentSchemaDisposable({
        targetDatabase: TARGET,
        adminConnectionString: admin,
      });
    }
  });

  it('create → identity → Stage15C probes → exclude UCE-2/4 → drop', async () => {
    expect(isRecognizedUceDisposableName(TARGET)).toBe(true);
    expect(isRecognizedCurrentSchemaDisposableName(TARGET)).toBe(false);
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[UCE_RESET_OK_ENV] = '1';

    const adminClient = new Client({ connectionString: admin });
    await adminClient.connect();
    let host = '';
    let port = '';
    let currentDatabase = '';
    let currentUser = '';
    let rolsuper: boolean | null = null;
    try {
      const parsed = parseAcceptanceDatabaseUrl(admin);
      const diag = uceSafeConnectionDiagnostics(admin, TARGET);
      host = String(diag.host);
      port = diag.port;
      const ident = await adminClient.query<{
        database: string;
        user: string;
      }>('SELECT current_database() AS database, current_user AS user');
      const superRow = await adminClient.query<{ super: boolean }>(
        'SELECT rolsuper AS super FROM pg_roles WHERE rolname = current_user',
      );
      currentDatabase = ident.rows[0]?.database ?? '';
      currentUser = ident.rows[0]?.user ?? '';
      rolsuper = superRow.rows[0]?.super ?? null;
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          host,
          port,
          approvedDatabase: TARGET,
          current_database: currentDatabase,
          current_user: currentUser,
          rolsuper,
          parsedHost: parsed.host,
        }),
      );
      expect(JSON.stringify({ host, port, currentUser })).not.toMatch(
        /password|\/\/[^@]+@/i,
      );
      expect(currentDatabase).toBe('postgres');
    } finally {
      await adminClient.end();
    }

    if (await databaseExists(admin, TARGET)) {
      await dropUceCurrentSchemaDisposable({
        targetDatabase: TARGET,
        adminConnectionString: admin,
      });
    }

    const created = await provisionUceCurrentSchema({
      targetDatabase: TARGET,
      adminConnectionString: admin,
    });
    expect(created.created).toBe(true);
    expect(created.database).toBe(TARGET);
    expect(created.currentDatabase).toBe(TARGET);
    expect(created.template).toBe('wekonnek_stage13b2_test');
    expect(created.template).not.toBe('wekonnek_stage12_test');

    const app = new Client({
      connectionString: rewriteDatabase(url, TARGET),
    });
    await app.connect();
    try {
      const live = await app.query<{ database: string; user: string }>(
        'SELECT current_database() AS database, current_user AS user',
      );
      expect(live.rows[0]?.database).toBe(TARGET);
      const tables = await app.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
        [REQUIRED_TABLES],
      );
      const have = new Set(tables.rows.map((r) => r.tablename));
      for (const t of REQUIRED_TABLES) {
        expect(have.has(t)).toBe(true);
      }
      const custodian = await app.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'order_fulfillments'
           AND column_name = 'physical_custodian_rider_id'`,
      );
      expect(custodian.rowCount).toBeGreaterThan(0);
      const successor = await app.query(
        `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'liability_determinations_one_child_per_parent'`,
      );
      expect(successor.rowCount).toBeGreaterThan(0);
      const uce2 = await app.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'rider_locations'
           AND column_name = 'wk_order_id'`,
      );
      expect(uce2.rowCount).toBe(0);
      const uce4 = await app.query(
        `SELECT to_regclass('public.customer_delivery_authorizations') AS reg`,
      );
      expect(uce4.rows[0]?.reg).toBeNull();
    } finally {
      await app.end();
    }

    await expect(
      provisionUceCurrentSchema({
        targetDatabase: TARGET,
        adminConnectionString: admin,
      }),
    ).rejects.toThrow(/already exists/);

    await dropUceCurrentSchemaDisposable({
      targetDatabase: TARGET,
      adminConnectionString: admin,
    });
    expect(await databaseExists(admin, TARGET)).toBe(false);
  });
});
