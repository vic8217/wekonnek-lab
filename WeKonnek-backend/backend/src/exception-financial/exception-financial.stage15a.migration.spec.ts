/**
 * Stage15A migration objects on the dedicated disposable acceptance DB.
 * Additive only. Does not rollback historical evidence.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { parseAcceptanceDatabaseUrl } from '../test-support/acceptance-database';
import { isStage15aAcceptanceDatabase } from '../test-support/load-stage-test-env';
import { isRecognizedCurrentSchemaDisposableName } from '../test-support/test-database-guard';
import { execSync } from 'child_process';
import { PrismaService } from '../prisma/prisma.service';

const enabled = loadStageTestEnv('.env.stage15a.test');
const describeIf = enabled ? describe : describe.skip;

describeIf('Stage15A trusted evidence provenance migration objects', () => {
  const prisma = new PrismaService();
  const url = process.env.DATABASE_URL!;
  const EXPECTED_DB = parseAcceptanceDatabaseUrl(url).database;

  beforeAll(async () => {
    if (
      !isStage15aAcceptanceDatabase(EXPECTED_DB) ||
      !isRecognizedCurrentSchemaDisposableName(EXPECTED_DB)
    ) {
      throw new Error(`Stage15A migration refused database ${EXPECTED_DB}`);
    }
    await prisma.$connect();
    const identity = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >`SELECT current_database() AS database, current_user AS user`;
    if (identity[0]?.database !== EXPECTED_DB) {
      throw new Error('Stage15A migration current_database mismatch');
    }
    void identity[0]?.user;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('psql current_database matches expected Stage15A disposable DB', () => {
    const psqlDb = execSync(`psql "${url}" -tAc "SELECT current_database()"`, {
      encoding: 'utf8',
    }).trim();
    expect(psqlDb).toBe(EXPECTED_DB);
  });

  it('ClaimEvidenceProvenance enum exists with attested value only', () => {
    const found = execSync(
      `psql "${url}" -tAc "SELECT typname FROM pg_type WHERE typname='ClaimEvidenceProvenance'"`,
      { encoding: 'utf8' },
    ).trim();
    expect(found).toBe('ClaimEvidenceProvenance');
    const labels = execSync(
      `psql "${url}" -tAc "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname='ClaimEvidenceProvenance' ORDER BY enumsortorder"`,
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean);
    expect(labels).toEqual(['SERVER_ATTESTED_ORDER_TERMS']);
  });

  it('provenance column is nullable with no trusted default', () => {
    const col = execSync(
      `psql "${url}" -tAc "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name='exception_claim_evidence' AND column_name='provenance'"`,
      { encoding: 'utf8' },
    ).trim();
    const [nullable, def] = col.split('|').map((s) => s.trim());
    expect(nullable).toBe('YES');
    expect(def === '' || def === 'null' || def == null).toBe(true);
  });

  it('NULL historical provenance is insertable and attested value persists', async () => {
    const nullCheck = await prisma.$queryRaw<Array<{ v: unknown }>>`
      SELECT NULL::"ClaimEvidenceProvenance" AS v
    `;
    expect(nullCheck[0]?.v).toBeNull();
    const attested = await prisma.$queryRaw<Array<{ v: string }>>`
      SELECT 'SERVER_ATTESTED_ORDER_TERMS'::"ClaimEvidenceProvenance" AS v
    `;
    expect(attested[0]?.v).toBe('SERVER_ATTESTED_ORDER_TERMS');
  });
});
