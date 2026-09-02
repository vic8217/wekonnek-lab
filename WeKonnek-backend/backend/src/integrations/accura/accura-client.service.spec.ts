/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AccuraClientService } from './accura-client.service';
import { accuraBasicAuthorization } from './accura-client.types';

const PLATFORM_ID = 'acc_platform';
const PLATFORM_SECRET = 'accura-platform-secret-value';
const CLIENT_ID = 'acc_testclientid';
const CLIENT_SECRET = 'accura-machine-secret-value';
const WEBHOOK_SECRET = 'accura-webhook-secret-must-not-be-used';

function orderRow() {
  return {
    id: 42,
    orderCode: 'WK-ACC-42',
    userId: '11111111-1111-1111-1111-111111111111',
    shopId: 7,
    merchantId: 11,
    status: 'processing',
    paymentMethod: 'qrph',
    paymentStatus: 'paid',
    paymentRef: 'WK260901PAY42',
    discountAmount: new Prisma.Decimal(0),
    deliveryFee: new Prisma.Decimal(0),
    transactionFeeAmount: new Prisma.Decimal(8.5),
    deliveryAddress: null,
    orderItems: [
      {
        productName: 'Coffee',
        quantity: 1,
        price: new Prisma.Decimal('120.00'),
        productId: 3,
      },
    ],
    shop: {
      id: 7,
      name: 'Cafe',
      merchantId: 11,
      accuraBranchMapping: {
        merchantId: 11,
        accuraBranchId: 'accura-branch-1',
      },
    },
  };
}

function issuedBody() {
  return {
    invoiceId: 'inv-1',
    officialNumber: 'ER-000001',
    status: 'ISSUED',
    issuedAt: '2026-09-01T12:00:00.000Z',
    documentHash: 'a'.repeat(64),
    externalOrderId: '42',
    externalOrderCode: 'WK-ACC-42',
  };
}

function createService(fetchImpl: jest.Mock, order = orderRow()) {
  const wkOrderUpdate = jest.fn();
  const invoiceCreate = jest.fn();
  const accuraInvoiceCreate = jest.fn();
  const prisma = {
    wkOrder: {
      findUnique: jest.fn(async () => order),
      update: wkOrderUpdate,
    },
    user: {
      findUnique: jest.fn(async () => ({
        firstName: 'Ana',
        lastName: 'Cruz',
        email: 'ana@test.invalid',
        phone: '+639170000001',
      })),
    },
    invoice: { create: invoiceCreate },
    wkOrderAccuraInvoice: { create: accuraInvoiceCreate },
  };
  const config = {
    get: (key: string) => {
      const values: Record<string, string> = {
        ACCURA_API_BASE_URL: 'https://accura-sandbox.example.test',
        ACCURA_PLATFORM_CLIENT_ID: PLATFORM_ID,
        ACCURA_PLATFORM_CLIENT_SECRET: PLATFORM_SECRET,
        ACCURA_INTEGRATION_CLIENT_ID: CLIENT_ID,
        ACCURA_INTEGRATION_CLIENT_SECRET: CLIENT_SECRET,
        ACCURA_WEBHOOK_SECRET: WEBHOOK_SECRET,
        ACCURA_API_TIMEOUT_MS: '10000',
        ACCURA_BRANCH_ID: 'accura-branch-legacy-must-not-be-used',
        ACCURA_SERIES_ID: 'accura-series-1',
      };
      return values[key];
    },
  } as unknown as ConfigService;
  const service = new AccuraClientService(prisma as never, config, fetchImpl);
  return { service, prisma, wkOrderUpdate, invoiceCreate, accuraInvoiceCreate };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: async () => body,
  } as Response;
}

