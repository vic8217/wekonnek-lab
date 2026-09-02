/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AccuraClientService } from './accura-client.service';
import { AccuraWebhooksService } from './accura-webhooks.service';
import { computeAccuraHmacHex } from './accura-webhook.crypto';
import {
  ACCURA_INVOICE_ISSUED_EVENT,
  ACCURA_WEBHOOK_VERSION,
} from './accura-webhook.types';

const WEBHOOK_SECRET = 'roundtrip-webhook-secret';
const MACHINE_SECRET = 'roundtrip-machine-secret';
const ORDER_ID = 42;
const ORDER_CODE = 'WK-ACC-42';

type StoredEvent = {
  eventId: string;
  eventType: string;
  wkOrderId: number | null;
  accuraInvoiceId: string | null;
  payloadVersion: string | null;
  processedAt: Date;
};
type StoredInvoice = {
  wkOrderId: number;
  accuraInvoiceId: string;
  accuraInvoiceNumber: string;
  accuraDocumentHash: string;
};

class Store {
  events = new Map<string, StoredEvent>();
  invoices = new Map<number, StoredInvoice>();
  order = {
    id: ORDER_ID,
    orderCode: ORDER_CODE,
    userId: '11111111-1111-1111-1111-111111111111',
    shopId: 7 as number | null,
    merchantId: 11,
    status: 'processing',
    paymentMethod: 'qrph',
    paymentStatus: 'paid',
    paymentRef: 'PAY-1',
    discountAmount: new Prisma.Decimal(0),
    deliveryFee: new Prisma.Decimal(0),
    transactionFeeAmount: new Prisma.Decimal(2),
    deliveryAddress: null as string | null,
    paymentStatusAtLoad: 'paid',
    orderItems: [
      {
        productName: 'Tea',
        quantity: 1,
        price: new Prisma.Decimal('80.00'),
        productId: 1,
      },
    ],
    shop: {
      id: 7,
      name: 'Cafe',
      merchantId: 11,
      accuraBranchMapping: {
        merchantId: 11,
        accuraBranchId: 'branch-1',
      },
    },
  };
  wkOrderUpdates = 0;

  snapshot() {
    return {
      events: [...this.events.entries()],
      invoices: [...this.invoices.entries()],
    };
  }

  restore(snapshot: ReturnType<Store['snapshot']>) {
    this.events = new Map(snapshot.events);
    this.invoices = new Map(snapshot.invoices);
  }

  tx() {
    return {
      accuraWebhookEvent: {
        findUnique: async ({
          where: { eventId },
        }: {
          where: { eventId: string };
        }) => this.events.get(eventId) ?? null,
        create: async ({ data }: { data: StoredEvent }) => {
          this.events.set(data.eventId, data);
          return data;
        },
      },
      wkOrder: {
        findUnique: async ({ where: { id } }: { where: { id: number } }) =>
          id === this.order.id ? this.order : null,
        update: async () => {
          this.wkOrderUpdates += 1;
          throw new Error('payment/order must not be mutated');
        },
      },
      wkOrderAccuraInvoice: {
        findUnique: async ({
          where,
        }: {
          where: { wkOrderId?: number; accuraInvoiceId?: string };
        }) => {
          if (where.wkOrderId != null)
            return this.invoices.get(where.wkOrderId) ?? null;
          if (where.accuraInvoiceId)
            return (
              [...this.invoices.values()].find(
                (row) => row.accuraInvoiceId === where.accuraInvoiceId,
              ) ?? null
            );
          return null;
        },
        create: async ({ data }: { data: StoredInvoice }) => {
          this.invoices.set(data.wkOrderId, data);
          return data;
        },
      },
    };
  }

  asPrisma() {
    const client = this.tx();
    return {
      ...client,
      user: {
        findUnique: async () => ({
          firstName: 'Ana',
          lastName: 'Cruz',
          email: 'ana@test.invalid',
          phone: '+63917',
        }),
      },
      wkOrder: {
        ...client.wkOrder,
        findUnique: async ({ where: { id } }: { where: { id: number } }) =>
          id === this.order.id ? this.order : null,
      },
      accuraWebhookEvent: client.accuraWebhookEvent,
      $transaction: async (
        fn: (tx: ReturnType<Store['tx']>) => Promise<unknown>,
      ) => {
        const snapshot = this.snapshot();
        try {
          return await fn(this.tx());
        } catch (error) {
          this.restore(snapshot);
          throw error;
        }
      },
    };
  }
}

