/**
 * UCE-1 canonical WkOrder rider-assignment HTTP acceptance.
 * Live mutations are opt-in: WEKONNEK_UCE1_HTTP=1. The approved DATABASE_URL
 * name must be an H0 UCE disposable whose identity is exactly UCE-1 and whose
 * executor is cursor or terra (wekonnek_uce1_cursor_test |
 * wekonnek_uce1_terra_test). Unsafe live configuration fails closed; it does
 * not skip.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommerceDomain,
  FulfillmentStatus,
  MerchantStaffRole,
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

/** Independently approved UCE-1 HTTP targets. Exact names, not a wildcard. */
const UCE1_HTTP_TARGETS: ReadonlySet<string> = new Set([
  'wekonnek_uce1_cursor_test',
  'wekonnek_uce1_terra_test',
]);

function isApprovedUce1HttpTarget(database: string): boolean {
  if (!isRecognizedUceDisposableName(database)) return false;
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database)) return false;
  return UCE1_HTTP_TARGETS.has(database);
}

function assertApprovedUce1HttpTarget(database: string): void {
  if (!isApprovedUce1HttpTarget(database)) {
    throw new Error(
      `UCE-1 HTTP refused: ${database} is not an approved UCE-1 cursor|terra ` +
        'disposable (expected wekonnek_uce1_cursor_test or wekonnek_uce1_terra_test)',
    );
  }
}

function resolveUce1HttpApprovedDatabase(): string {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `UCE-1 HTTP refused: NODE_ENV=test is required (got ${process.env.NODE_ENV ?? '<unset>'})`,
    );
  }
  if (!isDestructiveAcceptanceOptIn()) {
    throw new Error(
      `UCE-1 HTTP refused: ${ACCEPTANCE_DESTRUCTIVE_OK_ENV}=1 is required`,
    );
  }
  const parsed = parseAcceptanceDatabaseUrl(process.env.DATABASE_URL || '');
  assertSafeLocalAcceptanceHost(parsed, 'UCE-1 HTTP');
  assertNotHistoricalAcceptanceDatabase(parsed.database, 'UCE-1 HTTP');
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(parsed.database)) {
    throw new Error(
      `UCE-1 HTTP refused: ${parsed.database} is permanently forbidden`,
    );
  }
  assertApprovedUce1HttpTarget(parsed.database);
  return parsed.database;
}

const LIVE_OPT_IN = process.env.WEKONNEK_UCE1_HTTP === '1';
const describeLive = LIVE_OPT_IN ? describe : describe.skip;
let approvedDatabase = '';
if (LIVE_OPT_IN) {
  approvedDatabase = resolveUce1HttpApprovedDatabase();
  process.env.DO_SPACES_REGION ||= 'sgp1';
  process.env.DO_SPACES_BUCKET ||= 'wekonnek-uce1-test';
  process.env.DO_SPACES_ENDPOINT ||= 'https://sgp1.digitaloceanspaces.com';
  process.env.DO_SPACES_ACCESS_KEY ||= 'uce1-test';
  process.env.DO_SPACES_SECRET_KEY ||= 'uce1-test';
}

jest.setTimeout(180_000);

describe('UCE-1 HTTP harness database identity', () => {
  it('accepts only independently approved UCE-1 cursor and terra H0 names', () => {
    expect(isApprovedUce1HttpTarget('wekonnek_uce1_cursor_test')).toBe(true);
    expect(isApprovedUce1HttpTarget('wekonnek_uce1_terra_test')).toBe(true);
    expect(isRecognizedUceDisposableName('wekonnek_uce1_cursor_test')).toBe(
      true,
    );
    expect(isRecognizedUceDisposableName('wekonnek_uce1_terra_test')).toBe(
      true,
    );
  });

  it('rejects non-UCE-1, non-executor, historical, and system names', () => {
    const rejected = [
      'wekonnek_uce1_test',
      'wekonnek_uce1_prod',
      'wekonnek_uce1_cursor',
      'wekonnek_uce1_foo_test',
      'wekonnek_uce2_cursor_test',
      'wekonnek_uce_h1_cursor_test',
      'wekonnek_stage15c_cursor_config_final_test',
      'wekonnek_stage12_test',
      'postgres',
    ];
    for (const name of rejected) {
      expect(isApprovedUce1HttpTarget(name)).toBe(false);
    }
    expect(isRecognizedUceDisposableName('wekonnek_uce2_cursor_test')).toBe(
      true,
    );
    expect(isRecognizedUceDisposableName('wekonnek_uce_h1_cursor_test')).toBe(
      true,
    );
    expect(isRecognizedUceDisposableName('wekonnek_uce1_foo_test')).toBe(
      false,
    );
  });
});

