/**
 * Fail-closed provisioning of grammar-valid current-schema disposable DBs.
 *
 * Current schema is obtained by cloning an EXISTING canonical parent:
 *   wekonnek_stage13b2_test (preferred), else 13b1/13a/12 acceptance DBs.
 *
 * This does NOT:
 * - derive TEMPLATE wekonnek_stage{token}_test from the target name
 * - require wekonnek_stage13b3_test
 * - run the historical Prisma migration chain on an empty database
 * - clone historical Stage5B/Stage6 DBs
 *
 * Stage13B-3A/3B added no Prisma schema change, so Stage13B-2 IS current schema.
 *
 * After TEMPLATE clone, missing Prisma migrations from the repository are
 * applied automatically (Stage14A / Stage15A / Stage15C, …). No operator
 * manual SQL patch. Incompatible SQL fails the provision (then the new DB
 * is dropped).
 *
 * Harness infrastructure only. Not product runtime. Not financial authority.
 */
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import {
  ACCEPTANCE_ABSOLUTE_DENY_DATABASES,
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  assertSafeLocalAcceptanceHost,
  isDestructiveAcceptanceOptIn,
  parseAcceptanceDatabaseUrl,
} from './acceptance-database';
import {
  HISTORICAL_ACCEPTANCE_DATABASES,
  STAGE12_ACCEPTANCE_DATABASE,
  STAGE13A_ACCEPTANCE_DATABASE,
  STAGE13B1_ACCEPTANCE_DATABASE,
  STAGE13B2_ACCEPTANCE_DATABASE,
  assertNotHistoricalAcceptanceDatabase,
  isRecognizedCurrentSchemaDisposableName,
} from './test-database-guard';

/**
 * Canonical current-schema parents that MAY be used as PostgreSQL TEMPLATE.
 * Newest first. Intentionally omits wekonnek_stage13b3_test — that name is
 * not maintained infrastructure and must not become a hidden dependency.
 */
export const CURRENT_SCHEMA_PROVISION_TEMPLATE_CANDIDATES = [
  STAGE13B2_ACCEPTANCE_DATABASE,
  STAGE13B1_ACCEPTANCE_DATABASE,
  STAGE13A_ACCEPTANCE_DATABASE,
  STAGE12_ACCEPTANCE_DATABASE,
] as const;

const SAFE_IDENT_RE = /^[a-z][a-z0-9_]*$/;

export type CurrentSchemaProvisionResult = {
  database: string;
  template: string;
  created: boolean;
  appliedMigrations: string[];
};

export const CURRENT_SCHEMA_POST_TEMPLATE_MIGRATION_PROBES: Record<
  string,
  string
> = {
  '20260919120000_stage14a_financial_reconciliation_review':
    `SELECT 1 AS ok FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'financial_reconciliation_reviews'`,
  '20260921120000_stage15a_trusted_evidence_provenance':
    `SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'exception_claim_evidence' AND column_name = 'provenance'`,
  '20260921200000_stage15c_successor_chain_authority':
    `SELECT 1 AS ok FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'liability_determinations_one_child_per_parent'`,
  '20260922060000_uce2_canonical_rider_location':
    `SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'rider_locations' AND column_name = 'wk_order_id'`,
  '20260925120000_uce4_delivery_recipient_authorization':
    `SELECT 1 AS ok FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'customer_delivery_authorizations_one_active_per_fulfillment'`,
};

const POST_TEMPLATE_MIGRATION_FLOOR = '20260919120000';

export const PRISMA_MIGRATIONS_DIR = join(
  __dirname,
  '../../prisma/migrations',
);

export function quotePgIdent(name: string): string {
  if (!SAFE_IDENT_RE.test(name)) {
    throw new Error(
      `provision refused: identifier ${name} is not a safe PostgreSQL unquoted ident`,
    );
  }
  return `"${name}"`;
}

export function selectCurrentSchemaTemplate(
  existingDatabases: Iterable<string>,
): string {
  const have = new Set(existingDatabases);
  for (const candidate of CURRENT_SCHEMA_PROVISION_TEMPLATE_CANDIDATES) {
    if (have.has(candidate)) return candidate;
  }
  throw new Error(
    'provision refused: no canonical current-schema template parent exists ' +
      `(looked for ${CURRENT_SCHEMA_PROVISION_TEMPLATE_CANDIDATES.join(', ')}). ` +
      'Do not derive wekonnek_stage{token}_test from the target name, and do not ' +
      'create wekonnek_stage13b3_test as infrastructure.',
  );
}

