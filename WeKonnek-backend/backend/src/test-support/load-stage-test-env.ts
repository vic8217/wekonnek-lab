/**
 * Load stage-specific dotenv, preferring Stage 7 current-schema regression
 * when WEKONNEK_CURRENT_SCHEMA_REGRESSION=1.
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

export function loadStageTestEnv(stageEnvFileName: string): boolean {
  if (isCurrentSchemaRegressionMode()) {
    if (!existsSync(STAGE7_REGRESSION_ENV)) {
      throw new Error(
        `WEKONNEK_CURRENT_SCHEMA_REGRESSION=1 but missing ${STAGE7_REGRESSION_ENV}`,
      );
    }
    loadEnv({ path: STAGE7_REGRESSION_ENV, override: true });
    return true;
  }
  const stagePath = resolve(BACKEND_ROOT, stageEnvFileName);
  if (!existsSync(stagePath)) {
    return false;
  }
  loadEnv({ path: stagePath, override: true });
  return true;
}
