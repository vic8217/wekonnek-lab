/**
 * UCE-4 disposable Postgres acceptance.
 * Target comes only from UCE4_TEST_DATABASE_URL and must be
 * wekonnek_uce4_cursor_test or wekonnek_uce4_terra_test.
 * Opt-in: WEKONNEK_UCE4_LIVE=1 and WEKONNEK_ACCEPTANCE_DESTRUCTIVE_OK=1.
 * No fallback database.
 */
process.env.NODE_ENV = 'test';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  CommerceDomain,
  CustodyEventType,
  CustomerDeliveryAuthorizationStatus,
  CustomerDeliveryHandoffTokenStatus,
  FulfillmentStatus,
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { sign } from 'jsonwebtoken';
import { Client } from 'pg';
import { join } from 'path';
import request from 'supertest';
import { AppModule } from '../app.module';
import { CustodyEventService } from '../agreements/custody-event.service';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { RiderAssignmentService } from '../fulfillment/rider-assignment.service';
import { PickupHandoffService } from '../pickup-handoff/pickup-handoff.service';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceService } from '../rider-advance/rider-advance.service';
import { ACCEPTANCE_DESTRUCTIVE_OK_ENV } from '../test-support/acceptance-database';
import { databaseExists } from '../test-support/current-schema-disposable-provision';
import {
  UCE_RESET_OK_ENV,
  dropUceCurrentSchemaDisposable,
  provisionUceCurrentSchema,
} from '../test-support/uce-current-schema-provision';
import {
  assertUce4LiveIdentity,
  assertUce4NonSuperuserRole,
  evaluateUce4AcceptanceGate,
  resolveUce4AcceptanceDatabase,
} from '../test-support/uce4-acceptance-database';
import { DeliveryHandoffService } from './delivery-handoff.service';

const gate = evaluateUce4AcceptanceGate(process.env);
if (gate.mode === 'refuse') {
  throw new Error(`uce4 acceptance refused: ${gate.reason}`);
}
const describeIf = gate.mode === 'run' ? describe : describe.skip;
const TARGET = gate.mode === 'run' ? gate.target.database : '';
const targetUrl = gate.mode === 'run' ? gate.target.connectionString : '';
const admin = gate.mode === 'run' ? gate.target.adminConnectionString : '';
jest.setTimeout(180_000);

