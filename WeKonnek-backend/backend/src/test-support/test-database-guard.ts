/**
 * Stage 9+ test database identity guard.
 *
 * Frozen historical acceptance DBs must never be schema-upgraded to satisfy a
 * newer Prisma client, and disposable cleanup helpers must never target them.
 *
 * Each future stage uses:
 *   A) a dedicated stage acceptance DB, and
 *   B) a disposable current-schema regression DB (or equivalent isolation).
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Frozen historical acceptance databases — never mutate schema further for newer clients. */
export const HISTORICAL_ACCEPTANCE_DATABASES = new Set([
  'wekonnek_stage0_test',
  'wekonnek_stage1_test',
  'wekonnek_stage2_test',
  'wekonnek_stage3_test',
  'wekonnek_stage4_test',
  'wekonnek_stage5_test',
  'wekonnek_stage5b_test',
  'wekonnek_stage6_test',
]);

/**
 * Contaminated by Stage 7 DDL during early Stage 7 work.
 * Do not repair; do not use for Stage 7/8/9 acceptance or current-schema regression.
 */
export const STAGE7_CONTAMINATED_HISTORICAL_DATABASES = new Set([
  'wekonnek_stage5_test',
  'wekonnek_stage5b_test',
  'wekonnek_stage6_test',
]);

/** Historical DBs not modified by Stage 7 DDL. */
export const STAGE7_UNMODIFIED_HISTORICAL_DATABASES = new Set([
  'wekonnek_stage3_test',
  'wekonnek_stage4_test',
]);

export const STAGE7_ACCEPTANCE_DATABASE = 'wekonnek_stage7_test';
export const STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE =
  'wekonnek_stage7_regression_test';

export const STAGE8_ACCEPTANCE_DATABASE = 'wekonnek_stage8_test';
export const STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE =
  'wekonnek_stage8_regression_test';

export const STAGE9_ACCEPTANCE_DATABASE = 'wekonnek_stage9_test';
export const STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE =
  'wekonnek_stage9_regression_test';

export const STAGE10_ACCEPTANCE_DATABASE = 'wekonnek_stage10_test';
export const STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE =
  'wekonnek_stage10_regression_test';

export const STAGE11_ACCEPTANCE_DATABASE = 'wekonnek_stage11_test';
export const STAGE11_CURRENT_SCHEMA_REGRESSION_DATABASE =
  'wekonnek_stage11_regression_test';

export const STAGE12_ACCEPTANCE_DATABASE = 'wekonnek_stage12_test';
export const STAGE12_CURRENT_SCHEMA_REGRESSION_DATABASE =
  'wekonnek_stage12_regression_test';

export const STAGE13A_ACCEPTANCE_DATABASE = 'wekonnek_stage13a_test';
export const STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE =
  'wekonnek_stage13a_regression_test';

export const STAGE13B1_ACCEPTANCE_DATABASE = 'wekonnek_stage13b1_test';
export const STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE =
  'wekonnek_stage13b1_regression_test';

/**
 * Prior-stage DBs Stage 12 suites must never mutate (Stage 11 becomes a frozen
 * parent once Stage 12 opens, alongside earlier historical/contaminated DBs).
 */
export const STAGE12_FORBIDDEN_DATABASES = new Set([
  ...HISTORICAL_ACCEPTANCE_DATABASES,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE11_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE7_ACCEPTANCE_DATABASE,
  STAGE8_ACCEPTANCE_DATABASE,
  STAGE9_ACCEPTANCE_DATABASE,
  STAGE10_ACCEPTANCE_DATABASE,
  STAGE11_ACCEPTANCE_DATABASE,
  'wekonnek_stage7_regression_test',
  'wekonnek_stage8_regression_test',
  'wekonnek_stage9_regression_test',
  'wekonnek_stage10_regression_test',
  'wekonnek_stage11_regression_test',
]);

/**
 * Prior-stage DBs Stage 13A suites must never mutate (Stage 12 becomes a frozen
 * parent once Stage 13A opens, alongside earlier historical/contaminated DBs).
 */
export const STAGE13A_FORBIDDEN_DATABASES = new Set([
  ...STAGE12_FORBIDDEN_DATABASES,
  STAGE12_ACCEPTANCE_DATABASE,
  STAGE12_CURRENT_SCHEMA_REGRESSION_DATABASE,
  'wekonnek_stage12_regression_test',
]);

/**
 * Prior-stage DBs Stage 13B-1 suites must never mutate. Stage13A acceptance is
 * frozen; the living current-schema tip (13A regression) is admitted separately
 * so schema-identical Stage13B-1 tests can run under current-schema mode.
 */
