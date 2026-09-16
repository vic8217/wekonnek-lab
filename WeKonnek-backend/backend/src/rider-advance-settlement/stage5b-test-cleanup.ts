/**
 * Stage 5B disposable-test cleanup helpers.
 *
 * Production settlement ledger rows are append-only (BEFORE DELETE trigger).
 * Acceptance harnesses MUST NOT rely on DELETE / deleteMany against
 * rider_advance_settlements, and MUST NOT live behind Nest controllers or
 * production service APIs.
 *
 * TRUNCATE bypasses row-level DELETE triggers and is reserved for the
 * disposable wekonnek_stage5b_test database only.
 */
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_TEST_DATABASES = new Set([
  'wekonnek_stage5b_test',
  'wekonnek_stage6_test',
]);

/**
 * Purge all settlement ledger rows in the disposable Stage 5B acceptance DB.
 * Throws if connected to any other database.
 */
export async function truncateSettlementsForStage5bTest(
  prisma: PrismaService,
): Promise<void> {
  const identity = await prisma.$queryRaw<
    Array<{ database: string }>
  >(Prisma.sql`SELECT current_database() AS database`);
  const database = identity[0]?.database;
  if (!database || !ALLOWED_TEST_DATABASES.has(database)) {
    throw new Error(
      `truncateSettlementsForStage5bTest refused: expected wekonnek_stage5b_test|wekonnek_stage6_test, got ${database}`,
    );
  }
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "rider_advance_settlements"',
  );
}
