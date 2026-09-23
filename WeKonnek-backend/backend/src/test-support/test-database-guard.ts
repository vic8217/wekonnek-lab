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

export const STAGE13B2_ACCEPTANCE_DATABASE = 'wekonnek_stage13b2_test';
export const STAGE13B2_CURRENT_SCHEMA_REGRESSION_DATABASE =
  'wekonnek_stage13b2_regression_test';

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
 * Prior-stage DBs Stage 13B-2 suites must never mutate. Stage13B-1 acceptance
 * is the frozen parent; living current-schema tips are admitted separately.
 */
export const STAGE13B2_FORBIDDEN_DATABASES = new Set([
  ...STAGE13B1_FORBIDDEN_DATABASES,
  STAGE13B1_ACCEPTANCE_DATABASE,
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
  STAGE13B2_ACCEPTANCE_DATABASE,
  STAGE13B2_CURRENT_SCHEMA_REGRESSION_DATABASE,
]);

/** Terra/Cursor ephemeral Stage 12 acceptance DBs. */
const STAGE12_EPHEMERAL_DISPOSABLE_RE =
  /^wekonnek_stage12_(terra|cursor)_[a-z0-9][a-z0-9_]*$/;

/** Terra/Cursor ephemeral Stage 13A acceptance DBs. */
const STAGE13A_EPHEMERAL_DISPOSABLE_RE =
  /^wekonnek_stage13a_(terra|cursor)_[a-z0-9][a-z0-9_]*$/;

/**
 * Labels forbidden anywhere in a disposable suffix. Stronger than first-slot
 * denylist: prod/dev/live/staging/stage never become safe by wrapping a marker.
 */
const FORBIDDEN_DISPOSABLE_SUFFIX_LABELS = new Set([
  'prod',
  'production',
  'dev',
  'development',
  'live',
  'staging',
  'stage',
]);

const CURRENT_SCHEMA_ACCEPTANCE_MARKERS = new Set(['test', 'regression']);

/** Per-label: lowercase letter then up to 24 alphanumeric. Max 6 labels. */
const DISPOSABLE_SUFFIX_LABEL_RE = /^[a-z][a-z0-9]{0,24}$/;
const DISPOSABLE_SUFFIX_MAX_LABELS = 6;
const DISPOSABLE_SUFFIX_MAX_CHARS = 160;

/**
 * Current-schema disposable naming grammar:
 *   wekonnek_stage{token}_{bounded-disposable-suffix}
 * Token is Stage 12+ (12–99 or 13a / 13b1 / 13c / …). Not a wekonnek_* wildcard.
 * Suffix is 1–6 underscore-delimited lowercase labels. At least one complete
 * token must be `test` or `regression`. Descriptive labels may sit before or
 * after that marker. Does not special-case executor names (terra/cursor/repair)
 * or the word `final`.
 */
const CURRENT_SCHEMA_STAGE_TOKEN = '(?:1[3-9][a-z][0-9]{0,3}|1[2-9]|[2-9][0-9])';
const CURRENT_SCHEMA_DISPOSABLE_RE = new RegExp(
  `^wekonnek_stage(${CURRENT_SCHEMA_STAGE_TOKEN})_([a-z][a-z0-9_]{0,${DISPOSABLE_SUFFIX_MAX_CHARS - 1}})$`,
);

/** Frozen Stage0–11 acceptance parents — never admitted via grammar. */
const CURRENT_SCHEMA_GRAMMAR_FROZEN_PARENTS = new Set([
  ...HISTORICAL_ACCEPTANCE_DATABASES,
  STAGE7_ACCEPTANCE_DATABASE,
  STAGE8_ACCEPTANCE_DATABASE,
  STAGE9_ACCEPTANCE_DATABASE,
  STAGE10_ACCEPTANCE_DATABASE,
  STAGE11_ACCEPTANCE_DATABASE,
]);

export function isSafeCurrentSchemaDisposableSuffix(suffix: string): boolean {
  if (!suffix || suffix.length > DISPOSABLE_SUFFIX_MAX_CHARS) return false;
  if (suffix.startsWith('_') || suffix.endsWith('_') || suffix.includes('__')) {
    return false;
  }
  const labels = suffix.split('_');
  if (labels.length < 1 || labels.length > DISPOSABLE_SUFFIX_MAX_LABELS) {
    return false;
  }
  let hasAcceptanceMarker = false;
  for (const label of labels) {
    if (!DISPOSABLE_SUFFIX_LABEL_RE.test(label)) return false;
    if (FORBIDDEN_DISPOSABLE_SUFFIX_LABELS.has(label)) return false;
    if (CURRENT_SCHEMA_ACCEPTANCE_MARKERS.has(label)) {
      hasAcceptanceMarker = true;
    }
  }
  return hasAcceptanceMarker;
}

