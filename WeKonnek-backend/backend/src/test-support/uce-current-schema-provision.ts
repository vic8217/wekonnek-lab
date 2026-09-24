/**
 * UCE-H1: provision recognized UCE disposable databases with Stage15C current
 * schema by cloning an accepted current-schema parent TEMPLATE, then applying
 * the existing post-template Prisma migrations.
 *
 * Distinct from historical Stage disposable names
 * (`isRecognizedCurrentSchemaDisposableName`). H0 naming/identity remains the
 * only UCE-name authority.
 *
 * Harness only. Does not change product runtime, Prisma schema, or migrations.
 */
import { Client } from 'pg';
import {
  ACCEPTANCE_ABSOLUTE_DENY_DATABASES,
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  isDestructiveAcceptanceOptIn,
  parseAcceptanceDatabaseUrl,
} from './acceptance-database';
import {
  HISTORICAL_ACCEPTANCE_DATABASES,
  STAGE13A_ACCEPTANCE_DATABASE,
  STAGE13B1_ACCEPTANCE_DATABASE,
  STAGE13B2_ACCEPTANCE_DATABASE,
  assertNotHistoricalAcceptanceDatabase,
  assertRecognizedUceDisposableName,
  assertUceDisposableIdentity,
  isRecognizedCurrentSchemaDisposableName,
} from './test-database-guard';
import {
  applyMissingPrismaMigrations,
  assertAdminConnectionIsLocal,
  quotePgIdent,
  rewriteDatabase,
} from './current-schema-disposable-provision';

/** Extra opt-in required to DROP an existing UCE disposable DB. */
export const UCE_RESET_OK_ENV = 'WEKONNEK_UCE_RESET_OK';

/**
 * UCE clones these parents only (newest first). Intentionally omits
 * wekonnek_stage12_test — quarantined as pristine Stage12 evidence, not a
 * UCE template.
 */
export const UCE_CURRENT_SCHEMA_TEMPLATE_CANDIDATES = [
  STAGE13B2_ACCEPTANCE_DATABASE,
  STAGE13B1_ACCEPTANCE_DATABASE,
  STAGE13A_ACCEPTANCE_DATABASE,
] as const;

export const UCE_FORBIDDEN_TEMPLATE_DATABASES = new Set([
  'postgres',
  'template0',
  'template1',
  'wekonnek_stage3_custody_uat',
  'wekonnek_stage12_test',
  'wekonnek_stage15c_cursor_config_final_test',
  ...HISTORICAL_ACCEPTANCE_DATABASES,
]);

export type UceProvisionResult = {
  database: string;
  template: string;
  created: boolean;
  appliedMigrations: string[];
  currentDatabase: string;
  currentUser: string;
};

export type UceSafeDiagnostics = {
  host: string | null;
  port: string;
  approvedDatabase: string;
  currentDatabase?: string;
  currentUser?: string;
};

export function isUceResetOptIn(): boolean {
  return process.env[UCE_RESET_OK_ENV] === '1';
}

export function selectUceCurrentSchemaTemplate(
  existingDatabases: Iterable<string>,
): string {
  const have = new Set(existingDatabases);
  for (const forbidden of UCE_FORBIDDEN_TEMPLATE_DATABASES) {
    if (
      (UCE_CURRENT_SCHEMA_TEMPLATE_CANDIDATES as readonly string[]).includes(
        forbidden,
      )
    ) {
      throw new Error(
        `provision refused: UCE template candidate ${forbidden} is forbidden`,
      );
    }
  }
  for (const candidate of UCE_CURRENT_SCHEMA_TEMPLATE_CANDIDATES) {
    if (UCE_FORBIDDEN_TEMPLATE_DATABASES.has(candidate)) continue;
    if (have.has(candidate)) return candidate;
  }
  throw new Error(
    'provision refused: no accepted UCE current-schema template parent exists ' +
      `(looked for ${UCE_CURRENT_SCHEMA_TEMPLATE_CANDIDATES.join(', ')}). ` +
      'Do not clone wekonnek_stage12_test, wekonnek_stage3_custody_uat, or ' +
      'wekonnek_stage15c_cursor_config_final_test.',
  );
}

export function uceSafeConnectionDiagnostics(
  connectionString: string,
  approvedDatabase: string,
  identity?: { database: string; user: string },
): UceSafeDiagnostics {
  const parsed = parseAcceptanceDatabaseUrl(connectionString);
  let port = '5432';
  try {
    const u = new URL(connectionString);
    if (u.port) port = u.port;
  } catch {
    /* parseAcceptanceDatabaseUrl already validated protocol */
  }
  return {
    host: parsed.host,
    port,
    approvedDatabase,
    currentDatabase: identity?.database,
    currentUser: identity?.user,
  };
}

