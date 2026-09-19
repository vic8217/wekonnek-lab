/**
 * Stage 12 / 13A acceptance harness — disposable database override & safety.
 *
 * ACCEPTANCE INFRASTRUCTURE ONLY. Not used by product runtime.
 *
 * Canonical override:
 *   WEKONNEK_ACCEPTANCE_DATABASE_URL=postgresql://…/wekonnek_stage13a_terra_…
 *   WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1
 *
 * The override is snapshotted before dotenv and re-applied after so
 * `.env.stage13a.test` / `.env.stage12.test` cannot silently replace Terra's
 * disposable target.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  HISTORICAL_ACCEPTANCE_DATABASES,
  STAGE10_ACCEPTANCE_DATABASE,
  STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE11_ACCEPTANCE_DATABASE,
  STAGE11_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE12_ACCEPTANCE_DATABASE,
  STAGE12_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE12_FORBIDDEN_DATABASES,
  STAGE13A_ACCEPTANCE_DATABASE,
  STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE13A_FORBIDDEN_DATABASES,
  STAGE13B1_ACCEPTANCE_DATABASE,
  STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE13B1_FORBIDDEN_DATABASES,
  STAGE7_ACCEPTANCE_DATABASE,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE8_ACCEPTANCE_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE9_ACCEPTANCE_DATABASE,
  STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE,
  isCurrentSchemaRegressionMode,
  isStage12TerraDisposableDatabase,
  isStage13aTerraDisposableDatabase,
  isStage13b1EphemeralDisposableDatabase,
  isStage13b1TerraDisposableDatabase,
} from './test-database-guard';

export const ACCEPTANCE_DATABASE_URL_ENV = 'WEKONNEK_ACCEPTANCE_DATABASE_URL';
export const ACCEPTANCE_DESTRUCTIVE_OK_ENV = 'WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK';

/** Absolute deny list — never mutate, even if named like a test DB. */
export const ACCEPTANCE_ABSOLUTE_DENY_DATABASES = new Set([
  '',
  'postgres',
  'template0',
  'template1',
  'wekonnek',
  'wekonnek_prod',
  'wekonnek_production',
  'wekonnek_dev',
  'wekonnek_development',
  'wekonnek_lab',
  ...HISTORICAL_ACCEPTANCE_DATABASES,
  ...STAGE12_FORBIDDEN_DATABASES,
  STAGE7_ACCEPTANCE_DATABASE,
  STAGE8_ACCEPTANCE_DATABASE,
  STAGE9_ACCEPTANCE_DATABASE,
  STAGE10_ACCEPTANCE_DATABASE,
  STAGE11_ACCEPTANCE_DATABASE,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE11_CURRENT_SCHEMA_REGRESSION_DATABASE,
]);

/** Canonical shared Stage 12 disposable DBs (Cursor default workflow). */
export const STAGE12_CANONICAL_DISPOSABLE_DATABASES = new Set([
  STAGE12_ACCEPTANCE_DATABASE,
  STAGE12_CURRENT_SCHEMA_REGRESSION_DATABASE,
]);

/** Canonical shared Stage 13A disposable DBs (Cursor default workflow). */
export const STAGE13A_CANONICAL_DISPOSABLE_DATABASES = new Set([
  STAGE13A_ACCEPTANCE_DATABASE,
  STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE,
]);

/** Canonical shared Stage 13B-1 disposable DBs (Cursor default workflow). */
export const STAGE13B1_CANONICAL_DISPOSABLE_DATABASES = new Set([
  STAGE13B1_ACCEPTANCE_DATABASE,
  STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE,
]);

export type AcceptanceDatabaseParseResult = {
  database: string;
  /** Redacted URL safe for diagnostics (password stripped). */
  redactedUrl: string;
  host: string | null;
};

export function redactDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<unparseable-database-url>';
  }
}

