/**
 * Terra/Cursor CLI for fail-closed current-schema disposable provisioning.
 *
 * Does NOT derive TEMPLATE wekonnek_stage{token}_test from the target name.
 * Does NOT create or require wekonnek_stage13b3_test.
 * Clones the newest existing canonical parent (wekonnek_stage13b2_test, …).
 *
 *   NODE_ENV=test WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1 \
 *     npx tsx src/test-support/current-schema-disposable-provision.cli.ts \
 *     provision wekonnek_stage13b3_b_terra_test
 *
 *   NODE_ENV=test WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1 \
 *     npx tsx src/test-support/current-schema-disposable-provision.cli.ts \
 *     drop wekonnek_stage13b3_b_terra_test
 *
 * DATABASE_URL may name any local database; admin work uses /postgres.
 * Prints no passwords.
 */
import { loadStageTestEnv } from './load-stage-test-env';
import {
  adminUrlFrom,
  databaseExists,
  dropCurrentSchemaDisposable,
  provisionCurrentSchemaDisposable,
} from './current-schema-disposable-provision';

function usage(): never {
  console.error(
    'usage: current-schema-disposable-provision.cli.ts <provision|drop|exists> <database>',
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const target = process.argv[3];
  if (!command || !target) usage();
  if (command !== 'provision' && command !== 'drop' && command !== 'exists') {
    usage();
  }

  if (!process.env.DATABASE_URL) {
    loadStageTestEnv('.env.stage13b2.test') ||
      loadStageTestEnv('.env.stage13b1.test') ||
      loadStageTestEnv('.env.stage13a.test') ||
      loadStageTestEnv('.env.stage12.test');
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required (local PostgreSQL). Refusing to guess.',
    );
  }
  const adminConnectionString = adminUrlFrom(url);

  if (command === 'exists') {
    const present = await databaseExists(adminConnectionString, target);
    console.log(JSON.stringify({ database: target, exists: present }));
    return;
  }
  if (command === 'drop') {
    await dropCurrentSchemaDisposable({
      targetDatabase: target,
      adminConnectionString,
    });
    const present = await databaseExists(adminConnectionString, target);
    console.log(JSON.stringify({ database: target, dropped: true, exists: present }));
    return;
  }
  const result = await provisionCurrentSchemaDisposable({
    targetDatabase: target,
    adminConnectionString,
  });
  console.log(
    JSON.stringify({
      database: result.database,
      template: result.template,
      created: result.created,
      appliedMigrations: result.appliedMigrations,
    }),
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
