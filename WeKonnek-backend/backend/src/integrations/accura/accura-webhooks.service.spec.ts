/* eslint-disable @typescript-eslint/require-await */
import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccuraWebhooksService } from './accura-webhooks.service';
import { computeAccuraHmacHex } from './accura-webhook.crypto';
import {
  ACCURA_INVOICE_ISSUED_EVENT,
  ACCURA_WEBHOOK_VERSION,
} from './accura-webhook.types';

const SECRET = 'accura-receiver-test-secret';
const ORDER_ID = 42;
const ORDER_CODE = 'WK-ACC-42';
const NOW = new Date('2026-09-01T12:00:00.000Z');

function uniqueError(): Error & { code: string } {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

type StoredEvent = {
  id: string;
  eventId: string;
  eventType: string;
  wkOrderId: number | null;
  accuraInvoiceId: string | null;
  payloadVersion: string | null;
  processedAt: Date;
  createdAt: Date;
};

type StoredInvoice = {
  id: string;
  wkOrderId: number;
  accuraInvoiceId: string;
  accuraInvoiceNumber: string;
  accuraIssuedAt: Date;
  accuraDocumentHash: string;
  accuraVerificationUrl: string | null;
  sourceSystem: string;
  externalOrderId: string;
  externalOrderCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

class AccuraPrismaFake {
  events = new Map<string, StoredEvent>();
  invoicesByOrder = new Map<number, StoredInvoice>();
  invoicesByInvoiceId = new Map<string, StoredInvoice>();
  orders = new Map<
    number,
    {
      id: number;
      orderCode: string;
      merchantId: number;
      paymentStatus: string;
      status: string;
    }
  >();
  wkOrderUpdates = 0;
  invoiceCreates = 0;
  paycoolsUpdates = 0;
  failNextTransaction = false;

  snapshot() {
    return {
      events: clone([...this.events.entries()]),
      invoicesByOrder: clone([...this.invoicesByOrder.entries()]),
      invoicesByInvoiceId: clone([...this.invoicesByInvoiceId.entries()]),
    };
  }

  restore(snapshot: ReturnType<AccuraPrismaFake['snapshot']>) {
    this.events = new Map(snapshot.events);
    this.invoicesByOrder = new Map(snapshot.invoicesByOrder);
    this.invoicesByInvoiceId = new Map(snapshot.invoicesByInvoiceId);
  }

  tx() {
    return {
      accuraWebhookEvent: {
        findUnique: async ({
          where: { eventId },
        }: {
          where: { eventId: string };
        }) => this.events.get(eventId) ?? null,
        create: async ({
          data,
        }: {
          data: Omit<StoredEvent, 'id' | 'createdAt'>;
        }) => {
          if (this.events.has(data.eventId)) throw uniqueError();
          const row: StoredEvent = {
            id: `evt-${this.events.size + 1}`,
            createdAt: new Date(),
            ...data,
          };
          this.events.set(row.eventId, row);
          return row;
        },
      },
      wkOrder: {
        findUnique: async ({ where: { id } }: { where: { id: number } }) =>
          this.orders.get(id) ?? null,
        update: async () => {
          this.wkOrderUpdates += 1;
          throw new Error('WkOrder must not be mutated by ACCURA webhooks');
        },
      },
      wkOrderAccuraInvoice: {
        findUnique: async ({
          where,
        }: {
          where: { wkOrderId?: number; accuraInvoiceId?: string };
        }) => {
          if (where.wkOrderId !== undefined)
            return this.invoicesByOrder.get(where.wkOrderId) ?? null;
          if (where.accuraInvoiceId !== undefined)
            return this.invoicesByInvoiceId.get(where.accuraInvoiceId) ?? null;
          return null;
        },
        create: async ({
          data,
        }: {
          data: Omit<StoredInvoice, 'id' | 'createdAt' | 'updatedAt'>;
        }) => {
          if (this.invoicesByOrder.has(data.wkOrderId)) throw uniqueError();
          if (this.invoicesByInvoiceId.has(data.accuraInvoiceId))
            throw uniqueError();
          const row: StoredInvoice = {
            id: `inv-${this.invoicesByOrder.size + 1}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
          this.invoicesByOrder.set(row.wkOrderId, row);
          this.invoicesByInvoiceId.set(row.accuraInvoiceId, row);
          return row;
        },
      },
      invoice: {
        create: async () => {
          this.invoiceCreates += 1;
          throw new Error('legacy Invoice must not be used');
        },
      },
      platformPaymentTransaction: {
        update: async () => {
          this.paycoolsUpdates += 1;
          throw new Error('PayCools data must not be mutated');
        },
      },
    };
  }

  asPrisma() {
    const client = this.tx();
    return {
      ...client,
      accuraWebhookEvent: {
        ...client.accuraWebhookEvent,
        findUnique: client.accuraWebhookEvent.findUnique,
      },
      $transaction: async (
        fn: (tx: ReturnType<AccuraPrismaFake['tx']>) => Promise<unknown>,
      ) => {
        if (this.failNextTransaction) {
          this.failNextTransaction = false;
          throw new Error('transient receiver failure');
        }
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

function invoicePayload(
  overrides: Record<string, unknown> = {},
  dataOverrides: Record<string, unknown> = {},
) {
  return {
    version: ACCURA_WEBHOOK_VERSION,
    eventId: 'evt-invoice-1',
    eventType: ACCURA_INVOICE_ISSUED_EVENT,
    createdAt: '2026-09-01T12:00:00.000Z',
    data: {
      invoiceId: 'accura-inv-1',
      invoiceNumber: 'ACC-0001',
      status: 'ISSUED',
      issuedAt: '2026-09-01T11:59:00.000Z',
      documentHash: 'hash-1',
      sourceSystem: 'WEKONNEK',
      externalOrderId: String(ORDER_ID),
      externalOrderCode: ORDER_CODE,
      verificationUrl: 'https://accura.example/verify/1',
      ...dataOverrides,
    },
    ...overrides,
  };
}

function signedInput(
  payload: Record<string, unknown>,
  options: {
    secret?: string;
    timestamp?: string;
    eventId?: string;
    mutateBody?: (body: Buffer) => Buffer;
  } = {},
) {
  const timestamp =
    options.timestamp ?? String(Math.floor(NOW.getTime() / 1000));
  const rawBody = options.mutateBody
    ? options.mutateBody(Buffer.from(JSON.stringify(payload)))
    : Buffer.from(JSON.stringify(payload));
  const eventId =
    options.eventId ??
    (typeof payload.eventId === 'string' ? payload.eventId : undefined);
  return {
    rawBody,
    now: NOW,
    headers: {
      eventId,
      timestamp,
      signature: `v1=${computeAccuraHmacHex(options.secret ?? SECRET, timestamp, rawBody)}`,
    },
  };
}

function createHarness(orderPresent = true) {
  const store = new AccuraPrismaFake();
  if (orderPresent) {
    store.orders.set(ORDER_ID, {
      id: ORDER_ID,
      orderCode: ORDER_CODE,
      merchantId: 11,
      paymentStatus: 'paid',
      status: 'processing',
    });
  }
  const config = {
    get: (key: string) => {
      if (key === 'ACCURA_WEBHOOK_SECRET') return SECRET;
      if (key === 'ACCURA_WEBHOOK_TOLERANCE_SECONDS') return 300;
      return undefined;
    },
  } as unknown as ConfigService;
  const service = new AccuraWebhooksService(store.asPrisma() as never, config);
  return { store, service, config };
}

describe('AccuraWebhooksService receiver', () => {
  const logs: string[] = [];

  beforeEach(() => {
    logs.length = 0;
    jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((message: unknown) => {
        logs.push(String(message));
        return Logger.prototype;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('TEST 1 — valid invoice.issued creates association and event', async () => {
    const { service, store } = createHarness();
    const result = await service.handleWebhook(signedInput(invoicePayload()));
    expect(result.outcome).toBe('processed');
    expect(store.invoicesByOrder.size).toBe(1);
    expect(store.events.size).toBe(1);
    expect(store.invoicesByOrder.get(ORDER_ID)).toMatchObject({
      accuraInvoiceId: 'accura-inv-1',
      accuraInvoiceNumber: 'ACC-0001',
      accuraDocumentHash: 'hash-1',
      wkOrderId: ORDER_ID,
    });
    expect(store.wkOrderUpdates).toBe(0);
    expect(store.invoiceCreates).toBe(0);
    expect(store.paycoolsUpdates).toBe(0);
  });

  it('TEST 2 — duplicate same eventId is idempotent', async () => {
    const { service, store } = createHarness();
    const input = signedInput(invoicePayload());
    await service.handleWebhook(input);
    const second = await service.handleWebhook(input);
    expect(second.outcome).toBe('duplicate');
    expect(store.invoicesByOrder.size).toBe(1);
    expect(store.events.size).toBe(1);
  });

  it('TEST 3 — duplicate survives a new service instance using the persisted row', async () => {
    const first = createHarness();
    const input = signedInput(invoicePayload());
    await first.service.handleWebhook(input);
    const resumed = new AccuraWebhooksService(
      first.store.asPrisma() as never,
      first.config,
    );
    const second = await resumed.handleWebhook(input);
    expect(second.outcome).toBe('duplicate');
    expect(first.store.invoicesByOrder.size).toBe(1);
    expect(first.store.events.size).toBe(1);
  });

  it('TEST 4 — same invoice with a new eventId stays idempotent', async () => {
    const { service, store } = createHarness();
    await service.handleWebhook(signedInput(invoicePayload()));
    const result = await service.handleWebhook(
      signedInput(invoicePayload({ eventId: 'evt-invoice-2' })),
    );
    expect(result.outcome).toBe('processed');
    expect(store.invoicesByOrder.size).toBe(1);
    expect(store.events.size).toBe(2);
    expect(store.invoicesByOrder.get(ORDER_ID)?.accuraInvoiceId).toBe(
      'accura-inv-1',
    );
  });

  it('TEST 5 — different ACCURA invoice for the same order is rejected', async () => {
    const { service, store } = createHarness();
    await service.handleWebhook(signedInput(invoicePayload()));
    await expect(
      service.handleWebhook(
        signedInput(
          invoicePayload(
            { eventId: 'evt-invoice-3' },
            {
              invoiceId: 'accura-inv-OTHER',
              invoiceNumber: 'ACC-0002',
              documentHash: 'hash-other',
            },
          ),
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(store.invoicesByOrder.get(ORDER_ID)?.accuraInvoiceId).toBe(
      'accura-inv-1',
    );
    expect(store.events.size).toBe(1);
  });

  it('TEST 6 — wrong externalOrderCode is rejected with no attachment', async () => {
    const { service, store } = createHarness();
    await expect(
      service.handleWebhook(
        signedInput(invoicePayload({}, { externalOrderCode: 'WK-WRONG' })),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(store.invoicesByOrder.size).toBe(0);
    expect(store.events.size).toBe(0);
  });

  it('TEST 7 — unknown WkOrder returns 404 and creates no fake order', async () => {
    const { service, store } = createHarness(false);
    await expect(
      service.handleWebhook(signedInput(invoicePayload())),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(store.orders.size).toBe(0);
    expect(store.invoicesByOrder.size).toBe(0);
    expect(store.events.size).toBe(0);
  });

  it('TEST 8 — wrong HMAC is rejected with no DB mutation', async () => {
    const { service, store } = createHarness();
    const input = signedInput(invoicePayload());
    input.headers.signature = 'v1=' + 'ab'.repeat(32);
    await expect(service.handleWebhook(input)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(store.invoicesByOrder.size).toBe(0);
    expect(store.events.size).toBe(0);
  });

  it('TEST 9 — stale timestamp is rejected with no DB mutation', async () => {
    const { service, store } = createHarness();
    await expect(
      service.handleWebhook(
        signedInput(invoicePayload(), { timestamp: '1000' }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(store.invoicesByOrder.size).toBe(0);
    expect(store.events.size).toBe(0);
  });

  it('TEST 10 — unknown event type is ignored without invoice mutation', async () => {
    const { service, store } = createHarness();
    const result = await service.handleWebhook(
      signedInput(invoicePayload({ eventType: 'invoice.voided' })),
    );
    expect(result.outcome).toBe('ignored');
    expect(store.invoicesByOrder.size).toBe(0);
    expect(store.events.size).toBe(0);
  });

  it('TEST 11 — malformed payload is rejected with no mutation', async () => {
    const { service, store } = createHarness();
    await expect(
      service.handleWebhook(signedInput({ not: 'an-accura-envelope' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.invoicesByOrder.size).toBe(0);
    expect(store.events.size).toBe(0);
  });

  it('TEST 12 — invalid externalOrderId is rejected', async () => {
    const { service, store } = createHarness();
    for (const externalOrderId of [
      'NaN',
      '1.5',
      '-3',
      '0',
      '9007199254740993',
    ]) {
      await expect(
        service.handleWebhook(
          signedInput(
            invoicePayload(
              { eventId: `evt-${externalOrderId}` },
              { externalOrderId },
            ),
          ),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(store.invoicesByOrder.size).toBe(0);
  });

  it('TEST 25 — transient failure then ACCURA retry processes once', async () => {
    const { service, store } = createHarness();
    store.failNextTransaction = true;
    const first = signedInput(invoicePayload());
    await expect(service.handleWebhook(first)).rejects.toThrow(
      'transient receiver failure',
    );
    expect(store.invoicesByOrder.size).toBe(0);
    expect(store.events.size).toBe(0);
    const retry = signedInput(invoicePayload(), {
      timestamp: String(Math.floor(NOW.getTime() / 1000) + 5),
    });
    const result = await service.handleWebhook(retry);
    expect(result.outcome).toBe('processed');
    expect(store.invoicesByOrder.size).toBe(1);
    expect(store.events.size).toBe(1);
  });

  it('does not log the webhook secret or signature', async () => {
    const { service } = createHarness();
    const input = signedInput(invoicePayload());
    await service.handleWebhook(input);
    const combined = logs.join('\n');
    expect(combined).toContain('accura_webhook');
    expect(combined).not.toContain(SECRET);
    expect(combined).not.toContain(input.headers.signature);
    expect(combined.toLowerCase()).not.toContain('authorization');
  });

  it('does not attach an invoice when PLATFORM externalClientReference mismatches the order merchant', async () => {
    const { service, store } = createHarness();
    await expect(
      service.handleWebhook(
        signedInput(
          invoicePayload({}, { externalClientReference: 'merchant-22' }),
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(store.invoicesByOrder.size).toBe(0);
    expect(store.events.size).toBe(0);
  });
});
