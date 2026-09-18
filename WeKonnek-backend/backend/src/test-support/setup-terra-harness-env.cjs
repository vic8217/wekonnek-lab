/**
 * Jest setupFiles: load gitignored Terra harness override before suite dotenv.
 */
const { readFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const local = resolve(__dirname, '../../.env.stage12.terra.harness.local');
if (!existsSync(local)) {
  throw new Error(
    'Missing .env.stage12.terra.harness.local — run write-terra-harness-env.cjs first',
  );
}
for (const line of readFileSync(local, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  const k = t.slice(0, i);
  const v = t.slice(i + 1);
  if (k === 'WEKONNEK_ACCEPTANCE_DATABASE_URL' || k === 'WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK') {
    process.env[k] = v;
  }
}
