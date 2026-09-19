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
 * Harness infrastructure only. Not product runtime. Not financial authority.
 */
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
};

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
    return {
      database: input.targetDatabase,
      template,
      created: true,
    };
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
