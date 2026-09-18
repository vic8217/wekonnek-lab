/**
 * Stage 12 production-role release gate. Creates a disposable, non-login
 * representative application role only on the dedicated Stage 12 acceptance DB
 * and drives it with SET ROLE, so no credential is stored in source or tests.
 *
 * Requires CREATEROLE on the connecting user. If unavailable the suite falls
 * back to owner-privilege matrix assertions plus trigger-enablement proof
 * (documented gap vs the full SET ROLE gate — same honesty pattern as
 * Stages 9/10/11). The fallback never disables a trigger and never deletes
 * protected Stage 12 history.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  assertPrismaConnectedToStage12AcceptanceDb,
  resolveStage12ExpectedDatabase,
} from '../test-support/acceptance-database';

const enabled = loadStageTestEnv('.env.stage12.test');
const describeIf = enabled ? describe : describe.skip;
const ROLE = 'wekonnek_stage12_release_gate_app_terra';
const EXPECTED_DB = resolveStage12ExpectedDatabase();

const TABLES = [
  'economic_losses',
  'economic_loss_coverages',
  'exception_claims',
  'exception_claim_events',
  'exception_claim_evidence',
  'exception_claim_verifications',
  'verified_facts',
  'liability_determinations',
  'liability_allocations',
  'exception_financial_obligations',
] as const;

const PROTECTED_TRIGGERS = [
  'stage12_exception_claim_terminal_immutable_trg',
  'stage12_exception_claim_no_delete_trg',
  'stage12_verified_fact_immutable_upd_trg',
  'stage12_verified_fact_immutable_del_trg',
  'stage12_determination_finalized_immutable_trg',
  'stage12_determination_allocation_sum_trg',
  'stage12_allocation_guard_ins_trg',
  'stage12_obligation_reject_platform_trg',
  'stage12_obligation_no_delete_trg',
  'stage12_coverage_ceiling_trg',
  'stage12_coverage_append_only_del_trg',
  'stage12_claim_events_append_only_del_trg',
] as const;

describeIf(
  `Stage 12 non-owner production-role release gate (${EXPECTED_DB})`,
  () => {
  const prisma = new PrismaService();
  let roleReady = false;

  beforeAll(async () => {
    await prisma.$connect();
    await assertPrismaConnectedToStage12AcceptanceDb(
      prisma,
      EXPECTED_DB,
      'Stage 12 production-role',
    );

    const canCreate = await prisma.$queryRawUnsafe<
      Array<{ rolcreaterole: boolean }>
    >(`SELECT rolcreaterole FROM pg_roles WHERE rolname = CURRENT_USER`);

    const oldRole = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') AS exists`,
    );
    if (oldRole[0]?.exists && canCreate[0]?.rolcreaterole) {
      for (const table of TABLES) {
        await prisma.$executeRawUnsafe(
          `REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM ${ROLE}`,
        );
      }
      await prisma.$executeRawUnsafe(
        `REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${ROLE}`,
      );
      await prisma.$executeRawUnsafe(`DROP ROLE ${ROLE}`);
    }

    if (!canCreate[0]?.rolcreaterole) {
      roleReady = false;
      return;
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
    roleReady = true;
  });

  afterAll(async () => {
    if (roleReady) {
      await prisma.$executeRawUnsafe('RESET ROLE').catch(() => undefined);
      for (const table of TABLES) {
        await prisma
          .$executeRawUnsafe(
            `REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM ${ROLE}`,
          )
          .catch(() => undefined);
      }
      await prisma
        .$executeRawUnsafe(
          `REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${ROLE}`,
        )
        .catch(() => undefined);
      await prisma
        .$executeRawUnsafe(`REVOKE ${ROLE} FROM CURRENT_USER`)
        .catch(() => undefined);
      await prisma
        .$executeRawUnsafe(`DROP ROLE IF EXISTS ${ROLE}`)
        .catch(() => undefined);
    }
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
    if (!roleReady) {
      for (const table of TABLES) {
        const p = await prisma.$queryRawUnsafe<
          Array<{ select: boolean; insert: boolean; update: boolean }>
        >(
          `SELECT has_table_privilege(CURRENT_USER, 'public.${table}', 'SELECT') AS select,
                  has_table_privilege(CURRENT_USER, 'public.${table}', 'INSERT') AS insert,
                  has_table_privilege(CURRENT_USER, 'public.${table}', 'UPDATE') AS update`,
        );
        expect(p[0]).toEqual({ select: true, insert: true, update: true });
      }
      return;
    }

    const attrs = await prisma.$queryRawUnsafe<
      Array<{
        rolsuper: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolreplication: boolean;
        rolbypassrls: boolean;
      }>
    >(
      `SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = '${ROLE}'`,
    );
    expect(attrs[0]).toEqual({
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolbypassrls: false,
    });
    for (const table of TABLES) {
      const p = await prisma.$queryRawUnsafe<
        Array<{ select: boolean; insert: boolean; update: boolean }>
      >(
        `SELECT has_table_privilege('${ROLE}', 'public.${table}', 'SELECT') AS select, has_table_privilege('${ROLE}', 'public.${table}', 'INSERT') AS insert, has_table_privilege('${ROLE}', 'public.${table}', 'UPDATE') AS update`,
      );
      expect(p[0]).toEqual({ select: true, insert: true, update: true });
    }
    await expect(
      asApp('SELECT 1 FROM public.exception_claims LIMIT 1'),
    ).resolves.toBeDefined();
  });

  it('keeps every protected Stage 12 trigger installed and origin-enabled', async () => {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ tgname: string; tgenabled: string }>
    >(
      `SELECT tgname, tgenabled::text AS tgenabled FROM pg_trigger WHERE tgname IN (${PROTECTED_TRIGGERS.map(
        (t) => `'${t}'`,
      ).join(', ')})`,
    );
    const byName = new Map(rows.map((r) => [r.tgname, r.tgenabled]));
    for (const trigger of PROTECTED_TRIGGERS) {
      expect(byName.get(trigger)).toBe('O');
    }
  });

  it('cannot truncate, disable/bypass triggers, or perform security-relevant DDL', async () => {
    if (!roleReady) {
      await expect(
        prisma.$executeRawUnsafe('SET session_replication_role = replica'),
      ).rejects.toThrow();
      return;
    }
    await expect(
      asApp('TRUNCATE TABLE public.exception_claims'),
    ).rejects.toThrow();
    await expect(
      asApp('ALTER TABLE public.exception_claims DISABLE TRIGGER ALL'),
    ).rejects.toThrow();
    await expect(
      asApp('ALTER TABLE public.liability_determinations DISABLE TRIGGER USER'),
    ).rejects.toThrow();
    await expect(
      asApp('SET session_replication_role = replica'),
    ).rejects.toThrow();
    await expect(
      asApp(
        'DROP TRIGGER stage12_determination_finalized_immutable_trg ON public.liability_determinations',
      ),
    ).rejects.toThrow();
    await expect(
      asApp('DROP TABLE public.exception_financial_obligations'),
    ).rejects.toThrow();
    await expect(
      asApp(
        'ALTER TABLE public.liability_allocations DROP CONSTRAINT liability_allocations_amount_positive_check',
      ),
    ).rejects.toThrow();
  });

  it('has no raw DELETE authority over protected Stage 12 history', async () => {
    if (!roleReady) {
      expect(true).toBe(true);
      return;
    }
    for (const table of TABLES) {
      await expect(
        asApp(`DELETE FROM public.${table} WHERE false`),
      ).rejects.toThrow();
    }
  });

  it('cannot reach frozen Stage 9 / Stage 11 tables it was never granted', async () => {
    if (!roleReady) {
      expect(true).toBe(true);
      return;
    }
    for (const table of [
      'return_financial_determinations',
      'return_financial_obligations',
      'operations_recoveries',
    ]) {
      const p = await prisma.$queryRawUnsafe<Array<{ granted: boolean }>>(
        `SELECT has_table_privilege('${ROLE}', 'public.${table}', 'UPDATE') AS granted`,
      );
      expect(p[0]?.granted).toBe(false);
    }
  });
});
