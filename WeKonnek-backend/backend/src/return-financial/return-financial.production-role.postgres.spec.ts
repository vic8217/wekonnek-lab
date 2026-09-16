/**
 * Stage 9 production-role release gate.  This creates a disposable, non-login
 * representative application role only on the dedicated Stage 9 acceptance DB.
 * It deliberately uses SET ROLE so no credential is stored in source or tests.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { STAGE9_ACCEPTANCE_DATABASE } from '../test-support/test-database-guard';

const enabled = loadStageTestEnv('.env.stage9.test');
const describeIf = enabled ? describe : describe.skip;
const ROLE = 'wekonnek_stage9_release_gate_app_terra';
const TABLES = [
  'return_financial_determinations',
  'return_financial_obligations',
  'return_financial_settlements',
  'rider_advance_collection_restrictions',
  'return_financial_terms_versions',
  'return_financial_terms_acceptances',
  'rider_advance_settlements',
] as const;

describeIf('Stage 9 non-owner production-role release gate', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
    const db = await prisma.$queryRaw<Array<{ database: string }>>(
      Prisma.sql`SELECT current_database() AS database`,
    );
    expect(db[0]?.database).toBe(STAGE9_ACCEPTANCE_DATABASE);
    // A prior interrupted run may leave only the disposable role itself.
    // CREATEROLE is required by this release gate specifically so it can clean
    // that role up before provisioning a fresh one.
    const oldRole = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') AS exists`,
    );
    if (oldRole[0]?.exists) {
      for (const table of TABLES) {
        await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM ${ROLE}`);
      }
      await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${ROLE}`);
      await prisma.$executeRawUnsafe(`DROP ROLE ${ROLE}`);
    }
    await prisma.$executeRawUnsafe(
      `CREATE ROLE ${ROLE} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await prisma.$executeRawUnsafe(`GRANT ${ROLE} TO CURRENT_USER`);
    await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    for (const table of TABLES) {
      await prisma.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE ON TABLE public.${table} TO ${ROLE}`,
      );
    }
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe('RESET ROLE').catch(() => undefined);
    for (const table of TABLES) {
      await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM ${ROLE}`).catch(() => undefined);
    }
    await prisma.$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${ROLE}`).catch(() => undefined);
    await prisma.$executeRawUnsafe(`REVOKE ${ROLE} FROM CURRENT_USER`).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => undefined);
    await prisma.onModuleDestroy();
  });

  async function asApp(sql: string) {
    await prisma.$executeRawUnsafe(`SET ROLE ${ROLE}`);
    try {
      return await prisma.$queryRawUnsafe(sql);
    } finally {
      await prisma.$executeRawUnsafe('RESET ROLE');
    }
  }

  it('is a non-owner, non-superuser role with intended SELECT/INSERT/UPDATE access', async () => {
    const attrs = await prisma.$queryRawUnsafe<Array<{ rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolreplication: boolean; rolbypassrls: boolean }>>(
      `SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = '${ROLE}'`,
    );
    expect(attrs[0]).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false });
    for (const table of TABLES) {
      const p = await prisma.$queryRawUnsafe<Array<{ select: boolean; insert: boolean; update: boolean }>>(
        `SELECT has_table_privilege('${ROLE}', 'public.${table}', 'SELECT') AS select, has_table_privilege('${ROLE}', 'public.${table}', 'INSERT') AS insert, has_table_privilege('${ROLE}', 'public.${table}', 'UPDATE') AS update`,
      );
      expect(p[0]).toEqual({ select: true, insert: true, update: true });
    }
    await expect(asApp('SELECT 1 FROM public.return_financial_determinations LIMIT 1')).resolves.toBeDefined();
  });

  it('cannot truncate, disable/bypass triggers, or perform security-relevant DDL', async () => {
    for (const table of TABLES) {
      await expect(asApp(`TRUNCATE TABLE public.${table}`)).rejects.toThrow();
    }
    await expect(asApp(`TRUNCATE TABLE public.return_financial_determinations, public.return_financial_obligations CASCADE`)).rejects.toThrow();
    await expect(asApp('ALTER TABLE public.return_financial_determinations DISABLE TRIGGER ALL')).rejects.toThrow();
    // Stage 5B's append-only settlement ledger remains protected under the
    // same application-role model after Stage 9's collectibility integration.
    await expect(asApp('ALTER TABLE public.rider_advance_settlements DISABLE TRIGGER ALL')).rejects.toThrow();
    await expect(asApp('SET session_replication_role = replica')).rejects.toThrow();
    await expect(asApp('DROP TRIGGER stage9_rfd_immutable_trg ON public.return_financial_determinations')).rejects.toThrow();
    await expect(asApp('DROP TABLE public.return_financial_determinations')).rejects.toThrow();
    await expect(asApp('ALTER TABLE public.return_financial_determinations OWNER TO CURRENT_USER')).rejects.toThrow();
  });

  it('has no raw DELETE authority over protected Stage 9 history', async () => {
    for (const table of TABLES) {
      await expect(asApp(`DELETE FROM public.${table} WHERE false`)).rejects.toThrow();
    }
  });
});
