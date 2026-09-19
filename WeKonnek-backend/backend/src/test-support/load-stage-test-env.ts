/**
 * Load Stage N PostgreSQL acceptance env without mutating production/dev
 * DATABASE_URL for day-to-day `nest start`.
 *
 * Order (fail-closed for Stage 13A / 12 / 13B-1 acceptance override):
 * 1. Snapshot WEKONNEK_ACCEPTANCE_DATABASE_URL / DESTRUCTIVE_OK if present
 * 2. Snapshot incoming DATABASE_URL when it already names an approved
 *    current-schema disposable DB (Terra/Cursor/repair identities)
 * 3. Load .env then stage env file when present (may set DATABASE_URL)
 * 4. If explicit process override → restore and apply (always wins)
 * 5. Else if the loaded stage env set WEKONNEK_ACCEPTANCE_DATABASE_URL →
 *    apply it (stage-file pin wins over older-stage tip files)
 * 6. Else if current-schema and incoming URL was an approved disposable
 *    identity → restore it (do not clobber with a tip env file)
 * 7. Else if WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 → load newest tip:
 *    `.env.stage13b3b.regression.test`, else 13b3, 13b2, 13b1, 13a, 12
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

function isStage14aDisposableUrl(url: string | undefined): boolean {
  if (!url || url.trim() === '') return false;
  try {
    const database = parseAcceptanceDatabaseUrl(url).database;
    return isStage14aAcceptanceDatabase(database);
  } catch {
    return false;
  }
}

export function isStage14aAcceptanceDatabase(database: string): boolean {
  return (
    database.startsWith('wekonnek_stage14a_') &&
    isCurrentSchemaDisposableDatabase(database)
  );
}

/**
 * Stage14A acceptance routing is dedicated. It never falls through to
 * Stage13B-3B / 13B-3 / 13A regression tip files, and a generic
 * WEKONNEK_ACCEPTANCE_DATABASE_URL wins only when it already names
 * wekonnek_stage14a_*.
 */
export function loadStage14aTestEnv(): boolean {
  const backendRoot = resolve(__dirname, '../..');
  const stagePath = resolve(backendRoot, '.env.stage14a.test');
  const overrideSnap = snapshotAcceptanceOverrideEnv();
  const overrideUrl = overrideSnap.url;
  const incomingDatabaseUrl = process.env.DATABASE_URL;
  const overrideIs14a = isStage14aDisposableUrl(overrideUrl);
  const incomingIs14a = isStage14aDisposableUrl(incomingDatabaseUrl);

  if (!existsSync(stagePath) && !overrideIs14a && !incomingIs14a) {
    return false;
  }

  loadDotenv({ path: resolve(backendRoot, '.env') });
  if (existsSync(stagePath)) {
    loadDotenv({ path: stagePath, override: true });
  }

  if (overrideIs14a && overrideUrl) {
    restoreAcceptanceOverrideEnv(overrideSnap);
    applyAcceptanceDatabaseOverride();
  } else if (isStage14aDisposableUrl(process.env.WEKONNEK_ACCEPTANCE_DATABASE_URL)) {
    applyAcceptanceDatabaseOverride();
  } else if (!isStage14aDisposableUrl(process.env.DATABASE_URL) && incomingIs14a && incomingDatabaseUrl) {
    process.env.DATABASE_URL = incomingDatabaseUrl;
  }

  if (!isStage14aDisposableUrl(process.env.DATABASE_URL)) {
    return false;
  }

  process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
  if (process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK == null) {
    process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK = '1';
  }
  return true;
}

export function loadStageTestEnv(stageEnvFileName: string): boolean {
  if (
    stageEnvFileName === '.env.stage14a.test' ||
    stageEnvFileName === '.env.stage14a.regression.test'
  ) {
    return loadStage14aTestEnv();
  }
  const backendRoot = resolve(__dirname, '../..');
  const stagePath = resolve(backendRoot, stageEnvFileName);
  const tip13b3bRegressionPath = resolve(
    backendRoot,
    '.env.stage13b3b.regression.test',
  );
  const tip13b3RegressionPath = resolve(
    backendRoot,
    '.env.stage13b3.regression.test',
  );
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
    (existsSync(tip13b3bRegressionPath) ||
      existsSync(tip13b3RegressionPath) ||
      existsSync(tip13b2RegressionPath) ||
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

  // Stage env ACCEPTANCE_URL must pin DATABASE_URL. Older-stage current-schema
  // tip files must not hijack Stage13B-3 / 13B-3B disposable targets.
  if (process.env.WEKONNEK_ACCEPTANCE_DATABASE_URL?.trim()) {
    applyAcceptanceDatabaseOverride();
    if (process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK == null) {
      process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK = '1';
    }
    return existsSync(stagePath);
  }

  if (isCurrentSchemaRegressionMode()) {
    if (incomingCurrentSchemaDisposable && incomingDatabaseUrl) {
      process.env.DATABASE_URL = incomingDatabaseUrl;
    } else if (existsSync(tip13b3bRegressionPath)) {
      loadDotenv({ path: tip13b3bRegressionPath, override: true });
    } else if (existsSync(tip13b3RegressionPath)) {
      loadDotenv({ path: tip13b3RegressionPath, override: true });
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
      existsSync(tip13b3bRegressionPath) ||
      existsSync(tip13b3RegressionPath) ||
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
      stageEnvFileName === '.env.stage13b2.regression.test' ||
      stageEnvFileName === '.env.stage13b3.test' ||
      stageEnvFileName === '.env.stage13b3.regression.test' ||
      stageEnvFileName === '.env.stage13b3b.test' ||
      stageEnvFileName === '.env.stage13b3b.regression.test' ||
      stageEnvFileName === '.env.stage14a.test' ||
      stageEnvFileName === '.env.stage14a.regression.test'
    ) {
      process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK = '1';
    }
  }

  return existsSync(stagePath);
}
