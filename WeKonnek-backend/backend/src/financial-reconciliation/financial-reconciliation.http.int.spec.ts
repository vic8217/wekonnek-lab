/**
 * Stage13B-3A financial reconciliation HTTP acceptance.
 * Disposable current-schema DB only (wekonnek_stage13b3_*).
 */
import { existsSync, mkdirSync, cpSync } from 'fs';
import { join } from 'path';
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertPrismaConnectedToStage13b2AcceptanceDb,
  assertSafeCurrentSchemaRegressionDatabase,
  getExplicitAcceptanceDatabaseUrl,
  parseAcceptanceDatabaseUrl,
  stage13b2AllowedDbUsers,
} from '../test-support/acceptance-database';
import {
  isCurrentSchemaRegressionMode,
  isRecognizedCurrentSchemaDisposableName,
} from '../test-support/test-database-guard';

if (!process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION) {
  process.env.WEKONNEK_CURRENT_SCHEMA_REGRESSION = '1';
}

const STAGE13B3_ENV_PRESENT = loadStageTestEnv('.env.stage13b3.test');

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  MerchantStaffRole,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import {
  insertFinalizedReturnDetermination,
  insertRiderAdvance,
  seedOrderParties,
  Stage13b1OrderSeed,
} from './financial-reconciliation.test-seed';
import {
  RAIL_RETURN_FINANCIAL,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
} from './financial-reconciliation.types';

function resolveStage13b3ExpectedDatabase(): string {
  const override = getExplicitAcceptanceDatabaseUrl();
  const url = override ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Stage13B-3 HTTP: no DATABASE_URL / acceptance override');
  }
  const parsed = parseAcceptanceDatabaseUrl(url);
  if (!isCurrentSchemaRegressionMode()) {
    throw new Error(
      'Stage13B-3 HTTP requires WEKONNEK_CURRENT_SCHEMA_REGRESSION=1',
    );
  }
  if (
    !parsed.database.startsWith('wekonnek_stage13b3_') ||
    !isRecognizedCurrentSchemaDisposableName(parsed.database)
  ) {
    throw new Error(
      `Stage13B-3 HTTP refuses database ${parsed.database}; use wekonnek_stage13b3_* disposable`,
    );
  }
  assertSafeCurrentSchemaRegressionDatabase(
    parsed.database,
    'Stage13B-3 HTTP',
  );
  return parsed.database;
}

const describeIf = STAGE13B3_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = STAGE13B3_ENV_PRESENT
  ? resolveStage13b3ExpectedDatabase()
  : 'wekonnek_stage13b3_cursor_test';
const ALLOWED_DB_USERS = stage13b2AllowedDbUsers(EXPECTED_DB);

