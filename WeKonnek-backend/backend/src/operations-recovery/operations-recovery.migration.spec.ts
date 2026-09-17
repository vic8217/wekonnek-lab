/**
 * Stage 11 migration apply / rollback / reapply on acceptance DB only.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { STAGE11_ACCEPTANCE_DATABASE } from '../test-support/test-database-guard';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

const enabled = loadStageTestEnv('.env.stage11.test');
const describeIf = enabled ? describe : describe.skip;

describeIf('Stage 11 migration rollback/reapply', () => {
  const prisma = new PrismaService();
  const migDir = resolve(
    __dirname,
    '../../prisma/migrations/20260917180000_stage11_operations_recovery',
  );

  beforeAll(async () => {
    await prisma.$connect();
    const db = await prisma.$queryRaw<Array<{ database: string }>>(
      Prisma.sql`SELECT current_database() AS database`,
    );
    expect(db[0]?.database).toBe(STAGE11_ACCEPTANCE_DATABASE);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rollback then reapply restores Stage 11 objects', () => {
    const url = process.env.DATABASE_URL!;
    execSync(`psql "${url}" -v ON_ERROR_STOP=1 -f "${migDir}/rollback.sql"`, {
      stdio: 'inherit',
    });
    const gone = execSync(
      `psql "${url}" -tAc "SELECT to_regclass('public.operations_recoveries')"`,
      { encoding: 'utf8' },
    ).trim();
    expect(gone === '' || gone === 'null').toBe(true);

    execSync(`psql "${url}" -v ON_ERROR_STOP=1 -f "${migDir}/migration.sql"`, {
      stdio: 'inherit',
    });
    const present = execSync(
      `psql "${url}" -tAc "SELECT to_regclass('public.operations_recoveries')"`,
      { encoding: 'utf8' },
    ).trim();
    expect(present).toBe('operations_recoveries');

    const idx = execSync(
      `psql "${url}" -tAc "SELECT indexname FROM pg_indexes WHERE indexname='operations_recoveries_one_active_per_fulfillment'"`,
      { encoding: 'utf8' },
    ).trim();
    expect(idx).toBe('operations_recoveries_one_active_per_fulfillment');

    const trg = execSync(
      `psql "${url}" -tAc "SELECT tgname FROM pg_trigger WHERE tgname='stage11_operations_recovery_terminal_immutable_trg'"`,
      { encoding: 'utf8' },
    ).trim();
    expect(trg).toBe('stage11_operations_recovery_terminal_immutable_trg');
  });
});