describeLive('UCE-1 WkOrder rider-assignment HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
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
    const identity = await prisma.$queryRaw<Array<{ db: string; usr: string }>>`
      SELECT current_database() AS db, current_user AS usr
    `;
    const db = identity[0]?.db ?? '';
    const usr = identity[0]?.usr ?? '';
    assertUceDisposableIdentity(
      { database: db, user: usr },
      approvedDatabase,
      'UCE-1 HTTP',
    );
    if (db !== approvedDatabase || ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(db)) {
      throw new Error(
        `UCE-1 HTTP refused: current_database=${db} current_user=${usr} approved=${approvedDatabase}`,
      );
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  async function seed(opts?: {
    fulfillmentStatus?: FulfillmentStatus;
    commerceStatus?: string;
    assign?: boolean;
    custodian?: boolean;
    riderStatus?: string;
    riderActive?: boolean;
    riderRole?: UserRole;
    riderB?: boolean;
  }) {
    const tag = randomUUID();
    const mkUser = (
      role: UserRole,
      prefix: string,
      extra: { status?: string; isActive?: boolean } = {},
    ) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s7a-${prefix}-${tag}@test.invalid`,
          role,
          firstName: prefix,
          isActive: extra.isActive ?? true,
          status: extra.status ?? (role === UserRole.rider ? 'approved' : 'active'),
        },
      });
    const customer = await mkUser(UserRole.customer, 'c');
    const rider = await mkUser(opts?.riderRole ?? UserRole.rider, 'r', {
      status: opts?.riderStatus ?? 'approved',
      isActive: opts?.riderActive ?? true,
    });
    const riderB = opts?.riderB
      ? await mkUser(UserRole.rider, 'rb')
      : null;
    const merchantUser = await mkUser(UserRole.merchant, 'm');
    const otherMerchantUser = await mkUser(UserRole.merchant, 'om');
    const admin = await mkUser(UserRole.admin, 'a');
    const staffUser = await mkUser(UserRole.merchant, 'ms');
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `S7A ${tag}`,
        slug: `s7a-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
      },
    });
    const otherMerchant = await prisma.merchant.create({
      data: {
        userId: otherMerchantUser.id,
        name: `S7A o ${tag}`,
        slug: `s7ao-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
      },
    });
    await prisma.merchantStaff.create({
      data: {
        merchantId: merchant.id,
        userId: staffUser.id,
        role: MerchantStaffRole.staff,
        isActive: true,
      },
    });
    const managerUser = await mkUser(UserRole.merchant, 'mm');
    await prisma.merchantStaff.create({
      data: {
        merchantId: merchant.id,
        userId: managerUser.id,
        role: MerchantStaffRole.manager,
        isActive: true,
      },
    });
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-S7A-${tag.slice(0, 12)}`,
        userId: customer.id,
        merchantId: merchant.id,
        status: opts?.commerceStatus ?? 'ready',
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
              productName: 'Stage 7A Item',
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
        merchantId: merchant.id,
        customerId: customer.id,
        status: opts?.fulfillmentStatus ?? FulfillmentStatus.ready_for_pickup,
        assignmentVersion: 0,
        activeRiderId: opts?.assign ? rider.id : null,
        physicalCustodianRiderId: opts?.custodian ? rider.id : null,
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
      await prisma.orderFulfillment.update({
        where: { id: fulfillment.id },
        data: { assignmentVersion: 1 },
      });
    }
    return {
      tag,
      customer,
      rider,
      riderB,
      merchantUser,
      otherMerchantUser,
      admin,
      staffUser,
      managerUser,
      merchant,
      otherMerchant,
      order,
      fulfillment,
    };
  }

  async function cleanup(s: Awaited<ReturnType<typeof seed>>) {
    const ids = [
      s.customer.id,
      s.rider.id,
      s.riderB?.id,
      s.merchantUser.id,
      s.otherMerchantUser.id,
      s.admin.id,
      s.staffUser.id,
      s.managerUser.id,
    ].filter(Boolean) as string[];
    await prisma.orderDomainEvent.deleteMany({ where: { wkOrderId: s.order.id } });
    await prisma.pickupHandoffToken.deleteMany({ where: { wkOrderId: s.order.id } });
    await prisma.custodyEvent.deleteMany({ where: { wkOrderId: s.order.id } });
    await prisma.riderAssignment.deleteMany({
      where: { fulfillmentId: s.fulfillment.id },
    });
    await prisma.orderFulfillment.deleteMany({ where: { id: s.fulfillment.id } });
    await prisma.orderItem.deleteMany({ where: { orderId: s.order.id } });
    await prisma.orderPaymentAllocation.deleteMany({
      where: { wkOrderId: s.order.id },
    });
    await prisma.wkOrder.deleteMany({ where: { id: s.order.id } });
    await prisma.merchantStaff.deleteMany({
      where: { merchantId: { in: [s.merchant.id, s.otherMerchant.id] } },
    });
    await prisma.merchant.deleteMany({
      where: { id: { in: [s.merchant.id, s.otherMerchant.id] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  it('authorized merchant owner assigns an eligible rider without custody or orders_v2', async () => {
    const s = await seed();
    const v2Before = await prisma.order.count();
    const financeBefore = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: s.order.id },
    });
    const res = await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.merchantUser))
      .send({ riderId: s.rider.id })
      .expect(201);
    expect(res.body.fulfillmentStatus).toBe('rider_assigned');
    expect(res.body.activeRiderId).toBe(s.rider.id);
    expect(res.body.physicalCustodianRiderId).toBeNull();
    expect(res.body.assignmentVersion).toBe(1);
    expect(res.body.idempotent).toBe(false);
    expect(res.body.wkOrderId).toBe(s.order.id);
    expect(res.body.orderCode).toBe(s.order.orderCode);
    const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: s.fulfillment.id },
    });
    expect(fulfillment.status).toBe('rider_assigned');
    expect(fulfillment.physicalCustodianRiderId).toBeNull();
    expect(fulfillment.orderV2Id).toBeNull();
    expect(
      await prisma.riderAssignment.count({
        where: {
          fulfillmentId: s.fulfillment.id,
          status: RiderAssignmentStatus.ACTIVE,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.custodyEvent.count({
        where: { wkOrderId: s.order.id, eventType: 'MERCHANT_RELEASED' },
      }),
    ).toBe(0);
    expect(await prisma.order.count()).toBe(v2Before);
    const financeAfter = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: s.order.id },
    });
    expect(financeAfter.paymentStatus).toBe(financeBefore.paymentStatus);
    expect(financeAfter.merchantPaymentStatus).toBe(
      financeBefore.merchantPaymentStatus,
    );
    expect(String(financeAfter.transactionFeeAmount)).toBe(
      String(financeBefore.transactionFeeAmount),
    );
    expect(
      await prisma.riderAdvance.count({ where: { wkOrderId: s.order.id } }),
    ).toBe(0);
    expect(
      await prisma.orderDomainEvent.count({
        where: { wkOrderId: s.order.id, action: 'RIDER_ASSIGNED' },
      }),
    ).toBe(1);
    await cleanup(s);
  });

  it('merchant manager can assign; ordinary merchant staff cannot', async () => {
    const s = await seed();
    await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.staffUser))
      .send({ riderId: s.rider.id })
      .expect(403);
    expect(
      await prisma.riderAssignment.count({
        where: { fulfillmentId: s.fulfillment.id },
      }),
    ).toBe(0);
    const ok = await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.managerUser))
      .send({ riderId: s.rider.id })
      .expect(201);
    expect(ok.body.activeRiderId).toBe(s.rider.id);
    await cleanup(s);
  });

  it('system admin can assign', async () => {
    const s = await seed();
    await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.admin))
      .send({ riderId: s.rider.id })
      .expect(201);
    await cleanup(s);
  });

  it('rejects unrelated merchant, customer, rider self-assignment, and anonymous', async () => {
    const s = await seed();
    await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.otherMerchantUser))
      .send({ riderId: s.rider.id })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.customer))
      .send({ riderId: s.rider.id })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.rider))
      .send({ riderId: s.rider.id })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .send({ riderId: s.rider.id })
      .expect(401);
    expect(
      await prisma.riderAssignment.count({
        where: { fulfillmentId: s.fulfillment.id },
      }),
    ).toBe(0);
    await cleanup(s);
  });

  it('rejects a nonexistent rider, an inactive rider, and a non-rider role', async () => {
    const s = await seed();
    await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.merchantUser))
      .send({ riderId: randomUUID() })
      .expect(404);
    const inactive = await seed({ riderActive: false });
    await request(app.getHttpServer())
      .post(`/orders/${inactive.order.id}/rider-assignment`)
      .set(auth(inactive.merchantUser))
      .send({ riderId: inactive.rider.id })
      .expect(404);
    expect(
      await prisma.riderAssignment.count({
        where: { fulfillmentId: inactive.fulfillment.id },
      }),
    ).toBe(0);
    const wrongRole = await seed({ riderRole: UserRole.customer });
    const res = await request(app.getHttpServer())
      .post(`/orders/${wrongRole.order.id}/rider-assignment`)
      .set(auth(wrongRole.merchantUser))
      .send({ riderId: wrongRole.rider.id });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(
      await prisma.riderAssignment.count({
        where: { fulfillmentId: wrongRole.fulfillment.id },
      }),
    ).toBe(0);
    await cleanup(s);
    await cleanup(inactive);
    await cleanup(wrongRole);
  });

  it('duplicate same-rider retry is idempotent with one ACTIVE row and one RIDER_ASSIGNED', async () => {
    const s = await seed();
    const first = await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.merchantUser))
      .send({ riderId: s.rider.id })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.merchantUser))
      .send({ riderId: s.rider.id })
      .expect(201);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.assignmentId).toBe(first.body.assignmentId);
    expect(
      await prisma.riderAssignment.count({
        where: {
          fulfillmentId: s.fulfillment.id,
          status: RiderAssignmentStatus.ACTIVE,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.orderDomainEvent.count({
        where: { wkOrderId: s.order.id, action: 'RIDER_ASSIGNED' },
      }),
    ).toBe(1);
    await cleanup(s);
  });

  it('does not silently reassign a different rider', async () => {
    const s = await seed({ riderB: true });
    await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.merchantUser))
      .send({ riderId: s.rider.id })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.merchantUser))
      .send({ riderId: s.riderB!.id, allowReassignment: true })
      .expect(409);
    const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: s.fulfillment.id },
    });
    expect(fulfillment.activeRiderId).toBe(s.rider.id);
    expect(
      await prisma.riderAssignment.count({
        where: {
          fulfillmentId: s.fulfillment.id,
          status: RiderAssignmentStatus.ACTIVE,
        },
      }),
    ).toBe(1);
    await cleanup(s);
  });

  it('two concurrent first assignments leave one coherent ACTIVE rider', async () => {
    const s = await seed({ riderB: true });
    const [a, b] = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/orders/${s.order.id}/rider-assignment`)
        .set(auth(s.merchantUser))
        .send({ riderId: s.rider.id }),
      request(app.getHttpServer())
        .post(`/orders/${s.order.id}/rider-assignment`)
        .set(auth(s.merchantUser))
        .send({ riderId: s.riderB!.id }),
    ]);
    const statuses = [a, b].map((r) =>
      r.status === 'fulfilled' ? r.value.status : 0,
    );
    expect(statuses.filter((x) => x === 201).length).toBe(1);
    expect(statuses.filter((x) => x !== 201).length).toBe(1);
    const active = await prisma.riderAssignment.findMany({
      where: {
        fulfillmentId: s.fulfillment.id,
        status: RiderAssignmentStatus.ACTIVE,
      },
    });
    expect(active).toHaveLength(1);
    const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: s.fulfillment.id },
    });
    expect(fulfillment.activeRiderId).toBe(active[0].riderId);
    expect(fulfillment.physicalCustodianRiderId).toBeNull();
    (s as unknown as { race?: unknown }).race = { a: statuses[0], b: statuses[1] };
    await cleanup(s);
  });

  it('post-pickup initial assignment cannot replace the custodian', async () => {
    const s = await seed({ riderB: true });
    await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.merchantUser))
      .send({ riderId: s.rider.id })
      .expect(201);
    const issued = await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/pickup-token`)
      .set(auth(s.rider))
      .expect(201);
    await request(app.getHttpServer())
      .post('/pickup-handoffs/validate')
      .set(auth(s.merchantUser))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);
    const stillAssigned = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: s.fulfillment.id },
    });
    expect(stillAssigned.physicalCustodianRiderId).toBeNull();
    await request(app.getHttpServer())
      .post('/pickup-handoffs/confirm')
      .set(auth(s.merchantUser))
      .send({ qrPayload: issued.body.qrPayload })
      .expect(201);
    expect(
      await prisma.custodyEvent.count({
        where: { wkOrderId: s.order.id, eventType: 'MERCHANT_RELEASED' },
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.merchantUser))
      .send({ riderId: s.riderB!.id })
      .expect(409);
    const after = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: s.fulfillment.id },
    });
    expect(after.status).toBe('picked_up');
    expect(after.activeRiderId).toBe(s.rider.id);
    expect(after.physicalCustodianRiderId).toBe(s.rider.id);
    expect(
      await prisma.orderDomainEvent.count({
        where: {
          wkOrderId: s.order.id,
          action: { in: ['RIDER_TRANSFER_RELEASED', 'RIDER_TRANSFER_RECEIVED'] },
        },
      }),
    ).toBe(0);
    await cleanup(s);
  });

  it('rejects assignment in delivery_failed, returning, delivered, and returned', async () => {
    for (const status of [
      FulfillmentStatus.delivery_failed,
      FulfillmentStatus.returning,
      FulfillmentStatus.delivered,
      FulfillmentStatus.returned,
    ]) {
      const s = await seed({
        fulfillmentStatus: status,
        assign: true,
        custodian:
          status === FulfillmentStatus.delivery_failed ||
          status === FulfillmentStatus.returning,
        riderB: true,
      });
      const res = await request(app.getHttpServer())
        .post(`/orders/${s.order.id}/rider-assignment`)
        .set(auth(s.merchantUser))
        .send({ riderId: s.riderB!.id });
      expect(res.status).toBeGreaterThanOrEqual(400);
      const after = await prisma.orderFulfillment.findUniqueOrThrow({
        where: { id: s.fulfillment.id },
      });
      expect(after.status).toBe(status);
      expect(after.activeRiderId).toBe(s.rider.id);
      await cleanup(s);
    }
  });

  it('assignment vs pre-custody cancel leaves a coherent pair of outcomes', async () => {
    const s = await seed();
    const [assignRes, cancelRes] = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/orders/${s.order.id}/rider-assignment`)
        .set(auth(s.merchantUser))
        .send({ riderId: s.rider.id }),
      request(app.getHttpServer())
        .put(`/orders/${s.order.id}/status`)
        .set(auth(s.merchantUser))
        .send({ status: 'cancelled' }),
    ]);
    const assignStatus =
      assignRes.status === 'fulfilled' ? assignRes.value.status : 0;
    const cancelStatus =
      cancelRes.status === 'fulfilled' ? cancelRes.value.status : 0;
    const order = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: s.order.id },
    });
    const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: s.fulfillment.id },
    });
    const activeCount = await prisma.riderAssignment.count({
      where: {
        fulfillmentId: s.fulfillment.id,
        status: RiderAssignmentStatus.ACTIVE,
      },
    });
    if (order.status === 'cancelled' && assignStatus === 201) {
      expect(fulfillment.status).toBe('rider_assigned');
      expect(activeCount).toBe(1);
    } else if (order.status === 'cancelled') {
      expect(assignStatus).toBeGreaterThanOrEqual(400);
      expect(fulfillment.status).not.toBe('rider_assigned');
      expect(activeCount).toBe(0);
    } else {
      expect(assignStatus).toBe(201);
      expect(fulfillment.status).toBe('rider_assigned');
      expect(activeCount).toBe(1);
    }
    expect(cancelStatus === 200 || cancelStatus >= 400).toBe(true);
    expect(activeCount).toBeLessThanOrEqual(1);
    await cleanup(s);
  });

  it('missing order is 404 and service-level customer actor is rejected', async () => {
    const s = await seed();
    await request(app.getHttpServer())
      .post('/orders/2147483646/rider-assignment')
      .set(auth(s.merchantUser))
      .send({ riderId: s.rider.id })
      .expect(404);
    const assignments = app.get(RiderAssignmentService);
    await expect(
      assignments.assign({
        wkOrderId: s.order.id,
        riderId: s.rider.id,
        actor: { id: s.customer.id, type: 'CUSTOMER' },
      }),
    ).rejects.toThrow();
    await cleanup(s);
  });

  it('terminal commerce status is denied without assignment', async () => {
    const s = await seed({ commerceStatus: 'cancelled' });
    const res = await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.merchantUser))
      .send({ riderId: s.rider.id });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(
      await prisma.riderAssignment.count({
        where: { fulfillmentId: s.fulfillment.id },
      }),
    ).toBe(0);
    await cleanup(s);
  });

  it('stale expectedVersion is rejected by the service', async () => {
    const s = await seed();
    await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.merchantUser))
      .send({ riderId: s.rider.id })
      .expect(201);
    const assignments = app.get(RiderAssignmentService);
    await expect(
      assignments.assign({
        wkOrderId: s.order.id,
        riderId: s.rider.id,
        actor: { id: s.merchantUser.id, type: 'MERCHANT_OWNER' },
        actorMerchantIds: [s.merchant.id],
        expectedVersion: 0,
      }),
    ).rejects.toThrow(/version conflict/i);
    await cleanup(s);
  });

  it('HTTP assign does not clear a pending Stage7 incoming custodian transfer', async () => {
    const s = await seed({ riderB: true, assign: true, custodian: true });
    await prisma.orderFulfillment.update({
      where: { id: s.fulfillment.id },
      data: {
        status: FulfillmentStatus.picked_up,
        pendingCustodyIncomingRiderId: s.riderB!.id,
        pendingCustodyFromAssignmentVersion: 1,
        pendingCustodyRequestedAt: new Date(),
      },
    });
    await request(app.getHttpServer())
      .post(`/orders/${s.order.id}/rider-assignment`)
      .set(auth(s.merchantUser))
      .send({ riderId: s.riderB!.id })
      .expect(409);
    const after = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: s.fulfillment.id },
    });
    expect(after.activeRiderId).toBe(s.rider.id);
    expect(after.physicalCustodianRiderId).toBe(s.rider.id);
    expect(after.pendingCustodyIncomingRiderId).toBe(s.riderB!.id);
    await cleanup(s);
  });
});