function config() {
  return {
    get: (key: string) => {
      const values: Record<string, string> = {
        ACCURA_API_BASE_URL: 'https://accura-sandbox.example.test',
        ACCURA_PLATFORM_CLIENT_ID: 'acc_roundtrip',
        ACCURA_PLATFORM_CLIENT_SECRET: MACHINE_SECRET,
        ACCURA_INTEGRATION_CLIENT_ID: 'acc_company_legacy',
        ACCURA_INTEGRATION_CLIENT_SECRET: 'legacy-must-not-be-used',
        ACCURA_WEBHOOK_SECRET: WEBHOOK_SECRET,
        ACCURA_WEBHOOK_TOLERANCE_SECONDS: '300',
        ACCURA_BRANCH_ID: 'branch-1',
        ACCURA_SERIES_ID: 'series-1',
      };
      return values[key];
    },
  } as unknown as ConfigService;
}

function issuedBody(invoiceId = 'accura-inv-A') {
  return {
    invoiceId,
    officialNumber: 'ER-000100',
    status: 'ISSUED',
    issuedAt: '2026-09-01T12:00:00.000Z',
    documentHash: 'b'.repeat(64),
    externalOrderId: String(ORDER_ID),
    externalOrderCode: ORDER_CODE,
  };
}

function webhookFromIssuance(
  issued: ReturnType<typeof issuedBody>,
  eventId = 'evt-roundtrip-1',
) {
  const payload = {
    version: ACCURA_WEBHOOK_VERSION,
    eventId,
    eventType: ACCURA_INVOICE_ISSUED_EVENT,
    createdAt: issued.issuedAt,
    data: {
      invoiceId: issued.invoiceId,
      invoiceNumber: issued.officialNumber,
      status: issued.status,
      issuedAt: issued.issuedAt,
      documentHash: issued.documentHash,
      sourceSystem: 'WEKONNEK',
      externalOrderId: issued.externalOrderId,
      externalOrderCode: issued.externalOrderCode,
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    payload,
    rawBody,
    headers: {
      eventId,
      timestamp,
      signature: `v1=${computeAccuraHmacHex(WEBHOOK_SECRET, timestamp, rawBody)}`,
    },
  };
}

describe('ACCURA sandbox round-trip', () => {
  it('TEST 22 — issuance then webhook creates one WkOrderAccuraInvoice', async () => {
    const store = new Store();
    const issued = issuedBody();
    const fetchImpl = jest.fn(async () => ({
      status: 201,
      json: async () => issued,
    })) as never;
    const client = new AccuraClientService(
      store.asPrisma() as never,
      config(),
      fetchImpl,
    );
    const webhooks = new AccuraWebhooksService(
      store.asPrisma() as never,
      config(),
    );
    const issuance = await client.issueInvoiceForOrder(ORDER_ID);
    expect(issuance.ok).toBe(true);
    if (issuance.ok) expect(issuance.status).toBe('ISSUED');
    expect(store.invoices.size).toBe(0);
    const delivered = webhookFromIssuance(issued);
    const received = await webhooks.handleWebhook(delivered);
    expect(received.outcome).toBe('processed');
    expect(store.invoices.size).toBe(1);
    expect(store.events.size).toBe(1);
    expect(store.invoices.get(ORDER_ID)?.accuraInvoiceId).toBe('accura-inv-A');
    expect(store.wkOrderUpdates).toBe(0);
  });

  it('TEST 23 — repeated issuance + webhook stays on one association', async () => {
    const store = new Store();
    const issued = issuedBody();
    const fetchImpl = jest.fn(async () => ({
      status: 201,
      json: async () => issued,
    })) as never;
    const client = new AccuraClientService(
      store.asPrisma() as never,
      config(),
      fetchImpl,
    );
    const webhooks = new AccuraWebhooksService(
      store.asPrisma() as never,
      config(),
    );
    await client.issueInvoiceForOrder(ORDER_ID);
    await client.issueInvoiceForOrder(ORDER_ID);
    const keys = (fetchImpl as jest.Mock).mock.calls.map(
      (call) => (call[1] as RequestInit).headers as Record<string, string>,
    );
    expect(keys[0]['Idempotency-Key']).toBe(keys[1]['Idempotency-Key']);
    const delivered = webhookFromIssuance(issued);
    await webhooks.handleWebhook(delivered);
    await webhooks.handleWebhook(delivered);
    expect(store.invoices.size).toBe(1);
    expect(store.events.size).toBe(1);
  });

  it('TEST 24 — changed payload 409 leaves existing association unchanged', async () => {
    const store = new Store();
    store.invoices.set(ORDER_ID, {
      wkOrderId: ORDER_ID,
      accuraInvoiceId: 'accura-inv-A',
      accuraInvoiceNumber: 'ER-000100',
      accuraDocumentHash: 'b'.repeat(64),
    });
    const fetchImpl = jest.fn(async () => ({
      status: 409,
      json: async () => ({
        error: 'IDEMPOTENCY_KEY_REUSED',
        message:
          'This idempotency key was already used with a different request',
      }),
    })) as never;
    const client = new AccuraClientService(
      store.asPrisma() as never,
      config(),
      fetchImpl,
    );
    const result = await client.issueInvoiceForOrder(ORDER_ID);
    expect(result).toMatchObject({
      ok: false,
      category: 'IDEMPOTENCY_CONFLICT',
      retryable: false,
    });
    expect(store.invoices.get(ORDER_ID)?.accuraInvoiceId).toBe('accura-inv-A');
  });

  it('TEST 25 — transient webhook 500 then retry attaches once', async () => {
    const store = new Store();
    const issued = issuedBody();
    let fail = true;
    const webhooks = new AccuraWebhooksService(
      {
        ...store.asPrisma(),
        $transaction: async (
          fn: (tx: ReturnType<Store['tx']>) => Promise<unknown>,
        ) => {
          if (fail) {
            fail = false;
            throw new Error('transient receiver failure');
          }
          return store.asPrisma().$transaction(fn);
        },
      } as never,
      config(),
    );
    const delivered = webhookFromIssuance(issued);
    await expect(webhooks.handleWebhook(delivered)).rejects.toThrow(
      'transient receiver failure',
    );
    expect(store.invoices.size).toBe(0);
    const retry = webhookFromIssuance(issued);
    await expect(webhooks.handleWebhook(retry)).resolves.toMatchObject({
      outcome: 'processed',
    });
    expect(store.invoices.size).toBe(1);
    expect(store.events.size).toBe(1);
  });

  it('TEST 26 — wrong webhook secret is 401 with no mutation', async () => {
    const store = new Store();
    const issued = issuedBody();
    const webhooks = new AccuraWebhooksService(
      store.asPrisma() as never,
      config(),
    );
    const delivered = webhookFromIssuance(issued);
    delivered.headers.signature = `v1=${'ab'.repeat(32)}`;
    await expect(webhooks.handleWebhook(delivered)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(store.invoices.size).toBe(0);
    expect(store.events.size).toBe(0);
  });

  it('TEST 27 — unknown WkOrder is 404 with no rows', async () => {
    const store = new Store();
    const webhooks = new AccuraWebhooksService(
      store.asPrisma() as never,
      config(),
    );
    const issued = issuedBody();
    issued.externalOrderId = '999999';
    const delivered = webhookFromIssuance(issued, 'evt-unknown');
    await expect(webhooks.handleWebhook(delivered)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(store.invoices.size).toBe(0);
    expect(store.events.size).toBe(0);
  });

  it('TEST 28 — different invoice for the same order is 409', async () => {
    const store = new Store();
    store.invoices.set(ORDER_ID, {
      wkOrderId: ORDER_ID,
      accuraInvoiceId: 'accura-inv-A',
      accuraInvoiceNumber: 'ER-000100',
      accuraDocumentHash: 'b'.repeat(64),
    });
    const webhooks = new AccuraWebhooksService(
      store.asPrisma() as never,
      config(),
    );
    const issued = issuedBody('accura-inv-B');
    issued.officialNumber = 'ER-000200';
    issued.documentHash = 'c'.repeat(64);
    const delivered = webhookFromIssuance(issued, 'evt-conflict');
    await expect(webhooks.handleWebhook(delivered)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(store.invoices.get(ORDER_ID)?.accuraInvoiceId).toBe('accura-inv-A');
  });
});