export function adminUrlFrom(url: string): string {
  return url
    .replace(/\/[^/?]+(\?|$)/, '/postgres$1')
    .replace(/[?&]sslmode=[^&]*/g, '');
}

export function rewriteDatabase(url: string, database: string): string {
  return url.replace(/\/[^/?]+(\?|$)/, `/${database}$1`);
}

export function assertCurrentSchemaProvisionTarget(database: string): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `provision refused: NODE_ENV=test is required (got ${process.env.NODE_ENV ?? '<unset>'})`,
    );
  }
  if (!isDestructiveAcceptanceOptIn()) {
    throw new Error(
      `provision refused: ${ACCEPTANCE_DESTRUCTIVE_OK_ENV}=1 is required`,
    );
  }
  assertNotHistoricalAcceptanceDatabase(database, 'provision');
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database)) {
    throw new Error(
      `provision refused: database ${database} is permanently forbidden`,
    );
  }
  if (HISTORICAL_ACCEPTANCE_DATABASES.has(database)) {
    throw new Error(
      `provision refused: historical database ${database} must not be provisioned`,
    );
  }
  if (
    (CURRENT_SCHEMA_PROVISION_TEMPLATE_CANDIDATES as readonly string[]).includes(
      database,
    )
  ) {
    throw new Error(
      `provision refused: ${database} is a canonical current-schema parent, not a disposable provision target`,
    );
  }
  if (!isRecognizedCurrentSchemaDisposableName(database)) {
    throw new Error(
      `provision refused: ${database} is not a recognized current-schema disposable name`,
    );
  }
}

export function assertAdminConnectionIsLocal(adminConnectionString: string): void {
  const parsed = parseAcceptanceDatabaseUrl(adminConnectionString);
  assertSafeLocalAcceptanceHost(parsed, 'provision');
  if (parsed.database !== 'postgres') {
    throw new Error(
      `provision refused: admin connection must target database postgres (got ${parsed.database})`,
    );
  }
}

export function listPrismaMigrationNames(
  migrationsDir: string = PRISMA_MIGRATIONS_DIR,
): string[] {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .filter((name) => /^\d{14}_[a-z0-9_]+$/i.test(name))
    .sort();
}

