/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AccuraClientService } from './accura-client.service';
import {
  accuraBasicAuthorization,
  accuraExternalClientReference,
  getAccuraExternalClientReference,
} from './accura-client.types';

const PLATFORM_ID = 'acc_platform';
const PLATFORM_SECRET = 'platform-secret-value';
const COMPANY_ID = 'acc_company_legacy';
const COMPANY_SECRET = 'company-secret-must-not-be-used';

function orderRow(input: {
  id: number;
  merchantId: number;
  shopId: number;
  branchId: string | null;
  shopMerchantId?: number;
  mappingMerchantId?: number;
}) {
  const shopMerchantId = input.shopMerchantId ?? input.merchantId;
  const mappingMerchantId = input.mappingMerchantId ?? shopMerchantId;
  return {
    id: input.id,
    orderCode: `WK-ACC-${input.id}`,
    userId: '11111111-1111-1111-1111-111111111111',
    merchantId: input.merchantId,
    shopId: input.shopId,
    status: 'processing',
    paymentMethod: 'qrph',
    paymentStatus: 'paid',
    paymentRef: `PAY-${input.id}`,
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
      id: input.shopId,
      name: `Shop ${input.shopId}`,
      merchantId: shopMerchantId,
      accuraBranchMapping: input.branchId
        ? {
            merchantId: mappingMerchantId,
            accuraBranchId: input.branchId,
          }
        : null,
    },
  };
}

function issuedBody(orderId: number) {
  return {
    invoiceId: `inv-${orderId}`,
    officialNumber: `ER-${orderId}`,
    status: 'ISSUED',
    issuedAt: '2026-09-02T12:00:00.000Z',
    documentHash: 'a'.repeat(64),
    externalOrderId: String(orderId),
    externalOrderCode: `WK-ACC-${orderId}`,
    externalClientReference: accuraExternalClientReference(
      orderId === 42 ? 11 : 22,
    ),
  };
}

function createService(
  fetchImpl: jest.Mock,
  orders: Map<number, ReturnType<typeof orderRow>>,
  extraEnv: Record<string, string> = {},
) {
  const prisma = {
    wkOrder: {
      findUnique: jest.fn(async ({ where }: { where: { id: number } }) =>
        orders.get(where.id) || null,
      ),
    },
    user: {
      findUnique: jest.fn(async () => ({
        firstName: 'Ana',
        lastName: 'Cruz',
        email: 'ana@test.invalid',
        phone: '+639170000001',
      })),
    },
    wkOrderAccuraInvoice: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(),
    },
  };
  const config = {
    get: (key: string) =>
      ({
        ACCURA_API_BASE_URL: 'https://accura-sandbox.example.test',
        ACCURA_PLATFORM_CLIENT_ID: PLATFORM_ID,
        ACCURA_PLATFORM_CLIENT_SECRET: PLATFORM_SECRET,
        ACCURA_INTEGRATION_CLIENT_ID: COMPANY_ID,
        ACCURA_INTEGRATION_CLIENT_SECRET: COMPANY_SECRET,
        ACCURA_SERIES_ID: 'accura-series-1',
        ACCURA_BRANCH_ID: 'legacy-default-branch',
        ACCURA_API_TIMEOUT_MS: '10000',
        ...extraEnv,
      })[key],
  } as unknown as ConfigService;
  return new AccuraClientService(prisma as never, config, fetchImpl);
}

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body };
}