export function isRecognizedCurrentSchemaDisposableName(
  database: string,
): boolean {
  if (CURRENT_SCHEMA_GRAMMAR_FROZEN_PARENTS.has(database)) return false;
  const match = CURRENT_SCHEMA_DISPOSABLE_RE.exec(database);
  if (!match) return false;
  return isSafeCurrentSchemaDisposableSuffix(match[2]);
}

/**
 * UCE-H0 disposable acceptance names. Harness identity only — not product
 * authority, not current-schema provision, not cleanup/truncate permission.
 *
 * Canonical grammar (anchored, lowercase, exact suffix `_test`):
 *   wekonnek_uce{numericId}_{cursor|terra}_test
 *   wekonnek_uce_{letterId}_{cursor|terra}_test
 *
 * numericId: 1 | 1b | 2 | 3a | 3b | 4 | 5 | 6 | 7
 *            (bare `3` is not in grammar; use 3a / 3b)
 * letterId:  c1 | h0 | h1
 *
 * Letter-led UCE ids use a separator underscore so `uce_c1` is distinct from
 * numeric `uce1`. Numeric ids must NOT use that extra underscore.
 *
 * Name recognition does not create, drop, truncate, or migrate databases.
 */
const UCE_NUMERIC_ID = '(?:1b|3a|3b|[124567])';
const UCE_LETTER_ID = '(?:c1|h0|h1)';
const UCE_EXECUTOR = '(?:cursor|terra)';
const UCE_DISPOSABLE_RE = new RegExp(
  `^wekonnek_uce(?:${UCE_NUMERIC_ID}|_${UCE_LETTER_ID})_${UCE_EXECUTOR}_test$`,
);

export function isRecognizedUceDisposableName(database: string): boolean {
  if (!database) return false;
  return UCE_DISPOSABLE_RE.test(database);
}

export function assertRecognizedUceDisposableName(
  database: string,
  operation: string,
): void {
  if (!isRecognizedUceDisposableName(database)) {
    throw new Error(
      `${operation} refused: ${database} is not a recognized UCE disposable name ` +
        `(expected wekonnek_uce{1|1b|2|3a|3b|4|5|6|7}_{cursor|terra}_test or ` +
        `wekonnek_uce_{c1|h0|h1}_{cursor|terra}_test)`,
    );
  }
}

/**
 * Fail-closed UCE identity: the approved name must match grammar AND equal
 * the live current_database(). A matching DATABASE_URL name is not enough.
 * Does not grant provision, drop, truncate, or migration authority.
 */
export function assertUceDisposableIdentity(
  identity: { database: string; user: string },
  approvedDatabase: string,
  operation: string,
): void {
  assertRecognizedUceDisposableName(approvedDatabase, operation);
  if (!identity.database) {
    throw new Error(
      `${operation} refused: current_database() is empty; refuse to continue`,
    );
  }
  if (identity.database !== approvedDatabase) {
    throw new Error(
      `${operation} refused: current_database=${identity.database} user=${identity.user} ` +
        `does not match approved UCE disposable ${approvedDatabase}`,
    );
  }
}

export function isStage12TerraDisposableDatabase(database: string): boolean {
  return STAGE12_EPHEMERAL_DISPOSABLE_RE.test(database);
}

export function isStage13aTerraDisposableDatabase(database: string): boolean {
  return STAGE13A_EPHEMERAL_DISPOSABLE_RE.test(database);
}

export function isStage13b1EphemeralDisposableDatabase(
  database: string,
): boolean {
  const prefix = 'wekonnek_stage13b1_';
  if (!database.startsWith(prefix)) return false;
  return isSafeCurrentSchemaDisposableSuffix(database.slice(prefix.length));
}

/** @deprecated Use isStage13b1EphemeralDisposableDatabase — kept as alias. */
export function isStage13b1TerraDisposableDatabase(database: string): boolean {
  return isStage13b1EphemeralDisposableDatabase(database);
}

export function isStage13b2EphemeralDisposableDatabase(
  database: string,
): boolean {
  const prefix = 'wekonnek_stage13b2_';
  if (!database.startsWith(prefix)) return false;
  return isSafeCurrentSchemaDisposableSuffix(database.slice(prefix.length));
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
    isStage13b1EphemeralDisposableDatabase(database) ||
    isStage13b2EphemeralDisposableDatabase(database) ||
    isRecognizedCurrentSchemaDisposableName(database)
  ) {
    return;
  }
  throw new Error(
    `cleanup refused: expected disposable Stage 7/8/9/10/11/12/13A/13B-1/13B-2 DB (${[...DISPOSABLE_CLEANUP_DATABASES].join('|')}|wekonnek_stage12_(terra|cursor)_*|wekonnek_stage13a_(terra|cursor)_*|wekonnek_stage{token}_{test|regression suffix}), got ${database}`,
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
    set.add(STAGE13B2_CURRENT_SCHEMA_REGRESSION_DATABASE);
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
    database === STAGE13B2_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE12_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE11_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE10_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE
  );
}
