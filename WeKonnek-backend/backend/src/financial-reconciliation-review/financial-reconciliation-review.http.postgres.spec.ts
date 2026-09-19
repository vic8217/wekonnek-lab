/**
 * Stage14A PostgreSQL acceptance. Dedicated wekonnek_stage14a_* disposable DB.
 * Never mutates historical frozen DBs.
 */
import { existsSync, mkdirSync, cpSync, readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { loadStage14aTestEnv } from '../test-support/load-stage-test-env';
import {
  assertSafeCurrentSchemaRegressionDatabase,
  getExplicitAcceptanceDatabaseUrl,
  parseAcceptanceDatabaseUrl,
  stage13b2AllowedDbUsers,
} from '../test-support/acceptance-database';
import {
  isCurrentSchemaRegressionMode,
  isRecognizedCurrentSchemaDisposableName,
  readDatabaseIdentity,
} from '../test-support/test-database-guard';

const STAGE14A_ENV_PRESENT = loadStage14aTestEnv();

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ExceptionLiablePartyType, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import {
  insertFinalizedSuccessorAdjustment,
  seedOpenObligation,
} from '../exception-financial/exception-financial-settlement.test-seed';
import { ExceptionFinancialService } from '../exception-financial/exception-financial.service';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import {
  insertActiveRestriction,
  insertExceptionAck,
  insertFinalizedReturnDetermination,
  insertRiderAdvance,
  seedOrderParties,
} from '../financial-reconciliation/financial-reconciliation.test-seed';

function stage14aConnectionUrl(): string {
  const candidates = [
    getExplicitAcceptanceDatabaseUrl(),
    process.env.DATABASE_URL,
  ].filter((url): url is string => Boolean(url && url.trim()));
  for (const url of candidates) {
    try {
      const parsed = parseAcceptanceDatabaseUrl(url);
      if (
        parsed.database.startsWith('wekonnek_stage14a_') &&
        isRecognizedCurrentSchemaDisposableName(parsed.database)
      ) {
        return url;
      }
    } catch {
      continue;
    }
  }
  throw new Error('Stage14A postgres: no DATABASE_URL / acceptance override naming wekonnek_stage14a_*');
}

function resolveStage14aExpectedDatabase(): string {
  const url = stage14aConnectionUrl();
  const parsed = parseAcceptanceDatabaseUrl(url);
  if (!isCurrentSchemaRegressionMode()) {
    throw new Error('Stage14A postgres requires WEKONNEK_CURRENT_SCHEMA_REGRESSION=1');
  }
  if (
    !parsed.database.startsWith('wekonnek_stage14a_') ||
    !isRecognizedCurrentSchemaDisposableName(parsed.database)
  ) {
    throw new Error(
      `Stage14A postgres refuses database ${parsed.database}; use wekonnek_stage14a_* disposable`,
    );
  }
  assertSafeCurrentSchemaRegressionDatabase(parsed.database, 'Stage14A postgres');
  return parsed.database;
}

const describeIf = STAGE14A_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = STAGE14A_ENV_PRESENT
  ? resolveStage14aExpectedDatabase()
  : 'wekonnek_stage14a_cursor_test';
const ALLOWED_DB_USERS = stage13b2AllowedDbUsers(EXPECTED_DB);

async function applyStage14aMigrationIfNeeded(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const identity = await client.query<{ database: string; user: string }>(
      'SELECT current_database() AS database, current_user AS user',
    );
    if (identity.rows[0]?.database !== EXPECTED_DB) {
      throw new Error(
        `Stage14A migration refused: current_database()=${identity.rows[0]?.database}`,
      );
    }
    if (!ALLOWED_DB_USERS.has(identity.rows[0]!.user)) {
      throw new Error(
        `Stage14A migration refused: current_user()=${identity.rows[0]?.user}`,
      );
    }
    const exists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'financial_reconciliation_reviews'`,
    );
    if ((exists.rowCount ?? 0) > 0) return;
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260919120000_stage14a_financial_reconciliation_review/migration.sql',
      ),
      'utf8',
    );
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function snapshotFinancialTables(prisma: PrismaService) {
  const [
    riderAdvanceSettlement,
    returnFinancialSettlement,
    exceptionFinancialSettlement,
    riderAdvance,
    returnFinancialObligation,
    exceptionFinancialObligation,
    economicLossCoverage,
    liabilityDetermination,
    restriction,
  ] = await Promise.all([
    prisma.riderAdvanceSettlement.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, status: true, acknowledgedAmount: true },
    }),
    prisma.returnFinancialSettlement.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, status: true, acknowledgedAmount: true },
    }),
    prisma.exceptionFinancialSettlement.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, status: true, acknowledgedAmount: true },
    }),
    prisma.riderAdvance.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, status: true, reimbursementPrincipal: true },
    }),
    prisma.returnFinancialObligation.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, principal: true },
    }),
    prisma.exceptionFinancialObligation.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, principal: true, status: true },
    }),
    prisma.economicLossCoverage.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, amount: true },
    }),
    prisma.liabilityDetermination.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, status: true },
    }),
    prisma.riderAdvanceCollectionRestriction.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, restrictedAmount: true, status: true },
    }),
  ]);
  return {
    riderAdvanceSettlement,
    returnFinancialSettlement,
    exceptionFinancialSettlement,
    riderAdvance,
    returnFinancialObligation,
    exceptionFinancialObligation,
    economicLossCoverage,
    liabilityDetermination,
    restriction,
  };
}

async function snapshotReviewRow(prisma: PrismaService, id: string) {
  const rows = await prisma.$queryRaw<
    Array<Record<string, unknown>>
  >`
    SELECT
      id::text AS id,
      wk_order_id,
      finding_key,
      finding_code,
      opening_fingerprint,
      current_fingerprint,
      status::text AS status,
      assigned_admin_user_id::text AS assigned_admin_user_id,
      route_classification::text AS route_classification,
      waiting_party_type::text AS waiting_party_type,
      close_classification::text AS close_classification,
      close_reason,
      prior_review_id::text AS prior_review_id,
      row_version,
      created_by_admin_user_id::text AS created_by_admin_user_id,
      created_at,
      updated_at,
      closed_at
    FROM financial_reconciliation_reviews
    WHERE id = ${id}::uuid
  `;
  return rows[0];
}

describeIf(`Stage14A financial reconciliation review (${EXPECTED_DB})`, () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminId: string;
  let staffId: string;
  let customerId: string;
  let merchantUserId: string;
  let riderId: string;
  let coordinatorId: string;
  let orderId: number;
  let raId: string;
  let findingKey: string;

  const runtimeI18n = join(process.cwd(), 'i18n');
  const sourceI18n = join(process.cwd(), 'src', 'i18n');
  const auth = (user: { id: string; role: UserRole; portal?: string }) => ({
    Authorization: `Bearer ${sign(
      { sub: user.id, role: user.role, portal: user.portal },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '1h' },
    )}`,
  });

  beforeAll(async () => {
    const url = stage14aConnectionUrl();
    await applyStage14aMigrationIfNeeded(url);
    if (!existsSync(runtimeI18n)) {
      mkdirSync(runtimeI18n, { recursive: true });
      cpSync(sourceI18n, runtimeI18n, { recursive: true });
    }
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
    prisma = app.get(PrismaService);
    const identity = await readDatabaseIdentity(prisma);
    expect(identity.database).toBe(EXPECTED_DB);
    expect(ALLOWED_DB_USERS.has(identity.user)).toBe(true);

    const fx = await seedOrderParties(prisma);
    customerId = fx.customerId;
    merchantUserId = fx.merchantUserId;
    riderId = fx.riderAId;
    orderId = fx.orderId;
    raId = await insertRiderAdvance(prisma, fx, {
      riderId: fx.riderAId,
      principal: '1000.00',
    });
    await insertFinalizedReturnDetermination(prisma, fx, {
      riderAdvanceId: raId,
      merchantToRider: '400.00',
      merchantToCustomer: '0.00',
      snapshotPrincipal: '1000.00',
      snapshotReimbursed: '0.00',
    });
    const staff = await prisma.user.create({
      data: {
        phone: `+63${fx.tag.replace(/-/g, '').slice(0, 15)}s`,
        email: `s14a-staff-${fx.tag}@test.invalid`,
        role: UserRole.staff,
        firstName: 'staff',
      },
    });
    staffId = staff.id;
    const coordinator = await prisma.user.create({
      data: {
        phone: `+63${fx.tag.replace(/-/g, '').slice(0, 15)}c`,
        email: `s14a-coord-${fx.tag}@test.invalid`,
        role: UserRole.coordinator,
        firstName: 'coord',
      },
    });
    coordinatorId = coordinator.id;
    const admin = await prisma.user.create({
      data: {
        phone: `+63${fx.tag.replace(/-/g, '').slice(0, 15)}a`,
        email: `s14a-admin-${fx.tag}@test.invalid`,
        role: UserRole.admin,
        firstName: 'admin',
      },
    });
    adminId = admin.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports current_database() / current_user() before fixtures mutate reviews', async () => {
    const identity = await readDatabaseIdentity(prisma);
    expect(identity.database).toBe(EXPECTED_DB);
    expect(ALLOWED_DB_USERS.has(identity.user)).toBe(true);
  });

  it('creates a review from a live finding and is idempotent', async () => {
    const live = await request(app.getHttpServer())
      .get(`/api/orders/${orderId}/financial-reconciliation`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    expect(live.body.findings.length).toBeGreaterThan(0);
    findingKey = live.body.findings[0].findingKey;
    const first = await request(app.getHttpServer())
      .post('/api/admin/financial-reconciliation/reviews')
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ wkOrderId: orderId, findingKey })
      .expect(201);
    expect(first.body.created).toBe(true);
    expect(first.body.review.findingKey).toBe(findingKey);
    const second = await request(app.getHttpServer())
      .post('/api/admin/financial-reconciliation/reviews')
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ wkOrderId: orderId, findingKey })
      .expect(200);
    expect(second.body.created).toBe(false);
    expect(second.body.review.id).toBe(first.body.review.id);
  });

  it('rejects non-live and tampered finding keys', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/financial-reconciliation/reviews')
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ wkOrderId: orderId, findingKey: 'tampered-not-live' })
      .expect(409)
      .expect((res) => {
        expect(String(res.body.message)).toContain('STALE_FINDING');
      });
  });

  it('denies staff, customer, merchant, rider, coordinator, and shop portal', async () => {
    const denied = [
      { id: staffId, role: UserRole.staff },
      { id: customerId, role: UserRole.customer },
      { id: merchantUserId, role: UserRole.merchant },
      { id: riderId, role: UserRole.rider },
      { id: coordinatorId, role: UserRole.coordinator },
      { id: adminId, role: UserRole.admin, portal: 'shop' as const },
    ];
    for (const user of denied) {
      await request(app.getHttpServer())
        .get('/api/admin/financial-reconciliation/reviews')
        .set(auth(user))
        .expect((res) => {
          expect([401, 403]).toContain(res.status);
        });
    }
  });

  it('assigns with optimistic concurrency and rejects stale versions', async () => {
    const listed = await request(app.getHttpServer())
      .get(`/api/admin/financial-reconciliation/reviews?wkOrderId=${orderId}`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const review = listed.body.items[0];
    const ok = await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${review.id}/assign`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ assignedAdminUserId: adminId, expectedVersion: review.rowVersion })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${review.id}/assign`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ assignedAdminUserId: null, expectedVersion: review.rowVersion })
      .expect(409);
    expect(ok.body.assignedAdminUserId).toBe(adminId);
  });

  it('notes are append-only and idempotent by key', async () => {
    const listed = await request(app.getHttpServer())
      .get(`/api/admin/financial-reconciliation/reviews?wkOrderId=${orderId}`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const reviewId = listed.body.items[0].id;
    const key = 'note-key-1';
    const first = await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${reviewId}/notes`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ body: 'Investigating restriction', idempotencyKey: key })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${reviewId}/notes`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ body: 'Investigating restriction', idempotencyKey: key })
      .expect(201);
    expect(second.body.id).toBe(first.body.id);
    await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${reviewId}/notes`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ body: 'different body', idempotencyKey: key })
      .expect(409);
    await expect(
      prisma.financialReconciliationReviewNote.update({
        where: { id: first.body.id },
        data: { body: 'hacked' },
      }),
    ).rejects.toThrow(/append_only|forbidden/i);
    await expect(
      prisma.financialReconciliationReviewNote.delete({
        where: { id: first.body.id },
      }),
    ).rejects.toThrow(/append_only|forbidden/i);
  });

  it('refreshes live reconciliation and rejects condition-cleared while finding is active', async () => {
    const listed = await request(app.getHttpServer())
      .get(`/api/admin/financial-reconciliation/reviews?wkOrderId=${orderId}`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const reviewId = listed.body.items[0].id;
    const refreshed = await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${reviewId}/refresh`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(201);
    expect(refreshed.body.findingActive).toBe(true);
    await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${reviewId}/close`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({
        mode: 'CONDITION_CLEARED',
        reason: 'trying to close early',
        expectedVersion: refreshed.body.rowVersion,
      })
      .expect(409)
      .expect((res) => {
        expect(String(res.body.message)).toContain('FINDING_STILL_ACTIVE');
      });
    await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${reviewId}/close`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({
        mode: 'REVIEW_ONLY',
        reason: 'not allowlisted',
        expectedVersion: refreshed.body.rowVersion,
      })
      .expect(400);
  });

  it('review mutations do not change frozen financial authority', async () => {
    const before = await snapshotFinancialTables(prisma);
    const listed = await request(app.getHttpServer())
      .get(`/api/admin/financial-reconciliation/reviews?wkOrderId=${orderId}`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const review = listed.body.items[0];
    await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${review.id}/escalate`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ reason: 'Needs engineering inspection', expectedVersion: review.rowVersion })
      .expect(201);
    const after = await snapshotFinancialTables(prisma);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('events cannot be updated or deleted', async () => {
    const event = await prisma.financialReconciliationReviewEvent.findFirst({
      where: { type: 'REVIEW_OPENED' },
    });
    expect(event).toBeTruthy();
    await expect(
      prisma.financialReconciliationReviewEvent.update({
        where: { id: event!.id },
        data: { payload: { hacked: true } },
      }),
    ).rejects.toThrow(/append_only|forbidden/i);
    await expect(
      prisma.financialReconciliationReviewEvent.delete({ where: { id: event!.id } }),
    ).rejects.toThrow(/append_only|forbidden/i);
  });

  it('closes condition-cleared only after the live finding disappears, without suppressing detectors by case close', async () => {
    const fx = await seedOrderParties(prisma);
    const ra = await insertRiderAdvance(prisma, fx, {
      riderId: fx.riderAId,
      principal: '800.00',
    });
    const det = await insertFinalizedReturnDetermination(prisma, fx, {
      riderAdvanceId: ra,
      merchantToRider: '300.00',
      merchantToCustomer: '0.00',
      snapshotPrincipal: '800.00',
      snapshotReimbursed: '0.00',
    });
    const live = await request(app.getHttpServer())
      .get(`/api/orders/${fx.orderId}/financial-reconciliation`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const key = live.body.findings[0].findingKey;
    const created = await request(app.getHttpServer())
      .post('/api/admin/financial-reconciliation/reviews')
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ wkOrderId: fx.orderId, findingKey: key })
      .expect(201);
    await insertActiveRestriction(prisma, fx, ra, det.determinationId, '300.00');
    const afterFix = await request(app.getHttpServer())
      .get(`/api/orders/${fx.orderId}/financial-reconciliation`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const stillPresent = afterFix.body.findings.some(
      (finding: { findingKey: string }) => finding.findingKey === key,
    );
    if (!stillPresent) {
      await request(app.getHttpServer())
        .post(`/api/admin/financial-reconciliation/reviews/${created.body.review.id}/close`)
        .set(auth({ id: adminId, role: UserRole.admin }))
        .send({
          mode: 'CONDITION_CLEARED',
          reason: 'Restriction now present from domain fixture',
          expectedVersion: created.body.review.rowVersion,
        })
        .expect(201);
      const closedLive = await request(app.getHttpServer())
        .get(`/api/orders/${fx.orderId}/financial-reconciliation`)
        .set(auth({ id: adminId, role: UserRole.admin }))
        .expect(200);
      expect(
        closedLive.body.findings.some(
          (finding: { findingKey: string }) => finding.findingKey === key,
        ),
      ).toBe(false);
    }
    expect(stillPresent).toBe(false);
  });

  it('rejects staff assignment and cross-order finding substitution', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/financial-reconciliation/reviews')
      .set(auth({ id: staffId, role: UserRole.staff }))
      .send({ wkOrderId: orderId, findingKey })
      .expect((res) => {
        expect([401, 403]).toContain(res.status);
      });
    const other = await seedOrderParties(prisma);
    await request(app.getHttpServer())
      .post('/api/admin/financial-reconciliation/reviews')
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ wkOrderId: other.orderId, findingKey })
      .expect(409)
      .expect((res) => {
        expect(String(res.body.message)).toContain('STALE_FINDING');
      });
    const listed = await request(app.getHttpServer())
      .get(`/api/admin/financial-reconciliation/reviews?wkOrderId=${orderId}`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${listed.body.items[0].id}/assign`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ assignedAdminUserId: staffId, expectedVersion: listed.body.items[0].rowVersion })
      .expect(400);
  });

  it('creates distinct reviews for the same findingCode on distinct canonical keys', async () => {
    const fx = await seedOrderParties(prisma);
    const ra = await insertRiderAdvance(prisma, fx, {
      riderId: fx.riderAId,
      principal: '900.00',
    });
    await insertFinalizedReturnDetermination(prisma, fx, {
      riderAdvanceId: ra,
      merchantToRider: '200.00',
      merchantToCustomer: '0.00',
      snapshotPrincipal: '900.00',
      snapshotReimbursed: '0.00',
    });
    const live = await request(app.getHttpServer())
      .get(`/api/orders/${fx.orderId}/financial-reconciliation`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const key = live.body.findings[0].findingKey;
    expect(key).not.toBe(findingKey);
    const created = await request(app.getHttpServer())
      .post('/api/admin/financial-reconciliation/reviews')
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ wkOrderId: fx.orderId, findingKey: key })
      .expect(201);
    expect(created.body.review.findingCode).toBe(live.body.findings[0].code);
    expect(created.body.review.id).not.toBeUndefined();
    const original = await request(app.getHttpServer())
      .get(`/api/admin/financial-reconciliation/reviews?wkOrderId=${orderId}`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    expect(original.body.items.some((item: { findingKey: string }) => item.findingKey === findingKey)).toBe(
      true,
    );
    expect(created.body.review.findingKey).not.toBe(findingKey);
  });

  it('duplicate concurrent creates return one open review', async () => {
    const fx = await seedOrderParties(prisma);
    const ra = await insertRiderAdvance(prisma, fx, {
      riderId: fx.riderAId,
      principal: '700.00',
    });
    await insertFinalizedReturnDetermination(prisma, fx, {
      riderAdvanceId: ra,
      merchantToRider: '250.00',
      merchantToCustomer: '0.00',
      snapshotPrincipal: '700.00',
      snapshotReimbursed: '0.00',
    });
    const live = await request(app.getHttpServer())
      .get(`/api/orders/${fx.orderId}/financial-reconciliation`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const key = live.body.findings[0].findingKey;
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/admin/financial-reconciliation/reviews')
        .set(auth({ id: adminId, role: UserRole.admin }))
        .send({ wkOrderId: fx.orderId, findingKey: key }),
      request(app.getHttpServer())
        .post('/api/admin/financial-reconciliation/reviews')
        .set(auth({ id: adminId, role: UserRole.admin }))
        .send({ wkOrderId: fx.orderId, findingKey: key }),
    ]);
    expect([200, 201]).toContain(a.status);
    expect([200, 201]).toContain(b.status);
    expect(a.body.review.id).toBe(b.body.review.id);
    const open = await prisma.financialReconciliationReview.count({
      where: {
        wkOrderId: fx.orderId,
        findingKey: key,
        status: { in: ['OPEN', 'IN_REVIEW', 'WAITING_ON_PARTY', 'ESCALATED_ENGINEERING'] },
      },
    });
    expect(open).toBe(1);
  });

  it('concurrent assign vs escalate yields one success and a version conflict', async () => {
    const listed = await request(app.getHttpServer())
      .get(`/api/admin/financial-reconciliation/reviews?wkOrderId=${orderId}`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const review = listed.body.items[0];
    const [assign, escalate] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/admin/financial-reconciliation/reviews/${review.id}/assign`)
        .set(auth({ id: adminId, role: UserRole.admin }))
        .send({ assignedAdminUserId: adminId, expectedVersion: review.rowVersion }),
      request(app.getHttpServer())
        .post(`/api/admin/financial-reconciliation/reviews/${review.id}/escalate`)
        .set(auth({ id: adminId, role: UserRole.admin }))
        .send({ reason: 'Concurrent engineering look', expectedVersion: review.rowVersion }),
    ]);
    const statuses = [assign.status, escalate.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('concurrent notes with the same idempotency key do not duplicate', async () => {
    const listed = await request(app.getHttpServer())
      .get(`/api/admin/financial-reconciliation/reviews?wkOrderId=${orderId}`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const reviewId = listed.body.items[0].id;
    const key = `concurrent-note-${reviewId}`;
    const [a, b] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/admin/financial-reconciliation/reviews/${reviewId}/notes`)
        .set(auth({ id: adminId, role: UserRole.admin }))
        .send({ body: 'Same note body', idempotencyKey: key }),
      request(app.getHttpServer())
        .post(`/api/admin/financial-reconciliation/reviews/${reviewId}/notes`)
        .set(auth({ id: adminId, role: UserRole.admin }))
        .send({ body: 'Same note body', idempotencyKey: key }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
    expect(
      await prisma.financialReconciliationReviewNote.count({
        where: { reviewId, idempotencyKey: key },
      }),
    ).toBe(1);
  });

  it('raw SQL cannot update or delete append-only review children', async () => {
    const event = await prisma.financialReconciliationReviewEvent.findFirst({
      where: { type: 'REVIEW_OPENED' },
    });
    const note = await prisma.financialReconciliationReviewNote.findFirst();
    expect(event).toBeTruthy();
    expect(note).toBeTruthy();
    await expect(
      prisma.$executeRaw`
        UPDATE financial_reconciliation_review_events
        SET payload = '{}'::jsonb
        WHERE id = ${event!.id}::uuid
      `,
    ).rejects.toThrow(/append_only|forbidden/i);
    await expect(
      prisma.$executeRaw`
        DELETE FROM financial_reconciliation_review_events
        WHERE id = ${event!.id}::uuid
      `,
    ).rejects.toThrow(/append_only|forbidden/i);
    await expect(
      prisma.$executeRaw`
        UPDATE financial_reconciliation_review_notes
        SET body = 'hacked'
        WHERE id = ${note!.id}::uuid
      `,
    ).rejects.toThrow(/append_only|forbidden/i);
    await expect(
      prisma.$executeRaw`
        DELETE FROM financial_reconciliation_review_notes
        WHERE id = ${note!.id}::uuid
      `,
    ).rejects.toThrow(/append_only|forbidden/i);
  });

  it('review-only close is allowlisted and does not suppress the detector', async () => {
    const exceptions = app.get(ExceptionFinancialService);
    await exceptions.ensureSeededPolicy();
    const fx = await seedOpenObligation(prisma, exceptions, { principal: '800.00' });
    await insertExceptionAck(prisma, {
      obligationId: fx.obligationId,
      wkOrderId: fx.orderId,
      amount: '300.00',
      debtorType: ExceptionLiablePartyType.CUSTOMER,
      debtorUserId: fx.customerId,
      debtorMerchantId: null,
      creditorType: ExceptionLiablePartyType.MERCHANT,
      creditorUserId: null,
      creditorMerchantId: fx.merchantId,
      actorId: fx.adminId,
    });
    const succDetId = await insertFinalizedSuccessorAdjustment(prisma, fx);
    await prisma.exceptionFinancialObligation.create({
      data: {
        id: randomUUID(),
        liabilityDeterminationId: succDetId,
        exceptionClaimId: fx.claimId,
        economicLossId: fx.economicLossId,
        wkOrderId: fx.orderId,
        debtorType: ExceptionLiablePartyType.CUSTOMER,
        debtorUserId: fx.customerId,
        creditorType: ExceptionLiablePartyType.MERCHANT,
        creditorMerchantId: fx.merchantId,
        principal: '500.00',
        currency: 'PHP',
        status: 'OPEN',
        reason: 'successor obligation',
      },
    });
    const live = await request(app.getHttpServer())
      .get(`/api/orders/${fx.orderId}/financial-reconciliation`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const finding = live.body.findings.find(
      (item: { code: string }) => item.code === 'SUCCESSOR_REVIEW_REQUIRED',
    );
    expect(finding).toBeTruthy();
    const created = await request(app.getHttpServer())
      .post('/api/admin/financial-reconciliation/reviews')
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ wkOrderId: fx.orderId, findingKey: finding.findingKey })
      .expect(201);
    expect(created.body.review.reviewOnlyClosePermitted).toBe(true);
    const closed = await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${created.body.review.id}/close`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({
        mode: 'REVIEW_ONLY',
        reason: 'Operational follow-up only; detector remains live',
        expectedVersion: created.body.review.rowVersion,
      })
      .expect(201);
    expect(closed.body.status).toBe('CLOSED_REVIEW_ONLY');
    const after = await request(app.getHttpServer())
      .get(`/api/orders/${fx.orderId}/financial-reconciliation`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    expect(
      after.body.findings.some(
        (item: { findingKey: string }) => item.findingKey === finding.findingKey,
      ),
    ).toBe(true);
  });

  it('reopening after condition-cleared reappearance creates a new linked review', async () => {
    const fx = await seedOrderParties(prisma);
    const ra = await insertRiderAdvance(prisma, fx, {
      riderId: fx.riderAId,
      principal: '650.00',
    });
    await insertFinalizedReturnDetermination(prisma, fx, {
      riderAdvanceId: ra,
      merchantToRider: '200.00',
      merchantToCustomer: '0.00',
      snapshotPrincipal: '650.00',
      snapshotReimbursed: '0.00',
    });
    const live = await request(app.getHttpServer())
      .get(`/api/orders/${fx.orderId}/financial-reconciliation`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const key = live.body.findings[0].findingKey;
    const fingerprint = 'a'.repeat(64);
    const prior = await prisma.financialReconciliationReview.create({
      data: {
        wkOrderId: fx.orderId,
        findingKey: key,
        findingCode: live.body.findings[0].code,
        openingFingerprint: fingerprint,
        currentFingerprint: fingerprint,
        status: 'CLOSED_CONDITION_CLEARED',
        closeClassification: 'CLOSED_CONDITION_CLEARED',
        closeReason: 'Historical cleared case',
        createdByAdminUserId: adminId,
        closedAt: new Date(),
      },
    });
    const reappeared = await request(app.getHttpServer())
      .post('/api/admin/financial-reconciliation/reviews')
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ wkOrderId: fx.orderId, findingKey: key })
      .expect(201);
    expect(reappeared.body.created).toBe(true);
    expect(reappeared.body.review.id).not.toBe(prior.id);
    expect(reappeared.body.review.priorReviewId).toBe(prior.id);
    expect(
      reappeared.body.review.events.some(
        (event: { type: string }) => event.type === 'NEW_CASE_FROM_REAPPEARANCE',
      ),
    ).toBe(true);
    const stillClosed = await prisma.financialReconciliationReview.findUnique({
      where: { id: prior.id },
    });
    expect(stillClosed?.status).toBe('CLOSED_CONDITION_CLEARED');
    const afterPrior = await snapshotReviewRow(prisma, prior.id);
    expect(afterPrior.status).toBe('CLOSED_CONDITION_CLEARED');
    expect(afterPrior.row_version).toBe(1);
    expect(afterPrior.current_fingerprint).toBe(fingerprint);
  });

  it('STALE_FINDING_REJECTED persists and leaves the open review unchanged', async () => {
    const fx = await seedOrderParties(prisma);
    const ra = await insertRiderAdvance(prisma, fx, {
      riderId: fx.riderAId,
      principal: '550.00',
    });
    const det = await insertFinalizedReturnDetermination(prisma, fx, {
      riderAdvanceId: ra,
      merchantToRider: '180.00',
      merchantToCustomer: '0.00',
      snapshotPrincipal: '550.00',
      snapshotReimbursed: '0.00',
    });
    const live = await request(app.getHttpServer())
      .get(`/api/orders/${fx.orderId}/financial-reconciliation`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const key = live.body.findings[0].findingKey;
    const created = await request(app.getHttpServer())
      .post('/api/admin/financial-reconciliation/reviews')
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ wkOrderId: fx.orderId, findingKey: key })
      .expect(201);
    await insertActiveRestriction(prisma, fx, ra, det.determinationId, '180.00');
    const before = await snapshotReviewRow(prisma, created.body.review.id);
    const eventsBefore = await prisma.financialReconciliationReviewEvent.count({
      where: { reviewId: created.body.review.id },
    });
    await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${created.body.review.id}/escalate`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({
        reason: 'Escalate after finding left live reconciliation',
        expectedVersion: created.body.review.rowVersion,
      })
      .expect(409)
      .expect((res) => {
        expect(String(res.body.message)).toContain('STALE_FINDING');
      });
    const after = await snapshotReviewRow(prisma, created.body.review.id);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    const staleEvents = await prisma.financialReconciliationReviewEvent.findMany({
      where: {
        reviewId: created.body.review.id,
        type: 'STALE_FINDING_REJECTED',
      },
    });
    expect(staleEvents.length).toBe(1);
    expect(
      await prisma.financialReconciliationReviewEvent.count({
        where: { reviewId: created.body.review.id },
      }),
    ).toBe(eventsBefore + 1);
  });

  it('rejects every product UPDATE and DELETE on terminal review rows', async () => {
    for (const status of [
      'CLOSED_CONDITION_CLEARED',
      'CLOSED_REVIEW_ONLY',
      'CLOSED_DUPLICATE',
    ] as const) {
      const row = await prisma.financialReconciliationReview.create({
        data: {
          wkOrderId: orderId,
          findingKey: `terminal-${status}-${randomUUID()}`,
          findingCode: 'SUCCESSOR_REVIEW_REQUIRED',
          openingFingerprint: 'b'.repeat(64),
          currentFingerprint: 'c'.repeat(64),
          status,
          closeClassification: status,
          closeReason: 'terminal fixture',
          createdByAdminUserId: adminId,
          closedAt: new Date(),
        },
      });
      const attempts: Array<() => Promise<unknown>> = [
        () =>
          prisma.$executeRaw`
            UPDATE financial_reconciliation_reviews
            SET current_fingerprint = ${'d'.repeat(64)}
            WHERE id = ${row.id}::uuid
          `,
        () =>
          prisma.$executeRaw`
            UPDATE financial_reconciliation_reviews
            SET row_version = row_version + 1
            WHERE id = ${row.id}::uuid
          `,
        () =>
          prisma.$executeRaw`
            UPDATE financial_reconciliation_reviews
            SET created_at = NOW()
            WHERE id = ${row.id}::uuid
          `,
        () =>
          prisma.$executeRaw`
            UPDATE financial_reconciliation_reviews
            SET updated_at = NOW()
            WHERE id = ${row.id}::uuid
          `,
        () =>
          prisma.$executeRaw`
            UPDATE financial_reconciliation_reviews
            SET finding_key = 'mutated'
            WHERE id = ${row.id}::uuid
          `,
        () =>
          prisma.$executeRaw`
            UPDATE financial_reconciliation_reviews
            SET status = 'OPEN'
            WHERE id = ${row.id}::uuid
          `,
        () =>
          prisma.$executeRaw`
            UPDATE financial_reconciliation_reviews
            SET assigned_admin_user_id = ${adminId}::uuid
            WHERE id = ${row.id}::uuid
          `,
        () =>
          prisma.$executeRaw`
            UPDATE financial_reconciliation_reviews
            SET close_reason = 'mutated'
            WHERE id = ${row.id}::uuid
          `,
        () =>
          prisma.$executeRaw`
            UPDATE financial_reconciliation_reviews
            SET closed_at = NOW()
            WHERE id = ${row.id}::uuid
          `,
        () =>
          prisma.$executeRaw`
            DELETE FROM financial_reconciliation_reviews
            WHERE id = ${row.id}::uuid
          `,
      ];
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toThrow(/terminal_immutable|append_only|forbidden/i);
      }
    }
  });

  it('rejects refresh and other mutations after CONDITION_CLEARED close', async () => {
    const fx = await seedOrderParties(prisma);
    const ra = await insertRiderAdvance(prisma, fx, {
      riderId: fx.riderAId,
      principal: '610.00',
    });
    const det = await insertFinalizedReturnDetermination(prisma, fx, {
      riderAdvanceId: ra,
      merchantToRider: '210.00',
      merchantToCustomer: '0.00',
      snapshotPrincipal: '610.00',
      snapshotReimbursed: '0.00',
    });
    const live = await request(app.getHttpServer())
      .get(`/api/orders/${fx.orderId}/financial-reconciliation`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const key = live.body.findings[0].findingKey;
    const created = await request(app.getHttpServer())
      .post('/api/admin/financial-reconciliation/reviews')
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ wkOrderId: fx.orderId, findingKey: key })
      .expect(201);
    await insertActiveRestriction(prisma, fx, ra, det.determinationId, '210.00');
    const closed = await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${created.body.review.id}/close`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({
        mode: 'CONDITION_CLEARED',
        reason: 'Restriction present from domain fixture',
        expectedVersion: created.body.review.rowVersion,
      })
      .expect(201);
    expect(closed.body.status).toBe('CLOSED_CONDITION_CLEARED');
    const before = await snapshotReviewRow(prisma, created.body.review.id);
    const rejected = [
      request(app.getHttpServer())
        .post(`/api/admin/financial-reconciliation/reviews/${created.body.review.id}/refresh`)
        .set(auth({ id: adminId, role: UserRole.admin })),
      request(app.getHttpServer())
        .post(`/api/admin/financial-reconciliation/reviews/${created.body.review.id}/assign`)
        .set(auth({ id: adminId, role: UserRole.admin }))
        .send({ assignedAdminUserId: adminId, expectedVersion: closed.body.rowVersion }),
      request(app.getHttpServer())
        .post(`/api/admin/financial-reconciliation/reviews/${created.body.review.id}/route`)
        .set(auth({ id: adminId, role: UserRole.admin }))
        .send({ routeClassification: 'ENGINEERING', expectedVersion: closed.body.rowVersion }),
      request(app.getHttpServer())
        .post(`/api/admin/financial-reconciliation/reviews/${created.body.review.id}/waiting`)
        .set(auth({ id: adminId, role: UserRole.admin }))
        .send({ waitingPartyType: 'CUSTOMER', expectedVersion: closed.body.rowVersion }),
      request(app.getHttpServer())
        .post(`/api/admin/financial-reconciliation/reviews/${created.body.review.id}/escalate`)
        .set(auth({ id: adminId, role: UserRole.admin }))
        .send({ reason: 'Too late', expectedVersion: closed.body.rowVersion }),
      request(app.getHttpServer())
        .post(`/api/admin/financial-reconciliation/reviews/${created.body.review.id}/close`)
        .set(auth({ id: adminId, role: UserRole.admin }))
        .send({
          mode: 'CONDITION_CLEARED',
          reason: 'Second close',
          expectedVersion: closed.body.rowVersion,
        }),
    ];
    const results = await Promise.all(rejected);
    for (const res of results) {
      expect(res.status).toBe(409);
      expect(String(res.body.message)).toContain('REVIEW_ALREADY_CLOSED');
    }
    const after = await snapshotReviewRow(prisma, created.body.review.id);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    const detail = await request(app.getHttpServer())
      .get(`/api/admin/financial-reconciliation/reviews/${created.body.review.id}`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    expect(detail.body.currentFingerprint).toBe(before.current_fingerprint);
    expect(detail.body.needsRefresh).toBe(false);
    expect(typeof detail.body.findingActive).toBe('boolean');
  });

  it('rejects refresh after REVIEW_ONLY close without mutating the terminal row', async () => {
    const exceptions = app.get(ExceptionFinancialService);
    await exceptions.ensureSeededPolicy();
    const fx = await seedOpenObligation(prisma, exceptions, { principal: '720.00' });
    await insertExceptionAck(prisma, {
      obligationId: fx.obligationId,
      wkOrderId: fx.orderId,
      amount: '200.00',
      debtorType: ExceptionLiablePartyType.CUSTOMER,
      debtorUserId: fx.customerId,
      debtorMerchantId: null,
      creditorType: ExceptionLiablePartyType.MERCHANT,
      creditorUserId: null,
      creditorMerchantId: fx.merchantId,
      actorId: fx.adminId,
    });
    const succDetId = await insertFinalizedSuccessorAdjustment(prisma, fx);
    await prisma.exceptionFinancialObligation.create({
      data: {
        id: randomUUID(),
        liabilityDeterminationId: succDetId,
        exceptionClaimId: fx.claimId,
        economicLossId: fx.economicLossId,
        wkOrderId: fx.orderId,
        debtorType: ExceptionLiablePartyType.CUSTOMER,
        debtorUserId: fx.customerId,
        creditorType: ExceptionLiablePartyType.MERCHANT,
        creditorMerchantId: fx.merchantId,
        principal: '520.00',
        currency: 'PHP',
        status: 'OPEN',
        reason: 'successor obligation',
      },
    });
    const live = await request(app.getHttpServer())
      .get(`/api/orders/${fx.orderId}/financial-reconciliation`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(200);
    const finding = live.body.findings.find(
      (item: { code: string }) => item.code === 'SUCCESSOR_REVIEW_REQUIRED',
    );
    expect(finding).toBeTruthy();
    const created = await request(app.getHttpServer())
      .post('/api/admin/financial-reconciliation/reviews')
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({ wkOrderId: fx.orderId, findingKey: finding.findingKey })
      .expect(201);
    const closed = await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${created.body.review.id}/close`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .send({
        mode: 'REVIEW_ONLY',
        reason: 'Operational follow-up only',
        expectedVersion: created.body.review.rowVersion,
      })
      .expect(201);
    const before = await snapshotReviewRow(prisma, created.body.review.id);
    await request(app.getHttpServer())
      .post(`/api/admin/financial-reconciliation/reviews/${created.body.review.id}/refresh`)
      .set(auth({ id: adminId, role: UserRole.admin }))
      .expect(409);
    const after = await snapshotReviewRow(prisma, created.body.review.id);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(closed.body.status).toBe('CLOSED_REVIEW_ONLY');
  });
});
