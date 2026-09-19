/**
 * Stage13B-3B PostgreSQL identity, query-bound, and no-write proofs.
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

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialReconciliationService } from './financial-reconciliation.service';
import {
  insertFinalizedReturnDetermination,
  insertRiderAdvance,
  seedOrderParties,
} from './financial-reconciliation.test-seed';
import { RAIL_RIDER_ADVANCE_REIMBURSEMENT } from './financial-reconciliation.types';

function resolveStage13b3bExpectedDatabase(): string {
  const override = getExplicitAcceptanceDatabaseUrl();
  const url = override ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Stage13B-3B postgres: no DATABASE_URL / acceptance override');
  }
  const parsed = parseAcceptanceDatabaseUrl(url);
  if (!isCurrentSchemaRegressionMode()) {
    throw new Error(
      'Stage13B-3B postgres requires WEKONNEK_CURRENT_SCHEMA_REGRESSION=1',
    );
  }
  if (
    parsed.database === 'wekonnek_stage6_test' ||
    parsed.database.startsWith('wekonnek_stage6_')
  ) {
    throw new Error(
      `HARNESS ROUTING: Stage13B-3B postgres refused historical database ${parsed.database}`,
    );
  }
  if (parsed.database === 'wekonnek_stage13b3_cursor_test') {
    throw new Error(
      `HARNESS ROUTING: Stage13B-3B postgres refused frozen Stage13B-3A database ${parsed.database}`,
    );
  }
  if (
    !parsed.database.startsWith('wekonnek_stage13b3_') ||
    !isRecognizedCurrentSchemaDisposableName(parsed.database)
  ) {
    throw new Error(
      `Stage13B-3B postgres refuses database ${parsed.database}; use wekonnek_stage13b3_* disposable`,
    );
  }
  assertSafeCurrentSchemaRegressionDatabase(
    parsed.database,
    'Stage13B-3B postgres',
  );
  return parsed.database;
}

const describeIf = STAGE13B3B_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = STAGE13B3B_ENV_PRESENT
  ? resolveStage13b3bExpectedDatabase()
  : 'wekonnek_stage13b3_b_cursor_test';
const ALLOWED_DB_USERS = stage13b2AllowedDbUsers(EXPECTED_DB);

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
  ] = await Promise.all([
    prisma.riderAdvanceSettlement.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        status: true,
        claimedAmount: true,
        acknowledgedAmount: true,
        acknowledgedAt: true,
      },
    }),
    prisma.returnFinancialSettlement.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        status: true,
        claimedAmount: true,
        acknowledgedAmount: true,
        acknowledgedAt: true,
      },
    }),
    prisma.exceptionFinancialSettlement.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        status: true,
        claimedAmount: true,
        acknowledgedAmount: true,
        acknowledgedAt: true,
      },
    }),
    prisma.riderAdvance.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, status: true, reimbursementPrincipal: true },
    }),
    prisma.returnFinancialObligation.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, principal: true, type: true },
    }),
    prisma.exceptionFinancialObligation.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, status: true, principal: true },
    }),
    prisma.economicLossCoverage.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, amount: true, sourceRef: true },
    }),
    prisma.liabilityDetermination.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, status: true },
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
  };
}

describeIf(
  `Stage13B-3B financial-reconciliation search PostgreSQL (${EXPECTED_DB})`,
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let adminId: string;
    let orderId: number;
    let raId: string;

    const runtimeI18n = join(process.cwd(), 'i18n');
    const sourceI18n = join(process.cwd(), 'src', 'i18n');
    const auth = (user: { id: string; role: UserRole }) => ({
      Authorization: `Bearer ${sign(
        { sub: user.id, role: user.role },
        process.env.JWT_SECRET || 'dev-secret',
        { expiresIn: '1h' },
      )}`,
    });

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
        'Stage13B-3B postgres',
      );
      expect(identity.database).toBe(EXPECTED_DB);
      expect(ALLOWED_DB_USERS.has(identity.user)).toBe(true);

      const fx = await seedOrderParties(prisma);
      orderId = fx.orderId;
      raId = await insertRiderAdvance(prisma, fx, {
        riderId: fx.riderAId,
        principal: '1234.56',
      });
      await insertFinalizedReturnDetermination(prisma, fx, {
        riderAdvanceId: raId,
        merchantToRider: '100.00',
        merchantToCustomer: '0.10',
        snapshotPrincipal: '1234.56',
        snapshotReimbursed: '0.10',
      });
      const admin = await prisma.user.create({
        data: {
          phone: `+63${fx.tag.replace(/-/g, '').slice(0, 16)}`,
          email: `s13b3b-pg-admin-${fx.tag}@test.invalid`,
          role: UserRole.admin,
          firstName: 'pgadmin',
        },
      });
      adminId = admin.id;
    });

    afterAll(async () => {
      await app.close();
    });

    it('reports current_database() / current_user() before fixtures mutate', async () => {
      const rows = await prisma.$queryRaw<
        Array<{ database: string; user: string }>
      >`SELECT current_database() AS database, current_user AS user`;
      expect(rows[0]?.database).toBe(EXPECTED_DB);
      expect(ALLOWED_DB_USERS.has(rows[0]!.user)).toBe(true);
      expect(rows[0]?.database).not.toBe('wekonnek_stage6_test');
    });

    it('admin search does not lookup MerchantStaff and does not N+1 after forOrder', async () => {
      const staffSpy = jest.spyOn(prisma.merchantStaff, 'findMany');
      const recon = app.get(FinancialReconciliationService);
      const forOrderSpy = jest.spyOn(recon, 'forOrder');
      try {
        staffSpy.mockClear();
        forOrderSpy.mockClear();
        await request(app.getHttpServer())
          .get('/api/admin/financial-reconciliation')
          .query({ wkOrderId: String(orderId) })
          .set(auth({ id: adminId, role: UserRole.admin }))
          .expect(200);
        expect(staffSpy).not.toHaveBeenCalled();
        expect(forOrderSpy).toHaveBeenCalledTimes(1);
      } finally {
        staffSpy.mockRestore();
        forOrderSpy.mockRestore();
      }
    });

    it('admin search GET does not mutate financial tables', async () => {
      const before = await snapshotFinancialTables(prisma);
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      await request(app.getHttpServer())
        .get('/api/admin/financial-reconciliation')
        .query({ since })
        .set(auth({ id: adminId, role: UserRole.admin }))
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/admin/financial-reconciliation')
        .query({
          rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
          obligationId: raId,
        })
        .set(auth({ id: adminId, role: UserRole.admin }))
        .expect(200);
      const after = await snapshotFinancialTables(prisma);
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    });
  },
);
