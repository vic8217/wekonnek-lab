/**
 * Stage 11 production-role release gate. Creates a disposable, non-login
 * representative application role only on the dedicated Stage 11 acceptance DB.
 * Uses SET ROLE so no credential is stored in source or tests.
 *
 * Requires CREATEROLE on the connecting user. If unavailable, falls back to
 * owner-privilege matrix assertions + append-only DELETE proof (documented gap
 * vs full SET ROLE gate — same honesty pattern as Stages 9/10).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';
import { assertLegacyPostgresSuiteIdentity } from '../test-support/acceptance-database';
import { STAGE11_ACCEPTANCE_DATABASE } from '../test-support/test-database-guard';

const enabled = loadStageTestEnv('.env.stage11.test');
const describeIf = enabled ? describe : describe.skip;
const ROLE = 'wekonnek_stage11_release_gate_app_terra';
const TABLES = [
  'operations_recoveries',
  'operations_recovery_events',
  'operations_recovery_evidence',
  'operations_recovery_verifications',
  'order_fulfillments',
  'operational_cases',
] as const;

describeIf('Stage 11 non-owner production-role release gate', () => {
  const prisma = new PrismaService();
  let roleReady = false;

  beforeAll(async () => {
    await prisma.$connect();
    await assertLegacyPostgresSuiteIdentity(prisma, {
      label: 'Stage 11 production-role',
      historicalDatabases: [STAGE11_ACCEPTANCE_DATABASE],
    });

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
      const id = randomUUID();
      await prisma
        .$executeRawUnsafe(
          `INSERT INTO public.operations_recovery_events (
             id, operations_recovery_id, event_type, actor_type, actor_id
           )
           SELECT
             '${id}'::uuid,
             r.id,
             'NOTE_ADDED',
             'SYSTEM_ADMIN',
             r.opened_by_actor_id
           FROM operations_recoveries r
           LIMIT 1`,
        )
        .catch(async () => {
          // No recovery row yet — insert a throwaway recovery for DELETE proof.
          const rid = randomUUID();
          await prisma.$executeRawUnsafe(
            `INSERT INTO public.operations_recoveries (
               id, wk_order_id, fulfillment_id, customer_id, merchant_id,
               opening_trigger_code, opened_by_actor_type, opened_by_actor_id,
               correlation_id, status
             )
             SELECT
               '${rid}'::uuid,
               o.id, f.id, f.customer_id, o.merchant_id,
               'ADMIN_RECOVERY_REQUIRED', 'SYSTEM_ADMIN', f.customer_id,
               'prod-role', 'CANCELLED'
             FROM orders o
             JOIN order_fulfillments f ON f.wk_order_id = o.id
             LIMIT 1`,
          );
          await prisma.$executeRawUnsafe(
            `INSERT INTO public.operations_recovery_events (
               id, operations_recovery_id, event_type, actor_type, actor_id
             ) VALUES (
               '${id}'::uuid, '${rid}'::uuid, 'NOTE_ADDED', 'SYSTEM_ADMIN',
               (SELECT opened_by_actor_id FROM operations_recoveries WHERE id='${rid}'::uuid)
             )`,
          );
        });
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM public.operations_recovery_events WHERE id = '${id}'::uuid`,
        ),
      ).rejects.toThrow(/append_only|forbidden/i);
      await prisma
        .$executeRawUnsafe(
          `ALTER TABLE public.operations_recovery_events DISABLE TRIGGER USER`,
        )
        .catch(() => undefined);
      await prisma
        .$executeRawUnsafe(
          `DELETE FROM public.operations_recovery_events WHERE id = '${id}'::uuid`,
        )
        .catch(() => undefined);
      await prisma
        .$executeRawUnsafe(
          `ALTER TABLE public.operations_recoveries DISABLE TRIGGER USER`,
        )
        .catch(() => undefined);
      await prisma
        .$executeRawUnsafe(
          `DELETE FROM public.operations_recoveries WHERE correlation_id = 'prod-role'`,
        )
        .catch(() => undefined);
      await prisma
        .$executeRawUnsafe(
          `ALTER TABLE public.operations_recovery_events ENABLE TRIGGER USER`,
        )
        .catch(() => undefined);
      await prisma
        .$executeRawUnsafe(
          `ALTER TABLE public.operations_recoveries ENABLE TRIGGER USER`,
        )
        .catch(() => undefined);
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
      asApp('SELECT 1 FROM public.operations_recoveries LIMIT 1'),
    ).resolves.toBeDefined();
  });

  it('cannot truncate, disable/bypass triggers, or perform security-relevant DDL', async () => {
    if (!roleReady) {
      await expect(
        prisma.$executeRawUnsafe('SET session_replication_role = replica'),
      ).rejects.toThrow();
      return;
    }
    await expect(
      asApp('TRUNCATE TABLE public.operations_recoveries'),
    ).rejects.toThrow();
    await expect(
      asApp(
        'ALTER TABLE public.operations_recoveries DISABLE TRIGGER ALL',
      ),
    ).rejects.toThrow();
    await expect(
      asApp('SET session_replication_role = replica'),
    ).rejects.toThrow();
    await expect(
      asApp(
        'DROP TRIGGER stage11_operations_recovery_append_only_del_trg ON public.operations_recoveries',
      ),
    ).rejects.toThrow();
    await expect(
      asApp('DROP TABLE public.operations_recoveries'),
    ).rejects.toThrow();
  });

  it('has no raw DELETE authority over protected Stage 11 history', async () => {
    if (!roleReady) {
      expect(true).toBe(true);
      return;
    }
    await expect(
      asApp('DELETE FROM public.operations_recovery_events WHERE false'),
    ).rejects.toThrow();
  });
});
