/**
 * Stage 13A Exception Obligation Settlement HTTP auth acceptance.
 * Default: .env.stage13a.test; override via WEKONNEK_ACCEPTANCE_DATABASE_URL.
 *
 * JWT party claim/ack/cash; wrong party 403; admin 403 on mutations.
 */
import { existsSync, mkdirSync, cpSync } from 'fs';
import { join } from 'path';
import { loadStageTestEnv } from '../test-support/load-stage-test-env';
import {
  assertPrismaConnectedToStage13aAcceptanceDb,
  resolveStage13aExpectedDatabase,
  stage13aAllowedDbUsers,
} from '../test-support/acceptance-database';
import { STAGE13A_FORBIDDEN_DATABASES } from '../test-support/test-database-guard';

const STAGE13A_ENV_PRESENT = loadStageTestEnv('.env.stage13a.test');

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { ExceptionFinancialService } from './exception-financial.service';
import { seedOpenObligation } from './exception-financial-settlement.test-seed';

const describeIf = STAGE13A_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const EXPECTED_DB = resolveStage13aExpectedDatabase();
const ALLOWED_DB_USERS = stage13aAllowedDbUsers(EXPECTED_DB);

describeIf(`Stage 13A Exception Settlement HTTP (${EXPECTED_DB})`, () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let exceptions: ExceptionFinancialService;

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
    await app.listen(0);
    prisma = app.get(PrismaService);
    exceptions = app.get(ExceptionFinancialService);

    const identity = await assertPrismaConnectedToStage13aAcceptanceDb(
      prisma,
      EXPECTED_DB,
      'Stage 13A settlement HTTP',
    );
    expect(STAGE13A_FORBIDDEN_DATABASES.has(identity.database)).toBe(false);
    expect(ALLOWED_DB_USERS.has(identity.user)).toBe(true);

    await exceptions.ensureSeededPolicy();
  });

  afterAll(async () => {
    await app.close();
  });

  it('debtor can claim transfer; creditor can cash and ack; wrong party 403; admin 403', async () => {
    const fx = await seedOpenObligation(prisma, exceptions);
    const customer = { id: fx.customerId, role: UserRole.customer };
    const merchant = { id: fx.merchantUserId, role: UserRole.merchant };
    const foreign = { id: fx.foreignId, role: UserRole.customer };
    const admin = { id: fx.adminId, role: UserRole.admin };

    const claimRes = await request(app.getHttpServer())
      .post(
        `/exception-financial-obligations/${fx.obligationId}/settlements/claim`,
      )
      .set(auth(customer))
      .send({
        method: 'DIRECT_TRANSFER',
        amount: '100.00',
        idempotencyKey: `http-claim-${randomUUID()}`,
      });
    expect(claimRes.status).toBeLessThan(400);
    const settlementId = claimRes.body.settlement.id as string;

    const badClaim = await request(app.getHttpServer())
      .post(
        `/exception-financial-obligations/${fx.obligationId}/settlements/claim`,
      )
      .set(auth(foreign))
      .send({
        method: 'DIRECT_TRANSFER',
        amount: '10.00',
        idempotencyKey: `http-bad-${randomUUID()}`,
      });
    expect(badClaim.status).toBe(403);

    const adminCash = await request(app.getHttpServer())
      .post(
        `/exception-financial-obligations/${fx.obligationId}/settlements/cash`,
      )
      .set(auth(admin))
      .send({
        amount: '10.00',
        idempotencyKey: `http-admin-cash-${randomUUID()}`,
      });
    expect(adminCash.status).toBe(403);

    const selfAck = await request(app.getHttpServer())
      .post(`/exception-financial-settlements/${settlementId}/acknowledge`)
      .set(auth(customer))
      .send({
        acknowledgedAmount: '100.00',
        idempotencyKey: `http-self-ack-${randomUUID()}`,
      });
    expect(selfAck.status).toBe(403);

    const ack = await request(app.getHttpServer())
      .post(`/exception-financial-settlements/${settlementId}/acknowledge`)
      .set(auth(merchant))
      .send({
        acknowledgedAmount: '100.00',
        idempotencyKey: `http-ack-${randomUUID()}`,
      });
    expect(ack.status).toBeLessThan(400);

    const cashRes = await request(app.getHttpServer())
      .post(
        `/exception-financial-obligations/${fx.obligationId}/settlements/cash`,
      )
      .set(auth(merchant))
      .send({
        amount: '50.00',
        idempotencyKey: `http-cash-${randomUUID()}`,
      });
    expect(cashRes.status).toBeLessThan(400);
    expect(cashRes.body.settlement.status).toBe('ACKNOWLEDGED');

    const summaryOk = await request(app.getHttpServer())
      .get(
        `/exception-financial-obligations/${fx.obligationId}/settlement-summary`,
      )
      .set(auth(customer));
    expect(summaryOk.status).toBeLessThan(400);

    const summaryForbidden = await request(app.getHttpServer())
      .get(
        `/exception-financial-obligations/${fx.obligationId}/settlement-summary`,
      )
      .set(auth(foreign));
    expect(summaryForbidden.status).toBe(403);
  });
});
