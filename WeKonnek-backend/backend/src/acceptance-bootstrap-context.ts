/**
 * Bounded TEST acceptance bootstrap context.
 *
 * Used by AppModule only to decide whether ConfigModule may skip `.env`
 * loading. Not destructive-acceptance authority. No I/O. No PostgreSQL.
 *
 * Actual DB authorization remains in the centralized acceptance harness.
 */
export const ACCEPTANCE_BOOTSTRAP_OVERRIDE_ENV = 'WEKONNEK_ACCEPTANCE_DB_OVERRIDE';
export const ACCEPTANCE_BOOTSTRAP_DATABASE_URL_ENV =
  'WEKONNEK_ACCEPTANCE_DATABASE_URL';

export function isExplicitAcceptanceBootstrapContext(
  env: NodeJS.Dict<string | undefined> = process.env,
): boolean {
  if (env.NODE_ENV !== 'test') return false;
  if (env[ACCEPTANCE_BOOTSTRAP_OVERRIDE_ENV] !== '1') return false;
  const url = env[ACCEPTANCE_BOOTSTRAP_DATABASE_URL_ENV];
  if (url == null || url.trim() === '') return false;
  return true;
}