export function parseAcceptanceDatabaseUrl(
  url: string,
): AcceptanceDatabaseParseResult {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error(
      `${ACCEPTANCE_DATABASE_URL_ENV} is empty; refuse to guess a database`,
    );
  }
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    throw new Error(
      `${ACCEPTANCE_DATABASE_URL_ENV} is malformed; refuse to connect (${redactDatabaseUrl(trimmed)})`,
    );
  }
  if (u.protocol !== 'postgresql:' && u.protocol !== 'postgres:') {
    throw new Error(
      `${ACCEPTANCE_DATABASE_URL_ENV} must use postgresql:// (got ${u.protocol})`,
    );
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, '')).trim();
  if (!database) {
    throw new Error(
      `${ACCEPTANCE_DATABASE_URL_ENV} has no database name in path; refuse to connect`,
    );
  }
  return {
    database,
    redactedUrl: redactDatabaseUrl(trimmed),
    host: u.hostname || u.searchParams.get('host') || null,
  };
}

const LOCAL_ACCEPTANCE_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
]);

/** Local PostgreSQL only — unix sockets and loopback. Remote hosts fail closed. */
export function isSafeLocalAcceptanceHost(host: string | null): boolean {
  if (host == null || host === '') return true;
  const normalized = host.toLowerCase();
  if (LOCAL_ACCEPTANCE_HOSTS.has(normalized)) return true;
  if (normalized.startsWith('/')) return true;
  return false;
}

export function assertSafeLocalAcceptanceHost(
  parsed: AcceptanceDatabaseParseResult,
  operation: string,
): void {
  if (!isSafeLocalAcceptanceHost(parsed.host)) {
    throw new Error(
      `${operation} refused: host ${parsed.host} is not a local PostgreSQL target`,
    );
  }
}

export function isDestructiveAcceptanceOptIn(): boolean {
  return process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] === '1';
}

export {
  isStage12TerraDisposableDatabase,
  isStage13aTerraDisposableDatabase,
  isStage13b1EphemeralDisposableDatabase,
  isStage13b1TerraDisposableDatabase,
};

export function isStage13aDisposableAcceptanceDatabase(
  database: string,
): boolean {
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database)) return false;
  if (STAGE13A_FORBIDDEN_DATABASES.has(database)) return false;
  if (STAGE13A_CANONICAL_DISPOSABLE_DATABASES.has(database)) return true;
  if (isStage13aTerraDisposableDatabase(database)) return true;
  return false;
}

export function isStage13b1DisposableAcceptanceDatabase(
  database: string,
): boolean {
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database)) return false;
  if (STAGE13B1_FORBIDDEN_DATABASES.has(database)) return false;
  if (STAGE13B1_CANONICAL_DISPOSABLE_DATABASES.has(database)) return true;
  if (isStage13b1EphemeralDisposableDatabase(database)) return true;
  // Schema-identical living tip — current-schema regression only.
  if (database === STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE) return true;
  return false;
}

/**
 * Stage 12 disposable gate — also admits Stage 13A canonical + ephemeral DBs.
 * Does NOT admit Stage 13B-1 names: those are current-schema-only (see
 * isCurrentSchemaDisposableDatabase). Historical Stage 12 acceptance stays
 * bound to Stage 12/13A disposable identities.
 */
export function isStage12DisposableAcceptanceDatabase(database: string): boolean {
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database)) return false;
  if (STAGE12_CANONICAL_DISPOSABLE_DATABASES.has(database)) return true;
  if (isStage12TerraDisposableDatabase(database)) return true;
  if (STAGE13A_CANONICAL_DISPOSABLE_DATABASES.has(database)) return true;
  if (isStage13aTerraDisposableDatabase(database)) return true;
  return false;
}

/**
 * Centralized current-schema regression identity: Stage 12 / 13A / 13B-1
 * canonical disposable names plus narrow ephemeral slot names.
 * Not a wekonnek_* wildcard.
 */
export function isCurrentSchemaDisposableDatabase(database: string): boolean {
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database)) return false;
  if (isStage12DisposableAcceptanceDatabase(database)) return true;
  if (isStage13b1DisposableAcceptanceDatabase(database)) return true;
  return false;
}

/**
 * Fail-closed gate before destructive acceptance work.
 * Requires approved disposable naming AND destructive opt-in.
 */
