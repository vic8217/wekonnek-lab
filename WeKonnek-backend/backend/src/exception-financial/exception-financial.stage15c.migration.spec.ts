/**
 * Stage15C migration objects on the dedicated disposable acceptance DB.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { parseAcceptanceDatabaseUrl } from '../test-support/acceptance-database';
import { isStage15cAcceptanceDatabase } from '../test-support/load-stage-test-env';
import { isRecognizedCurrentSchemaDisposableName } from '../test-support/test-database-guard';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const enabled = loadStageTestEnv('.env.stage15c.test');
const describeIf = enabled ? describe : describe.skip;
const INDEX = 'liability_determinations_one_child_per_parent';

describeIf('Stage15C successor chain migration objects', () => {
  const prisma = new PrismaService();
  const url = process.env.DATABASE_URL!;
  const EXPECTED_DB = parseAcceptanceDatabaseUrl(url).database;

  beforeAll(async () => {
    if (
      !isStage15cAcceptanceDatabase(EXPECTED_DB) ||
      !isRecognizedCurrentSchemaDisposableName(EXPECTED_DB)
    ) {
      throw new Error(`Stage15C migration refused database ${EXPECTED_DB}`);
    }
    await prisma.$connect();
    const identity = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >`SELECT current_database() AS database, current_user AS user`;
    if (identity[0]?.database !== EXPECTED_DB) {
      throw new Error('Stage15C migration current_database mismatch');
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function indexExists(): boolean {
    const found = execSync(
      `psql "${url}" -tAc "SELECT indexname FROM pg_indexes WHERE indexname='${INDEX}'"`,
      { encoding: 'utf8' },
    ).trim();
    return found === INDEX;
  }

  it('clean/valid-chain: one-child-per-parent index is present', () => {
    expect(indexExists()).toBe(true);
  });

  it('rollback removes only the Stage15C index and reapply succeeds', () => {
    execSync(
      `psql "${url}" -v ON_ERROR_STOP=1 -c 'DROP INDEX IF EXISTS "${INDEX}"'`,
      { encoding: 'utf8' },
    );
    expect(indexExists()).toBe(false);
    execSync(
      `psql "${url}" -v ON_ERROR_STOP=1 -c 'CREATE UNIQUE INDEX "${INDEX}" ON "liability_determinations" ("adjustment_of_determination_id") WHERE "adjustment_of_determination_id" IS NOT NULL'`,
      { encoding: 'utf8' },
    );
    expect(indexExists()).toBe(true);
  });

  it('duplicate child makes index creation fail and rolls back', async () => {
    const parent = await prisma.liabilityDetermination.findFirst({
      where: { adjustmentOfDeterminationId: { not: null } },
    });
    expect(parent).toBeTruthy();
    const extraId = randomUUID();
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `DROP INDEX IF EXISTS "${INDEX}"`,
        );
        await tx.liabilityDetermination.create({
          data: {
            id: extraId,
            exceptionClaimId: parent!.exceptionClaimId,
            economicLossId: parent!.economicLossId,
            policyVersionId: parent!.policyVersionId,
            policyHash: parent!.policyHash,
            status: parent!.status,
            currency: parent!.currency,
            totalLiabilityAmount: parent!.totalLiabilityAmount,
            compensableAmountSnapshot: parent!.compensableAmountSnapshot,
            priorCoverageAmountSnapshot: parent!.priorCoverageAmountSnapshot,
            remainingAmountSnapshot: parent!.remainingAmountSnapshot,
            finalizedAt: parent!.finalizedAt,
            finalizedByActorId: parent!.finalizedByActorId,
            finalizedByActorType: parent!.finalizedByActorType,
            createdByActorType: parent!.createdByActorType,
            createdByActorId: parent!.createdByActorId,
            adjustmentOfDeterminationId: parent!.adjustmentOfDeterminationId,
            correlationId: `s15c-dup-${randomUUID().slice(0, 8)}`,
          },
        });
        await tx.$executeRawUnsafe(
          `CREATE UNIQUE INDEX "${INDEX}" ON "liability_determinations" ("adjustment_of_determination_id") WHERE "adjustment_of_determination_id" IS NOT NULL`,
        );
      }),
    ).rejects.toThrow();
    expect(indexExists()).toBe(true);
    expect(
      await prisma.liabilityDetermination.findUnique({ where: { id: extraId } }),
    ).toBeNull();
  });
});