async function applyOneMigration(
  client: Client,
  dir: string,
  name: string,
  recordInPrismaTable: boolean,
): Promise<void> {
  const sqlPath = join(dir, name, 'migration.sql');
  if (!existsSync(sqlPath)) {
    throw new Error(`provision refused: missing migration.sql for ${name}`);
  }
  const sql = readFileSync(sqlPath, 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    if (recordInPrismaTable) {
      const checksum = createHash('sha256').update(sql).digest('hex');
      await client.query(
        `INSERT INTO "_prisma_migrations" (
           id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count
         ) VALUES (gen_random_uuid()::text, $1, NOW(), $2, NULL, NULL, NOW(), 1)`,
        [checksum, name],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* session may already be aborted */
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`provision refused: applying ${name} failed: ${message}`);
  }
}

export async function applyMissingPrismaMigrations(input: {
  connectionString: string;
  migrationsDir?: string;
  expectedDatabase: string;
}): Promise<string[]> {
  const dir = input.migrationsDir ?? PRISMA_MIGRATIONS_DIR;
  const names = listPrismaMigrationNames(dir);
  const client = new Client({ connectionString: input.connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    const identity = await client.query<{ database: string }>(
      'SELECT current_database() AS database',
    );
    const database = identity.rows[0]?.database;
    if (database !== input.expectedDatabase) {
      throw new Error(
        `provision refused: migration session current_database()=${database} expected ${input.expectedDatabase}`,
      );
    }
    const table = await client.query<{ reg: string | null }>(
      `SELECT to_regclass('public._prisma_migrations') AS reg`,
    );
    const hasMigrationsTable = table.rows[0]?.reg != null;
    if (hasMigrationsTable) {
      const have = await client.query<{ migration_name: string }>(
        'SELECT migration_name FROM "_prisma_migrations"',
      );
      const present = new Set(have.rows.map((r) => r.migration_name));
      if (present.size === 0) {
        throw new Error(
          'provision refused: _prisma_migrations is empty; refuse to replay the full historical chain',
        );
      }
      let maxApplied = '00000000000000';
      for (const name of present) {
        const ts = name.slice(0, 14);
        if (/^\d{14}$/.test(ts) && ts > maxApplied) maxApplied = ts;
      }
      for (const name of names) {
        if (present.has(name)) continue;
        const ts = name.slice(0, 14);
        if (ts <= maxApplied) {
          throw new Error(
            `provision refused: ${name} is absent from _prisma_migrations but is not after latest applied ${maxApplied}`,
          );
        }
        await applyOneMigration(client, dir, name, true);
        applied.push(name);
        present.add(name);
      }
      return applied;
    }

    const postTemplate = names.filter(
      (name) => name.slice(0, 14) >= POST_TEMPLATE_MIGRATION_FLOOR,
    );
    for (const name of postTemplate) {
      const probe = CURRENT_SCHEMA_POST_TEMPLATE_MIGRATION_PROBES[name];
      if (!probe) {
        throw new Error(
          `provision refused: ${name} has no schema probe and _prisma_migrations is absent`,
        );
      }
      const already = await client.query(probe);
      if ((already.rowCount ?? 0) > 0) continue;
      await applyOneMigration(client, dir, name, false);
      applied.push(name);
    }
    return applied;
  } finally {
    await client.end();
  }
}

async function listDatabaseNames(client: Client): Promise<Set<string>> {
  const rows = await client.query<{ datname: string }>(
    'SELECT datname FROM pg_database',
  );
  return new Set(rows.rows.map((r) => r.datname));
}

export async function provisionCurrentSchemaDisposable(input: {
  targetDatabase: string;
  adminConnectionString: string;
}): Promise<CurrentSchemaProvisionResult> {
  assertCurrentSchemaProvisionTarget(input.targetDatabase);
  assertAdminConnectionIsLocal(input.adminConnectionString);

  const admin = new Client({ connectionString: input.adminConnectionString });
  await admin.connect();
  try {
    const identity = await admin.query<{
      database: string;
      user: string;
    }>('SELECT current_database() AS database, current_user AS user');
    if (identity.rows[0]?.database !== 'postgres') {
      throw new Error(
        `provision refused: admin session current_database()=${identity.rows[0]?.database}`,
      );
    }

    const existing = await listDatabaseNames(admin);
    if (existing.has(input.targetDatabase)) {
      throw new Error(
        `provision refused: target ${input.targetDatabase} already exists; refuse to clobber`,
      );
    }
    const template = selectCurrentSchemaTemplate(existing);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [template],
    );
    await admin.query(
      `CREATE DATABASE ${quotePgIdent(input.targetDatabase)} TEMPLATE ${quotePgIdent(template)}`,
    );
    try {
      const appliedMigrations = await applyMissingPrismaMigrations({
        connectionString: rewriteDatabase(
          input.adminConnectionString,
          input.targetDatabase,
        ),
        expectedDatabase: input.targetDatabase,
      });
      return {
        database: input.targetDatabase,
        template,
        created: true,
        appliedMigrations,
      };
    } catch (err) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [input.targetDatabase],
      );
      await admin.query(
        `DROP DATABASE IF EXISTS ${quotePgIdent(input.targetDatabase)}`,
      );
      throw err;
    }
  } finally {
    await admin.end();
  }
}

export async function dropCurrentSchemaDisposable(input: {
  targetDatabase: string;
  adminConnectionString: string;
}): Promise<void> {
  assertCurrentSchemaProvisionTarget(input.targetDatabase);
  assertAdminConnectionIsLocal(input.adminConnectionString);
  const admin = new Client({ connectionString: input.adminConnectionString });
  await admin.connect();
  try {
    const identity = await admin.query<{ database: string }>(
      'SELECT current_database() AS database',
    );
    if (identity.rows[0]?.database !== 'postgres') {
      throw new Error(
        `drop refused: admin session current_database()=${identity.rows[0]?.database}`,
      );
    }
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [input.targetDatabase],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${quotePgIdent(input.targetDatabase)}`);
  } finally {
    await admin.end();
  }
}

export async function databaseExists(
  adminConnectionString: string,
  database: string,
): Promise<boolean> {
  assertAdminConnectionIsLocal(adminConnectionString);
  const admin = new Client({ connectionString: adminConnectionString });
  await admin.connect();
  try {
    const rows = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database],
    );
    return (rows.rowCount ?? 0) > 0;
  } finally {
    await admin.end();
  }
}