export function assertSafeStage12AcceptanceDatabase(
  database: string,
  operation: string,
): void {
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database)) {
    throw new Error(
      `${operation} refused: database ${database} is permanently forbidden for Stage 12 destructive acceptance`,
    );
  }
  if (!isStage12DisposableAcceptanceDatabase(database)) {
    throw new Error(
      `${operation} refused: database ${database} is not an approved Stage 12 disposable acceptance target ` +
        `(allowed: ${STAGE12_ACCEPTANCE_DATABASE}, ${STAGE12_CURRENT_SCHEMA_REGRESSION_DATABASE}, wekonnek_stage12_(terra|cursor)_*, ` +
        `${STAGE13A_ACCEPTANCE_DATABASE}, ${STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE}, wekonnek_stage13a_(terra|cursor)_*)`,
    );
  }
  if (!isDestructiveAcceptanceOptIn()) {
    throw new Error(
      `${operation} refused: ${ACCEPTANCE_DESTRUCTIVE_OK_ENV}=1 is required for destructive Stage 12 acceptance against ${database}`,
    );
  }
}

/**
 * Fail-closed Stage 13A gate — Stage 0–12 historical/acceptance DBs are denied.
 */
export function assertSafeStage13aAcceptanceDatabase(
  database: string,
  operation: string,
): void {
  if (
    ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database) ||
    STAGE13A_FORBIDDEN_DATABASES.has(database)
  ) {
    throw new Error(
      `${operation} refused: database ${database} is permanently forbidden for Stage 13A destructive acceptance`,
    );
  }
  if (!isStage13aDisposableAcceptanceDatabase(database)) {
    throw new Error(
      `${operation} refused: database ${database} is not an approved Stage 13A disposable acceptance target ` +
        `(allowed: ${STAGE13A_ACCEPTANCE_DATABASE}, ${STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE}, wekonnek_stage13a_(terra|cursor)_*)`,
    );
  }
  if (!isDestructiveAcceptanceOptIn()) {
    throw new Error(
      `${operation} refused: ${ACCEPTANCE_DESTRUCTIVE_OK_ENV}=1 is required for destructive Stage 13A acceptance against ${database}`,
    );
  }
}

/**
 * Fail-closed Stage 13B-1 gate — frozen Stage13A acceptance and earlier DBs denied.
 */
export function assertSafeStage13b1AcceptanceDatabase(
  database: string,
  operation: string,
): void {
  if (
    ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database) ||
    STAGE13B1_FORBIDDEN_DATABASES.has(database)
  ) {
    throw new Error(
      `${operation} refused: database ${database} is permanently forbidden for Stage 13B-1 destructive acceptance`,
    );
  }
  if (!isStage13b1DisposableAcceptanceDatabase(database)) {
    throw new Error(
      `${operation} refused: database ${database} is not an approved Stage 13B-1 disposable acceptance target ` +
        `(allowed: ${STAGE13B1_ACCEPTANCE_DATABASE}, ${STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE}, wekonnek_stage13b1_<slot>_(test|regression), ${STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE})`,
    );
  }
  if (!isDestructiveAcceptanceOptIn()) {
    throw new Error(
      `${operation} refused: ${ACCEPTANCE_DESTRUCTIVE_OK_ENV}=1 is required for destructive Stage 13B-1 acceptance against ${database}`,
    );
  }
}

/**
 * Fail-closed current-schema regression gate.
 * Requires explicit flag, NODE_ENV=test, approved disposable naming, and
 * destructive opt-in. Does not weaken historical Stage 12/13A gates.
 */
