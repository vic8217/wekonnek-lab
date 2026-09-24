/**
 * Shared live harness for UCE-2 HTTP acceptance.
 * Opt-in: WEKONNEK_UCE2=1 and DATABASE_URL wekonnek_uce2_cursor_test
 * or wekonnek_uce2_terra_test.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CommerceDomain,
  FulfillmentStatus,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { cpSync, existsSync, mkdirSync } from 'fs';
import { sign } from 'jsonwebtoken';
import { join } from 'path';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
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

const UCE2_TARGETS = new Set([
  'wekonnek_uce2_cursor_test',
  'wekonnek_uce2_terra_test',
]);

export function isApprovedUce2Target(database: string): boolean {
  return (
    isRecognizedUceDisposableName(database) &&
    !ACCEPTANCE_ABSOLUTE_DENY_DATABASES.has(database) &&
    UCE2_TARGETS.has(database)
  );
}

function resolveApprovedDatabase(): string {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('UCE-2 refused: NODE_ENV=test is required');
  }
  if (!isDestructiveAcceptanceOptIn()) {
    throw new Error(
      `UCE-2 refused: ${ACCEPTANCE_DESTRUCTIVE_OK_ENV}=1 is required`,
    );
  }
  const parsed = parseAcceptanceDatabaseUrl(process.env.DATABASE_URL || '');
  assertSafeLocalAcceptanceHost(parsed, 'UCE-2');
  assertNotHistoricalAcceptanceDatabase(parsed.database, 'UCE-2');
  if (!isApprovedUce2Target(parsed.database)) {
    throw new Error(
      `UCE-2 refused: ${parsed.database} is not wekonnek_uce2_cursor_test or wekonnek_uce2_terra_test`,
    );
  }
  return parsed.database;
}

export const UCE2_LIVE = process.env.WEKONNEK_UCE2 === '1';
export const describeUce2Live = UCE2_LIVE ? describe : describe.skip;

if (UCE2_LIVE) {
  resolveApprovedDatabase();
  process.env.DO_SPACES_REGION ||= 'sgp1';
  process.env.DO_SPACES_BUCKET ||= 'wekonnek-uce2-test';
  process.env.DO_SPACES_ENDPOINT ||= 'https://sgp1.digitaloceanspaces.com';
  process.env.DO_SPACES_ACCESS_KEY ||= 'uce2-test';
  process.env.DO_SPACES_SECRET_KEY ||= 'uce2-test';
}

export type LiveApp = {
  app: INestApplication;
  prisma: PrismaService;
  close: () => Promise<void>;
};

export async function bootUce2App(): Promise<LiveApp> {
  const approvedDatabase = resolveApprovedDatabase();
  const runtimeI18n = join(process.cwd(), 'i18n');
  const sourceI18n = join(process.cwd(), 'src', 'i18n');
  if (!existsSync(runtimeI18n)) {
    mkdirSync(runtimeI18n, { recursive: true });
    cpSync(sourceI18n, runtimeI18n, { recursive: true });
  }
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0);
  const prisma = app.get(PrismaService);
  const identity = await prisma.$queryRaw<Array<{ db: string; usr: string }>>`
    SELECT current_database() AS db, current_user AS usr
  `;
  assertUceDisposableIdentity(
    { database: identity[0]?.db ?? '', user: identity[0]?.usr ?? '' },
    approvedDatabase,
    'UCE-2',
  );
  return {
    app,
    prisma,
    close: async () => {
      await app.close();
    },
  };
}

export function authHeader(user: { id: string; role: UserRole }) {
  return {
    Authorization: `Bearer ${sign(
      { sub: user.id, role: user.role },
      process.env.JWT_SECRET || 'dev-secret',
      { expiresIn: '1h' },
    )}`,
  };
}

export async function seedActors(prisma: PrismaClient) {
  const tag = randomUUID();
  const mk = (role: UserRole, prefix: string, isActive = true) =>
    prisma.user.create({
      data: {
        phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        email: `uce2-${prefix}-${tag}@test.invalid`,
        role,
        firstName: prefix,
        isActive,
        status: 'pending',
      },
    });
  const customer = await mk(UserRole.customer, 'c');
  const otherCustomer = await mk(UserRole.customer, 'c2');
  const rider = await mk(UserRole.rider, 'r');
  const riderB = await mk(UserRole.rider, 'rb');
  const driver = await mk(UserRole.driver, 'd');
  const inactive = await mk(UserRole.rider, 'in', false);
  const merchantUser = await mk(UserRole.merchant, 'm');
  const otherMerchantUser = await mk(UserRole.merchant, 'm2');
  const admin = await mk(UserRole.admin, 'ad');
  const merchant = await prisma.merchant.create({
    data: {
      userId: merchantUser.id,
      name: `UCE2 ${tag}`,
      slug: `uce2-${tag}`,
      commerceDomain: CommerceDomain.NON_FOOD,
    },
  });
  const otherMerchant = await prisma.merchant.create({
    data: {
      userId: otherMerchantUser.id,
      name: `UCE2 B ${tag}`,
      slug: `uce2b-${tag}`,
      commerceDomain: CommerceDomain.NON_FOOD,
    },
  });
  return {
    tag,
    customer,
    otherCustomer,
    rider,
    riderB,
    driver,
    inactive,
    merchantUser,
    otherMerchantUser,
    admin,
    merchant,
    otherMerchant,
  };
}

export async function seedOrder(
  prisma: PrismaClient,
  actors: Awaited<ReturnType<typeof seedActors>>,
  input: {
    status: FulfillmentStatus;
    activeRiderId?: string | null;
    physicalCustodianRiderId?: string | null;
    pendingCustodyIncomingRiderId?: string | null;
    merchantId?: number;
  },
) {
  const tag = randomUUID().slice(0, 12);
  const order = await prisma.wkOrder.create({
    data: {
      orderCode: `WK-UCE2-${tag}`,
      userId: actors.customer.id,
      merchantId: input.merchantId ?? actors.merchant.id,
      status: 'ready',
      orderType: 'delivery',
      totalAmount: 25,
      deliveryFee: 0,
      transactionFeeAmount: 0,
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      merchantPaymentStatus: 'AWAITING_PAYMENT',
      notes: 'leave at door',
      deliveryAddress: '18 Mabini St',
      orderItems: {
        create: [
          { productName: 'UCE2 Item', quantity: 2, price: 12.5, subtotal: 25 },
        ],
      },
    },
  });
  const fulfillment = await prisma.orderFulfillment.create({
    data: {
      id: randomUUID(),
      wkOrderId: order.id,
      merchantId: input.merchantId ?? actors.merchant.id,
      customerId: actors.customer.id,
      status: input.status,
      assignmentVersion: 0,
      activeRiderId: input.activeRiderId ?? null,
      physicalCustodianRiderId: input.physicalCustodianRiderId ?? null,
      pendingCustodyIncomingRiderId: input.pendingCustodyIncomingRiderId ?? null,
    },
  });
  return { order, fulfillment };
}

export async function cleanupOrder(
  prisma: PrismaClient,
  orderId: number,
  fulfillmentId: string,
) {
  await prisma.riderLocation.deleteMany({ where: { wkOrderId: orderId } });
  await prisma.orderDomainEvent.deleteMany({ where: { wkOrderId: orderId } });
  await prisma.custodyEvent.deleteMany({ where: { wkOrderId: orderId } });
  await prisma.deliveryAttempt.deleteMany({ where: { wkOrderId: orderId } });
  await prisma.riderAssignment.deleteMany({ where: { fulfillmentId } });
  await prisma.orderFulfillment.deleteMany({ where: { id: fulfillmentId } });
  await prisma.orderItem.deleteMany({ where: { orderId } });
  await prisma.wkOrder.deleteMany({ where: { id: orderId } });
}
