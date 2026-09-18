/**
 * Load Stage N PostgreSQL acceptance env without mutating production/dev
 * DATABASE_URL for day-to-day `nest start`.
 *
 * Order (fail-closed for Stage 12 acceptance override):
 * 1. Snapshot WEKONNEK_ACCEPTANCE_DATABASE_URL / DESTRUCTIVE_OK if present
 * 2. Load .env then stage env file when present (may set DATABASE_URL)
 * 3. If explicit override → restore and apply (always wins)
 * 4. Else if WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 → load tip
 *    `.env.stage12.regression.test` so legacy Stage0–11 suites do not stay
 *    bound to their historical stage DB URL
 *
 * Explicit Terra/Cursor override always wins over dotenv.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';
import {
  applyAcceptanceDatabaseOverride,
  restoreAcceptanceOverrideEnv,
  snapshotAcceptanceOverrideEnv,
} from './acceptance-database';
import { isCurrentSchemaRegressionMode } from './test-database-guard';

export function loadStageTestEnv(stageEnvFileName: string): boolean {
  const backendRoot = resolve(__dirname, '../..');
  const stagePath = resolve(backendRoot, stageEnvFileName);
  const tipRegressionPath = resolve(
    backendRoot,
    '.env.stage12.regression.test',
  );
  const overrideSnap = snapshotAcceptanceOverrideEnv();
  const hasOverride =
    overrideSnap.url !== undefined && overrideSnap.url.trim() !== '';

  if (
    !existsSync(stagePath) &&
    !hasOverride &&
    !(isCurrentSchemaRegressionMode() && existsSync(tipRegressionPath))
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
    // Tip current-schema DB must win over stage-specific historical URLs.
    if (existsSync(tipRegressionPath)) {
      loadDotenv({ path: tipRegressionPath, override: true });
    } else {
      const legacyTip = resolve(backendRoot, '.env.stage7.regression.test');
      if (existsSync(legacyTip)) {
        loadDotenv({ path: legacyTip, override: true });
      }
    }
    if (process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK == null) {
      process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK = '1';
    }
    return existsSync(stagePath) || existsSync(tipRegressionPath);
  }

  if (process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK == null) {
    if (
      stageEnvFileName === '.env.stage12.test' ||
      stageEnvFileName === '.env.stage12.regression.test'
    ) {
      process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK = '1';
    }
  }

  return existsSync(stagePath);
}