describeIf(`Stage13B-3A financial-reconciliation HTTP (${EXPECTED_DB})`, () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fx: Stage13b1OrderSeed;
  let emptyFx: Stage13b1OrderSeed;
  let raId: string;
  let riderObligationId: string;
  let customerObligationId: string;
  let admin: { id: string; role: UserRole };
  let staff: { id: string; role: UserRole };
  let coordinator: { id: string; role: UserRole };
  let cashier: { id: string; role: UserRole };
  let crew: { id: string; role: UserRole };
  let foreignCustomer: { id: string; role: UserRole };

  const runtimeI18n = join(process.cwd(), 'i18n');
  const sourceI18n = join(process.cwd(), 'src', 'i18n');
  const auth = (
    user: { id: string; role: UserRole },
    extra: Record<string, unknown> = {},
  ) => ({
    Authorization: `Bearer ${sign(
      { sub: user.id, role: user.role, ...extra },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '1h' },
    )}`,
  });

  const orderPath = (orderId: number) =>
    `/api/orders/${orderId}/financial-reconciliation`;
  const oblPath = (rail: string, id: string) =>
    `/api/financial-obligations/${rail}/${id}`;

  beforeAll(async () => {
    if (!existsSync(runtimeI18n)) {
      mkdirSync(runtimeI18n, { recursive: true });
      cpSync(sourceI18n, runtimeI18n, { recursive: true });
    }
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
    prisma = app.get(PrismaService);

    const identity = await assertPrismaConnectedToStage13b2AcceptanceDb(
      prisma,
      EXPECTED_DB,
      'Stage13B-3 HTTP',
    );
    expect(identity.database.startsWith('wekonnek_stage13b3_')).toBe(true);
    expect(ALLOWED_DB_USERS.has(identity.user)).toBe(true);

    emptyFx = await seedOrderParties(prisma);
    fx = await seedOrderParties(prisma);
    raId = await insertRiderAdvance(prisma, fx, {
      riderId: fx.riderAId,
      principal: '1234.56',
    });
    const det = await insertFinalizedReturnDetermination(prisma, fx, {
      riderAdvanceId: raId,
      merchantToRider: '100.00',
      merchantToCustomer: '0.10',
      snapshotPrincipal: '1234.56',
      snapshotReimbursed: '0.10',
    });
    riderObligationId = det.riderObligationId;
    customerObligationId = det.customerObligationId;

    const mk = (role: UserRole, p: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s13b3-${p}-${fx.tag}@test.invalid`,
          role,
          firstName: p,
        },
      });
    admin = await mk(UserRole.admin, 'admin');
    staff = await mk(UserRole.staff, 'staff');
    coordinator = await mk(UserRole.coordinator, 'coord');
    cashier = await mk(UserRole.merchant, 'cashier');
    crew = await mk(UserRole.staff, 'crew');
    foreignCustomer = await mk(UserRole.customer, 'foreign');
    await prisma.merchantStaff.create({
      data: {
        merchantId: fx.merchantId,
        userId: cashier.id,
        role: MerchantStaffRole.cashier,
        isActive: true,
      },
    });
    await prisma.merchantStaff.create({
      data: {
        merchantId: fx.merchantId,
        userId: crew.id,
        role: MerchantStaffRole.staff,
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('unauthenticated order GET is 401', async () => {
    await request(app.getHttpServer()).get(orderPath(fx.orderId)).expect(401);
  });

  it('missing order is 404', async () => {
    const res = await request(app.getHttpServer())
      .get(orderPath(fx.orderId + 9_000_000))
      .set(auth({ id: fx.customerId, role: UserRole.customer }))
      .expect(404);
    expect(res.body.statusCode).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.etag).toBeUndefined();
  });

  it('admin + existing order + zero financial items is 200 empty', async () => {
    const res = await request(app.getHttpServer())
      .get(orderPath(emptyFx.orderId))
      .set(auth(admin))
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.etag).toBeUndefined();
    expect(res.body.items).toEqual([]);
    expect(res.body.findings).toEqual([]);
    expect(res.body.hasOutstanding).toBe(false);
    expect(res.body.hasDispute).toBe(false);
    expect(res.body.hasReconciliationIssue).toBe(false);
  });

  it('participant + existing order + zero authorized items is 403', async () => {
    await request(app.getHttpServer())
      .get(orderPath(emptyFx.orderId))
      .set(auth({ id: emptyFx.customerId, role: UserRole.customer }))
      .expect(403);
  });

  it('admin sees the complete order projection including money strings', async () => {
    const res = await request(app.getHttpServer())
      .get(orderPath(fx.orderId))
      .set(auth(admin))
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const ids = res.body.items.map((i: { obligationId: string }) => i.obligationId);
    expect(ids).toEqual(
      expect.arrayContaining([raId, riderObligationId, customerObligationId]),
    );
    const ra = res.body.items.find(
      (i: { obligationId: string }) => i.obligationId === raId,
    );
    expect(ra.originalPrincipal).toBe('1234.56');
    expect(typeof ra.originalPrincipal).toBe('string');
    expect(typeof ra.remainingAmount).toBe('string');
    const m2r = res.body.items.find(
      (i: { obligationId: string }) => i.obligationId === riderObligationId,
    );
    const m2c = res.body.items.find(
      (i: { obligationId: string }) => i.obligationId === customerObligationId,
    );
    expect(m2r.originalPrincipal).toBe('100.00');
    expect(m2c.originalPrincipal).toBe('0.10');
    expect(ra.sourceRefs).toBeDefined();
    expect(res.body.findings.length).toBeGreaterThan(0);
    expect(res.body.findings[0].evidenceRefs).toBeDefined();
    expect(res.body.hasOutstanding).toBe(true);
  });

  it('P2 customer hides merchant→rider return', async () => {
    const res = await request(app.getHttpServer())
      .get(orderPath(fx.orderId))
      .set(auth({ id: fx.customerId, role: UserRole.customer }))
      .expect(200);
    const ids: string[] = res.body.items.map(
      (i: { obligationId: string }) => i.obligationId,
    );
    expect(ids).toContain(raId);
    expect(ids).toContain(customerObligationId);
    expect(ids).not.toContain(riderObligationId);
    expect(res.body.findings).toEqual([]);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('sourceRefs');
    expect(json).not.toContain('evidenceRefs');
    expect(json).not.toContain(riderObligationId);
  });

  it('P3 merchant owner hides customer→rider RA', async () => {
    const res = await request(app.getHttpServer())
      .get(orderPath(fx.orderId))
      .set(auth({ id: fx.merchantUserId, role: UserRole.merchant }))
      .expect(200);
    const ids: string[] = res.body.items.map(
      (i: { obligationId: string }) => i.obligationId,
    );
    expect(ids).toContain(riderObligationId);
    expect(ids).toContain(customerObligationId);
    expect(ids).not.toContain(raId);
    expect(res.body.findings).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(raId);
  });

  it('P4/P9/P10 rider sees RA + M2R finding without evidenceRefs when both visible', async () => {
    const res = await request(app.getHttpServer())
      .get(orderPath(fx.orderId))
      .set(auth({ id: fx.riderAId, role: UserRole.rider }))
      .expect(200);
    const ids: string[] = res.body.items.map(
      (i: { obligationId: string }) => i.obligationId,
    );
    expect(ids).toContain(raId);
    expect(ids).toContain(riderObligationId);
    expect(ids).not.toContain(customerObligationId);
    expect(res.body.findings.length).toBeGreaterThan(0);
    for (const finding of res.body.findings) {
      expect(finding.evidenceRefs).toBeUndefined();
      expect(finding.findingKey).toBeDefined();
      expect(finding.code).toBeDefined();
    }
    expect(JSON.stringify(res.body)).not.toContain('sourceRefs');
    expect(JSON.stringify(res.body)).not.toContain('evidenceRefs');
  });

  it('P12 coordinator with order access is denied financial reconciliation', async () => {
    await request(app.getHttpServer())
      .get(orderPath(fx.orderId))
      .set(auth(coordinator))
      .expect(403);
  });

  it('denies staff, cashier, shop-portal crew, foreign customer, and UserRole.staff-as-admin', async () => {
    await request(app.getHttpServer())
      .get(orderPath(fx.orderId))
      .set(auth(staff))
      .expect(403);
    await request(app.getHttpServer())
      .get(orderPath(fx.orderId))
      .set(auth(cashier))
      .expect(403);
    await request(app.getHttpServer())
      .get(orderPath(fx.orderId))
      .set(auth(crew, { portal: 'shop', merchantId: fx.merchantId }))
      .expect(403);
    await request(app.getHttpServer())
      .get(orderPath(fx.orderId))
      .set(auth(foreignCustomer))
      .expect(403);
  });

  it('Rider A remains authorized after custody is Rider B; Rider B is denied', async () => {
    const riderA = await request(app.getHttpServer())
      .get(orderPath(fx.orderId))
      .set(auth({ id: fx.riderAId, role: UserRole.rider }))
      .expect(200);
    expect(
      riderA.body.items.some(
        (i: { obligationId: string }) => i.obligationId === raId,
      ),
    ).toBe(true);
    await request(app.getHttpServer())
      .get(orderPath(fx.orderId))
      .set(auth({ id: fx.riderBId, role: UserRole.rider }))
      .expect(403);
    await request(app.getHttpServer())
      .get(oblPath(RAIL_RIDER_ADVANCE_REIMBURSEMENT, raId))
      .set(auth({ id: fx.riderBId, role: UserRole.rider }))
      .expect(404);
    const riderAObl = await request(app.getHttpServer())
      .get(oblPath(RAIL_RIDER_ADVANCE_REIMBURSEMENT, raId))
      .set(auth({ id: fx.riderAId, role: UserRole.rider }))
      .expect(200);
    expect(riderAObl.body.obligationId).toBe(raId);
    expect(riderAObl.headers['cache-control']).toBe('no-store');
  });

  it('P1/P11 foreign UUID and missing UUID share the same public 404', async () => {
    const foreign = randomUUID();
    const missing = randomUUID();
    const a = await request(app.getHttpServer())
      .get(oblPath(RAIL_RIDER_ADVANCE_REIMBURSEMENT, foreign))
      .set(auth({ id: fx.riderAId, role: UserRole.rider }))
      .expect(404);
    const b = await request(app.getHttpServer())
      .get(oblPath(RAIL_RIDER_ADVANCE_REIMBURSEMENT, missing))
      .set(auth({ id: fx.riderAId, role: UserRole.rider }))
      .expect(404);
    const unauthorized = await request(app.getHttpServer())
      .get(oblPath(RAIL_RIDER_ADVANCE_REIMBURSEMENT, raId))
      .set(auth(foreignCustomer))
      .expect(404);
    expect(a.body.statusCode).toBe(404);
    expect(b.body.statusCode).toBe(404);
    expect(unauthorized.body.statusCode).toBe(404);
    expect(a.body.message).toBe(b.body.message);
    expect(a.body.message).toBe(unauthorized.body.message);
    expect(a.body.message).toBe('Financial obligation not found');
  });

  it('invalid rail is 400', async () => {
    await request(app.getHttpServer())
      .get(oblPath('NOT_A_RAIL', raId))
      .set(auth(admin))
      .expect(400);
  });

  it('admin obligation GET 200 / missing 404; participant authorized 200', async () => {
    const ok = await request(app.getHttpServer())
      .get(oblPath(RAIL_RETURN_FINANCIAL, riderObligationId))
      .set(auth(admin))
      .expect(200);
    expect(ok.body.obligationId).toBe(riderObligationId);
    expect(ok.body.sourceRefs).toBeDefined();
    await request(app.getHttpServer())
      .get(oblPath(RAIL_RETURN_FINANCIAL, randomUUID()))
      .set(auth(admin))
      .expect(404);
    const merchant = await request(app.getHttpServer())
      .get(oblPath(RAIL_RETURN_FINANCIAL, riderObligationId))
      .set(auth({ id: fx.merchantUserId, role: UserRole.merchant }))
      .expect(200);
    expect(merchant.body.sourceRefs).toBeUndefined();
    expect(merchant.body.originalPrincipal).toBe('100.00');
  });
});