export const STAGE13B1_FORBIDDEN_DATABASES = new Set([
  ...STAGE13A_FORBIDDEN_DATABASES,
  STAGE13A_ACCEPTANCE_DATABASE,
]);

/**
 * Prior-stage DBs Stage 11 suites must never mutate (includes Stage 10 acceptance
 * and Stage 10 regression, plus earlier historical/contaminated DBs).
 */
export const STAGE11_FORBIDDEN_DATABASES = new Set([
  ...HISTORICAL_ACCEPTANCE_DATABASES,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE7_ACCEPTANCE_DATABASE,
  STAGE8_ACCEPTANCE_DATABASE,
  STAGE9_ACCEPTANCE_DATABASE,
  STAGE10_ACCEPTANCE_DATABASE,
  'wekonnek_stage7_regression_test',
  'wekonnek_stage8_regression_test',
  'wekonnek_stage9_regression_test',
  'wekonnek_stage10_regression_test',
]);

/**
 * Prior-stage DBs Stage 10 suites must never mutate (includes Stage 9 acceptance
 * and Stage 9 regression, plus earlier historical/contaminated DBs).
 */
export const STAGE10_FORBIDDEN_DATABASES = new Set([
  ...HISTORICAL_ACCEPTANCE_DATABASES,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE7_ACCEPTANCE_DATABASE,
  STAGE8_ACCEPTANCE_DATABASE,
  STAGE9_ACCEPTANCE_DATABASE,
  'wekonnek_stage7_regression_test',
  'wekonnek_stage8_regression_test',
  'wekonnek_stage9_regression_test',
]);

/**
 * Prior-stage DBs Stage 9 suites must never mutate (includes Stage 8 acceptance
 * and Stage 8 regression, plus earlier historical/contaminated DBs).
 */
export const STAGE9_FORBIDDEN_DATABASES = new Set([
  ...HISTORICAL_ACCEPTANCE_DATABASES,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
  'wekonnek_stage7_regression_test',
  'wekonnek_stage8_regression_test',
]);

/** Prior-stage DBs Stage 8 suites must never mutate. */
export const STAGE8_FORBIDDEN_DATABASES = new Set([
  ...[
    'wekonnek_stage0_test',
    'wekonnek_stage1_test',
    'wekonnek_stage2_test',
    'wekonnek_stage3_test',
    'wekonnek_stage4_test',
    'wekonnek_stage5_test',
    'wekonnek_stage5b_test',
    'wekonnek_stage6_test',
    'wekonnek_stage7_test',
  ],
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
  'wekonnek_stage7_regression_test',
]);

/** Databases where settlement TRUNCATE / aggressive cleanup is allowed. */
export const DISPOSABLE_CLEANUP_DATABASES = new Set([
  STAGE7_ACCEPTANCE_DATABASE,
  STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE8_ACCEPTANCE_DATABASE,
  STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE9_ACCEPTANCE_DATABASE,
  STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE10_ACCEPTANCE_DATABASE,
  STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE11_ACCEPTANCE_DATABASE,
  STAGE11_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE12_ACCEPTANCE_DATABASE,
  STAGE12_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE13A_ACCEPTANCE_DATABASE,
  STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE,
  STAGE13B1_ACCEPTANCE_DATABASE,
  STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE,
]);

/** Terra/Cursor ephemeral Stage 12 acceptance DBs. */
const STAGE12_EPHEMERAL_DISPOSABLE_RE =
  /^wekonnek_stage12_(terra|cursor)_[a-z0-9][a-z0-9_]*$/;

/** Terra/Cursor ephemeral Stage 13A acceptance DBs. */
const STAGE13A_EPHEMERAL_DISPOSABLE_RE =
  /^wekonnek_stage13a_(terra|cursor)_[a-z0-9][a-z0-9_]*$/;

/**
 * Stage 13B-1 ephemeral disposable DBs.
 * Slot-based (terra/cursor/repair/…) — not a wekonnek_* wildcard, and not a
 * special-case privilege for any one executor name.
 *   wekonnek_stage13b1_<slot>_(test|regression|…_test|…_regression)
 */
const STAGE13B1_EPHEMERAL_DISPOSABLE_RE =
  /^wekonnek_stage13b1_([a-z][a-z0-9]{0,24})_([a-z0-9][a-z0-9_]*)$/;

const STAGE13B1_FORBIDDEN_EPHEMERAL_SLOTS = new Set([
  'prod',
  'production',
  'dev',
  'development',
  'live',
  'staging',
]);

