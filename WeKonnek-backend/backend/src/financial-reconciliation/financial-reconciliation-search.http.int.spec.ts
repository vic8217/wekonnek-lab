/**
 * Stage13B-3B SYSTEM ADMIN discovery HTTP acceptance.
 * Fresh disposable current-schema DB only (wekonnek_stage13b3_*).
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
process.env.WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK = '1';

function incomingAcceptanceIsStage13b3bTarget(): boolean {
  const raw = process.env.WEKONNEK_ACCEPTANCE_DATABASE_URL;
  if (!raw || raw.trim() === '') return false;
  try {
    const db = parseAcceptanceDatabaseUrl(raw).database;
    return (
      isRecognizedCurrentSchemaDisposableName(db) &&
      db.startsWith('wekonnek_stage13b3_') &&
      db !== 'wekonnek_stage13b3_cursor_test' &&
      !db.startsWith('wekonnek_stage6_')
    );
  } catch {
    return false;
  }
}

if (!incomingAcceptanceIsStage13b3bTarget()) {
  delete process.env.WEKONNEK_ACCEPTANCE_DATABASE_URL;
}

const STAGE13B3B_ENV_PRESENT = loadStageTestEnv('.env.stage13b3b.test');

import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  MerchantStaffRole,
  RiderAdvanceStatus,
  ReturnFinancialDeterminationStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { ExceptionFinancialService } from '../exception-financial/exception-financial.service';
import { seedOpenObligation } from '../exception-financial/exception-financial-settlement.test-seed';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialReconciliationService } from './financial-reconciliation.service';
import {
  insertFinalizedReturnDetermination,
  insertRiderAdvance,
  insertRiderAdvanceAck,
  seedOrderParties,
  Stage13b1OrderSeed,
} from './financial-reconciliation.test-seed';
import {
  RAIL_EXCEPTION_FINANCIAL,
  RAIL_RETURN_FINANCIAL,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
  RECONCILIATION_FINDING_CODES,
} from './financial-reconciliation.types';

function resolveStage13b3bExpectedDatabase(): string {
  const override = getExplicitAcceptanceDatabaseUrl();
  const url = override ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Stage13B-3B HTTP: no DATABASE_URL / acceptance override');
  }
  const parsed = parseAcceptanceDatabaseUrl(url);
  if (!isCurrentSchemaRegressionMode()) {
    throw new Error(
      'Stage13B-3B HTTP requires WEKONNEK_CURRENT_SCHEMA_REGRESSION=1',
    );
  }
  if (
    parsed.database === 'wekonnek_stage6_test' ||
    parsed.database.startsWith('wekonnek_stage6_')
  ) {
    throw new Error(
      `HARNESS ROUTING: Stage13B-3B HTTP refused historical database ${parsed.database}`,
    );
  }
  if (parsed.database === 'wekonnek_stage13b3_cursor_test') {
    throw new Error(
      `HARNESS ROUTING: Stage13B-3B HTTP refused frozen Stage13B-3A database ${parsed.database}`,
    );
  }
  if (
    !parsed.database.startsWith('wekonnek_stage13b3_') ||
    !isRecognizedCurrentSchemaDisposableName(parsed.database)
  ) {
    throw new Error(
      `Stage13B-3B HTTP refuses database ${parsed.database}; use wekonnek_stage13b3_* disposable`,
    );
  }
  assertSafeCurrentSchemaRegressionDatabase(
    parsed.database,
    'Stage13B-3B HTTP',
  );
  return parsed.database;
}

const describeIf = STAGE13B3B_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(300_000);

const EXPECTED_DB = STAGE13B3B_ENV_PRESENT
  ? resolveStage13b3bExpectedDatabase()
  : 'wekonnek_stage13b3_b_cursor_test';
const ALLOWED_DB_USERS = stage13b2AllowedDbUsers(EXPECTED_DB);
const SEARCH = '/api/admin/financial-reconciliation';
const MONEY_KEYS = [
  'originalPrincipal',
  'settledAmount',
  'remainingAmount',
  'collectibleRemaining',
  'orderNetBalance',
];

function assertDiscoveryCard(card: Record<string, unknown>) {
  expect(card).toEqual(
    expect.objectContaining({
      wkOrderId: expect.any(Number),
      rails: expect.any(Array),
      hasOutstanding: expect.any(Boolean),
      hasDispute: expect.any(Boolean),
      hasReconciliationIssue: expect.any(Boolean),
      reconciliationStates: expect.any(Array),
      findingCodes: expect.any(Array),
      itemCount: expect.any(Number),
      sourceActivityAt: expect.any(String),
    }),
  );
  const json = JSON.stringify(card);
  for (const key of MONEY_KEYS) expect(json).not.toContain(key);
  expect(json).not.toContain('sourceRefs');
  expect(json).not.toContain('evidenceRefs');
  expect(json).not.toContain('lastFinancialActivityAt');
}

describeIf(`Stage13B-3B financial-reconciliation search HTTP (${EXPECTED_DB})`, () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reconciliation: FinancialReconciliationService;
  let fx: Stage13b1OrderSeed;
  let raId: string;
  let riderObligationId: string;
  let customerObligationId: string;
  let disputedFx: Stage13b1OrderSeed;
  let settledFx: Stage13b1OrderSeed;
  let emptyFx: Stage13b1OrderSeed;
  let admin: { id: string; role: UserRole };
  let inactiveAdmin: { id: string; role: UserRole };
  let spoofCustomer: { id: string; role: UserRole };
  let staff: { id: string; role: UserRole };
  let coordinator: { id: string; role: UserRole };
  let cashier: { id: string; role: UserRole };
  let merchantStaff: { id: string; role: UserRole };
  let driver: { id: string; role: UserRole };

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

  const search = (
    query: Record<string, string>,
    user: { id: string; role: UserRole } = admin,
    extra: Record<string, unknown> = {},
  ) =>
    request(app.getHttpServer())
      .get(SEARCH)
      .query(query)
      .set(auth(user, extra));

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
    reconciliation = app.get(FinancialReconciliationService);

    const identity = await assertPrismaConnectedToStage13b2AcceptanceDb(
      prisma,
      EXPECTED_DB,
      'Stage13B-3B HTTP',
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

    disputedFx = await seedOrderParties(prisma);
    await insertRiderAdvance(prisma, disputedFx, {
      riderId: disputedFx.riderAId,
      principal: '50.00',
      status: RiderAdvanceStatus.DISPUTED,
    });

    settledFx = await seedOrderParties(prisma);
    const settledRa = await insertRiderAdvance(prisma, settledFx, {
      riderId: settledFx.riderAId,
      principal: '25.00',
    });
    await insertRiderAdvanceAck(prisma, settledFx, settledRa, '25.00');

    const mk = (role: UserRole, p: string, isActive = true) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s13b3b-${p}-${fx.tag}@test.invalid`,
          role,
          firstName: p,
          isActive,
        },
      });
    admin = await mk(UserRole.admin, 'admin');
    inactiveAdmin = await mk(UserRole.admin, 'inactive', false);
    spoofCustomer = await mk(UserRole.customer, 'spoof');
    staff = await mk(UserRole.staff, 'staff');
    coordinator = await mk(UserRole.coordinator, 'coord');
    cashier = await mk(UserRole.merchant, 'cashier');
    merchantStaff = await mk(UserRole.merchant, 'mstaff');
    driver = await mk(UserRole.driver, 'driver');
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
        userId: merchantStaff.id,
        role: MerchantStaffRole.staff,
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('unauthenticated is 401', async () => {
    await request(app.getHttpServer()).get(SEARCH).expect(401);
  });

  it('admin is allowed', async () => {
    const res = await search({
      wkOrderId: String(fx.orderId),
    }).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.etag).toBeUndefined();
    expect(res.body.items).toHaveLength(1);
    assertDiscoveryCard(res.body.items[0]);
  });

  it('denies customer, merchant owner, merchant staff, cashier, rider, driver, coordinator, staff', async () => {
    const q = { wkOrderId: String(fx.orderId) };
    await search(q, { id: fx.customerId, role: UserRole.customer }).expect(403);
    await search(q, { id: fx.merchantUserId, role: UserRole.merchant }).expect(
      403,
    );
    await search(q, merchantStaff).expect(403);
    await search(q, cashier).expect(403);
    await search(q, { id: fx.riderAId, role: UserRole.rider }).expect(403);
    await search(q, driver).expect(403);
    await search(q, coordinator).expect(403);
    await search(q, staff).expect(403);
  });

  it('denies shop portal even for persisted admin', async () => {
    await search(
      { wkOrderId: String(fx.orderId) },
      admin,
      { portal: 'shop', merchantId: fx.merchantId },
    ).expect(403);
  });

  it('denies inactive admin', async () => {
    const res = await search(
      { wkOrderId: String(fx.orderId) },
      inactiveAdmin,
    );
    expect([401, 403]).toContain(res.status);
  });

  it('JWT role spoof does not grant admin if persisted role is non-admin', async () => {
    await search(
      { wkOrderId: String(fx.orderId) },
      { id: spoofCustomer.id, role: UserRole.admin },
    ).expect(403);
  });

  it('unbounded search is 400 SEARCH_BOUNDS_REQUIRED', async () => {
    const res = await search({}).expect(400);
    expect(JSON.stringify(res.body)).toContain('SEARCH_BOUNDS_REQUIRED');
  });

  it('since scan is 200', async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const res = await search({ since }).expect(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers.etag).toBeUndefined();
  });

  it('since older than 30 days is 400', async () => {
    const since = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const res = await search({ since }).expect(400);
    expect(JSON.stringify(res.body)).toContain('INVALID_DATE');
  });

  it('until before since is 400', async () => {
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const until = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const res = await search({ since, until }).expect(400);
    expect(JSON.stringify(res.body)).toContain('INVALID_DATE');
  });

  it('invalid rail / findingCode / reconciliationState are 400', async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const rail = await search({ since, rail: 'PAYMENT' }).expect(400);
    expect(JSON.stringify(rail.body)).toContain('INVALID_RAIL');
    const finding = await search({
      since,
      findingCode: 'NOT_A_CODE',
    }).expect(400);
    expect(JSON.stringify(finding.body)).toContain('INVALID_FINDING_CODE');
    const state = await search({
      since,
      reconciliationState: 'NOPE',
    }).expect(400);
    expect(JSON.stringify(state.body)).toContain(
      'INVALID_RECONCILIATION_STATE',
    );
  });

  it('obligationId without rail is 400', async () => {
    const res = await search({ obligationId: raId }).expect(400);
    expect(JSON.stringify(res.body)).toContain('INVALID_EXACT_KEY');
  });

  it('exact wkOrderId evaluates at most one forOrder', async () => {
    const spy = jest.spyOn(reconciliation, 'forOrder');
    spy.mockClear();
    const res = await search({ wkOrderId: String(fx.orderId) }).expect(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(fx.orderId);
    expect(res.body.items).toHaveLength(1);
    spy.mockRestore();
  });

  it('exact wkOrderId with no financial data is empty 200', async () => {
    const res = await search({
      wkOrderId: String(emptyFx.orderId),
    }).expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.scanned).toBe(1);
    expect(res.body.exhausted).toBe(true);
  });

  it('rail+obligationId resolves one order', async () => {
    const res = await search({
      rail: RAIL_RETURN_FINANCIAL,
      obligationId: riderObligationId,
    }).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].wkOrderId).toBe(fx.orderId);
  });

  it('multi-rail order appears once with frozen rails array', async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const res = await search({
      since,
      wkOrderId: String(fx.orderId),
    }).expect(200);
    expect(res.body.items).toHaveLength(1);
    const card = res.body.items[0];
    expect(card.rails).toEqual(
      expect.arrayContaining([
        RAIL_RIDER_ADVANCE_REIMBURSEMENT,
        RAIL_RETURN_FINANCIAL,
      ]),
    );
    assertDiscoveryCard(card);
  });

  it('derived hasOutstanding true/false match frozen forOrder', async () => {
    const open = await search({
      wkOrderId: String(fx.orderId),
      hasOutstanding: 'true',
    }).expect(200);
    expect(open.body.items).toHaveLength(1);
    const frozenOpen = await reconciliation.forOrder(fx.orderId);
    expect(frozenOpen.hasOutstanding).toBe(true);

    const miss = await search({
      wkOrderId: String(fx.orderId),
      hasOutstanding: 'false',
    }).expect(200);
    expect(miss.body.items).toEqual([]);

    const settled = await search({
      wkOrderId: String(settledFx.orderId),
      hasOutstanding: 'false',
    }).expect(200);
    const frozenSettled = await reconciliation.forOrder(settledFx.orderId);
    expect(frozenSettled.hasOutstanding).toBe(false);
    expect(settled.body.items).toHaveLength(1);
  });

  it('derived hasDispute reflects RA DISPUTED only', async () => {
    const hit = await search({
      wkOrderId: String(disputedFx.orderId),
      hasDispute: 'true',
    }).expect(200);
    const frozen = await reconciliation.forOrder(disputedFx.orderId);
    expect(frozen.hasDispute).toBe(true);
    expect(hit.body.items).toHaveLength(1);

    const miss = await search({
      wkOrderId: String(fx.orderId),
      hasDispute: 'true',
    }).expect(200);
    expect((await reconciliation.forOrder(fx.orderId)).hasDispute).toBe(false);
    expect(miss.body.items).toEqual([]);
  });

  it('derived hasReconciliationIssue / findingCode / reconciliationState come from frozen forOrder', async () => {
    const frozen = await reconciliation.forOrder(fx.orderId);
    expect(frozen.hasReconciliationIssue).toBe(true);
    expect(frozen.findings.map((f) => f.code)).toContain(
      RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
    );
    const issue = await search({
      wkOrderId: String(fx.orderId),
      hasReconciliationIssue: 'true',
    }).expect(200);
    expect(issue.body.items).toHaveLength(1);
    const code = await search({
      wkOrderId: String(fx.orderId),
      findingCode: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
    }).expect(200);
    expect(code.body.items).toHaveLength(1);
    const state = await search({
      wkOrderId: String(fx.orderId),
      reconciliationState: 'OVERLAP_REVIEW_REQUIRED',
    }).expect(200);
    expect(state.body.items).toHaveLength(1);
    const miss = await search({
      wkOrderId: String(settledFx.orderId),
      findingCode: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
    }).expect(200);
    expect(miss.body.items).toEqual([]);
  });

  it('search card corresponds to immediate Stage13B-3A admin detail', async () => {
    const searchRes = await search({
      wkOrderId: String(fx.orderId),
    }).expect(200);
    const detail = await request(app.getHttpServer())
      .get(`/api/orders/${fx.orderId}/financial-reconciliation`)
      .set(auth(admin))
      .expect(200);
    const card = searchRes.body.items[0];
    const rails = [
      ...new Set(detail.body.items.map((i: { rail: string }) => i.rail)),
    ];
    expect(card.rails.sort()).toEqual((rails as string[]).sort());
    expect(card.hasOutstanding).toBe(detail.body.hasOutstanding);
    expect(card.hasDispute).toBe(detail.body.hasDispute);
    expect(card.hasReconciliationIssue).toBe(detail.body.hasReconciliationIssue);
    expect(card.itemCount).toBe(detail.body.items.length);
    expect(card.findingCodes.sort()).toEqual(
      [
        ...new Set(
          detail.body.findings.map((f: { code: string }) => f.code),
        ),
      ].sort(),
    );
  });

  it('page 1 + page 2 are deterministic and do not repeat wkOrderId', async () => {
    const base = new Date('2026-09-18T08:00:00.000Z');
    const until = new Date('2026-09-18T08:00:30.000Z');
    const ids: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const party = await seedOrderParties(prisma);
      const at = new Date(base.getTime() + (5 - i) * 1000);
      await insertRiderAdvance(prisma, party, {
        riderId: party.riderAId,
        principal: '10.00',
        createdAt: at,
        updatedAt: at,
      });
      ids.push(party.orderId);
    }
    const since = base.toISOString();
    const page1 = await search({
      since,
      until: until.toISOString(),
      limit: '3',
    }).expect(200);
    expect(page1.body.items).toHaveLength(3);
    expect(page1.body.nextCursor).toEqual(expect.any(String));
    const page2 = await search({
      since,
      until: until.toISOString(),
      limit: '3',
      cursor: page1.body.nextCursor,
    }).expect(200);
    const all = [...page1.body.items, ...page2.body.items].map(
      (c: { wkOrderId: number }) => c.wkOrderId,
    );
    expect(new Set(all).size).toBe(all.length);
    const replay = await search({
      since,
      until: until.toISOString(),
      limit: '3',
    }).expect(200);
    expect(replay.body.items.map((c: { wkOrderId: number }) => c.wkOrderId)).toEqual(
      page1.body.items.map((c: { wkOrderId: number }) => c.wkOrderId),
    );
  });

  it('cursor changed findingCode / rail → CURSOR_FILTER_MISMATCH; malformed / wrong version → INVALID_CURSOR', async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const first = await search({ since, limit: '1' }).expect(200);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const finding = await search({
      since,
      limit: '1',
      findingCode: RECONCILIATION_FINDING_CODES.CURRENCY_MISMATCH,
      cursor: first.body.nextCursor,
    }).expect(400);
    expect(JSON.stringify(finding.body)).toContain('CURSOR_FILTER_MISMATCH');
    const rail = await search({
      since,
      limit: '1',
      rail: RAIL_EXCEPTION_FINANCIAL,
      cursor: first.body.nextCursor,
    }).expect(400);
    expect(JSON.stringify(rail.body)).toContain('CURSOR_FILTER_MISMATCH');
    const malformed = await search({ since, cursor: 'not-base64' }).expect(400);
    expect(JSON.stringify(malformed.body)).toContain('INVALID_CURSOR');
    const wrongV = Buffer.from(
      JSON.stringify({
        v: 9,
        a: new Date().toISOString(),
        i: 1,
        f: 'a'.repeat(64),
      }),
      'utf8',
    ).toString('base64url');
    const version = await search({ since, cursor: wrongV }).expect(400);
    expect(JSON.stringify(version.body)).toContain('INVALID_CURSOR');
  });

  it('limit default 20 and client limit>20 is capped to 20', async () => {
    const base = new Date('2026-09-18T09:00:00.000Z');
    const until = new Date('2026-09-18T09:00:40.000Z');
    for (let i = 0; i < 22; i += 1) {
      const party = await seedOrderParties(prisma);
      const at = new Date(base.getTime() + i * 1000);
      await insertRiderAdvance(prisma, party, {
        riderId: party.riderAId,
        principal: '11.00',
        createdAt: at,
        updatedAt: at,
      });
    }
    const since = base.toISOString();
    const def = await search({
      since,
      until: until.toISOString(),
    }).expect(200);
    expect(def.body.items.length).toBeLessThanOrEqual(20);
    expect(def.body.items.length).toBe(20);
    const capped = await search({
      since,
      until: until.toISOString(),
      limit: '99',
    }).expect(200);
    expect(capped.body.items.length).toBe(20);
  });

  it('hard scan cap: >50 candidates + rare findingCode still calls forOrder <= 50', async () => {
    const base = new Date('2026-09-18T10:00:00.000Z');
    const until = new Date('2026-09-18T10:01:10.000Z');
    for (let i = 0; i < 55; i += 1) {
      const party = await seedOrderParties(prisma);
      const at = new Date(base.getTime() + i * 1000);
      await insertRiderAdvance(prisma, party, {
        riderId: party.riderAId,
        principal: '12.00',
        createdAt: at,
        updatedAt: at,
      });
    }
    const spy = jest.spyOn(reconciliation, 'forOrder');
    spy.mockClear();
    const res = await search({
      since: base.toISOString(),
      until: until.toISOString(),
      findingCode: RECONCILIATION_FINDING_CODES.CURRENCY_MISMATCH,
      limit: '20',
      ...( { candidateScanMax: '500' } as Record<string, string> ),
    }).expect(200);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(50);
    expect(spy).toHaveBeenCalledTimes(50);
    expect(res.body.items).toEqual([]);
    expect(res.body.scanned).toBe(50);
    expect(res.body.nextCursor).toEqual(expect.any(String));
    spy.mockRestore();
  });

  it('zero-match page still exposes nextCursor and continuation works', async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const first = await search({
      since,
      hasDispute: 'true',
      limit: '20',
    }).expect(200);
    expect(first.body.scanned).toBeGreaterThan(0);
    if (first.body.nextCursor) {
      const next = await search({
        since,
        hasDispute: 'true',
        limit: '20',
        cursor: first.body.nextCursor,
      }).expect(200);
      expect(next.status).toBe(200);
    }
  });

  it('candidate that disappears before forOrder does not 5xx the search', async () => {
    const orig = reconciliation.forOrder.bind(reconciliation);
    const spy = jest
      .spyOn(reconciliation, 'forOrder')
      .mockImplementation(async (wkOrderId: number) => {
        if (wkOrderId === fx.orderId) {
          throw new NotFoundException('gone');
        }
        return orig(wkOrderId);
      });
    try {
      const res = await search({ wkOrderId: String(fx.orderId) }).expect(200);
      expect(res.body.items).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('concurrent settlement may change the advisory card; fresh detail wins', async () => {
    const party = await seedOrderParties(prisma);
    const id = await insertRiderAdvance(prisma, party, {
      riderId: party.riderAId,
      principal: '80.00',
    });
    const before = await search({ wkOrderId: String(party.orderId) }).expect(
      200,
    );
    expect(before.body.items[0].hasOutstanding).toBe(true);
    await insertRiderAdvanceAck(prisma, party, id, '80.00');
    const after = await search({ wkOrderId: String(party.orderId) }).expect(
      200,
    );
    const detail = await request(app.getHttpServer())
      .get(`/api/orders/${party.orderId}/financial-reconciliation`)
      .set(auth(admin))
      .expect(200);
    expect(after.body.items[0].hasOutstanding).toBe(detail.body.hasOutstanding);
    expect(detail.body.hasOutstanding).toBe(false);
  });

  it('three-rail order is one card; return+exception and RA+return do not duplicate', async () => {
    const exceptions = app.get(ExceptionFinancialService);
    await exceptions.ensureSeededPolicy();
    const ex = await seedOpenObligation(prisma, exceptions, {
      principal: '40.00',
    });
    const assignment = await prisma.riderAssignment.findFirstOrThrow({
      where: { fulfillmentId: ex.fulfillmentId },
    });
    const mapped: Stage13b1OrderSeed = {
      tag: ex.tag,
      customerId: ex.customerId,
      riderAId: ex.riderId,
      riderBId: ex.riderId,
      merchantUserId: ex.merchantUserId,
      merchantId: ex.merchantId,
      orderId: ex.orderId,
      fulfillmentId: ex.fulfillmentId,
      assignmentId: assignment.id,
    };
    const threeRa = await insertRiderAdvance(prisma, mapped, {
      riderId: ex.riderId,
      principal: '30.00',
    });
    await insertFinalizedReturnDetermination(prisma, mapped, {
      riderAdvanceId: threeRa,
      merchantToRider: '5.00',
      merchantToCustomer: '1.00',
      snapshotPrincipal: '30.00',
      snapshotReimbursed: '0.00',
    });
    const card = await search({ wkOrderId: String(ex.orderId) }).expect(200);
    expect(card.body.items).toHaveLength(1);
    expect(card.body.items[0].rails).toEqual(
      expect.arrayContaining([
        RAIL_RIDER_ADVANCE_REIMBURSEMENT,
        RAIL_RETURN_FINANCIAL,
        RAIL_EXCEPTION_FINANCIAL,
      ]),
    );
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const scan = await search({ since, limit: '20' }).expect(200);
    const matches = scan.body.items.filter(
      (c: { wkOrderId: number }) => c.wkOrderId === ex.orderId,
    );
    expect(matches.length).toBeLessThanOrEqual(1);
  });

  it('return DISPUTED determination is not an executable item and does not invent hasDispute', async () => {
    const party = await seedOrderParties(prisma);
    const id = await insertRiderAdvance(prisma, party, {
      riderId: party.riderAId,
      principal: '15.00',
    });
    await insertFinalizedReturnDetermination(prisma, party, {
      riderAdvanceId: id,
      merchantToRider: '4.00',
      merchantToCustomer: '1.00',
      status: ReturnFinancialDeterminationStatus.DISPUTED,
    });
    const frozen = await reconciliation.forOrder(party.orderId);
    expect(frozen.hasDispute).toBe(false);
    const res = await search({
      wkOrderId: String(party.orderId),
      hasDispute: 'true',
    }).expect(200);
    expect(res.body.items).toEqual([]);
  });
});
