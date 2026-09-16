/**
 * Load stage-specific dotenv, preferring Stage 9 current-schema regression
 * when WEKONNEK_CURRENT_SCHEMA_REGRESSION=1.
 *
 * Stage 9 is the current schema tip: regression mode always loads
 * `.env.stage9.regression.test` (wekonnek_stage9_regression_test).
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { isCurrentSchemaRegressionMode } from './test-database-guard';

const BACKEND_ROOT = resolve(__dirname, '../..');

export const STAGE7_REGRESSION_ENV = resolve(
  BACKEND_ROOT,
  '.env.stage7.regression.test',
);

export const STAGE8_REGRESSION_ENV = resolve(
  BACKEND_ROOT,
  '.env.stage8.regression.test',
);

export const STAGE9_REGRESSION_ENV = resolve(
  BACKEND_ROOT,
  '.env.stage9.regression.test',
);

export function loadStageTestEnv(stageEnvFileName: string): boolean {
  if (isCurrentSchemaRegressionMode()) {
    if (!existsSync(STAGE9_REGRESSION_ENV)) {
      throw new Error(
        `WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 but missing ${STAGE9_REGRESSION_ENV}`,
      );
    }
    loadEnv({ path: STAGE9_REGRESSION_ENV, override: true });
    return true;
  }
  const stagePath = resolve(BACKEND_ROOT, stageEnvFileName);
  if (!existsSync(stagePath)) {
    return false;
  }
  loadEnv({ path: stagePath, override: true });
  return true;
}