export function isStage12TerraDisposableDatabase(database: string): boolean {
  return STAGE12_EPHEMERAL_DISPOSABLE_RE.test(database);
}

export function isStage13aTerraDisposableDatabase(database: string): boolean {
  return STAGE13A_EPHEMERAL_DISPOSABLE_RE.test(database);
}

export function isStage13b1EphemeralDisposableDatabase(
  database: string,
): boolean {
  const match = STAGE13B1_EPHEMERAL_DISPOSABLE_RE.exec(database);
  if (!match) return false;
  const slot = match[1];
  const rest = match[2];
  if (STAGE13B1_FORBIDDEN_EPHEMERAL_SLOTS.has(slot)) return false;
  return (
    rest === 'test' ||
    rest === 'regression' ||
    rest.endsWith('_test') ||
    rest.endsWith('_regression')
  );
}

/** @deprecated Use isStage13b1EphemeralDisposableDatabase — kept as alias. */
export function isStage13b1TerraDisposableDatabase(database: string): boolean {
  return isStage13b1EphemeralDisposableDatabase(database);
}

export function isCurrentSchemaRegressionMode(): boolean {
  return process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION === '1';
}

export async function readDatabaseIdentity(
  prisma: PrismaService,
): Promise<{ database: string; user: string }> {
  const rows = await prisma.$queryRaw<
    Array<{ database: string; user: string }>
  >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
  const database = rows[0]?.database;
  const user = rows[0]?.user;
  if (!database || !user) {
    throw new Error('Unable to resolve current_database()/current_user()');
  }
  return { database, user };
}

export function assertNotHistoricalAcceptanceDatabase(
  database: string,
  operation: string,
): void {
  if (HISTORICAL_ACCEPTANCE_DATABASES.has(database)) {
    throw new Error(
      `${operation} refused: historical acceptance database ${database} is frozen and must not be mutated by Stage 7+ helpers`,
    );
  }
}

export function assertDisposableCleanupDatabase(database: string): void {
  assertNotHistoricalAcceptanceDatabase(database, 'cleanup');
  if (
    DISPOSABLE_CLEANUP_DATABASES.has(database) ||
    isStage12TerraDisposableDatabase(database) ||
    isStage13aTerraDisposableDatabase(database) ||
    isStage13b1EphemeralDisposableDatabase(database)
  ) {
    return;
  }
  throw new Error(
    `cleanup refused: expected disposable Stage 7/8/9/10/11/12/13A/13B-1 DB (${[...DISPOSABLE_CLEANUP_DATABASES].join('|')}|wekonnek_stage12_(terra|cursor)_*|wekonnek_stage13a_(terra|cursor)_*|wekonnek_stage13b1_<slot>_(test|regression)), got ${database}`,
  );
}

export async function assertAllowedTestDatabase(
  prisma: PrismaService,
  opts: {
    allowedDatabases: ReadonlySet<string>;
    allowedUsers?: ReadonlySet<string>;
    label: string;
  },
): Promise<{ database: string; user: string }> {
  const identity = await readDatabaseIdentity(prisma);
  if (!opts.allowedDatabases.has(identity.database)) {
    throw new Error(
      `${opts.label} require database in {${[...opts.allowedDatabases].join(', ')}}; got database=${identity.database} user=${identity.user}`,
    );
  }
  if (opts.allowedUsers && !opts.allowedUsers.has(identity.user)) {
    throw new Error(
      `${opts.label} require user in {${[...opts.allowedUsers].join(', ')}}; got database=${identity.database} user=${identity.user}`,
    );
  }
  return identity;
}

/**
 * Allowed DBs for a stage suite under either historical acceptance or
 * current-schema regression mode. Stage 13A is the tip, so regression mode adds
 * wekonnek_stage13a_regression_test (Stage 12 tip remains accepted while
 * provisioned).
 */
export function stageOrRegressionDatabases(
  historical: string | string[],
): Set<string> {
  const set = new Set(
    Array.isArray(historical) ? historical : [historical],
  );
  if (isCurrentSchemaRegressionMode()) {
    set.add(STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE);
    set.add(STAGE12_CURRENT_SCHEMA_REGRESSION_DATABASE);
    // Stage 11 remains accepted while its regression DB is still provisioned.
    set.add(STAGE11_CURRENT_SCHEMA_REGRESSION_DATABASE);
    set.add(STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE);
  }
  return set;
}

/** True when connected to the disposable current-schema regression DB (Stage 13A tip). */
export function isAllowedCurrentSchemaRegressionDatabase(
  database: string,
): boolean {
  return (
    database === STAGE13A_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE13B1_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE12_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE11_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE
  );
}