export function assertSafeCurrentSchemaRegressionDatabase(
  database: string,
  operation: string,
): void {
  if (!isCurrentSchemaRegressionMode()) {
    throw new Error(
      `${operation} refused: WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 is required for current-schema regression targeting`,
    );
  }
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `${operation} refused: NODE_ENV=test is required for current-schema regression (got ${process.env.NODE_ENV ?? '<unset>'})`,
    );
  }
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database)) {
    throw new Error(
      `${operation} refused: database ${database} is permanently forbidden for current-schema regression`,
    );
  }
  if (!isCurrentSchemaDisposableDatabase(database)) {
    throw new Error(
      `${operation} refused: database ${database} is not an approved current-schema disposable target ` +
        `(allowed: Stage12/13A/13B-1 canonical names or wekonnek_stage12_(terra|cursor)_* / wekonnek_stage13a_(terra|cursor)_* / wekonnek_stage13b1_<slot>_(test|regression))`,
    );
  }
  if (!isDestructiveAcceptanceOptIn()) {
    throw new Error(
      `${operation} refused: ${ACCEPTANCE_DESTRUCTIVE_OK_ENV}=1 is required for current-schema regression against ${database}`,
    );
  }
}

/** Alias for shared vocabulary in legacy suite normalization. */
export const assertSafeDisposableAcceptanceDatabase =
  assertSafeStage12AcceptanceDatabase;

export function getAcceptanceDatabaseTarget(): string {
  return resolveStage12ExpectedDatabase();
}

export function redactedConnectionDescription(
  url: string | null | undefined = process.env.DATABASE_URL,
): string {
  if (!url) return '<no-database-url>';
  try {
    const parsed = parseAcceptanceDatabaseUrl(url);
    const host = parsed.host ?? 'unknown-host';
    return `database=${parsed.database} host=${host} url=${parsed.redactedUrl}`;
  } catch {
    return `url=${redactDatabaseUrl(url)}`;
  }
}

/**
 * Current-schema regression target: explicit override, else tip disposable DB.
 * Requires WEKONNEK_CURRENT_SCHEMA_REGRESSION=1.
 */
export function assertCurrentSchemaRegressionDatabase(
  database: string,
  operation: string,
): string {
  const expected = resolveStage12ExpectedDatabase();
  assertSafeCurrentSchemaRegressionDatabase(expected, operation);
  if (database !== expected) {
    throw new Error(
      `${operation} refused: current_database=${database} does not match current-schema target ${expected}`,
    );
  }
  return expected;
}

export function assertHistoricalStageDatabase(
  database: string,
  opts: {
    label: string;
    historicalDatabases: readonly string[] | ReadonlySet<string>;
    historicalUsers?: ReadonlySet<string>;
    user?: string;
  },
): void {
  if (isCurrentSchemaRegressionMode()) {
    throw new Error(
      `${opts.label}: assertHistoricalStageDatabase called while WEKONNEK_CURRENT_SCHEMA_REGRESSION=1; use current-schema guard instead`,
    );
  }
  const allowed = new Set(
    Array.isArray(opts.historicalDatabases)
      ? opts.historicalDatabases
      : [...opts.historicalDatabases],
  );
  if (!allowed.has(database)) {
    throw new Error(
      `${opts.label} historical acceptance requires database in {${[...allowed].join(', ')}}; got database=${database}` +
        (opts.user ? ` user=${opts.user}` : ''),
    );
  }
  if (opts.historicalUsers && opts.user && !opts.historicalUsers.has(opts.user)) {
    throw new Error(
      `${opts.label} historical acceptance requires user in {${[...opts.historicalUsers].join(', ')}}; got database=${database} user=${opts.user}`,
    );
  }
}

/**
 * Single entry for Stage0–11 postgres suites:
 * - historical mode → enforce stage-specific DB identity
 * - current-schema mode → centralized disposable acceptance target
 *   (override or tip regression DB) with actual current_database() check
 */
