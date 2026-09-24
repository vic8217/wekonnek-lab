/**
 * UCE-1B-A live persisted merchant assignment authority.
 * Opt-in: WEKONNEK_UCE1B=1. DATABASE_URL must be wekonnek_uce1b_cursor_test
 * or wekonnek_uce1b_terra_test.
 */
import { ForbiddenException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommerceDomain,
  FulfillmentStatus,
  MerchantStaffRole,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAssignmentService } from './rider-assignment.service';
import { FulfillmentTransitionService } from './fulfillment-transition.service';
import {
  ACCEPTANCE_ABSOLUTE_DENY_DATABASES,
  ACCEPTANCE_DESTRUCTIVE_OK_ENV,
  assertSafeLocalAcceptanceHost,
  isDestructiveAcceptanceOptIn,
  parseAcceptanceDatabaseUrl,
} from '../test-support/acceptance-database';
import {
  assertNotHistoricalAcceptanceDatabase,
  assertUceDisposableIdentity,
  isRecognizedUceDisposableName,
} from '../test-support/test-database-guard';

const UCE_1BA_TARGETS: ReadonlySet<string> = new Set([
  'wekonnek_uce1b_cursor_test',
  'wekonnek_uce1b_terra_test',
]);

function isApprovedUce1baTarget(database: string): boolean {
  if (!isRecognizedUceDisposableName(database)) return false;
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database)) return false;
  return UCE_1BA_TARGETS.has(database);
}

function resolveUce1baApprovedDatabase(): string {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `UCE-1B-A refused: NODE_ENV=test is required (got ${process.env.NODE_ENV ?? '<unset>'})`,
    );
  }
  if (!isDestructiveAcceptanceOptIn()) {
    throw new Error(
      `UCE-1B-A refused: ${ACCEPTANCE_DESTRUCTIVE_OK_ENV}=1 is required`,
    );
  }
  const parsed = parseAcceptanceDatabaseUrl(process.env.DATABASE_URL || '');
  assertSafeLocalAcceptanceHost(parsed, 'UCE-1B-A');
  assertNotHistoricalAcceptanceDatabase(parsed.database, 'UCE-1B-A');
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(parsed.database)) {
    throw new Error(`UCE-1B-A refused: ${parsed.database} is permanently forbidden`);
  }
  if (!isApprovedUce1baTarget(parsed.database)) {
    throw new Error(
      `UCE-1B-A refused: ${parsed.database} is not wekonnek_uce1b_cursor_test or wekonnek_uce1b_terra_test`,
    );
  }
  return parsed.database;
}

const LIVE_OPT_IN = process.env.WEKONNEK_UCE1B === '1';
const describeLive = LIVE_OPT_IN ? describe : describe.skip;
let approvedDatabase = '';
if (LIVE_OPT_IN) {
  approvedDatabase = resolveUce1baApprovedDatabase();
  process.env.DO_SPACES_REGION ||= 'sgp1';
  process.env.DO_SPACES_BUCKET ||= 'wekonnek-uce1b-test';
  process.env.DO_SPACES_ENDPOINT ||= 'https://sgp1.digitaloceanspaces.com';
  process.env.DO_SPACES_ACCESS_KEY ||= 'uce1b-test';
  process.env.DO_SPACES_SECRET_KEY ||= 'uce1b-test';
}

jest.setTimeout(180_000);

describe('UCE-1B-A harness database identity', () => {
  it('accepts Cursor and Terra UCE-1B H0 names', () => {
    expect(isApprovedUce1baTarget('wekonnek_uce1b_cursor_test')).toBe(true);
    expect(isApprovedUce1baTarget('wekonnek_uce1b_terra_test')).toBe(true);
    expect(isRecognizedUceDisposableName('wekonnek_uce1b_cursor_test')).toBe(
      true,
    );
  });

  it('rejects UCE-1, UCE-C1, and other H0 names as 1B-A live targets', () => {
    expect(isApprovedUce1baTarget('wekonnek_uce1_cursor_test')).toBe(false);
    expect(isApprovedUce1baTarget('wekonnek_uce_c1_cursor_test')).toBe(false);
    expect(isApprovedUce1baTarget('postgres')).toBe(false);
  });
});

