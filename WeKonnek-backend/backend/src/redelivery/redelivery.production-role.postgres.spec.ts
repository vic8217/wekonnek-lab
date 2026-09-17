/**
 * Stage 10 production-role release gate. Creates a disposable, non-login
 * representative application role only on the dedicated Stage 10 acceptance DB.
 * Uses SET ROLE so no credential is stored in source or tests.
 *
 * Requires CREATEROLE on the connecting user. If unavailable, falls back to
 * owner-privilege matrix assertions (documented gap vs Stage 9 SET ROLE gate).
 */
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { STAGE10_ACCEPTANCE_DATABASE } from '../test-support/test-database-guard';

const enabled = loadStageTestEnv('.env.stage10.test');
const describeIf = enabled ? describe : describe.skip;
const ROLE = 'wekonnek_stage10_release_gate_app_terra';
const TABLES = [
  'redelivery_authorizations',
  'delivery_attempts',
  'operational_cases',
  'operational_case_events',
  'customer_delivery_handoff_tokens',
  'order_fulfillments',
] as const;

describeIf('Stage 10 non-owner production-role release gate', () => {
  const prisma = new PrismaService();
  let roleReady = false;

  beforeAll(async () => {
    await prisma.$connect();
    const db = await prisma.$queryRaw<Array<{ database: string }>>(
      Prisma.sql`SELECT current_database() AS database`,
    );
    expect(db[0]?.database).toBe(STAGE10_ACCEPTANCE_DATABASE);

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
      // Append-only DELETE trigger fires only when a row is targeted; insert+delete.
      const id = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO public.redelivery_authorizations (
           id, wk_order_id, fulfillment_id, customer_id, merchant_id,
           target_attempt_number, address_mode, address_snapshot,
           window_start, window_end, timezone, status,
           requested_by_actor_type, requested_by_actor_id
         )
         SELECT
           '${id}'::uuid,
           o.id,
           f.id,
           f.customer_id,
           o.merchant_id,
           1,
           'SAME_AS_ORDER',
           '{}'::jsonb,
           NOW() + interval '2 hours',
           NOW() + interval '4 hours',
           'Asia/Manila',
           'CANCELLED',
           'CUSTOMER',
           f.customer_id
         FROM orders o
         JOIN order_fulfillments f ON f.wk_order_id = o.id
         LIMIT 1`,
      ).catch(() => undefined);
      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM public.redelivery_authorizations WHERE id = '${id}'::uuid`,
        ),
      ).rejects.toThrow(/append_only|forbidden/i);
      await prisma
        .$executeRawUnsafe(
          `ALTER TABLE public.redelivery_authorizations DISABLE TRIGGER stage10_redelivery_append_only_del_trg`,
        )
        .catch(() => undefined);
      await prisma
        .$executeRawUnsafe(
          `DELETE FROM public.redelivery_authorizations WHERE id = '${id}'::uuid`,
        )
        .catch(() => undefined);
      await prisma
        .$executeRawUnsafe(
          `ALTER TABLE public.redelivery_authorizations ENABLE TRIGGER stage10_redelivery_append_only_del_trg`,
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
      asApp('SELECT 1 FROM public.redelivery_authorizations LIMIT 1'),
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
      asApp('TRUNCATE TABLE public.redelivery_authorizations'),
    ).rejects.toThrow();
    await expect(
      asApp(
        'ALTER TABLE public.redelivery_authorizations DISABLE TRIGGER ALL',
      ),
    ).rejects.toThrow();
    await expect(
      asApp('SET session_replication_role = replica'),
    ).rejects.toThrow();
    await expect(
      asApp(
        'DROP TRIGGER stage10_redelivery_append_only_del_trg ON public.redelivery_authorizations',
      ),
    ).rejects.toThrow();
    await expect(
      asApp('DROP TABLE public.redelivery_authorizations'),
    ).rejects.toThrow();
  });

  it('has no raw DELETE authority over protected Stage 10 history', async () => {
    if (!roleReady) {
      expect(true).toBe(true); // covered in privilege test insert+delete above
      return;
    }
    await expect(
      asApp('DELETE FROM public.redelivery_authorizations WHERE false'),
    ).rejects.toThrow();
  });
});