export async function assertLegacyPostgresSuiteIdentity(
  prisma: PrismaService,
  opts: {
    label: string;
    historicalDatabases: readonly string[] | ReadonlySet<string>;
    historicalUsers?: ReadonlySet<string>;
  },
): Promise<{ database: string; user: string; mode: 'historical' | 'current-schema' }> {
  const rows = await prisma.$queryRaw<
    Array<{ database: string; user: string }>
  >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
  const database = rows[0]?.database;
  const user = rows[0]?.user;
  if (!database || !user) {
    throw new Error(
      `${opts.label}: unable to resolve current_database()/current_user()`,
    );
  }

  if (isCurrentSchemaRegressionMode()) {
    const expected = resolveStage12ExpectedDatabase();
    assertSafeCurrentSchemaRegressionDatabase(expected, opts.label);
    if (process.env.DATABASE_URL) {
      const parsed = parseAcceptanceDatabaseUrl(process.env.DATABASE_URL);
      assertSafeLocalAcceptanceHost(parsed, opts.label);
    }
    if (database !== expected) {
      throw new Error(
        `${opts.label} current-schema regression requires ${expected}; got database=${database} user=${user}`,
      );
    }
    const allowedUsers = stage12AllowedDbUsers(expected);
    if (!allowedUsers.has(user)) {
      throw new Error(
        `${opts.label} current-schema regression requires user in {${[...allowedUsers].join(', ')}}; got database=${database} user=${user}`,
      );
    }
    return { database, user, mode: 'current-schema' };
  }

  assertHistoricalStageDatabase(database, {
    label: opts.label,
    historicalDatabases: opts.historicalDatabases,
    historicalUsers: opts.historicalUsers,
    user,
  });
  return { database, user, mode: 'historical' };
}

export async function verifyActualDatabaseIdentity(
  prisma: PrismaService,
  expectedDatabase: string,
  label: string,
): Promise<{ database: string; user: string }> {
  return assertPrismaConnectedToStage12AcceptanceDb(
    prisma,
    expectedDatabase,
    label,
  );
}

export function getExplicitAcceptanceDatabaseUrl(): string | null {
  const raw = process.env[ACCEPTANCE_DATABASE_URL_ENV];
  if (raw == null || raw.trim() === '') return null;
  return raw.trim();
}

/**
 * Apply WEKONNEK_ACCEPTANCE_DATABASE_URL → process.env.DATABASE_URL after
 * validating the target. Fail closed on malformed / forbidden targets.
 * Returns the validated database name, or null when no override is set.
 */
export function applyAcceptanceDatabaseOverride(): string | null {
  const override = getExplicitAcceptanceDatabaseUrl();
  if (!override) return null;
  const parsed = parseAcceptanceDatabaseUrl(override);
  assertSafeLocalAcceptanceHost(parsed, 'acceptance database override');
  if (isCurrentSchemaRegressionMode()) {
    assertSafeCurrentSchemaRegressionDatabase(
      parsed.database,
      'acceptance database override',
    );
  } else if (
    STAGE13B1_CANONICAL_DISPOSABLE_DATABASES.has(parsed.database) ||
    isStage13b1EphemeralDisposableDatabase(parsed.database)
  ) {
    assertSafeStage13b1AcceptanceDatabase(
      parsed.database,
      'acceptance database override',
    );
  } else if (
    STAGE13A_CANONICAL_DISPOSABLE_DATABASES.has(parsed.database) ||
    isStage13aTerraDisposableDatabase(parsed.database)
  ) {
    assertSafeStage13aAcceptanceDatabase(
      parsed.database,
      'acceptance database override',
    );
  } else {
    assertSafeStage12AcceptanceDatabase(
      parsed.database,
      'acceptance database override',
    );
  }
  process.env.DATABASE_URL = override;
  return parsed.database;
}

/**
 * Snapshot override env vars before dotenv so they can be restored afterward.
 */
export function snapshotAcceptanceOverrideEnv(): {
  url: string | undefined;
  destructive: string | undefined;
} {
  return {
    url: process.env[ACCEPTANCE_DATABASE_URL_ENV],
    destructive: process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV],
  };
}

export function restoreAcceptanceOverrideEnv(snap: {
  url: string | undefined;
  destructive: string | undefined;
}): void {
  if (snap.url !== undefined) {
    process.env[ACCEPTANCE_DATABASE_URL_ENV] = snap.url;
  } else {
    delete process.env[ACCEPTANCE_DATABASE_URL_ENV];
  }
  if (snap.destructive !== undefined) {
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = snap.destructive;
  } else {
    delete process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV];
  }
}

/**
 * Current-schema tip: prefer DATABASE_URL when it already names an approved
 * current-schema disposable DB (Stage13B-1 / 13A / 12), else Stage13A regression.
 */
