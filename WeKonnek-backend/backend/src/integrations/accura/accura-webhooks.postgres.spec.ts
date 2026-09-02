import 'dotenv/config';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccuraWebhooksService } from './accura-webhooks.service';
import { computeAccuraHmacHex } from './accura-webhook.crypto';
import {
  ACCURA_INVOICE_ISSUED_EVENT,
  ACCURA_WEBHOOK_VERSION,
} from './accura-webhook.types';

jest.setTimeout(30_000);

const SECRET = 'accura-postgres-test-secret';
const LOCAL_DB_HOST = /localhost|127\.0\.0\.1/;

function signedInput(payload: Record<string, unknown>, timestamp?: string) {
  const ts = timestamp ?? String(Math.floor(Date.now() / 1000));
  const rawBody = Buffer.from(JSON.stringify(payload));
  return {
    rawBody,
    headers: {
      eventId: String(payload.eventId),
      timestamp: ts,
      signature: `v1=${computeAccuraHmacHex(SECRET, ts, rawBody)}`,
    },
  };
}

describe('Accura webhook receiver PostgreSQL', () => {
  const prisma = new PrismaService();
  const config = {
    get: (key: string) => {
      if (key === 'ACCURA_WEBHOOK_SECRET') return SECRET;
      if (key === 'ACCURA_WEBHOOK_TOLERANCE_SECONDS') return 300;
      return undefined;
    },
  } as unknown as ConfigService;
  const service = new AccuraWebhooksService(prisma, config);
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL ?? '';
    if (!LOCAL_DB_HOST.test(url)) {
      throw new Error(
        'ACCURA webhook postgres tests refuse non-local DATABASE_URL',
      );
    }
    await prisma.$connect();
    const target = await prisma.$queryRaw<Array<{ database: string }>>(
      Prisma.sql`SELECT current_database() AS database`,
    );
    const database = target[0]?.database ?? '';
    if (/prod/i.test(database)) {
      throw new Error(`Refusing to run ACCURA tests against ${database}`);
    }
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  afterAll(async () => prisma.onModuleDestroy());

  it('persists one association and stays idempotent after a DB roundtrip', async () => {
    const token = randomUUID();
    const buyer = await prisma.user.create({
      data: {
        phone: `+63${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(
          0,
          20,
        ),
        email: `accura-buyer-${token}@test.invalid`,
      },
    });
    const merchant = await prisma.merchant.create({
      data: {
        name: `ACCURA ${token}`,
        slug: `accura-${token}`,
      },
    });
    const order = await prisma.wkOrder.create({
      data: {
        orderCode: `WK-ACC-${token.slice(0, 8)}`,
        userId: buyer.id,
        merchantId: merchant.id,
        totalAmount: 250,
        paymentMethod: 'qrph',
        paymentStatus: 'paid',
        status: 'processing',
      },
    });
    cleanup = async () => {
      await prisma.accuraWebhookEvent.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.wkOrderAccuraInvoice.deleteMany({
        where: { wkOrderId: order.id },
      });
      await prisma.wkOrder.deleteMany({ where: { id: order.id } });
      await prisma.merchant.deleteMany({ where: { id: merchant.id } });
      await prisma.user.deleteMany({ where: { id: buyer.id } });
    };

    const payload = {
      version: ACCURA_WEBHOOK_VERSION,
      eventId: `evt-${token}`,
      eventType: ACCURA_INVOICE_ISSUED_EVENT,
      createdAt: new Date().toISOString(),
      data: {
        invoiceId: `inv-${token}`,
        invoiceNumber: `ACC-${token.slice(0, 8)}`,
        status: 'ISSUED',
        issuedAt: new Date().toISOString(),
        documentHash: `hash-${token}`,
        sourceSystem: 'WEKONNEK',
        externalOrderId: String(order.id),
        externalOrderCode: order.orderCode,
      },
    };
    const first = await service.handleWebhook(signedInput(payload));
    expect(first.outcome).toBe('processed');
    const resumed = new AccuraWebhooksService(prisma, config);
    const second = await resumed.handleWebhook(signedInput(payload));
    expect(second.outcome).toBe('duplicate');
    expect(
      await prisma.wkOrderAccuraInvoice.count({
        where: { wkOrderId: order.id },
      }),
    ).toBe(1);
    expect(
      await prisma.accuraWebhookEvent.count({
        where: { eventId: payload.eventId },
      }),
    ).toBe(1);
    const unchanged = await prisma.wkOrder.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(unchanged.paymentStatus).toBe('paid');
    expect(unchanged.status).toBe('processing');
  });
});
