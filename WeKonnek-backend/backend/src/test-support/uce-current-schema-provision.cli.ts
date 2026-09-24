/**
 * Terra/Cursor CLI for UCE-H1 current-schema provisioning of recognized UCE DBs.
 *
 *   NODE_ENV=test WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1 \
 *     npx tsx src/test-support/uce-current-schema-provision.cli.ts \
 *     provision wekonnek_uce_h1_cursor_test
 *
 * Drop additionally requires WEKONNEK_UCE_RESET_OK=1.
 * Prints no passwords. DATABASE_URL must be local PostgreSQL.
 */
import { loadStageTestEnv } from './load-stage-test-env';
import { adminUrlFrom, databaseExists } from './current-schema-disposable-provision';
import {
  dropUceCurrentSchemaDisposable,
  provisionUceCurrentSchema,
  uceSafeConnectionDiagnostics,
} from './uce-current-schema-provision';

function usage(): never {
  console.error(
    'usage: uce-current-schema-provision.cli.ts <provision|drop|exists> <uce-database>',
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
      loadStageTestEnv('.env.stage13a.test');
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required (local PostgreSQL). Refusing to guess.',
    );
  }
  const adminConnectionString = adminUrlFrom(url);
  const diag = uceSafeConnectionDiagnostics(adminConnectionString, target);
  console.log(
    JSON.stringify({
      host: diag.host,
      port: diag.port,
      approvedDatabase: diag.approvedDatabase,
    }),
  );

  if (command === 'exists') {
    const present = await databaseExists(adminConnectionString, target);
    console.log(JSON.stringify({ database: target, exists: present }));
    return;
  }
  if (command === 'drop') {
    await dropUceCurrentSchemaDisposable({
      targetDatabase: target,
      adminConnectionString,
    });
    const present = await databaseExists(adminConnectionString, target);
    console.log(
      JSON.stringify({ database: target, dropped: true, exists: present }),
    );
    return;
  }
  const result = await provisionUceCurrentSchema({
    targetDatabase: target,
    adminConnectionString,
  });
  console.log(
    JSON.stringify({
      database: result.database,
      template: result.template,
      created: result.created,
      appliedMigrations: result.appliedMigrations,
      current_database: result.currentDatabase,
      current_user: result.currentUser,
    }),
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exit(1);
});