export function assertUceProvisioningAllowed(
  database: string,
  approvedDatabase: string = database,
): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `uce provision refused: NODE_ENV=test is required (got ${process.env.NODE_ENV ?? '<unset>'})`,
    );
  }
  if (!isDestructiveAcceptanceOptIn()) {
    throw new Error(
      `uce provision refused: ${ACCEPTANCE_DESTRUCTIVE_OK_ENV}=1 is required`,
    );
  }
  if (database !== approvedDatabase) {
    throw new Error(
      `uce provision refused: requested ${database} does not match approved ${approvedDatabase}`,
    );
  }
  assertRecognizedUceDisposableName(database, 'uce provision');
  if (isRecognizedCurrentSchemaDisposableName(database)) {
    throw new Error(
      `uce provision refused: ${database} is a current-schema Stage name, not a UCE disposable`,
    );
  }
  assertNotHistoricalAcceptanceDatabase(database, 'uce provision');
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database)) {
    throw new Error(
      `uce provision refused: database ${database} is permanently forbidden`,
    );
  }
  if (UCE_FORBIDDEN_TEMPLATE_DATABASES.has(database)) {
    throw new Error(
      `uce provision refused: ${database} is a forbidden/quarantined identity`,
    );
  }
  if (
    (UCE_CURRENT_SCHEMA_TEMPLATE_CANDIDATES as readonly string[]).includes(
      database,
    )
  ) {
    throw new Error(
      `uce provision refused: ${database} is a canonical current-schema parent, not a UCE target`,
    );
  }
}

export function assertUceResetAllowed(
  database: string,
  approvedDatabase: string = database,
): void {
  assertUceProvisioningAllowed(database, approvedDatabase);
  if (!isUceResetOptIn()) {
    throw new Error(
      `uce drop refused: ${UCE_RESET_OK_ENV}=1 is required (UCE name recognition is not cleanup authority)`,
    );
  }
}

async function listDatabaseNames(client: Client): Promise<Set<string>> {
  const rows = await client.query<{ datname: string }>(
    'SELECT datname FROM pg_database',
  );
  return new Set(rows.rows.map((r) => r.datname));
}

async function readSessionIdentity(
  client: Client,
): Promise<{ database: string; user: string }> {
  const identity = await client.query<{ database: string; user: string }>(
    'SELECT current_database() AS database, current_user AS user',
  );
  const database = identity.rows[0]?.database;
  const user = identity.rows[0]?.user;
  if (!database || !user) {
    throw new Error(
      'uce provision refused: unable to read current_database()/current_user()',
    );
  }
  return { database, user };
}

export async function provisionUceCurrentSchema(input: {
  targetDatabase: string;
  approvedDatabase?: string;
  adminConnectionString: string;
}): Promise<UceProvisionResult> {
  const approved = input.approvedDatabase ?? input.targetDatabase;
  assertUceProvisioningAllowed(input.targetDatabase, approved);
  assertAdminConnectionIsLocal(input.adminConnectionString);
  parseAcceptanceDatabaseUrl(input.adminConnectionString);

  const admin = new Client({ connectionString: input.adminConnectionString });
  await admin.connect();
  try {
    const adminIdentity = await readSessionIdentity(admin);
    if (adminIdentity.database !== 'postgres') {
      throw new Error(
        `uce provision refused: admin session current_database()=${adminIdentity.database}`,
      );
    }

    const existing = await listDatabaseNames(admin);
    if (existing.has(input.targetDatabase)) {
      throw new Error(
        `uce provision refused: target ${input.targetDatabase} already exists; refuse to clobber (set ${UCE_RESET_OK_ENV}=1 and drop explicitly first)`,
      );
    }
    const template = selectUceCurrentSchemaTemplate(existing);
    if (UCE_FORBIDDEN_TEMPLATE_DATABASES.has(template)) {
      throw new Error(
        `uce provision refused: selected template ${template} is forbidden`,
      );
    }

    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [template],
    );
    await admin.query(
      `CREATE DATABASE ${quotePgIdent(input.targetDatabase)} TEMPLATE ${quotePgIdent(template)}`,
    );
    try {
      const targetUrl = rewriteDatabase(
        input.adminConnectionString,
        input.targetDatabase,
      );
      const appliedMigrations = await applyMissingPrismaMigrations({
        connectionString: targetUrl,
        expectedDatabase: input.targetDatabase,
      });
      const app = new Client({ connectionString: targetUrl });
      await app.connect();
      try {
        const live = await readSessionIdentity(app);
        assertUceDisposableIdentity(live, input.targetDatabase, 'uce provision');
        return {
          database: input.targetDatabase,
          template,
          created: true,
          appliedMigrations,
          currentDatabase: live.database,
          currentUser: live.user,
        };
      } finally {
        await app.end();
      }
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

export async function dropUceCurrentSchemaDisposable(input: {
  targetDatabase: string;
  approvedDatabase?: string;
  adminConnectionString: string;
}): Promise<void> {
  const approved = input.approvedDatabase ?? input.targetDatabase;
  assertUceResetAllowed(input.targetDatabase, approved);
  assertAdminConnectionIsLocal(input.adminConnectionString);
  const admin = new Client({ connectionString: input.adminConnectionString });
  await admin.connect();
  try {
    const adminIdentity = await readSessionIdentity(admin);
    if (adminIdentity.database !== 'postgres') {
      throw new Error(
        `uce drop refused: admin session current_database()=${adminIdentity.database}`,
      );
    }
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [input.targetDatabase],
    );
    await admin.query(
      `DROP DATABASE IF EXISTS ${quotePgIdent(input.targetDatabase)}`,
    );
  } finally {
    await admin.end();
  }
}
