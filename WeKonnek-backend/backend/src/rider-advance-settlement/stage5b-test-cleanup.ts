/**
 * Stage 5B disposable-test cleanup helpers.
 *
 * Production settlement ledger rows are append-only (BEFORE DELETE trigger).
 * Acceptance harnesses MUST NOT rely on DELETE / deleteMany against
 * rider_advance_settlements, and MUST NOT live behind Nest controllers or
 * production service APIs.
 *
 * TRUNCATE bypasses row-level DELETE triggers and is reserved for disposable
 * Stage 7 acceptance / current-schema regression databases only.
 * Historical acceptance DBs (including contaminated stage5/5b/6) are refused.
 */
import { PrismaService } from '../prisma/prisma.service';
import {
  assertDisposableCleanupDatabase,
  readDatabaseIdentity,
} from '../test-support/test-database-guard';

/**
 * Purge all settlement ledger rows in a disposable Stage 7 test DB.
 * Throws if connected to any historical acceptance database.
 */
export async function truncateSettlementsForStage5bTest(
  prisma: PrismaService,
): Promise<void> {
  const { database } = await readDatabaseIdentity(prisma);
  assertDisposableCleanupDatabase(database);
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "rider_advance_settlements"',
  );
}