function resolveCurrentSchemaTipDatabase(operation: string): string {
  const url = process.env.DATABASE_URL;
  if (url) {
    let parsed: AcceptanceDatabaseParseResult | null = null;
    try {
      parsed = parseAcceptanceDatabaseUrl(url);
    } catch {
      parsed = null;
    }
    if (parsed && isCurrentSchemaDisposableDatabase(parsed.database)) {
      assertSafeLocalAcceptanceHost(parsed, operation);
      assertSafeCurrentSchemaRegressionDatabase(parsed.database, operation);
      return parsed.database;
    }
  }
  assertSafeCurrentSchemaRegressionDatabase(
    STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE,
    operation,
  );
  return STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE;
}

/**
 * Expected Stage 12 suite database: explicit override wins, else tip
 * regression DB when in current-schema mode, else shared Stage 12 acceptance.
 */
export function resolveStage12ExpectedDatabase(): string {
  const override = getExplicitAcceptanceDatabaseUrl();
  if (override) {
    const parsed = parseAcceptanceDatabaseUrl(override);
    assertSafeLocalAcceptanceHost(parsed, 'resolveStage12ExpectedDatabase');
    if (isCurrentSchemaRegressionMode()) {
      assertSafeCurrentSchemaRegressionDatabase(
        parsed.database,
        'resolveStage12ExpectedDatabase',
      );
    } else {
      assertSafeStage12AcceptanceDatabase(
        parsed.database,
        'resolveStage12ExpectedDatabase',
      );
    }
    return parsed.database;
  }
  if (isCurrentSchemaRegressionMode()) {
    return resolveCurrentSchemaTipDatabase('resolveStage12ExpectedDatabase');
  }
  return STAGE12_ACCEPTANCE_DATABASE;
}

/**
 * Expected Stage 13A suite database: explicit override wins, else current-schema
 * tip, else shared acceptance DB.
 */
export function resolveStage13aExpectedDatabase(): string {
  const override = getExplicitAcceptanceDatabaseUrl();
  if (override) {
    const parsed = parseAcceptanceDatabaseUrl(override);
    assertSafeLocalAcceptanceHost(parsed, 'resolveStage13aExpectedDatabase');
    if (isCurrentSchemaRegressionMode()) {
      assertSafeCurrentSchemaRegressionDatabase(
        parsed.database,
        'resolveStage13aExpectedDatabase',
      );
    } else {
      assertSafeStage13aAcceptanceDatabase(
        parsed.database,
        'resolveStage13aExpectedDatabase',
      );
    }
    return parsed.database;
  }
  if (isCurrentSchemaRegressionMode()) {
    return resolveCurrentSchemaTipDatabase('resolveStage13aExpectedDatabase');
  }
  return STAGE13A_ACCEPTANCE_DATABASE;
}

/**
 * Expected Stage 13B-1 suite database: explicit override wins, else current-schema
 * living tip (Stage13A regression, schema-identical), else shared 13B-1 acceptance.
 */
export function resolveStage13b1ExpectedDatabase(): string {
  const override = getExplicitAcceptanceDatabaseUrl();
  if (override) {
    const parsed = parseAcceptanceDatabaseUrl(override);
    assertSafeLocalAcceptanceHost(parsed, 'resolveStage13b1ExpectedDatabase');
    if (isCurrentSchemaRegressionMode()) {
      assertSafeCurrentSchemaRegressionDatabase(
        parsed.database,
        'resolveStage13b1ExpectedDatabase',
      );
    } else {
      assertSafeStage13b1AcceptanceDatabase(
        parsed.database,
        'resolveStage13b1ExpectedDatabase',
      );
    }
    return parsed.database;
  }
  if (isCurrentSchemaRegressionMode()) {
    return resolveCurrentSchemaTipDatabase('resolveStage13b1ExpectedDatabase');
  }
  return STAGE13B1_ACCEPTANCE_DATABASE;
}

/** Users permitted to run Stage 12 acceptance against the expected DB. */
export function stage12AllowedDbUsers(expectedDatabase: string): Set<string> {
  return new Set(['victor', expectedDatabase]);
}