describeIf(`UCE-4 delivery recipient (${TARGET || 'opt-in skipped'})`, () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let delivery: DeliveryHandoffService;
  let pickup: PickupHandoffService;
  let assignments: RiderAssignmentService;
  let transitions: FulfillmentTransitionService;
  let custody: CustodyEventService;
  let cleanup: (() => Promise<void>) | undefined;
  let identity: { database: string; user: string };
  let createdByThisRun = false;
  const auth = (user: { id: string; role: string }) => ({
    Authorization: `Bearer ${sign(
      { sub: user.id, role: user.role },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '1h' },
    )}`,
  });

  async function readSessionRole(connectionString: string) {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const ident = await client.query<{ database: string; user: string }>(
        'SELECT current_database() AS database, current_user AS "user"',
      );
      const role = await client.query<{ super: boolean }>(
        'SELECT rolsuper AS super FROM pg_roles WHERE rolname = current_user',
      );
      const database = ident.rows[0]?.database ?? '';
      const user = ident.rows[0]?.user ?? '';
      const rolsuper = role.rows[0]?.super;
      if (typeof rolsuper !== 'boolean') {
        throw new Error('uce4 acceptance refused: rolsuper is unreadable');
      }
      return { database, user, rolsuper };
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    const approved = resolveUce4AcceptanceDatabase(process.env.UCE4_TEST_DATABASE_URL);
    if (approved.database !== TARGET) {
      throw new Error(
        `uce4 acceptance refused: resolved ${approved.database} != ${TARGET}`,
      );
    }
    const adminSession = await readSessionRole(admin);
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        phase: 'before-provision',
        current_database: adminSession.database,
        current_user: adminSession.user,
        rolsuper: adminSession.rolsuper,
        approvedDatabase: TARGET,
      }),
    );
    if (adminSession.database !== 'postgres') {
      throw new Error(
        `uce4 acceptance refused: admin current_database=${adminSession.database}`,
      );
    }
    assertUce4NonSuperuserRole(adminSession);
    if (await databaseExists(admin, TARGET)) {
      throw new Error(
        `uce4 refused: ${TARGET} already exists; refuse to clobber`,
      );
    }
    const provisioned = await provisionUceCurrentSchema({
      targetDatabase: TARGET,
      approvedDatabase: TARGET,
      adminConnectionString: admin,
    });
    createdByThisRun = true;
    assertUce4LiveIdentity(
      { database: provisioned.currentDatabase, user: provisioned.currentUser },
      TARGET,
    );
    identity = {
      database: provisioned.currentDatabase,
      user: provisioned.currentUser,
    };
    process.env.DATABASE_URL = targetUrl;
    const runtimeI18n = join(process.cwd(), 'i18n');
    const sourceI18n = join(process.cwd(), 'src', 'i18n');
    if (!existsSync(runtimeI18n)) {
      mkdirSync(runtimeI18n, { recursive: true });
      cpSync(sourceI18n, runtimeI18n, { recursive: true });
    }
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const session = await prisma.$queryRaw<Array<{ database: string; user: string }>>`
      SELECT current_database() AS database, current_user AS "user"
    `;
    const role = await prisma.$queryRaw<Array<{ super: boolean }>>`
      SELECT rolsuper AS super FROM pg_roles WHERE rolname = current_user
    `;
    const rolsuper = role[0]?.super;
    if (typeof rolsuper !== 'boolean') {
      throw new Error('uce4 acceptance refused: session rolsuper is unreadable');
    }
    assertUce4LiveIdentity(
      { database: session[0]?.database ?? '', user: session[0]?.user ?? '' },
      TARGET,
    );
    assertUce4NonSuperuserRole({ user: session[0]?.user ?? '', rolsuper });
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        phase: 'before-tests',
        current_database: session[0]?.database,
        current_user: session[0]?.user,
        rolsuper,
        approvedDatabase: TARGET,
      }),
    );
    identity = { database: session[0].database, user: session[0].user };
    const events = app.get(OrderDomainEventService);
    custody = app.get(CustodyEventService);
    const riderAdvance = app.get(RiderAdvanceService);
    assignments = app.get(RiderAssignmentService);
    transitions = app.get(FulfillmentTransitionService);
    const config = app.get(ConfigService);
    pickup = new PickupHandoffService(
      prisma,
      events,
      custody,
      transitions,
      config,
      riderAdvance,
    );
    delivery = app.get(DeliveryHandoffService);
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (!createdByThisRun) return;
    const approved = resolveUce4AcceptanceDatabase(process.env.UCE4_TEST_DATABASE_URL);
    if (approved.database !== TARGET) {
      throw new Error(
        `uce4 drop refused: ${approved.database} != database created by this run (${TARGET})`,
      );
    }
    const adminSession = await readSessionRole(admin);
    if (adminSession.database !== 'postgres') {
      throw new Error(
        `uce4 drop refused: admin current_database=${adminSession.database}`,
      );
    }
    assertUce4NonSuperuserRole(adminSession);
    process.env[ACCEPTANCE_DESTRUCTIVE_OK_ENV] = '1';
    process.env[UCE_RESET_OK_ENV] = '1';
    if (await databaseExists(admin, TARGET)) {
      await dropUceCurrentSchemaDisposable({
        targetDatabase: TARGET,
        approvedDatabase: TARGET,
        adminConnectionString: admin,
      });
    }
  });

  async function seed() {
    const tag = randomUUID();
    const phone = () =>
      `+639${Math.floor(100000000 + Math.random() * 899999999)}`.slice(0, 13);
    const customer = await prisma.user.create({
      data: { phone: phone(), email: `u4-c-${tag}@test.invalid`, role: UserRole.customer },
    });
    const other = await prisma.user.create({
      data: { phone: phone(), email: `u4-o-${tag}@test.invalid`, role: UserRole.customer },
    });
    const rider = await prisma.user.create({
      data: { phone: phone(), email: `u4-r-${tag}@test.invalid`, role: UserRole.rider },
    });
    const riderB = await prisma.user.create({
      data: { phone: phone(), email: `u4-rb-${tag}@test.invalid`, role: UserRole.rider },
    });
    const merchantUser = await prisma.user.create({
      data: { phone: phone(), email: `u4-m-${tag}@test.invalid`, role: UserRole.merchant },
    });
    const admin = await prisma.user.create({
      data: { phone: phone(), email: `u4-a-${tag}@test.invalid`, role: UserRole.admin },
    });
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `U4 ${tag}`,
        slug: `u4-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
        allowRiderAdvance: false,
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
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-U4-${tag.slice(0, 8)}`,
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
        orderItems: {
          create: [{ productName: 'item', quantity: 1, price: 1000, subtotal: 1000 }],
        },
      },
    });
    const fulfillment = await prisma.orderFulfillment.create({
      data: {
        id: randomUUID(),
        wkOrderId: order.id,
        merchantId: merchant.id,
        customerId: customer.id,
        status: FulfillmentStatus.ready_for_pickup,
        assignmentVersion: 0,
      },
    });
    await assignments.assign({
      fulfillmentId: fulfillment.id,
      riderId: rider.id,
      actor: { type: 'SYSTEM' },
    });
    cleanup = async () => {
      await prisma.customerDeliveryHandoffToken.deleteMany({ where: { wkOrderId: order.id } });
      await prisma.customerDeliveryAuthorization.deleteMany({ where: { wkOrderId: order.id } });
      await prisma.pickupHandoffToken.deleteMany({ where: { wkOrderId: order.id } });
      await prisma.riderCustodyHandoffToken.deleteMany({ where: { wkOrderId: order.id } });
      await prisma.custodyEvent.deleteMany({ where: { wkOrderId: order.id } });
      await prisma.riderAdvance.deleteMany({ where: { wkOrderId: order.id } });
      await prisma.orderDomainEvent.deleteMany({ where: { wkOrderId: order.id } });
      await prisma.riderAssignment.deleteMany({ where: { fulfillmentId: fulfillment.id } });
      await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
      await prisma.orderFulfillment.deleteMany({ where: { id: fulfillment.id } });
      await prisma.wkOrder.deleteMany({ where: { id: order.id } });
      await prisma.merchantPaymentMethod.deleteMany({ where: { merchantId: merchant.id } });
      await prisma.merchant.deleteMany({ where: { id: merchant.id } });
      await prisma.user.deleteMany({
        where: {
          id: { in: [customer.id, other.id, rider.id, riderB.id, merchantUser.id, admin.id] },
        },
      });
    };
    return { customer, other, rider, riderB, merchantUser, admin, merchant, order, fulfillment };
  }

  async function toInTransit(fx: Awaited<ReturnType<typeof seed>>) {
    const issued = await pickup.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const confirmed = await pickup.confirm({
      actorUserId: fx.merchantUser.id,
      qrPayload: issued.qrPayload,
    });
    expect(confirmed.ok).toBe(true);
    await transitions.transition({
      fulfillmentId: fx.fulfillment.id,
      targetStatus: 'in_transit',
      actor: { id: fx.rider.id, type: 'RIDER' },
      reason: 'uce4_in_transit',
    });
  }

  it('records the disposable database identity', () => {
    expect(identity.database).toBe(TARGET);
    expect(identity.user).not.toBe('postgres');
  });

  it('keeps one ACTIVE authorization and replaces by revoking the previous row and token', async () => {
    const fx = await seed();
    await toInTransit(fx);
    const first = await delivery.authorizeRecipient({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      body: {
        recipientDisplayName: ' Ana ',
        recipientCategory: 'HOUSEHOLD_MEMBER',
        idempotencyKey: 'a1',
      },
    });
    expect(first.idempotent).toBe(false);
    const replay = await delivery.authorizeRecipient({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      body: {
        recipientDisplayName: 'Ana',
        recipientCategory: 'HOUSEHOLD_MEMBER',
        idempotencyKey: 'a1',
      },
    });
    expect(replay.idempotent).toBe(true);
    await expect(
      delivery.authorizeRecipient({
        wkOrderId: fx.order.id,
        actorUserId: fx.customer.id,
        body: {
          recipientDisplayName: 'Someone Else',
          recipientCategory: 'AUTHORIZED_PERSON',
          idempotencyKey: 'a1',
        },
      }),
    ).rejects.toThrow(/payload conflict/i);
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    expect(issued.recipient?.recipientDisplayName).toBe('Ana');
    const replaced = await delivery.authorizeRecipient({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      body: {
        recipientDisplayName: 'Ben',
        recipientCategory: 'AUTHORIZED_PERSON',
        idempotencyKey: 'a2',
      },
    });
    expect(replaced.authorization.recipientDisplayName).toBe('Ben');
    const rows = await prisma.customerDeliveryAuthorization.findMany({
      where: { fulfillmentId: fx.fulfillment.id },
    });
    expect(rows.filter((row) => row.status === 'ACTIVE')).toHaveLength(1);
    expect(rows.filter((row) => row.status === 'REVOKED')).toHaveLength(1);
    const token = await prisma.customerDeliveryHandoffToken.findUniqueOrThrow({
      where: { id: issued.tokenId },
    });
    expect(token.status).toBe(CustomerDeliveryHandoffTokenStatus.REVOKED);
  });

  it('revokes the active token and rejects a second revoke after consumption', async () => {
    const fx = await seed();
    await toInTransit(fx);
    await delivery.authorizeRecipient({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      body: {
        recipientDisplayName: 'Ana',
        recipientCategory: 'HOUSEHOLD_MEMBER',
        idempotencyKey: 'r1',
      },
    });
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const revoked = await delivery.revokeRecipient({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
    });
    expect(revoked.idempotent).toBe(false);
    const again = await delivery.revokeRecipient({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
    });
    expect(again.idempotent).toBe(true);
    const token = await prisma.customerDeliveryHandoffToken.findUniqueOrThrow({
      where: { id: issued.tokenId },
    });
    expect(token.status).toBe(CustomerDeliveryHandoffTokenStatus.REVOKED);
  });

  it('confirms customer-self only for the owner and alternate recipients by credential', async () => {
    const fx = await seed();
    await toInTransit(fx);
    const selfIssued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    expect(selfIssued.recipient).toBeNull();
    const anonymous = await delivery.confirm({ qrPayload: selfIssued.qrPayload });
    expect(anonymous.ok).toBe(false);
    const preview = await delivery.validate({
      actorUserId: fx.customer.id,
      qrPayload: selfIssued.qrPayload,
    });
    expect(preview.ok).toBe(true);
    expect(await prisma.custodyEvent.count({ where: { wkOrderId: fx.order.id } })).toBeGreaterThanOrEqual(0);
    const beforeCustody = await prisma.custodyEvent.count({
      where: { wkOrderId: fx.order.id, eventType: CustodyEventType.CUSTOMER_RECEIVED },
    });
    const fulfilled = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillment.id },
    });
    expect(fulfilled.status).toBe(FulfillmentStatus.in_transit);
    expect(beforeCustody).toBe(0);
    const confirmed = await delivery.confirm({
      actorUserId: fx.customer.id,
      qrPayload: selfIssued.qrPayload,
    });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.idempotent).toBe(false);
    const replay = await delivery.confirm({
      actorUserId: fx.customer.id,
      qrPayload: selfIssued.qrPayload,
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.idempotent).toBe(true);
    expect(
      await prisma.custodyEvent.count({
        where: { wkOrderId: fx.order.id, eventType: CustodyEventType.CUSTOMER_RECEIVED },
      }),
    ).toBe(1);
    const order = await prisma.wkOrder.findUniqueOrThrow({ where: { id: fx.order.id } });
    expect(order.paymentStatus).toBe('pending');
    expect(await prisma.riderAdvance.count({ where: { wkOrderId: fx.order.id } })).toBe(0);
  });

  it('consumes an alternate authorization atomically and denies public CUSTOMER_RECEIVED', async () => {
    const fx = await seed();
    await toInTransit(fx);
    await delivery.authorizeRecipient({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      body: {
        recipientDisplayName: 'Ben',
        recipientCategory: 'AUTHORIZED_PERSON',
        idempotencyKey: 'c1',
      },
    });
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    await expect(
      custody.record({
        actorUserId: fx.customer.id,
        eventType: CustodyEventType.CUSTOMER_RECEIVED,
        wkOrderId: fx.order.id,
        fulfillmentId: fx.fulfillment.id,
      }),
    ).rejects.toThrow(/secured delivery handoff/);
    const liabilityBefore = await prisma.liabilityDetermination.count();
    const stage9Before = await prisma.returnFinancialDetermination.count();
    const done = await delivery.confirm({ qrPayload: issued.qrPayload });
    expect(done.ok).toBe(true);
    const auth = await prisma.customerDeliveryAuthorization.findFirstOrThrow({
      where: { fulfillmentId: fx.fulfillment.id },
    });
    expect(auth.status).toBe(CustomerDeliveryAuthorizationStatus.CONSUMED);
    expect(auth.consumedAt).toBeTruthy();
    const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: fx.fulfillment.id },
    });
    expect(fulfillment.status).toBe(FulfillmentStatus.delivered);
    const order = await prisma.wkOrder.findUniqueOrThrow({ where: { id: fx.order.id } });
    expect(order.paymentStatus).toBe('pending');
    expect(await prisma.riderAdvance.count({ where: { wkOrderId: fx.order.id } })).toBe(0);
    expect(await prisma.liabilityDetermination.count()).toBe(liabilityBefore);
    expect(await prisma.returnFinancialDetermination.count()).toBe(stage9Before);
    expect(
      await prisma.custodyEvent.count({
        where: { wkOrderId: fx.order.id, eventType: CustodyEventType.CUSTOMER_RECEIVED },
      }),
    ).toBe(1);
  });

  it('lets only one of two confirms write custody', async () => {
    const fx = await seed();
    await toInTransit(fx);
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const [a, b] = await Promise.all([
      delivery.confirm({ actorUserId: fx.customer.id, qrPayload: issued.qrPayload }),
      delivery.confirm({ actorUserId: fx.customer.id, qrPayload: issued.qrPayload }),
    ]);
    const wins = [a, b].filter((row) => row.ok);
    expect(wins).toHaveLength(2);
    expect(wins.filter((row) => row.ok && row.idempotent === false).length).toBe(1);
    expect(
      await prisma.custodyEvent.count({
        where: { wkOrderId: fx.order.id, eventType: CustodyEventType.CUSTOMER_RECEIVED },
      }),
    ).toBe(1);
  });

  it('rejects confirm after reassignment and after custodian mismatch', async () => {
    const fx = await seed();
    await toInTransit(fx);
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    await prisma.orderFulfillment.update({
      where: { id: fx.fulfillment.id },
      data: { physicalCustodianRiderId: fx.riderB.id },
    });
    const mismatch = await delivery.confirm({
      actorUserId: fx.customer.id,
      qrPayload: issued.qrPayload,
    });
    expect(mismatch.ok).toBe(false);
    await prisma.orderFulfillment.update({
      where: { id: fx.fulfillment.id },
      data: { physicalCustodianRiderId: fx.rider.id },
    });
    await assignments.assign({
      fulfillmentId: fx.fulfillment.id,
      riderId: fx.riderB.id,
      actor: { type: 'SYSTEM' },
      allowReassignment: true,
      reason: 'uce4_reassign',
    });
    const stale = await delivery.confirm({
      actorUserId: fx.customer.id,
      qrPayload: issued.qrPayload,
    });
    expect(stale.ok).toBe(false);
    expect(
      await prisma.orderFulfillment.findUniqueOrThrow({ where: { id: fx.fulfillment.id } }),
    ).toMatchObject({ status: FulfillmentStatus.in_transit });
  });

  it('serves owning-customer HTTP routes and denies other actors', async () => {
    const fx = await seed();
    const server = app.getHttpServer();
    const created = await request(server)
      .post(`/orders/${fx.order.id}/delivery-recipient`)
      .set(auth(fx.customer))
      .send({
        recipientDisplayName: ' Ana ',
        recipientCategory: 'HOUSEHOLD_MEMBER',
        idempotencyKey: 'http-1',
      })
      .expect(201);
    expect(created.body.authorization.recipientDisplayName).toBe('Ana');
    const current = await request(server)
      .get(`/orders/${fx.order.id}/delivery-recipient`)
      .set(auth(fx.customer))
      .expect(200);
    expect(current.body.receiverType).toBe('AUTHORIZED_RECIPIENT');
    await request(server)
      .get(`/orders/${fx.order.id}/delivery-recipient`)
      .set(auth(fx.other))
      .expect(403);
    await request(server)
      .get(`/orders/${fx.order.id}/delivery-recipient`)
      .set(auth(fx.merchantUser))
      .expect(403);
    await request(server)
      .get(`/orders/${fx.order.id}/delivery-recipient`)
      .set(auth(fx.rider))
      .expect(403);
    await request(server)
      .get(`/orders/${fx.order.id}/delivery-recipient`)
      .set(auth(fx.admin))
      .expect(403);
    await request(server)
      .post(`/orders/${fx.order.id}/delivery-recipient`)
      .set(auth(fx.customer))
      .send({
        recipientDisplayName: 'Ben',
        recipientCategory: 'AUTHORIZED_PERSON',
        idempotencyKey: 'http-2',
      })
      .expect(201);
    await request(server)
      .post(`/orders/${fx.order.id}/delivery-recipient/revoke`)
      .set(auth(fx.customer))
      .send({})
      .expect(201);
    const after = await request(server)
      .get(`/orders/${fx.order.id}/delivery-recipient`)
      .set(auth(fx.customer))
      .expect(200);
    expect(after.body.receiverType).toBe('CUSTOMER');
    expect(after.body.recipientDisplayName).toBeNull();
  });

  async function releaseTogether<T, U>(
    left: () => Promise<T>,
    right: () => Promise<U>,
  ) {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrived = 0;
    const enter = () =>
      new Promise<void>((resolve) => {
        arrived += 1;
        if (arrived === 2) release();
        gate.then(resolve);
      });
    const run = async <R>(op: () => Promise<R>) => {
      await enter();
      return op();
    };
    return Promise.allSettled([run(left), run(right)]);
  }

  async function snapshotDelivery(input: {
    orderId: number;
    fulfillmentId: string;
    tokenId: string;
  }) {
    const rows = await prisma.customerDeliveryAuthorization.findMany({
      where: { fulfillmentId: input.fulfillmentId },
    });
    const token = await prisma.customerDeliveryHandoffToken.findUniqueOrThrow({
      where: { id: input.tokenId },
    });
    const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: input.fulfillmentId },
    });
    const custodyCount = await prisma.custodyEvent.count({
      where: {
        wkOrderId: input.orderId,
        eventType: CustodyEventType.CUSTOMER_RECEIVED,
      },
    });
    return { rows, token, fulfillment, custodyCount };
  }

  it('serializes replace against confirm without a mixed terminal state', async () => {
    const fx = await seed();
    await toInTransit(fx);
    await delivery.authorizeRecipient({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      body: {
        recipientDisplayName: 'Ana',
        recipientCategory: 'HOUSEHOLD_MEMBER',
        idempotencyKey: 'race-replace-a',
      },
    });
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const authorizationA = await prisma.customerDeliveryAuthorization.findFirstOrThrow({
      where: { fulfillmentId: fx.fulfillment.id, status: 'ACTIVE' },
    });
    const bound = await prisma.customerDeliveryHandoffToken.findUniqueOrThrow({
      where: { id: issued.tokenId },
    });
    expect(bound.authorizationId).toBe(authorizationA.id);
    await releaseTogether(
      () =>
        delivery.authorizeRecipient({
          wkOrderId: fx.order.id,
          actorUserId: fx.customer.id,
          body: {
            recipientDisplayName: 'Ben',
            recipientCategory: 'AUTHORIZED_PERSON',
            idempotencyKey: 'race-replace-b',
          },
        }),
      () => delivery.confirm({ qrPayload: issued.qrPayload }),
    );
    const snap = await snapshotDelivery({
      orderId: fx.order.id,
      fulfillmentId: fx.fulfillment.id,
      tokenId: issued.tokenId,
    });
    const active = snap.rows.filter((row) => row.status === 'ACTIVE');
    const original = snap.rows.find((row) => row.id === authorizationA.id);
    const delivered = snap.fulfillment.status === FulfillmentStatus.delivered;
    const confirmWon =
      delivered &&
      original?.status === CustomerDeliveryAuthorizationStatus.CONSUMED &&
      active.length === 0 &&
      snap.token.status === CustomerDeliveryHandoffTokenStatus.CONSUMED &&
      snap.custodyCount === 1;
    const replaceWon =
      snap.fulfillment.status === FulfillmentStatus.in_transit &&
      original?.status === CustomerDeliveryAuthorizationStatus.REVOKED &&
      active.length === 1 &&
      active[0]?.id !== authorizationA.id &&
      snap.token.status === CustomerDeliveryHandoffTokenStatus.REVOKED &&
      snap.custodyCount === 0;
    if (!confirmWon && !replaceWon) {
      throw new Error(
        `PRODUCT CONCURRENCY DEFECT FOUND replace-vs-confirm ${JSON.stringify({
          original: original?.status ?? null,
          active: active.map((row) => row.id),
          token: snap.token.status,
          fulfillment: snap.fulfillment.status,
          custodyCount: snap.custodyCount,
        })}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        race: 'replace-vs-confirm',
        outcome: confirmWon ? 'confirm' : 'replace',
      }),
    );
    expect(confirmWon || replaceWon).toBe(true);
  });

  it('serializes revoke against confirm without a mixed terminal state', async () => {
    const fx = await seed();
    await toInTransit(fx);
    await delivery.authorizeRecipient({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      body: {
        recipientDisplayName: 'Ana',
        recipientCategory: 'HOUSEHOLD_MEMBER',
        idempotencyKey: 'race-revoke-a',
      },
    });
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const authorizationA = await prisma.customerDeliveryAuthorization.findFirstOrThrow({
      where: { fulfillmentId: fx.fulfillment.id, status: 'ACTIVE' },
    });
    await releaseTogether(
      () =>
        delivery.revokeRecipient({
          wkOrderId: fx.order.id,
          actorUserId: fx.customer.id,
        }),
      () => delivery.confirm({ qrPayload: issued.qrPayload }),
    );
    const snap = await snapshotDelivery({
      orderId: fx.order.id,
      fulfillmentId: fx.fulfillment.id,
      tokenId: issued.tokenId,
    });
    const active = snap.rows.filter((row) => row.status === 'ACTIVE');
    const original = snap.rows.find((row) => row.id === authorizationA.id);
    const delivered = snap.fulfillment.status === FulfillmentStatus.delivered;
    const confirmWon =
      delivered &&
      original?.status === CustomerDeliveryAuthorizationStatus.CONSUMED &&
      active.length === 0 &&
      snap.token.status === CustomerDeliveryHandoffTokenStatus.CONSUMED &&
      snap.custodyCount === 1;
    const revokeWon =
      snap.fulfillment.status === FulfillmentStatus.in_transit &&
      original?.status === CustomerDeliveryAuthorizationStatus.REVOKED &&
      active.length === 0 &&
      snap.token.status === CustomerDeliveryHandoffTokenStatus.REVOKED &&
      snap.custodyCount === 0;
    if (delivered && original?.status === CustomerDeliveryAuthorizationStatus.REVOKED) {
      throw new Error('PRODUCT CONCURRENCY DEFECT FOUND delivered + authorization REVOKED');
    }
    if (
      original?.status === CustomerDeliveryAuthorizationStatus.CONSUMED &&
      !delivered
    ) {
      throw new Error('PRODUCT CONCURRENCY DEFECT FOUND authorization consumed without delivery');
    }
    if (!confirmWon && !revokeWon) {
      throw new Error(
        `PRODUCT CONCURRENCY DEFECT FOUND revoke-vs-confirm ${JSON.stringify({
          original: original?.status ?? null,
          active: active.length,
          token: snap.token.status,
          fulfillment: snap.fulfillment.status,
          custodyCount: snap.custodyCount,
        })}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        race: 'revoke-vs-confirm',
        outcome: confirmWon ? 'confirm' : 'revoke',
      }),
    );
    expect(confirmWon || revokeWon).toBe(true);
  });

  it('rejects a new recipient, replacement, revoke, and delivery token after delivery', async () => {
    const fx = await seed();
    await toInTransit(fx);
    await delivery.authorizeRecipient({
      wkOrderId: fx.order.id,
      actorUserId: fx.customer.id,
      body: {
        recipientDisplayName: 'Ana',
        recipientCategory: 'HOUSEHOLD_MEMBER',
        idempotencyKey: 'terminal-a',
      },
    });
    const issued = await delivery.issueForOrder({
      wkOrderId: fx.order.id,
      actorUserId: fx.rider.id,
    });
    const confirmed = await delivery.confirm({ qrPayload: issued.qrPayload });
    expect(confirmed.ok).toBe(true);
    await expect(
      delivery.authorizeRecipient({
        wkOrderId: fx.order.id,
        actorUserId: fx.customer.id,
        body: {
          recipientDisplayName: 'Ben',
          recipientCategory: 'AUTHORIZED_PERSON',
          idempotencyKey: 'terminal-b',
        },
      }),
    ).rejects.toThrow(/eligible/i);
    await expect(
      delivery.authorizeRecipient({
        wkOrderId: fx.order.id,
        actorUserId: fx.customer.id,
        body: {
          recipientDisplayName: 'Cara',
          recipientCategory: 'HOUSEHOLD_MEMBER',
          idempotencyKey: 'terminal-c',
        },
      }),
    ).rejects.toThrow(/eligible/i);
    await expect(
      delivery.revokeRecipient({
        wkOrderId: fx.order.id,
        actorUserId: fx.customer.id,
      }),
    ).rejects.toThrow(/eligible/i);
    await expect(
      delivery.issueForOrder({
        wkOrderId: fx.order.id,
        actorUserId: fx.rider.id,
      }),
    ).rejects.toThrow(/in_transit/i);
    const rows = await prisma.customerDeliveryAuthorization.findMany({
      where: { fulfillmentId: fx.fulfillment.id },
    });
    expect(rows.filter((row) => row.status === 'ACTIVE')).toHaveLength(0);
    expect(rows.filter((row) => row.status === 'CONSUMED')).toHaveLength(1);
    expect(
      await prisma.customerDeliveryHandoffToken.count({
        where: {
          fulfillmentId: fx.fulfillment.id,
          status: CustomerDeliveryHandoffTokenStatus.ACTIVE,
        },
      }),
    ).toBe(0);
    expect(
      await prisma.orderFulfillment.findUniqueOrThrow({ where: { id: fx.fulfillment.id } }),
    ).toMatchObject({ status: FulfillmentStatus.delivered });
    expect(
      await prisma.custodyEvent.count({
        where: { wkOrderId: fx.order.id, eventType: CustodyEventType.CUSTOMER_RECEIVED },
      }),
    ).toBe(1);
  });
});