describe('ACCURA delegated marketplace issuance', () => {
  it('uses one canonical externalClientReference helper', () => {
    expect(getAccuraExternalClientReference(11)).toBe('merchant-11');
    expect(accuraExternalClientReference(22)).toBe('merchant-22');
    expect(getAccuraExternalClientReference).toBe(accuraExternalClientReference);
  });

  it('isolates Merchant A and Merchant B request authority', async () => {
    const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return jsonResponse(201, issuedBody(Number(body.externalOrderId)));
    });
    const orders = new Map([
      [
        42,
        orderRow({
          id: 42,
          merchantId: 11,
          shopId: 7,
          branchId: 'branch-a',
        }),
      ],
      [
        99,
        orderRow({
          id: 99,
          merchantId: 22,
          shopId: 8,
          branchId: 'branch-b',
        }),
      ],
    ]);
    const service = createService(fetchImpl, orders);
    await service.issueInvoiceForOrder(42);
    await service.issueInvoiceForOrder(99);
    const first = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    const second = JSON.parse(String(fetchImpl.mock.calls[1][1].body));
    expect(first.externalClientReference).toBe('merchant-11');
    expect(first.branchId).toBe('branch-a');
    expect(second.externalClientReference).toBe('merchant-22');
    expect(second.branchId).toBe('branch-b');
    expect(first.branchId).not.toBe(second.branchId);
    expect(first.externalClientReference).not.toBe(second.externalClientReference);
    expect(first.companyId).toBeUndefined();
    expect(second.companyId).toBeUndefined();
    const auth = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(auth.Authorization).toBe(
      accuraBasicAuthorization(PLATFORM_ID, PLATFORM_SECRET),
    );
    expect(auth.Authorization).not.toBe(
      accuraBasicAuthorization(COMPANY_ID, COMPANY_SECRET),
    );
    expect(first.branchId).not.toBe('legacy-default-branch');
  });

  it('does not fall back to COMPANY credentials or a default branch', async () => {
    const fetchImpl = jest.fn();
    const orders = new Map([
      [
        42,
        orderRow({
          id: 42,
          merchantId: 11,
          shopId: 7,
          branchId: 'branch-a',
        }),
      ],
    ]);
    const unconfigured = createService(fetchImpl, orders, {
      ACCURA_PLATFORM_CLIENT_ID: '',
      ACCURA_PLATFORM_CLIENT_SECRET: '',
    });
    const missing = await unconfigured.issueInvoiceForOrder(42);
    expect(missing).toMatchObject({ ok: false, category: 'NOT_CONFIGURED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails unonboarded merchants locally without fabricating an invoice', async () => {
    const fetchImpl = jest.fn();
    const orders = new Map([
      [
        42,
        orderRow({
          id: 42,
          merchantId: 11,
          shopId: 7,
          branchId: null,
        }),
      ],
    ]);
    const service = createService(fetchImpl, orders);
    const result = await service.issueInvoiceForOrder(42);
    expect(result).toMatchObject({
      ok: false,
      category: 'REJECTED',
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects stale mapping onto another merchant shop or branch owner', async () => {
    const fetchImpl = jest.fn();
    const crossShop = createService(
      fetchImpl,
      new Map([
        [
          42,
          orderRow({
            id: 42,
            merchantId: 11,
            shopId: 9,
            branchId: 'branch-b',
            shopMerchantId: 22,
            mappingMerchantId: 22,
          }),
        ],
      ]),
    );
    await expect(crossShop.issueInvoiceForOrder(42)).resolves.toMatchObject({
      ok: false,
      category: 'REJECTED',
      retryable: false,
    });
    const staleOwner = createService(
      fetchImpl,
      new Map([
        [
          42,
          orderRow({
            id: 42,
            merchantId: 11,
            shopId: 7,
            branchId: 'branch-b',
            mappingMerchantId: 22,
          }),
        ],
      ]),
    );
    await expect(staleOwner.issueInvoiceForOrder(42)).resolves.toMatchObject({
      ok: false,
      category: 'REJECTED',
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('classifies suspended, revoked, and missing delegation as permanent', async () => {
    const cases = [
      [403, 'CLIENT_ACCOUNT_SUSPENDED', 'AUTH'],
      [403, 'PLATFORM_DELEGATION_REVOKED', 'AUTH'],
      [404, 'PLATFORM_DELEGATION_NOT_FOUND', 'REJECTED'],
      [403, 'BRANCH_NOT_OWNED_BY_DELEGATED_CLIENT', 'AUTH'],
    ] as const;
    for (const [status, error, category] of cases) {
      const fetchImpl = jest.fn(async () => jsonResponse(status, { error }));
      const service = createService(
        fetchImpl,
        new Map([
          [
            42,
            orderRow({
              id: 42,
              merchantId: 11,
              shopId: 7,
              branchId: 'branch-a',
            }),
          ],
        ]),
      );
      const result = await service.issueInvoiceForOrder(42);
      expect(result).toMatchObject({
        ok: false,
        category,
        retryable: false,
      });
    }
  });
});

describe('ACCURA platform issuance logging', () => {
  it('does not log platform or company secrets', async () => {
    const logs: string[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message));
      return Logger.prototype;
    });
    const fetchImpl = jest.fn(async () => jsonResponse(201, issuedBody(42)));
    const service = createService(
      fetchImpl,
      new Map([
        [
          42,
          orderRow({
            id: 42,
            merchantId: 11,
            shopId: 7,
            branchId: 'branch-a',
          }),
        ],
      ]),
    );
    await service.issueInvoiceForOrder(42);
    const combined = logs.join('\n');
    expect(combined).not.toContain(PLATFORM_SECRET);
    expect(combined).not.toContain(COMPANY_SECRET);
    jest.restoreAllMocks();
  });
});
