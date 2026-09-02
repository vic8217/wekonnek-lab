import { Prisma } from '@prisma/client';
import {
  isWkOrderEligibleForAccuraInvoice,
  mapWkOrderToAccuraInvoiceRequest,
  resolveAccuraIssuanceTargets,
} from './accura-client.mapping';
import { accuraInvoiceIdempotencyKey } from './accura-client.types';
import type { AccuraOrderSnapshot } from './accura-client.mapping';

function snapshot(
  overrides: Partial<AccuraOrderSnapshot> = {},
): AccuraOrderSnapshot {
  return {
    id: 42,
    orderCode: 'WK-ACC-42',
    userId: 'user-1',
    shopId: 7,
    merchantId: 11,
    status: 'processing',
    paymentMethod: 'qrph',
    paymentStatus: 'paid',
    paymentRef: 'WK260901PAY42',
    discountAmount: new Prisma.Decimal('10.00'),
    deliveryFee: new Prisma.Decimal('25.00'),
    transactionFeeAmount: new Prisma.Decimal('5.00'),
    deliveryAddress: '123 Test Street',
    orderItems: [
      {
        productName: 'Rice meal',
        quantity: 2,
        price: new Prisma.Decimal('50.00'),
        productId: 9,
      },
    ],
    shop: {
      id: 7,
      name: 'Main shop',
      merchantId: 11,
      accuraBranchMapping: {
        merchantId: 11,
        accuraBranchId: 'accura-branch',
      },
    },
    buyer: {
      firstName: 'Ana',
      lastName: 'Cruz',
      email: 'ana@test.invalid',
      phone: '+639170000001',
    },
    ...overrides,
  };
}

describe('ACCURA invoice mapping', () => {
  it('maps WkOrder.id and orderCode as external references', () => {
    const request = mapWkOrderToAccuraInvoiceRequest(snapshot(), {
      branchId: 'accura-branch',
      seriesId: 'accura-series',
      externalClientReference: 'merchant-11',
    });
    expect(request.sourceSystem).toBe('WEKONNEK');
    expect(request.externalOrderId).toBe('42');
    expect(request.externalOrderCode).toBe('WK-ACC-42');
    expect(request.externalClientReference).toBe('merchant-11');
    expect(request.branchId).toBe('accura-branch');
    expect(request.seriesId).toBe('accura-series');
    expect(request).not.toHaveProperty('companyId');
  });

  it('uses a deterministic idempotency key per WkOrder', () => {
    expect(accuraInvoiceIdempotencyKey(42)).toBe(
      'wekonnek:wkorder:42:accura-invoice',
    );
    expect(
      mapWkOrderToAccuraInvoiceRequest(snapshot(), {
        branchId: 'b',
        seriesId: 's',
        externalClientReference: 'merchant-11',
      }).idempotencyKey,
    ).toBe(accuraInvoiceIdempotencyKey(42));
    expect(accuraInvoiceIdempotencyKey(42)).toBe(
      accuraInvoiceIdempotencyKey(42),
    );
  });

  it('maps merchandise snapshots and does not send the transaction fee as merchandise', () => {
    const request = mapWkOrderToAccuraInvoiceRequest(snapshot(), {
      branchId: 'b',
      seriesId: 's',
      externalClientReference: 'merchant-11',
    });
    expect(request.items[0]).toMatchObject({
      description: 'Rice meal',
      quantity: '2',
      unitPrice: '50.00',
      discountAmount: '10.00',
      taxClass: 'NON_VAT',
      productReference: '9',
    });
    expect(request.items.map((item) => item.description)).toEqual([
      'Rice meal',
      'Delivery fee',
    ]);
    expect(
      request.items.some((item) => /transaction fee/i.test(item.description)),
    ).toBe(false);
    expect(request.items.map((item) => item.unitPrice)).toEqual([
      '50.00',
      '25.00',
    ]);
  });

  it('sends only available buyer fields and payment context', () => {
    const request = mapWkOrderToAccuraInvoiceRequest(snapshot(), {
      branchId: 'b',
      seriesId: 's',
      externalClientReference: 'merchant-11',
    });
    expect(request.buyer).toEqual({
      name: 'Ana Cruz',
      phone: '+639170000001',
      email: 'ana@test.invalid',
      address: '123 Test Street',
    });
    expect(request.payment).toEqual({
      method: 'qrph',
      status: 'paid',
      processor: 'WEKONNEK',
      reference: 'WK260901PAY42',
      wekonnekShopId: 7,
      wekonnekShopName: 'Main shop',
    });
  });

  it('does not fabricate a buyer name when none exists', () => {
    const request = mapWkOrderToAccuraInvoiceRequest(
      snapshot({
        buyer: {
          firstName: null,
          lastName: null,
          email: null,
          phone: '+63917',
        },
        deliveryAddress: null,
      }),
      { branchId: 'b', seriesId: 's', externalClientReference: 'merchant-11' },
    );
    expect(request.buyer).toEqual({ phone: '+63917' });
    expect(request.buyer?.name).toBeUndefined();
  });

  it('allows paid orders and completed cash orders, but not unpaid pending orders', () => {
    expect(
      isWkOrderEligibleForAccuraInvoice({
        paymentStatus: 'paid',
        paymentMethod: 'qrph',
        status: 'pending',
      }),
    ).toBe(true);
    expect(
      isWkOrderEligibleForAccuraInvoice({
        paymentStatus: 'pending',
        paymentMethod: 'cod',
        status: 'completed',
      }),
    ).toBe(true);
    expect(
      isWkOrderEligibleForAccuraInvoice({
        paymentStatus: 'pending',
        paymentMethod: 'qrph',
        status: 'pending',
      }),
    ).toBe(false);
  });

  it('resolves merchant-owned ACCURA branches and rejects cross-merchant mapping', () => {
    expect(resolveAccuraIssuanceTargets(snapshot())).toEqual({
      ok: true,
      merchantId: 11,
      externalClientReference: 'merchant-11',
      branchId: 'accura-branch',
    });
    expect(
      resolveAccuraIssuanceTargets(
        snapshot({
          shop: {
            id: 7,
            name: 'Main shop',
            merchantId: 11,
            accuraBranchMapping: null,
          },
        }),
      ).ok,
    ).toBe(false);
    expect(
      resolveAccuraIssuanceTargets(
        snapshot({
          merchantId: 11,
          shop: {
            id: 9,
            name: 'Other',
            merchantId: 22,
            accuraBranchMapping: {
              merchantId: 22,
              accuraBranchId: 'branch-b',
            },
          },
        }),
      ).ok,
    ).toBe(false);
    expect(
      resolveAccuraIssuanceTargets(
        snapshot({
          shop: {
            id: 7,
            name: 'Main shop',
            merchantId: 11,
            accuraBranchMapping: {
              merchantId: 22,
              accuraBranchId: 'branch-b',
            },
          },
        }),
      ).ok,
    ).toBe(false);
  });
});
