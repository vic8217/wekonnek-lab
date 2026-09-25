/**
 * UCE-4 acceptance database selection.
 * Harness only. Uses UCE-H0 name recognition and does not provision or connect.
 *
 * There is no default database. Cursor and Terra each pass their own
 * UCE4_TEST_DATABASE_URL. A missing or invalid URL never falls back to
 * wekonnek_uce4_cursor_test.
 */
import {
  ACCEPTANCE_ABSOLUTE_DENY_DATABASES,
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  assertSafeLocalAcceptanceHost,
  parseAcceptanceDatabaseUrl,
} from './acceptance-database';
import { adminUrlFrom } from './current-schema-disposable-provision';
import {
  assertNotHistoricalAcceptanceDatabase,
  assertRecognizedUceDisposableName,
  assertUceDisposableIdentity,
} from './test-database-guard';

export const UCE4_TEST_DATABASE_URL_ENV = 'UCE4_TEST_DATABASE_URL';
export const UCE4_LIVE_ENV = 'WEKONNEK_UCE4_LIVE';

/** Milestone constraint on top of UCE-H0. H0 still admits other UCE ids. */
const UCE4_ACCEPTANCE_DATABASE_RE = /^wekonnek_uce4_(cursor|terra)_test$/;

export type Uce4AcceptanceTarget = {
  database: string;
  connectionString: string;
  adminConnectionString: string;
};

export type Uce4AcceptanceGate =
  | { mode: 'skip' }
  | { mode: 'run'; target: Uce4AcceptanceTarget }
  | { mode: 'refuse'; reason: string };

export function isUce4AcceptanceDatabase(database: string): boolean {
  return UCE4_ACCEPTANCE_DATABASE_RE.test(database);
}

export function resolveUce4AcceptanceDatabase(
  rawUrl: string | undefined,
): Uce4AcceptanceTarget {
  if (rawUrl == null || rawUrl.trim() === '') {
    throw new Error(
      `uce4 acceptance refused: ${UCE4_TEST_DATABASE_URL_ENV} is required; refuse to fall back to wekonnek_uce4_cursor_test`,
    );
  }
  let parsed: ReturnType<typeof parseAcceptanceDatabaseUrl>;
  try {
    parsed = parseAcceptanceDatabaseUrl(rawUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`uce4 acceptance refused: malformed database URL (${message})`);
  }
  assertSafeLocalAcceptanceHost(parsed, 'uce4 acceptance');
  if (!isUce4AcceptanceDatabase(parsed.database)) {
    throw new Error(
      `uce4 acceptance refused: ${parsed.database} is not an approved UCE-4 disposable ` +
        '(expected wekonnek_uce4_(cursor|terra)_test)',
    );
  }
  assertRecognizedUceDisposableName(parsed.database, 'uce4 acceptance');
  assertNotHistoricalAcceptanceDatabase(parsed.database, 'uce4 acceptance');
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(parsed.database)) {
    throw new Error(
      `uce4 acceptance refused: database ${parsed.database} is permanently forbidden`,
    );
  }
  const connectionString = rawUrl.trim();
  return {
    database: parsed.database,
    connectionString,
    adminConnectionString: adminUrlFrom(connectionString),
  };
}

export function assertUce4LiveIdentity(
  identity: { database: string; user: string },
  approvedDatabase: string,
): void {
  if (!isUce4AcceptanceDatabase(approvedDatabase)) {
    throw new Error(
      `uce4 acceptance refused: approved database ${approvedDatabase} is not a UCE-4 disposable`,
    );
  }
  assertUceDisposableIdentity(identity, approvedDatabase, 'uce4 acceptance');
}

export function assertUce4NonSuperuserRole(input: {
  user: string;
  rolsuper: boolean;
}): void {
  if (!input.user || input.user === 'postgres') {
    throw new Error(
      `uce4 acceptance refused: current_user ${input.user || '<empty>'} is not an accepted non-superuser test role`,
    );
  }
  if (input.rolsuper !== false) {
    throw new Error(
      `uce4 acceptance refused: current_user ${input.user} is a superuser`,
    );
  }
}

/**
 * Skip only when no acceptance intent is present.
 * Any live flag, destructive flag, or URL must fully validate or refuse.
 */
export function evaluateUce4AcceptanceGate(
  env: Record<string, string | undefined>,
): Uce4AcceptanceGate {
  const live = env[UCE4_LIVE_ENV] === '1';
  const destructive = env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] === '1';
  const raw = env[UCE4_TEST_DATABASE_URL_ENV];
  const hasUrl = raw != null && raw.trim() !== '';
  if (!live && !destructive && !hasUrl) return { mode: 'skip' };
  if (!live) {
    return {
      mode: 'refuse',
      reason: `${UCE4_LIVE_ENV}=1 is required`,
    };
  }
  if (!destructive) {
    return {
      mode: 'refuse',
      reason: `${ACCEPTANCE_DESTRUCTIVE_OK_ENV}=1 is required`,
    };
  }
  try {
    return { mode: 'run', target: resolveUce4AcceptanceDatabase(raw) };
  } catch (err) {
    return {
      mode: 'refuse',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
