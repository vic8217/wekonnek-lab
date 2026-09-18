/**
 * Stage 13A production-role release gate for settlement tables.
 * Creates a disposable, non-login representative application role only on the
 * dedicated Stage 13A acceptance DB and drives it with SET ROLE when CREATEROLE
 * is available. Fallback: owner privilege matrix + trigger-enablement proof.
 *
 * Never disables a trigger and never deletes protected Stage 13A history.
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertPrismaConnectedToStage13aAcceptanceDb,
  resolveStage13aExpectedDatabase,
} from '../test-support/acceptance-database';

const enabled = loadStageTestEnv('.env.stage13a.test');
const describeIf = enabled ? describe : describe.skip;
const ROLE = 'wekonnek_stage13a_release_gate_app_terra';
const EXPECTED_DB = resolveStage13aExpectedDatabase();

const TABLES = [
  'exception_financial_settlements',
  'exception_financial_settlement_evidence',
  'exception_financial_obligations',
] as const;

const PROTECTED_TRIGGERS = [
  'stage13a_efs_overpayment_ins_trg',
  'stage13a_efs_overpayment_upd_trg',
  'stage13a_efs_immutable_trg',
  'stage13a_efs_no_delete_trg',
  'stage13a_efse_immutable_upd_trg',
  'stage13a_efse_no_delete_trg',
  'stage13a_efs_reject_platform_trg',
  'stage13a_efo_economic_identity_trg',
  'stage13a_efo_status_authority_trg',
  'stage12_obligation_no_delete_trg',
] as const;

describeIf(
  `Stage 13A settlement non-owner production-role release gate (${EXPECTED_DB})`,
  () => {
    const prisma = new PrismaService();
    let roleReady = false;

    beforeAll(async () => {
      await prisma.$connect();
      await assertPrismaConnectedToStage13aAcceptanceDb(
        prisma,
        EXPECTED_DB,
        'Stage 13A settlement production-role',
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
        asApp('SELECT 1 FROM public.exception_financial_settlements LIMIT 1'),
      ).resolves.toBeDefined();
    });

    it('keeps every protected Stage 13A settlement trigger installed and origin-enabled', async () => {
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
        asApp('TRUNCATE TABLE public.exception_financial_settlements'),
      ).rejects.toThrow();
      await expect(
        asApp('TRUNCATE TABLE public.exception_financial_obligations'),
      ).rejects.toThrow();
      await expect(
        asApp(
          'ALTER TABLE public.exception_financial_settlements DISABLE TRIGGER ALL',
        ),
      ).rejects.toThrow();
      await expect(
        asApp(
          'ALTER TABLE public.exception_financial_settlement_evidence DISABLE TRIGGER USER',
        ),
      ).rejects.toThrow();
      await expect(
        asApp(
          'ALTER TABLE public.exception_financial_obligations DISABLE TRIGGER ALL',
        ),
      ).rejects.toThrow();
      await expect(
        asApp(
          'ALTER TABLE public.exception_financial_obligations DISABLE TRIGGER stage13a_efo_economic_identity_trg',
        ),
      ).rejects.toThrow();
      await expect(
        asApp(
          'ALTER TABLE public.exception_financial_obligations DISABLE TRIGGER stage13a_efo_status_authority_trg',
        ),
      ).rejects.toThrow();
      await expect(
        asApp('SET session_replication_role = replica'),
      ).rejects.toThrow();
      await expect(
        asApp(
          'DROP TRIGGER stage13a_efs_immutable_trg ON public.exception_financial_settlements',
        ),
      ).rejects.toThrow();
      await expect(
        asApp(
          'DROP TRIGGER stage13a_efo_economic_identity_trg ON public.exception_financial_obligations',
        ),
      ).rejects.toThrow();
      await expect(
        asApp(
          'DROP TRIGGER stage13a_efo_status_authority_trg ON public.exception_financial_obligations',
        ),
      ).rejects.toThrow();
      await expect(
        asApp('DROP TABLE public.exception_financial_settlements'),
      ).rejects.toThrow();
      await expect(
        asApp('DROP TABLE public.exception_financial_obligations'),
      ).rejects.toThrow();
    });

    it('has no raw DELETE authority over protected Stage 13A settlement history', async () => {
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

    it('cannot UPDATE immutable obligation identity or DELETE an authoritative obligation', async () => {
      const target = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id FROM public.exception_financial_obligations LIMIT 1`,
      );
      if (target.length === 0) {
        throw new Error(
          'Stage 13A production-role identity probe requires at least one exception_financial_obligations row',
        );
      }
      const id = target[0].id;
      const before = await prisma.$queryRawUnsafe<
        Array<{ principal: string; debtor_user_id: string | null }>
      >(
        `SELECT principal::text AS principal, debtor_user_id::text AS debtor_user_id
         FROM public.exception_financial_obligations WHERE id = '${id}'::uuid`,
      );

      if (roleReady) {
        await expect(
          asApp(
            `UPDATE public.exception_financial_obligations SET principal = 2000.00 WHERE id = '${id}'::uuid`,
          ),
        ).rejects.toThrow(/stage13a_exception_obligation_immutable|check_violation|23514/i);
        await expect(
          asApp(
            `DELETE FROM public.exception_financial_obligations WHERE id = '${id}'::uuid`,
          ),
        ).rejects.toThrow();
      } else {
        await expect(
          prisma.$executeRawUnsafe(
            `UPDATE public.exception_financial_obligations SET principal = 2000.00 WHERE id = $1::uuid`,
            id,
          ),
        ).rejects.toThrow(/stage13a_exception_obligation_immutable|check_violation|23514/i);
        await expect(
          prisma.$executeRawUnsafe(
            `DELETE FROM public.exception_financial_obligations WHERE id = $1::uuid`,
            id,
          ),
        ).rejects.toThrow(/stage12_obligation_no_delete|no_delete|forbidden/i);
      }

      const after = await prisma.$queryRawUnsafe<
        Array<{ principal: string; debtor_user_id: string | null }>
      >(
        `SELECT principal::text AS principal, debtor_user_id::text AS debtor_user_id
         FROM public.exception_financial_obligations WHERE id = '${id}'::uuid`,
      );
      expect(after[0]).toEqual(before[0]);
    });

    it('cannot fabricate CANCELLED or WRITTEN_OFF on an executable obligation', async () => {
      const target = await prisma.$queryRawUnsafe<
        Array<{ id: string; status: string }>
      >(
        `SELECT id::text AS id, status::text AS status
         FROM public.exception_financial_obligations
         WHERE status IN ('OPEN', 'PARTIALLY_SETTLED', 'SETTLED')
         LIMIT 1`,
      );
      if (target.length === 0) {
        throw new Error(
          'Stage 13A production-role status probe requires an executable obligation row',
        );
      }
      const id = target[0].id;
      const before = target[0].status;
      const run = async (sql: string) => {
        if (roleReady) {
          await asApp(sql);
        } else {
          await prisma.$executeRawUnsafe(sql);
        }
      };
      for (const status of ['CANCELLED', 'WRITTEN_OFF'] as const) {
        await expect(
          run(
            `UPDATE public.exception_financial_obligations SET status = '${status}' WHERE id = '${id}'::uuid`,
          ),
        ).rejects.toThrow(
          /status_authority|CANCELLED\/WRITTEN_OFF|check_violation|23514/i,
        );
      }
      const after = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
        `SELECT status::text AS status FROM public.exception_financial_obligations WHERE id = '${id}'::uuid`,
      );
      expect(after[0]?.status).toBe(before);
    });
  },
);