describeLive('UCE-1B-A persisted merchant assignment authority', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let assignments: RiderAssignmentService;
  let transitions: FulfillmentTransitionService;
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
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0);
    prisma = app.get(PrismaService);
    assignments = app.get(RiderAssignmentService);
    transitions = app.get(FulfillmentTransitionService);
    const identity = await prisma.$queryRaw<Array<{ db: string; usr: string }>>`
      SELECT current_database() AS db, current_user AS usr
    `;
    assertUceDisposableIdentity(
      { database: identity[0]?.db ?? '', user: identity[0]?.usr ?? '' },
      approvedDatabase,
      'UCE-1B-A',
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  async function seedWk(opts?: { assign?: boolean }) {
    const tag = randomUUID();
    const mkUser = (role: UserRole, prefix: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `1ba-${prefix}-${tag}@test.invalid`,
          role,
          firstName: prefix,
          isActive: true,
          status: role === UserRole.rider ? 'approved' : 'active',
        },
      });
    const customer = await mkUser(UserRole.customer, 'c');
    const rider = await mkUser(UserRole.rider, 'r');
    const riderB = await mkUser(UserRole.rider, 'rb');
    const ownerA = await mkUser(UserRole.merchant, 'oa');
    const ownerB = await mkUser(UserRole.merchant, 'ob');
    const manager = await mkUser(UserRole.merchant, 'mgr');
    const staff = await mkUser(UserRole.merchant, 'st');
    const fakeMgr = await mkUser(UserRole.merchant, 'fm');
    const admin = await mkUser(UserRole.admin, 'ad');
    const merchantA = await prisma.merchant.create({
      data: {
        userId: ownerA.id,
        name: `1BA A ${tag}`,
        slug: `1ba-a-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
      },
    });
    const merchantB = await prisma.merchant.create({
      data: {
        userId: ownerB.id,
        name: `1BA B ${tag}`,
        slug: `1ba-b-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
      },
    });
    await prisma.merchantStaff.create({
      data: {
        merchantId: merchantA.id,
        userId: manager.id,
        role: MerchantStaffRole.manager,
        isActive: true,
      },
    });
    await prisma.merchantStaff.create({
      data: {
        merchantId: merchantA.id,
        userId: staff.id,
        role: MerchantStaffRole.staff,
        isActive: true,
      },
    });
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-1BA-${tag.slice(0, 12)}`,
        userId: customer.id,
        merchantId: merchantA.id,
        status: 'ready',
        orderType: 'delivery',
        totalAmount: 25,
        deliveryFee: 0,
        transactionFeeAmount: 0,
        paymentMethod: 'cod',
        paymentStatus: 'pending',
        merchantPaymentStatus: 'AWAITING_PAYMENT',
        orderItems: {
          create: [
            {
              productName: '1BA Item',
              quantity: 1,
              price: 25,
              subtotal: 25,
            },
          ],
        },
      },
    });
    const fulfillment = await prisma.orderFulfillment.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        merchantId: merchantA.id,
        customerId: customer.id,
        status: FulfillmentStatus.ready_for_pickup,
        assignmentVersion: opts?.assign ? 1 : 0,
        activeRiderId: opts?.assign ? rider.id : null,
      },
    });
    if (opts?.assign) {
      await prisma.riderAssignment.create({
        data: {
          id: randomUUID(),
          fulfillmentId: fulfillment.id,
          riderId: rider.id,
          status: RiderAssignmentStatus.ACTIVE,
          assignmentVersion: 1,
          assignedByType: 'SYSTEM',
        },
      });
    }
    return {
      customer,
      rider,
      riderB,
      ownerA,
      ownerB,
      manager,
      staff,
      fakeMgr,
      admin,
      merchantA,
      merchantB,
      order,
      fulfillment,
    };
  }

  async function cleanupWk(s: Awaited<ReturnType<typeof seedWk>>) {
    await prisma.orderDomainEvent.deleteMany({
      where: { wkOrderId: s.order.id },
    });
    await prisma.riderAssignment.deleteMany({
      where: { fulfillmentId: s.fulfillment.id },
    });
    await prisma.orderFulfillment.deleteMany({
      where: { id: s.fulfillment.id },
    });
    await prisma.orderItem.deleteMany({ where: { orderId: s.order.id } });
    await prisma.wkOrder.deleteMany({ where: { id: s.order.id } });
    await prisma.merchantStaff.deleteMany({
      where: { merchantId: { in: [s.merchantA.id, s.merchantB.id] } },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: [s.merchantA.id, s.merchantB.id] } },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            s.customer.id,
            s.rider.id,
            s.riderB.id,
            s.ownerA.id,
            s.ownerB.id,
            s.manager.id,
            s.staff.id,
            s.fakeMgr.id,
            s.admin.id,
          ],
        },
      },
    });
  }

  it('A: persisted owner of target merchant is allowed', async () => {
    const s = await seedWk();
    const result = await assignments.assign({
      wkOrderId: s.order.id,
      riderId: s.rider.id,
      actor: { id: s.ownerA.id, type: 'MERCHANT_OWNER' },
    });
    expect(result.fulfillment.activeRiderId).toBe(s.rider.id);
    await cleanupWk(s);
  });

  it('B: owner of merchant A cannot assign merchant B with forged merchantOwnerUserId', async () => {
    const s = await seedWk();
    await expect(
      assignments.assign({
        wkOrderId: s.order.id,
        riderId: s.rider.id,
        actor: { id: s.ownerB.id, type: 'MERCHANT_OWNER' },
        merchantOwnerUserId: s.ownerB.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      await prisma.riderAssignment.count({
        where: { fulfillmentId: s.fulfillment.id },
      }),
    ).toBe(0);
    await cleanupWk(s);
  });

  it('C: forged actorMerchantIds of the target merchant does not authorize', async () => {
    const s = await seedWk();
    await expect(
      assignments.assign({
        wkOrderId: s.order.id,
        riderId: s.rider.id,
        actor: { id: s.ownerB.id, type: 'MERCHANT_OWNER' },
        actorMerchantIds: [s.merchantA.id],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await cleanupWk(s);
  });

  it('D: both forged owner id and actorMerchantIds are denied', async () => {
    const s = await seedWk();
    await expect(
      assignments.assign({
        wkOrderId: s.order.id,
        riderId: s.rider.id,
        actor: { id: s.ownerB.id, type: 'MERCHANT_OWNER' },
        merchantOwnerUserId: s.ownerB.id,
        actorMerchantIds: [s.merchantA.id],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await cleanupWk(s);
  });

  it('E: persisted active MERCHANT_ADMIN on target merchant is allowed', async () => {
    const s = await seedWk();
    const result = await assignments.assign({
      wkOrderId: s.order.id,
      riderId: s.rider.id,
      actor: { id: s.manager.id, type: 'MERCHANT_ADMIN' },
    });
    expect(result.fulfillment.activeRiderId).toBe(s.rider.id);
    await cleanupWk(s);
  });

  it('F: MERCHANT_ADMIN with forged actorMerchantIds but no persisted membership is denied', async () => {
    const s = await seedWk();
    await expect(
      assignments.assign({
        wkOrderId: s.order.id,
        riderId: s.rider.id,
        actor: { id: s.fakeMgr.id, type: 'MERCHANT_ADMIN' },
        actorMerchantIds: [s.merchantA.id],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await cleanupWk(s);
  });

  it('G: MERCHANT_STAFF with real persisted membership cannot assign', async () => {
    const s = await seedWk();
    await expect(
      assignments.assign({
        wkOrderId: s.order.id,
        riderId: s.rider.id,
        actor: { id: s.staff.id, type: 'MERCHANT_STAFF' },
        actorMerchantIds: [s.merchantA.id],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await cleanupWk(s);
  });

  it('H: unrelated merchant staff is denied', async () => {
    const s = await seedWk();
    await prisma.merchantStaff.create({
      data: {
        merchantId: s.merchantB.id,
        userId: s.fakeMgr.id,
        role: MerchantStaffRole.staff,
        isActive: true,
      },
    });
    await expect(
      assignments.assign({
        wkOrderId: s.order.id,
        riderId: s.rider.id,
        actor: { id: s.fakeMgr.id, type: 'MERCHANT_STAFF' },
        actorMerchantIds: [s.merchantA.id],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await cleanupWk(s);
  });

  it('I/J: CUSTOMER and RIDER cannot assign', async () => {
    const s = await seedWk();
    await expect(
      assignments.assign({
        wkOrderId: s.order.id,
        riderId: s.rider.id,
        actor: { id: s.customer.id, type: 'CUSTOMER' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      assignments.assign({
        wkOrderId: s.order.id,
        riderId: s.rider.id,
        actor: { id: s.rider.id, type: 'RIDER' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await cleanupWk(s);
  });

  it('K/L/M: SYSTEM_ADMIN, INTERNAL_SERVICE, and SYSTEM remain allowed', async () => {
    const s = await seedWk();
    await assignments.assign({
      wkOrderId: s.order.id,
      riderId: s.rider.id,
      actor: { id: s.admin.id, type: 'SYSTEM_ADMIN' },
    });
    await prisma.riderAssignment.updateMany({
      where: { fulfillmentId: s.fulfillment.id },
      data: { status: RiderAssignmentStatus.SUPERSEDED },
    });
    await prisma.orderFulfillment.update({
      where: { id: s.fulfillment.id },
      data: {
        activeRiderId: null,
        assignmentVersion: 0,
        status: FulfillmentStatus.ready_for_pickup,
      },
    });
    await assignments.assign({
      wkOrderId: s.order.id,
      riderId: s.rider.id,
      actor: { type: 'INTERNAL_SERVICE' },
    });
    await prisma.riderAssignment.updateMany({
      where: { fulfillmentId: s.fulfillment.id },
      data: { status: RiderAssignmentStatus.SUPERSEDED },
    });
    await prisma.orderFulfillment.update({
      where: { id: s.fulfillment.id },
      data: {
        activeRiderId: null,
        assignmentVersion: 0,
        status: FulfillmentStatus.ready_for_pickup,
      },
    });
    await assignments.assign({
      wkOrderId: s.order.id,
      riderId: s.rider.id,
      actor: { type: 'SYSTEM' },
    });
    await cleanupWk(s);
  });

  it('null merchantId merchant-owner with matching merchantOwnerUserId is denied', async () => {
    const s = await seedWk();
    const v2 = await prisma.order.create({
      data: {
        orderNumber: `1BA-V2-${randomUUID()}`,
        type: OrderType.express,
        status: OrderStatus.ready_for_pickup,
        customerId: s.customer.id,
        items: [],
        pickupAddress: {},
        deliveryAddress: {},
        paymentMethod: PaymentMethod.cash,
        paymentStatus: PaymentStatus.pending_payment,
      },
    });
    const ful = await prisma.orderFulfillment.create({
      data: {
        id: randomUUID(),
        orderV2Id: v2.id,
        customerId: s.customer.id,
        merchantId: null,
        status: FulfillmentStatus.ready_for_pickup,
        assignmentVersion: 0,
      },
    });
    await expect(
      assignments.assign({
        orderV2Id: v2.id,
        riderId: s.rider.id,
        actor: { id: s.ownerA.id, type: 'MERCHANT_OWNER' },
        merchantOwnerUserId: s.ownerA.id,
        actorMerchantIds: [s.merchantA.id],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      await prisma.riderAssignment.count({ where: { fulfillmentId: ful.id } }),
    ).toBe(0);
    await prisma.orderDomainEvent.deleteMany({ where: { orderV2Id: v2.id } });
    await prisma.orderFulfillment.deleteMany({ where: { id: ful.id } });
    await prisma.order.deleteMany({ where: { id: v2.id } });
    await cleanupWk(s);
  });

  it('allowReassignment does not bypass persisted merchant authority', async () => {
    const s = await seedWk({ assign: true });
    await expect(
      assignments.assign({
        wkOrderId: s.order.id,
        riderId: s.riderB.id,
        actor: { id: s.ownerB.id, type: 'MERCHANT_OWNER' },
        merchantOwnerUserId: s.ownerB.id,
        actorMerchantIds: [s.merchantA.id],
        allowReassignment: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: s.fulfillment.id },
    });
    expect(ful.activeRiderId).toBe(s.rider.id);
    await cleanupWk(s);
  });

  it('fulfillment transition cannot forge merchant authority into assign', async () => {
    const s = await seedWk();
    await expect(
      transitions.transition({
        fulfillmentId: s.fulfillment.id,
        targetStatus: 'rider_assigned',
        riderId: s.rider.id,
        actor: { id: s.ownerB.id, type: 'MERCHANT_OWNER' },
        merchantOwnerUserId: s.ownerB.id,
        actorMerchantIds: [s.merchantA.id],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await cleanupWk(s);
  });

  it('legacy delivery-orders assign-rider denies cross-merchant and null-merchant actors', async () => {
    const s = await seedWk();
    const v2 = await prisma.order.create({
      data: {
        orderNumber: `1BA-LEG-${randomUUID()}`,
        type: OrderType.express,
        status: OrderStatus.ready_for_pickup,
        customerId: s.customer.id,
        items: [],
        pickupAddress: {},
        deliveryAddress: {},
        paymentMethod: PaymentMethod.cash,
        paymentStatus: PaymentStatus.pending_payment,
      },
    });
    await prisma.orderFulfillment.create({
      data: {
        id: randomUUID(),
        orderV2Id: v2.id,
        merchantId: s.merchantA.id,
        customerId: s.customer.id,
        status: FulfillmentStatus.ready_for_pickup,
        assignmentVersion: 0,
      },
    });
    await request(app.getHttpServer())
      .put(`/delivery-orders/${v2.id}/assign-rider`)
      .set(auth(s.ownerA))
      .send({ riderId: s.rider.id })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/delivery-orders/${v2.id}/assign-rider`)
      .set(auth(s.ownerB))
      .send({ riderId: s.riderB.id })
      .expect(403);

    const v2Null = await prisma.order.create({
      data: {
        orderNumber: `1BA-NULL-${randomUUID()}`,
        type: OrderType.express,
        status: OrderStatus.ready_for_pickup,
        customerId: s.customer.id,
        items: [],
        pickupAddress: {},
        deliveryAddress: {},
        paymentMethod: PaymentMethod.cash,
        paymentStatus: PaymentStatus.pending_payment,
      },
    });
    await request(app.getHttpServer())
      .put(`/delivery-orders/${v2Null.id}/assign-rider`)
      .set(auth(s.ownerA))
      .send({ riderId: s.rider.id })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/delivery-orders/${v2.id}/assign-rider`)
      .set(auth(s.admin))
      .send({ riderId: s.riderB.id })
      .expect(200);

    await prisma.orderDomainEvent.deleteMany({
      where: { orderV2Id: { in: [v2.id, v2Null.id] } },
    });
    await prisma.riderAssignment.deleteMany({
      where: { orderV2Id: { in: [v2.id, v2Null.id] } },
    });
    await prisma.orderFulfillment.deleteMany({
      where: { orderV2Id: { in: [v2.id, v2Null.id] } },
    });
    await prisma.order.deleteMany({ where: { id: { in: [v2.id, v2Null.id] } } });
    await cleanupWk(s);
  });

  it('different-rider concurrent HTTP assign: one 201, one 409, one ACTIVE, no custody', async () => {
    const s = await seedWk();
    const financeBefore = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: s.order.id },
      select: {
        paymentStatus: true,
        merchantPaymentStatus: true,
        transactionFeeAmount: true,
      },
    });
    const [a, b] = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/orders/${s.order.id}/rider-assignment`)
        .set(auth(s.ownerA))
        .send({ riderId: s.rider.id }),
      request(app.getHttpServer())
        .post(`/orders/${s.order.id}/rider-assignment`)
        .set(auth(s.ownerA))
        .send({ riderId: s.riderB.id }),
    ]);
    const statuses = [a, b].map((r) =>
      r.status === 'fulfilled' ? r.value.status : 0,
    );
    expect(statuses.filter((x) => x === 201).length).toBe(1);
    expect(statuses.find((x) => x !== 201)).toBe(409);
    const active = await prisma.riderAssignment.findMany({
      where: {
        fulfillmentId: s.fulfillment.id,
        status: RiderAssignmentStatus.ACTIVE,
      },
    });
    expect(active).toHaveLength(1);
    const ful = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: s.fulfillment.id },
    });
    expect(ful.activeRiderId).toBe(active[0].riderId);
    expect(ful.physicalCustodianRiderId).toBeNull();
    expect(
      await prisma.custodyEvent.count({ where: { wkOrderId: s.order.id } }),
    ).toBe(0);
    const financeAfter = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: s.order.id },
      select: {
        paymentStatus: true,
        merchantPaymentStatus: true,
        transactionFeeAmount: true,
      },
    });
    expect(financeAfter).toEqual(financeBefore);
    await cleanupWk(s);
  });
});
