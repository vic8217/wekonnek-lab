/**
 * Stage13B-3A PostgreSQL identity, query-bound, and no-write proofs.
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
import { UserRole } from '@prisma/client';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import {
  insertFinalizedReturnDetermination,
  insertRiderAdvance,
  seedOrderParties,
} from './financial-reconciliation.test-seed';
import { RAIL_RIDER_ADVANCE_REIMBURSEMENT } from './financial-reconciliation.types';

function resolveStage13b3ExpectedDatabase(): string {
  const override = getExplicitAcceptanceDatabaseUrl();
  const url = override ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('Stage13B-3 postgres: no DATABASE_URL / acceptance override');
  }
  const parsed = parseAcceptanceDatabaseUrl(url);
  if (!isCurrentSchemaRegressionMode()) {
    throw new Error(
      'Stage13B-3 postgres requires WEKONNEK_CURRENT_SCHEMA_REGRESSION=1',
    );
  }
  if (
    !parsed.database.startsWith('wekonnek_stage13b3_') ||
    !isRecognizedCurrentSchemaDisposableName(parsed.database)
  ) {
    throw new Error(
      `Stage13B-3 postgres refuses database ${parsed.database}; use wekonnek_stage13b3_* disposable`,
    );
  }
  assertSafeCurrentSchemaRegressionDatabase(
    parsed.database,
    'Stage13B-3 postgres',
  );
  return parsed.database;
}

const describeIf = STAGE13B3_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(240_000);

const EXPECTED_DB = STAGE13B3_ENV_PRESENT
  ? resolveStage13b3ExpectedDatabase()
  : 'wekonnek_stage13b3_cursor_test';
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
  `Stage13B-3A financial-reconciliation HTTP PostgreSQL (${EXPECTED_DB})`,
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let adminId: string;
    let customerId: string;
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
        'Stage13B-3 postgres',
      );
      expect(identity.database).toBe(EXPECTED_DB);
      expect(ALLOWED_DB_USERS.has(identity.user)).toBe(true);

      const fx = await seedOrderParties(prisma);
      customerId = fx.customerId;
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
          email: `s13b3-pg-admin-${fx.tag}@test.invalid`,
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
    });

    it('resolves actor/owned merchants once per order GET (no N+1)', async () => {
      const merchantSpy = jest.spyOn(prisma.merchant, 'findMany');
      const staffSpy = jest.spyOn(prisma.merchantStaff, 'findMany');
      try {
        merchantSpy.mockClear();
        staffSpy.mockClear();
        await request(app.getHttpServer())
          .get(`/api/orders/${orderId}/financial-reconciliation`)
          .set(auth({ id: customerId, role: UserRole.customer }))
          .expect(200);
        expect(merchantSpy).toHaveBeenCalledTimes(1);
        expect(staffSpy).not.toHaveBeenCalled();
      } finally {
        merchantSpy.mockRestore();
        staffSpy.mockRestore();
      }
    });

    it('GET reads do not mutate financial tables', async () => {
      const before = await snapshotFinancialTables(prisma);
      await request(app.getHttpServer())
        .get(`/api/orders/${orderId}/financial-reconciliation`)
        .set(auth({ id: adminId, role: UserRole.admin }))
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/orders/${orderId}/financial-reconciliation`)
        .set(auth({ id: customerId, role: UserRole.customer }))
        .expect(200);
      await request(app.getHttpServer())
        .get(
          `/api/financial-obligations/${RAIL_RIDER_ADVANCE_REIMBURSEMENT}/${raId}`,
        )
        .set(auth({ id: customerId, role: UserRole.customer }))
        .expect(200);
      const after = await snapshotFinancialTables(prisma);
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    });
  },
);
