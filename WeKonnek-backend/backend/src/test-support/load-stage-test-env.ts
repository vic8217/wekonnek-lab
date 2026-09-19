/**
 * Load Stage N PostgreSQL acceptance env without mutating production/dev
 * DATABASE_URL for day-to-day `nest start`.
 *
 * Order (fail-closed for Stage 13A / 12 / 13B-1 acceptance override):
 * 1. Snapshot WEKONNEK_ACCEPTANCE_DATABASE_URL / DESTRUCTIVE_OK if present
 * 2. Snapshot incoming DATABASE_URL when it already names an approved
 *    current-schema disposable DB (Terra/Cursor/repair identities)
 * 3. Load .env then stage env file when present (may set DATABASE_URL)
 * 4. If explicit override → restore and apply (always wins)
 * 5. Else if current-schema and incoming URL was an approved disposable
 *    identity → restore it (do not clobber with a tip env file)
 * 6. Else if WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 → load tip
 *    `.env.stage13b2.regression.test` when present, else
 *    `.env.stage13b1.regression.test`, else
 *    `.env.stage13a.regression.test`, else `.env.stage12.regression.test`
 *
 * Explicit Terra/Cursor override always wins over dotenv.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';
import {
  applyAcceptanceDatabaseOverride,
  isCurrentSchemaDisposableDatabase,
  parseAcceptanceDatabaseUrl,
  restoreAcceptanceOverrideEnv,
  snapshotAcceptanceOverrideEnv,
} from './acceptance-database';
import { isCurrentSchemaRegressionMode } from './test-database-guard';

function isCurrentSchemaDisposableUrl(url: string | undefined): boolean {
  if (!url || url.trim() === '') return false;
  try {
    return isCurrentSchemaDisposableDatabase(
      parseAcceptanceDatabaseUrl(url).database,
    );
  } catch {
    return false;
  }
}

export function loadStageTestEnv(stageEnvFileName: string): boolean {
  const backendRoot = resolve(__dirname, '../..');
  const stagePath = resolve(backendRoot, stageEnvFileName);
  const tip13b2RegressionPath = resolve(
    backendRoot,
    '.env.stage13b2.regression.test',
  );
  const tip13b1RegressionPath = resolve(
    backendRoot,
    '.env.stage13b1.regression.test',
  );
  const tipRegressionPath = resolve(
    backendRoot,
    '.env.stage13a.regression.test',
  );
  const stage12TipRegressionPath = resolve(
    backendRoot,
    '.env.stage12.regression.test',
  );
  const overrideSnap = snapshotAcceptanceOverrideEnv();
  const hasOverride =
    overrideSnap.url !== undefined && overrideSnap.url.trim() !== '';
  const incomingDatabaseUrl = process.env.DATABASE_URL;
  const incomingCurrentSchemaDisposable = isCurrentSchemaDisposableUrl(
    incomingDatabaseUrl,
  );
  const currentSchemaTipPresent =
    isCurrentSchemaRegressionMode() &&
    (existsSync(tip13b2RegressionPath) ||
      existsSync(tip13b1RegressionPath) ||
      existsSync(tipRegressionPath) ||
      existsSync(stage12TipRegressionPath));

  if (
    !existsSync(stagePath) &&
    !hasOverride &&
    !currentSchemaTipPresent &&
    !(isCurrentSchemaRegressionMode() && incomingCurrentSchemaDisposable)
  ) {
    return false;
  }

  loadDotenv({ path: resolve(backendRoot, '.env') });
  if (existsSync(stagePath)) {
    loadDotenv({ path: stagePath, override: true });
  }

  if (hasOverride) {
    restoreAcceptanceOverrideEnv(overrideSnap);
    applyAcceptanceDatabaseOverride();
    return true;
  }

  if (isCurrentSchemaRegressionMode()) {
    if (incomingCurrentSchemaDisposable && incomingDatabaseUrl) {
      process.env.DATABASE_URL = incomingDatabaseUrl;
    } else if (existsSync(tip13b2RegressionPath)) {
      loadDotenv({ path: tip13b2RegressionPath, override: true });
    } else if (existsSync(tip13b1RegressionPath)) {
      loadDotenv({ path: tip13b1RegressionPath, override: true });
    } else if (existsSync(tipRegressionPath)) {
      loadDotenv({ path: tipRegressionPath, override: true });
    } else if (existsSync(stage12TipRegressionPath)) {
      loadDotenv({ path: stage12TipRegressionPath, override: true });
    } else {
      const legacyTip = resolve(backendRoot, '.env.stage7.regression.test');
      if (existsSync(legacyTip)) {
        loadDotenv({ path: legacyTip, override: true });
      }
    }
    if (process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK == null) {
      process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK = '1';
    }
    return (
      existsSync(stagePath) ||
      existsSync(tip13b2RegressionPath) ||
      existsSync(tip13b1RegressionPath) ||
      existsSync(tipRegressionPath) ||
      existsSync(stage12TipRegressionPath) ||
      isCurrentSchemaDisposableUrl(process.env.DATABASE_URL)
    );
  }

  if (process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK == null) {
    if (
      stageEnvFileName === '.env.stage12.test' ||
      stageEnvFileName === '.env.stage12.regression.test' ||
      stageEnvFileName === '.env.stage13a.test' ||
      stageEnvFileName === '.env.stage13a.regression.test' ||
      stageEnvFileName === '.env.stage13b1.test' ||
      stageEnvFileName === '.env.stage13b1.regression.test' ||
      stageEnvFileName === '.env.stage13b2.test' ||
      stageEnvFileName === '.env.stage13b2.regression.test'
    ) {
      process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK = '1';
    }
  }

  return existsSync(stagePath);
}