describe('AccuraClientService', () => {
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

  afterEach(() => jest.restoreAllMocks());

  it('POSTs Basic machine auth and the ACCURA Task 2 payload', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(201, issuedBody()));
    const { service } = createService(fetchImpl);
    const result = await service.issueInvoiceForOrder(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('ISSUED');
      expect(result.invoiceId).toBe('inv-1');
      expect(result.officialNumber).toBe('ER-000001');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toBe(
      'https://accura-sandbox.example.test/api/v1/integrations/invoices',
    );
    expect(init.headers.Authorization).toBe(
      accuraBasicAuthorization(PLATFORM_ID, PLATFORM_SECRET),
    );
    expect(init.headers.Authorization).not.toBe(
      accuraBasicAuthorization(CLIENT_ID, CLIENT_SECRET),
    );
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(init.headers['Idempotency-Key']).toBe(
      'wekonnek:wkorder:42:accura-invoice',
    );
    const body = JSON.parse(init.body as string);
    expect(body.sourceSystem).toBe('WEKONNEK');
    expect(body.externalOrderId).toBe('42');
    expect(body.externalOrderCode).toBe('WK-ACC-42');
    expect(body.externalClientReference).toBe('merchant-11');
    expect(body.branchId).toBe('accura-branch-1');
    expect(body.companyId).toBeUndefined();
    expect(body.idempotencyKey).toBe('wekonnek:wkorder:42:accura-invoice');
  });

  it('reuses the same idempotency key on retry', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(201, {
        invoiceId: 'inv-1',
        officialNumber: 'ER-000001',
        status: 'ISSUED',
        issuedAt: '2026-09-01T12:00:00.000Z',
        documentHash: 'a'.repeat(64),
        externalOrderId: '42',
        externalOrderCode: 'WK-ACC-42',
      }),
    );
    const { service } = createService(fetchImpl);
    await service.issueInvoiceForOrder(42);
    await service.issueInvoiceForOrder(42);
    const first = JSON.parse(
      ((fetchImpl as jest.Mock).mock.calls[0][1] as RequestInit).body as string,
    );
    const second = JSON.parse(
      ((fetchImpl as jest.Mock).mock.calls[1][1] as RequestInit).body as string,
    );
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.idempotencyKey).toBe('wekonnek:wkorder:42:accura-invoice');
  });

  it('does not write WkOrderAccuraInvoice or mutate payment fields on success', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(201, {
        invoiceId: 'inv-1',
        officialNumber: 'ER-000001',
        status: 'ISSUED',
        issuedAt: '2026-09-01T12:00:00.000Z',
        documentHash: 'a'.repeat(64),
        externalOrderId: '42',
        externalOrderCode: 'WK-ACC-42',
      }),
    );
    const { service, wkOrderUpdate, invoiceCreate, accuraInvoiceCreate } =
      createService(fetchImpl);
    await service.issueInvoiceForOrder(42);
    expect(wkOrderUpdate).not.toHaveBeenCalled();
    expect(invoiceCreate).not.toHaveBeenCalled();
    expect(accuraInvoiceCreate).not.toHaveBeenCalled();
  });

  it('skips unpaid orders without calling ACCURA', async () => {
    const fetchImpl = jest.fn();
    const unpaid = {
      ...orderRow(),
      paymentStatus: 'pending',
      status: 'pending',
    };
    const { service } = createService(fetchImpl, unpaid);
    const result = await service.issueInvoiceForOrder(42);
    expect(result).toMatchObject({ ok: false, category: 'NOT_ELIGIBLE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('classifies auth, idempotency, 429, 5xx, and timeout', async () => {
    const cases: Array<[number | 'timeout', string]> = [
      [401, 'AUTH'],
      [409, 'IDEMPOTENCY_CONFLICT'],
      [429, 'RATE_LIMITED'],
      [500, 'SERVER'],
      ['timeout', 'TIMEOUT'],
    ];
    for (const [status, category] of cases) {
      const fetchImpl = jest.fn(async () => {
        if (status === 'timeout') {
          const error = new Error('aborted');
          error.name = 'AbortError';
          throw error;
        }
        return jsonResponse(status, {
          error:
            status === 409
              ? 'IDEMPOTENCY_KEY_REUSED'
              : status === 429
                ? 'RATE_LIMIT_EXCEEDED'
                : 'ISSUANCE_FAILED',
        });
      });
      const { service, wkOrderUpdate } = createService(fetchImpl);
      const result = await service.issueInvoiceForOrder(42);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.category).toBe(category);
      expect(result.retryable).toBe(
        category === 'RATE_LIMITED' ||
          category === 'SERVER' ||
          category === 'TIMEOUT',
      );
      expect(wkOrderUpdate).not.toHaveBeenCalled();
    }
  });

  it('does not log machine or webhook secrets', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(201, issuedBody()));
    const { service } = createService(fetchImpl);
    await service.issueInvoiceForOrder(42);
    const combined = logs.join('\n');
    expect(combined).toContain('accura_issuance');
    expect(combined).toContain('wkOrderId=42');
    expect(combined).not.toContain(PLATFORM_SECRET);
    expect(combined).not.toContain(CLIENT_SECRET);
    expect(combined).not.toContain(WEBHOOK_SECRET);
    expect(combined).not.toContain(
      accuraBasicAuthorization(PLATFORM_ID, PLATFORM_SECRET),
    );
    const auth = ((fetchImpl as jest.Mock).mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    expect(combined).not.toContain(auth.Authorization);
  });
});
