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
  'wekonnek_stage7_test',
  'wekonnek_stage8_test',
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
]);

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
  if (!DISPOSABLE_CLEANUP_DATABASES.has(database)) {
    throw new Error(
      `cleanup refused: expected disposable Stage 7/8/9 DB (${[...DISPOSABLE_CLEANUP_DATABASES].join('|')}), got ${database}`,
    );
  }
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
 * current-schema regression mode. Stage 9 tip uses wekonnek_stage9_regression_test.
 */
export function stageOrRegressionDatabases(
  historical: string | string[],
): Set<string> {
  const set = new Set(
    Array.isArray(historical) ? historical : [historical],
  );
  if (isCurrentSchemaRegressionMode()) {
    set.add(STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE);
  }
  return set;
}

/** True when connected to the disposable current-schema regression DB (Stage 9 tip). */
export function isAllowedCurrentSchemaRegressionDatabase(
  database: string,
): boolean {
  return (
    database === STAGE9_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE8_CURRENT_SCHEMA_REGRESSION_DATABASE ||
    database === STAGE7_CURRENT_SCHEMA_REGRESSION_DATABASE
  );
}
