#!/usr/bin/env node
/**
 * Write gitignored local env for Terra harness suites (no stdout of secrets).
 */
const { readFileSync, writeFileSync, chmodSync } = require('fs');
const { resolve } = require('path');

const stagePath = resolve(__dirname, '../../.env.stage12.test');
const outPath = resolve(__dirname, '../../.env.stage12.terra.harness.local');
const env = {};
for (const line of readFileSync(stagePath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  env[t.slice(0, i)] = t.slice(i + 1);
}
const base = env.DATABASE_URL;
if (!base || !base.includes('wekonnek_stage12_test')) {
  console.error('expected wekonnek_stage12_test in DATABASE_URL');
  process.exit(1);
}
const override = base.replace(
  /\/wekonnek_stage12_test(\?|$)/,
  '/wekonnek_stage12_terra_harness_test$1',
);
writeFileSync(
  outPath,
  `WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1\nWEKONNEK_ACCEPTANCE_DATABASE_URL=${override}\n`,
  { mode: 0o600 },
);
chmodSync(outPath, 0o600);
console.log('wrote .env.stage12.terra.harness.local (credentials redacted)');
