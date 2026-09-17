/**
 * Stage 11 operations recovery HTTP + privacy acceptance.
 * Requires backend/.env.stage11.test → wekonnek_stage11_test.
 */
import { config as loadEnv } from 'dotenv';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';

const STAGE11_ENV = resolve(__dirname, '../../.env.stage11.test');
const STAGE11_ENV_PRESENT = existsSync(STAGE11_ENV);

if (STAGE11_ENV_PRESENT) {
  loadEnv({ path: STAGE11_ENV, override: true });
}

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommerceDomain,
  DeliveryFailureReasonCode,
  DeliveryAttemptOutcome,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  OperationsRecoveryTrigger,
  Prisma,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryFailureService } from '../delivery-failure/delivery-failure.service';
import {
  STAGE11_ACCEPTANCE_DATABASE,
  STAGE11_FORBIDDEN_DATABASES,
} from '../test-support/test-database-guard';

const describeIf = STAGE11_ENV_PRESENT ? describe : describe.skip;
jest.setTimeout(180_000);

const ALLOWED_DB_USERS = new Set(['victor', 'wekonnek_stage11_test']);

describeIf('Stage 11 Operations Recovery HTTP (wekonnek_stage11_test)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let failures: DeliveryFailureService;
  let customer: { id: string; role: UserRole };
  let rider: { id: string; role: UserRole };
  let admin: { id: string; role: UserRole };
  let merchantUser: { id: string; role: UserRole };
  let foreign: { id: string; role: UserRole };
  let order: { id: number };
  let fulfillment: { id: string };
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
    failures = app.get(DeliveryFailureService);

    const target = await prisma.$queryRaw<
      Array<{ database: string; user: string }>
    >(Prisma.sql`SELECT current_database() AS database, current_user AS user`);
    expect(STAGE11_FORBIDDEN_DATABASES.has(target[0]!.database)).toBe(false);
    expect(target[0]?.database).toBe(STAGE11_ACCEPTANCE_DATABASE);
    expect(ALLOWED_DB_USERS.has(target[0]!.user)).toBe(true);

    const tag = randomUUID();
    const mk = (role: UserRole, p: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s11h-${p}-${tag}@test.invalid`,
          role,
          firstName: p,
        },
      });
    customer = await mk(UserRole.customer, 'c');
    rider = await mk(UserRole.rider, 'r');
    admin = await mk(UserRole.admin, 'a');
    merchantUser = await mk(UserRole.merchant, 'm');
    foreign = await mk(UserRole.customer, 'f');
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S11H ${tag}`,
        slug: `s11h-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
        allowRiderAdvance: true,
      },
    });
    await prisma.merchantPaymentMethod.create({
      data: {
        id: randomUUID(),
        merchantId: merchant.id,
        kind: MerchantPaymentMethodKind.CASH,
        displayName: 'Cash',
        enabled: true,
      },
    });
    order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S11H-${tag.slice(0, 8)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: 'pending',
        orderType: 'delivery',
        totalAmount: 1000,
        deliveryFee: 50,
        transactionFeeAmount: 0,
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
        deliveryAddress: '123 Stage11 HTTP St',
        orderItems: {
          create: [
            {
              productName: 'item',
              quantity: 1,
              price: 1000,
              subtotal: 1000,
            },
          ],
        },
      },
    });
    fulfillment = await prisma.orderFulfillment.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        merchantId: merchant.id,
        customerId: customer.id,
        status: FulfillmentStatus.in_transit,
        assignmentVersion: 1,
        activeRiderId: rider.id,
        physicalCustodianRiderId: rider.id,
      },
    });
    await prisma.riderAssignment.create({
      data: {
        id: randomUUID(),
        fulfillmentId: fulfillment.id,
        riderId: rider.id,
        status: RiderAssignmentStatus.ACTIVE,
        assignmentVersion: 1,
      },
    });
    await failures.reportFailure({
      wkOrderId: order.id,
      actorUserId: rider.id,
      failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
      correlationId: `s11h-fail-${tag}`,
    });
    // Exhaust attempts for DELIVERY_ATTEMPTS_EXHAUSTED eligibility
    const first = await prisma.deliveryAttempt.findFirst({
      where: { fulfillmentId: fulfillment.id },
    });
    if (first) {
      for (const n of [2, 3]) {
        await prisma.deliveryAttempt.create({
          data: {
            id: randomUUID(),
            wkOrderId: order.id,
            fulfillmentId: fulfillment.id,
            attemptNumber: n,
            riderId: first.riderId,
            riderAssignmentId: first.riderAssignmentId,
            assignmentVersion: first.assignmentVersion,
            physicalCustodianRiderId: first.physicalCustodianRiderId,
            outcome: DeliveryAttemptOutcome.FAILED,
            failureReasonCode: DeliveryFailureReasonCode.CUSTOMER_UNREACHABLE,
            occurredAt: new Date(),
            reportedByActorType: 'RIDER',
            reportedByActorId: rider.id,
          },
        });
      }
    }
  });

  afterAll(async () => {
    // Append-only Stage 8/11 history must remain. Do not DISABLE TRIGGER or
    // DELETE protected rows; leave suite fixtures orphaned on the acceptance DB.
    void order;
    void fulfillment;
    await app?.close();
  });

  it('admin opens recovery; customer gets minimal GET; foreign denied; rider cannot open', async () => {
    const open = await request(app.getHttpServer())
      .post(`/orders/${order.id}/operations-recoveries`)
      .set(auth(admin))
      .send({
        openingTriggerCode: OperationsRecoveryTrigger.DELIVERY_ATTEMPTS_EXHAUSTED,
        correlationId: `http-open-${randomUUID()}`,
        idempotencyKey: `http-idem-${randomUUID()}`,
      });
    expect(open.status).toBeLessThan(400);
    expect(open.body.code).toBe('OPERATIONS_RECOVERY_OPENED');
    const recoveryId = open.body.recovery.id as string;

    const riderOpen = await request(app.getHttpServer())
      .post(`/orders/${order.id}/operations-recoveries`)
      .set(auth(rider))
      .send({
        openingTriggerCode: OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
        correlationId: 'x',
      });
    expect(riderOpen.status).toBeGreaterThanOrEqual(400);

    const custGet = await request(app.getHttpServer())
      .get(`/operations-recoveries/${recoveryId}`)
      .set(auth(customer));
    expect(custGet.status).toBeLessThan(400);
    expect(custGet.body.recovery.status).toBeDefined();
    expect(custGet.body.recovery.events).toBeUndefined();

    const adminGet = await request(app.getHttpServer())
      .get(`/operations-recoveries/${recoveryId}`)
      .set(auth(admin));
    expect(adminGet.status).toBeLessThan(400);
    expect(adminGet.body.recovery.events).toBeDefined();

    const foreignGet = await request(app.getHttpServer())
      .get(`/operations-recoveries/${recoveryId}`)
      .set(auth(foreign));
    expect(foreignGet.status).toBeGreaterThanOrEqual(400);

    const list = await request(app.getHttpServer())
      .get(`/orders/${order.id}/operations-recoveries`)
      .set(auth(merchantUser));
    expect(list.status).toBeLessThan(400);
    expect(Array.isArray(list.body.recoveries)).toBe(true);
  });
});