/** Users permitted to run Stage 13A acceptance against the expected DB. */
export function stage13aAllowedDbUsers(expectedDatabase: string): Set<string> {
  return new Set(['victor', expectedDatabase]);
}

/** Users permitted to run Stage 13B-1 acceptance against the expected DB. */
export function stage13b1AllowedDbUsers(expectedDatabase: string): Set<string> {
  return new Set(['victor', expectedDatabase]);
}

/**
 * Connect via Prisma and prove current_database() matches the requested
 * disposable target. Never logs credentials.
 */
export async function assertPrismaConnectedToStage12AcceptanceDb(
  prisma: PrismaService,
  expectedDatabase: string,
  label: string,
): Promise<{ database: string; user: string }> {
  if (isCurrentSchemaRegressionMode()) {
    assertSafeCurrentSchemaRegressionDatabase(expectedDatabase, label);
  } else {
    assertSafeStage12AcceptanceDatabase(expectedDatabase, label);
  }
  const rows = await prisma.$queryRaw<
    Array<{ database: string; user: string }>
  >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
  const database = rows[0]?.database;
  const user = rows[0]?.user;
  if (!database || !user) {
    throw new Error(`${label}: unable to resolve current_database()/current_user()`);
  }
  if (database !== expectedDatabase) {
    throw new Error(
      `${label}: Prisma current_database=${database} does not match expected disposable DB ${expectedDatabase} (user=${user})`,
    );
  }
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database)) {
    throw new Error(
      `${label}: connected to forbidden database ${database}; abort before any mutation`,
    );
  }
  return { database, user };
}

export async function assertPrismaConnectedToStage13aAcceptanceDb(
  prisma: PrismaService,
  expectedDatabase: string,
  label: string,
): Promise<{ database: string; user: string }> {
  if (isCurrentSchemaRegressionMode()) {
    assertSafeCurrentSchemaRegressionDatabase(expectedDatabase, label);
  } else {
    assertSafeStage13aAcceptanceDatabase(expectedDatabase, label);
  }
  const rows = await prisma.$queryRaw<
    Array<{ database: string; user: string }>
  >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
  const database = rows[0]?.database;
  const user = rows[0]?.user;
  if (!database || !user) {
    throw new Error(`${label}: unable to resolve current_database()/current_user()`);
  }
  if (database !== expectedDatabase) {
    throw new Error(
      `${label}: Prisma current_database=${database} does not match expected disposable DB ${expectedDatabase} (user=${user})`,
    );
  }
  if (
    ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database) ||
    STAGE13A_FORBIDDEN_DATABASES.has(database)
  ) {
    throw new Error(
      `${label}: connected to forbidden database ${database}; abort before any mutation`,
    );
  }
  return { database, user };
}

export async function assertPrismaConnectedToStage13b1AcceptanceDb(
  prisma: PrismaService,
  expectedDatabase: string,
  label: string,
): Promise<{ database: string; user: string }> {
  assertSafeStage13b1AcceptanceDatabase(expectedDatabase, label);
  const rows = await prisma.$queryRaw<
    Array<{ database: string; user: string }>
  >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
  const database = rows[0]?.database;
  const user = rows[0]?.user;
  if (!database || !user) {
    throw new Error(`${label}: unable to resolve current_database()/current_user()`);
  }
  if (database !== expectedDatabase) {
    throw new Error(
      `${label}: Prisma current_database=${database} does not match expected disposable DB ${expectedDatabase} (user=${user})`,
    );
  }
  if (
    ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database) ||
    STAGE13B1_FORBIDDEN_DATABASES.has(database)
  ) {
    throw new Error(
      `${label}: connected to forbidden database ${database}; abort before any mutation`,
    );
  }
  return { database, user };
}

/** Whether cleanup helpers may TRUNCATE/aggressive-clean this DB. */
export function isDisposableCleanupDatabaseName(database: string): boolean {
  return (
    isStage12DisposableAcceptanceDatabase(database) ||
    isStage13b1DisposableAcceptanceDatabase(database)
  );
}
