/**
 * UCE-C1 live serializable-retry acceptance.
 * Opt-in: WEKONNEK_UCE_C1=1. DATABASE_URL must be an H0 UCE-C1 disposable:
 * wekonnek_uce_c1_cursor_test or wekonnek_uce_c1_terra_test.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommerceDomain,
  FulfillmentStatus,
  Prisma,
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
import { PrismaService } from './prisma.service';
import {
  isSerializableConflictError,
} from './serializable-retry';
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

const UCE_C1_TARGETS: ReadonlySet<string> = new Set([
  'wekonnek_uce_c1_cursor_test',
  'wekonnek_uce_c1_terra_test',
]);

function isApprovedUceC1Target(database: string): boolean {
  if (!isRecognizedUceDisposableName(database)) return false;
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database)) return false;
  return UCE_C1_TARGETS.has(database);
}

function resolveUceC1ApprovedDatabase(): string {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `UCE-C1 refused: NODE_ENV=test is required (got ${process.env.NODE_ENV ?? '<unset>'})`,
    );
  }
  if (!isDestructiveAcceptanceOptIn()) {
    throw new Error(
      `UCE-C1 refused: ${ACCEPTANCE_DESTRUCTIVE_OK_ENV}=1 is required`,
    );
  }
  const parsed = parseAcceptanceDatabaseUrl(process.env.DATABASE_URL || '');
  assertSafeLocalAcceptanceHost(parsed, 'UCE-C1');
  assertNotHistoricalAcceptanceDatabase(parsed.database, 'UCE-C1');
  if (ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(parsed.database)) {
    throw new Error(`UCE-C1 refused: ${parsed.database} is permanently forbidden`);
  }
  if (!isApprovedUceC1Target(parsed.database)) {
    throw new Error(
      `UCE-C1 refused: ${parsed.database} is not wekonnek_uce_c1_cursor_test or wekonnek_uce_c1_terra_test`,
    );
  }
  return parsed.database;
}

const LIVE_OPT_IN = process.env.WEKONNEK_UCE_C1 === '1';
const describeLive = LIVE_OPT_IN ? describe : describe.skip;
let approvedDatabase = '';
if (LIVE_OPT_IN) {
  approvedDatabase = resolveUceC1ApprovedDatabase();
  process.env.DO_SPACES_REGION ||= 'sgp1';
  process.env.DO_SPACES_BUCKET ||= 'wekonnek-uce-c1-test';
  process.env.DO_SPACES_ENDPOINT ||= 'https://sgp1.digitaloceanspaces.com';
  process.env.DO_SPACES_ACCESS_KEY ||= 'uce-c1-test';
  process.env.DO_SPACES_SECRET_KEY ||= 'uce-c1-test';
}

jest.setTimeout(180_000);

function inspectSerializationError(err: unknown): {
  typeName: string;
  isPrismaKnown: boolean;
  wrapperCode: string | null;
  adapterKind: string | null;
  adapterOriginalCode: string | null;
  classifier: boolean;
} {
  const isPrismaKnown =
    err instanceof Prisma.PrismaClientKnownRequestError;
  const meta =
    isPrismaKnown && err.meta && typeof err.meta === 'object'
      ? (err.meta as {
          driverAdapterError?: { cause?: { kind?: unknown; originalCode?: unknown } };
        })
      : null;
  const cause = meta?.driverAdapterError?.cause;
  return {
    typeName: err instanceof Error ? err.constructor.name : typeof err,
    isPrismaKnown,
    wrapperCode: isPrismaKnown ? err.code : null,
    adapterKind: typeof cause?.kind === 'string' ? cause.kind : null,
    adapterOriginalCode:
      typeof cause?.originalCode === 'string' ? cause.originalCode : null,
    classifier: isSerializableConflictError(err),
  };
}

describe('UCE-C1 harness database identity', () => {
  it('accepts Cursor and Terra UCE-C1 H0 names', () => {
    expect(isApprovedUceC1Target('wekonnek_uce_c1_cursor_test')).toBe(true);
    expect(isApprovedUceC1Target('wekonnek_uce_c1_terra_test')).toBe(true);
    expect(isRecognizedUceDisposableName('wekonnek_uce_c1_cursor_test')).toBe(
      true,
    );
    expect(isRecognizedUceDisposableName('wekonnek_uce_c1_terra_test')).toBe(
      true,
    );
  });

  it('rejects UCE-1 and other H0 names as C1 live targets', () => {
    expect(isApprovedUceC1Target('wekonnek_uce1_cursor_test')).toBe(false);
    expect(isApprovedUceC1Target('wekonnek_uce_h1_cursor_test')).toBe(false);
    expect(isApprovedUceC1Target('postgres')).toBe(false);
  });
});

describeLive('UCE-C1 live serializable assignment', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let classifiedRetryableThrows = 0;
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
      'UCE-C1',
    );
    const originalTransaction = prisma.$transaction.bind(prisma);
    prisma.$transaction = ((...args: Parameters<PrismaService['$transaction']>) =>
      (originalTransaction as (...a: unknown[]) => Promise<unknown>)(
        ...args,
      ).catch((err: unknown) => {
        if (isSerializableConflictError(err)) {
          classifiedRetryableThrows += 1;
        }
        throw err;
      })) as PrismaService['$transaction'];
  });

  afterAll(async () => {
    await app?.close();
  });

  async function seed(opts?: { riderB?: boolean }) {
    const tag = randomUUID();
    const mkUser = (role: UserRole, prefix: string) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `c1-${prefix}-${tag}@test.invalid`,
          role,
          firstName: prefix,
          isActive: true,
          status: role === UserRole.rider ? 'approved' : 'active',
        },
      });
    const customer = await mkUser(UserRole.customer, 'c');
    const rider = await mkUser(UserRole.rider, 'r');
    const riderB = opts?.riderB ? await mkUser(UserRole.rider, 'rb') : null;
    const merchantUser = await mkUser(UserRole.merchant, 'm');
    const merchant = await prisma.merchant.create({
      data: {
        userId: merchantUser.id,
        name: `C1 ${tag}`,
        slug: `c1-${tag}`,
        commerceDomain: CommerceDomain.NON_FOOD,
      },
    });
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-C1-${tag.slice(0, 12)}`,
        userId: customer.id,
        merchantId: merchant.id,
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
              productName: 'C1 Item',
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
        status: FulfillmentStatus.ready_for_pickup,
        assignmentVersion: 0,
      },
    });
    return {
      customer,
      rider,
      riderB,
      merchantUser,
      merchant,
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
    ].filter(Boolean) as string[];
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
    await prisma.merchant.deleteMany({ where: { id: s.merchant.id } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  it('captures structured P2010 adapter serialization from concurrent FOR UPDATE', async () => {
    const s = await seed();
    const captured: ReturnType<typeof inspectSerializationError>[] = [];
    const race = async () => {
      try {
        await prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`
              SELECT id FROM "orders" WHERE id = ${s.order.id} FOR UPDATE
            `;
            await tx.$queryRaw`
              SELECT id FROM "order_fulfillments"
              WHERE wk_order_id = ${s.order.id} FOR UPDATE
            `;
            await tx.wkOrder.update({
              where: { id: s.order.id },
              data: { deliveryFee: { increment: 1 } },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (err) {
        captured.push(inspectSerializationError(err));
        throw err;
      }
    };
    const results = await Promise.allSettled([race(), race()]);
    const failed = results.filter((r) => r.status === 'rejected');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const shape = captured.find((c) => c.classifier) ?? captured[0];
    expect(shape.isPrismaKnown).toBe(true);
    expect(shape.wrapperCode).toBe('P2010');
    expect(shape.adapterKind).toBe('TransactionWriteConflict');
    expect(shape.adapterOriginalCode).toBe('40001');
    expect(shape.classifier).toBe(true);
    await cleanup(s);
  });

  it('two different riders: one 201, loser 409, one ACTIVE, no custody', async () => {
    const s = await seed({ riderB: true });
    classifiedRetryableThrows = 0;
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
    const loser = statuses.find((x) => x !== 201);
    expect(loser).toBe(409);
    expect(classifiedRetryableThrows).toBeGreaterThanOrEqual(1);
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
    await cleanup(s);
  });

  it('two same-rider concurrent assigns leave one ACTIVE assignment', async () => {
    const s = await seed();
    classifiedRetryableThrows = 0;
    const [a, b] = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/orders/${s.order.id}/rider-assignment`)
        .set(auth(s.merchantUser))
        .send({ riderId: s.rider.id }),
      request(app.getHttpServer())
        .post(`/orders/${s.order.id}/rider-assignment`)
        .set(auth(s.merchantUser))
        .send({ riderId: s.rider.id }),
    ]);
    const statuses = [a, b].map((r) =>
      r.status === 'fulfilled' ? r.value.status : 0,
    );
    expect(statuses.filter((x) => x === 201).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((x) => x === 201 || x === 409)).toBe(true);
    const active = await prisma.riderAssignment.findMany({
      where: {
        fulfillmentId: s.fulfillment.id,
        status: RiderAssignmentStatus.ACTIVE,
      },
    });
    expect(active).toHaveLength(1);
    expect(active[0].riderId).toBe(s.rider.id);
    const fulfillment = await prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: s.fulfillment.id },
    });
    expect(fulfillment.activeRiderId).toBe(s.rider.id);
    expect(fulfillment.physicalCustodianRiderId).toBeNull();
    await cleanup(s);
  });
});
