/**
 * Jest setupFiles: point suites at wekonnek_stage12_cursor_regression_test.
 */
const { readFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const local = resolve(__dirname, '../../.env.stage12.cursor.regression.local');
if (existsSync(local)) {
  for (const line of readFileSync(local, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i);
    const v = t.slice(i + 1);
    if (
      k === 'WEKONNEK_ACCEPTANCE_DATABASE_URL' ||
      k === 'WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK' ||
      k === 'WEKONNEK_CURRENT_SCHEMA_REGRESSION'
    ) {
      process.env[k] = v;
    }
  }
  return;
}

const stagePath = resolve(__dirname, '../../.env.stage12.test');
if (!existsSync(stagePath)) {
  throw new Error('Missing .env.stage12.test for cursor regression setup');
}
const env = {};
for (const line of readFileSync(stagePath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  env[t.slice(0, i)] = t.slice(i + 1);
}
const base = env.DATABASE_URL;
if (!base || !base.includes('wekonnek_stage12_test')) {
  throw new Error('expected wekonnek_stage12_test in DATABASE_URL');
}
const override = base.replace(
  /\/wekonnek_stage12_test(\?|$)/,
  '/wekonnek_stage12_cursor_regression_test$1',
);
process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK = '1';
process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
process.env.WEKONNEK_ACCEPTANCE_DATABASE_URL = override;
