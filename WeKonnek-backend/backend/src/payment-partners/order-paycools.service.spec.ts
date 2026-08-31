/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CommerceDomain,
  PlatformPaymentDestination,
  PlatformPaymentSourceType,
  PlatformPaymentStatus,
} from '@prisma/client';
import { OrderPayCoolsService } from './order-paycools.service';
import { CUSTOMER_ORDER_PAYMENT_PURPOSE } from './paycools-order-source';
import { PaymentLifecycleService } from './payment-lifecycle.service';
import type { VerifiedWebhookPayment } from './payment-provider';

jest.mock('qrcode', () => ({
  toDataURL: jest.fn(async (value: string) => `data:image/png;base64,${value}`),
}));

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER = '22222222-2222-2222-2222-222222222222';
const PAYMENT_ID = '44444444-4444-4444-4444-444444444444';
const REFERENCE = 'WK260830ORDER0000001';

function paidCallback(
  overrides: Partial<VerifiedWebhookPayment> = {},
): VerifiedWebhookPayment {
  return {
    reference: REFERENCE,
    providerTransactionId: 'pc-txn-1',
    amountMinor: 12500,
    currency: 'PHP',
    status: 'PAID',
    eventName: 'qrcode.payment.success',
    ...overrides,
  };
}

function createStore(
  initial: {
    orderType?: string;
    commerceDomain?: CommerceDomain;
    paymentStatus?: string;
    orderStatus?: string;
    paymentMethod?: string;
    userId?: string;
    totalAmount?: number;
    emptyOrder?: boolean;
    paymentTxnStatus?: PlatformPaymentStatus;
    operational?: boolean;
    existingActive?: boolean;
    expiresAt?: string | null;
  } = {},
) {
  const order = {
    id: 88,
    orderCode: 'WK-ORDER-88',
    userId: initial.userId ?? USER_ID,
    merchantId: 9,
    status: initial.orderStatus ?? 'pending',
    orderType: initial.orderType ?? 'delivery',
    totalAmount: initial.totalAmount ?? 125,
    paymentMethod: initial.paymentMethod ?? 'qrph',
    paymentStatus: initial.paymentStatus ?? 'pending',
    merchant: {
      id: 9,
      commerceDomain: initial.commerceDomain ?? CommerceDomain.FOOD,
    },
    orderItems: initial.emptyOrder ? [] : [{ id: 1 }],
  };
  const payment = {
    id: PAYMENT_ID,
    reference: REFERENCE,
    provider: 'PAYCOOLS',
    providerTransactionId: null as string | null,
    destination: PlatformPaymentDestination.MERCHANT_ACCOUNT,
    sourceType: PlatformPaymentSourceType.RESTAURANT_ORDER,
    sourceId: '88',
    merchantId: 9,
    payerUserId: USER_ID,
    amount: 125,
    providerAmountMinor: 12500,
    currency: 'PHP',
    status: initial.paymentTxnStatus ?? PlatformPaymentStatus.PENDING,
    metadata: {
      purpose: CUSTOMER_ORDER_PAYMENT_PURPOSE,
      orderId: 88,
      orderCode: 'WK-ORDER-88',
      orderType: order.orderType,
      customerUserId: USER_ID,
      merchantId: 9,
      qrData: '000201QRPH',
      qrLink: 'https://paycools.test/pay',
      expiresAt:
        initial.expiresAt ?? new Date(Date.now() + 600_000).toISOString(),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    paidAt: null as Date | null,
  };
  const payments = initial.existingActive ? [{ ...payment }] : [];

  let claimChain = Promise.resolve();
  const serialize = <T>(fn: () => T | Promise<T>) => {
    const next = claimChain.then(fn, fn);
    claimChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const lifecycleEvents: Array<Record<string, unknown>> = [];
  const tx = {
    platformPaymentTransaction: {
      updateMany: jest.fn(async ({ where, data }: any) =>
        serialize(() => {
          const statusOk = !where.status || payment.status === where.status;
          const providerOk =
            !where.provider || payment.provider === where.provider;
          const idOk = !where.id || payment.id === where.id;
          if (!statusOk || !providerOk || !idOk) return { count: 0 };
          Object.assign(payment, data);
          return { count: 1 };
        }),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id && where.id !== payment.id) return null;
        if (where.reference && where.reference !== payment.reference)
          return null;
        return { ...payment };
      }),
      findUniqueOrThrow: jest.fn(async () => ({ ...payment })),
    },
    platformPaymentLifecycleEvent: {
      create: jest.fn(async ({ data }: any) => {
        lifecycleEvents.push(data);
        return data;
      }),
    },
  };

  const prisma = {
    merchant: {
      findUnique: jest.fn(async () => ({
        commerceDomain: order.merchant.commerceDomain,
      })),
    },
    wkOrder: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === order.id ? { ...order } : null,
      ),
      update: jest.fn(async ({ data }: any) => Object.assign(order, data)),
    },
    user: {
      findUnique: jest.fn(async () => ({
        firstName: 'Ana',
        lastName: 'Cruz',
        email: 'ana@example.test',
      })),
    },
    platformPaymentTransaction: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id && where.id !== payment.id) return null;
        if (where.reference && where.reference !== payment.reference)
          return null;
        return { ...payment };
      }),
      findUniqueOrThrow: jest.fn(async () => ({ ...payment })),
      findMany: jest.fn(async () => payments.map((row) => ({ ...row }))),
      update: jest.fn(async ({ data }: any) => Object.assign(payment, data)),
      updateMany: tx.platformPaymentTransaction.updateMany,
    },
    platformPaymentLifecycleEvent: {
      create: jest.fn(async ({ data }: any) => {
        lifecycleEvents.push(data);
        return data;
      }),
      findMany: jest.fn(async () => lifecycleEvents),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(tx);
    }),
  };

  const platformPayments = {
    createPending: jest.fn(async (input: any) => {
      Object.assign(payment, {
        sourceType: input.sourceType,
        amount: input.amount,
        providerAmountMinor: Math.round(input.amount * 100),
        metadata: input.metadata,
      });
      payments.push(payment);
      return { ...payment };
    }),
    attachProviderIdentifiers: jest.fn(async () => ({
      ...payment,
      providerQrCodeId: 'qr-1',
    })),
  };
  const paymentPartners = {
    isSourceOperational: jest.fn(async () => initial.operational !== false),
    getActiveProvider: jest.fn(async () => {
      if (initial.operational === false) {
        throw new BadRequestException(
          'This payment method is currently unavailable',
        );
      }
      return { providerCode: 'PAYCOOLS', defaultQrExpirySeconds: 600 };
    }),
    paymentCallbackUrl: jest.fn(
      () => 'https://api.example.test/api/payments/callbacks/paycools/payment',
    ),
  };
  const paycools = {
    createPayment: jest.fn(async () => ({
      providerQrCodeId: 'qr-1',
      paymentUrl: 'https://paycools.test/pay',
      qrData: '000201QRPH',
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 600_000),
    })),
    verifyWebhook: jest.fn(),
  };
  const orders = {
    markPaidByGateway: jest.fn(async () => undefined),
    cancelUnpaidQrphOrder: jest.fn(async () => undefined),
    notifyMerchantPaidQrphOrder: jest.fn(async () => undefined),
  };
  const dineInSync = { recordOrder: jest.fn(async () => undefined) };
  const lifecycle = new PaymentLifecycleService(prisma as never);

  const service = new OrderPayCoolsService(
    prisma as never,
    orders as never,
    dineInSync as never,
    platformPayments as never,
    lifecycle,
    paymentPartners as never,
    paycools as never,
  );

  return {
    service,
    prisma,
    platformPayments,
    paymentPartners,
    paycools,
    orders,
    dineInSync,
    lifecycle,
    lifecycleEvents,
    order,
    payment,
    payments,
  };
}

describe('OrderPayCoolsService', () => {
  it('hides PayCools when the provider is unavailable', async () => {
    const { service } = createStore({ operational: false });
    await expect(
      service.getAvailability({ merchantId: 9, orderType: 'delivery' }),
    ).resolves.toMatchObject({ available: false, method: null });
  });

  it('shows PayCools when the restaurant source is operational', async () => {
    const { service, paymentPartners } = createStore({
      commerceDomain: CommerceDomain.FOOD,
    });
    await expect(
      service.getAvailability({ merchantId: 9, orderType: 'delivery' }),
    ).resolves.toMatchObject({
      available: true,
      method: 'qrph',
      sourceType: PlatformPaymentSourceType.RESTAURANT_ORDER,
    });
    expect(paymentPartners.isSourceOperational).toHaveBeenCalledWith(
      PlatformPaymentSourceType.RESTAURANT_ORDER,
    );
  });

  it('creates a restaurant PayCools payment from the stored order amount', async () => {
    const { service, paycools, platformPayments, order } = createStore({
      orderType: 'delivery',
      commerceDomain: CommerceDomain.FOOD,
      totalAmount: 188.5,
    });
    const created = await service.createForOrder(88, USER_ID);
    expect(platformPayments.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: PlatformPaymentSourceType.RESTAURANT_ORDER,
        amount: 188.5,
        sourceId: '88',
        payerUserId: USER_ID,
      }),
    );
    expect(paycools.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 18850,
        customerName: 'Ana Cruz',
        email: 'ana@example.test',
      }),
    );
    expect(created.status).toBe(PlatformPaymentStatus.PENDING);
    expect(created.qrcodeContent).toBe('000201QRPH');
    expect(created.qrImageDataUrl).toContain('000201QRPH');
    expect(order.paymentMethod).toBe('qrph');
  });

  it('creates a retail PayCools payment', async () => {
    const { service, platformPayments } = createStore({
      orderType: 'delivery',
      commerceDomain: CommerceDomain.NON_FOOD,
    });
    await service.createForOrder(88, USER_ID);
    expect(platformPayments.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: PlatformPaymentSourceType.RETAIL_ORDER,
      }),
    );
  });

  it('creates a pickup/take-out PayCools payment', async () => {
    const { service, platformPayments } = createStore({
      orderType: 'pickup',
      commerceDomain: CommerceDomain.FOOD,
    });
    await service.createForOrder(88, USER_ID);
    expect(platformPayments.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: PlatformPaymentSourceType.TAKE_OUT,
      }),
    );
  });

  it('creates a dine-in bill-out PayCools payment only after bill-out is confirmed', async () => {
    const { service, dineInSync } = createStore({
      orderType: 'dine_in',
      orderStatus: 'ready',
    });
    await expect(service.createForOrder(88, USER_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const ready = createStore({
      orderType: 'dine_in',
      orderStatus: 'payment_pending',
      paymentMethod: 'pending_selection',
    });
    await ready.service.createForOrder(88, USER_ID);
    expect(ready.dineInSync.recordOrder).toHaveBeenCalledWith(
      88,
      'PAYMENT_METHOD_SELECTED',
    );
    expect(dineInSync.recordOrder).not.toHaveBeenCalled();
  });

  it('rejects creation when the caller does not own the order', async () => {
    const { service, paycools } = createStore();
    await expect(service.createForOrder(88, OTHER_USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(paycools.createPayment).not.toHaveBeenCalled();
  });

  it('rejects already-paid and terminal orders', async () => {
    await expect(
      createStore({ paymentStatus: 'paid' }).service.createForOrder(
        88,
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      createStore({ orderStatus: 'cancelled' }).service.createForOrder(
        88,
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      createStore({ orderStatus: 'completed' }).service.createForOrder(
        88,
        USER_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects zero-total and empty orders before calling PayCools', async () => {
    const zero = createStore({ totalAmount: 0 });
    await expect(zero.service.createForOrder(88, USER_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(zero.paycools.createPayment).not.toHaveBeenCalled();

    const empty = createStore({ emptyOrder: true });
    await expect(empty.service.createForOrder(88, USER_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(empty.paycools.createPayment).not.toHaveBeenCalled();
  });

  it('records QR generation failure against the same canonical payment', async () => {
    const { service, paycools, payment, lifecycleEvents, platformPayments } = createStore();
    paycools.createPayment.mockRejectedValue(new Error('provider unavailable'));
    await expect(service.createForOrder(88, USER_ID)).rejects.toThrow('provider unavailable');
    expect(payment.status).toBe(PlatformPaymentStatus.FAILED);
    expect(platformPayments.createPending).toHaveBeenCalledTimes(1);
    expect(lifecycleEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'QR_GENERATION_FAILED', resultingStatus: PlatformPaymentStatus.FAILED }),
    ]));
  });

  it('rejects a second active PayCools initiation for the same order', async () => {
    const { service, paycools } = createStore({ existingActive: true });
    await expect(service.createForOrder(88, USER_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(paycools.createPayment).not.toHaveBeenCalled();
  });

  it('does not start PayCools for RFQ pending_selection orders', async () => {
    const { service, paycools } = createStore({
      paymentMethod: 'pending_selection',
      orderType: 'delivery',
    });
    await expect(service.createForOrder(88, USER_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(paycools.createPayment).not.toHaveBeenCalled();
  });

  it('settles a valid signed-equivalent PAID callback once', async () => {
    const { service, orders, payment } = createStore();
    const result = await service.settleVerified(paidCallback());
    expect(result).toEqual({ accepted: true, duplicate: false, settled: true });
    expect(payment.status).toBe(PlatformPaymentStatus.PAID);
    expect(orders.markPaidByGateway).toHaveBeenCalledWith('88', 'completed');
  });

  it('does not settle a duplicate PAID callback a second time', async () => {
    const { service, orders } = createStore();
    await service.settleVerified(paidCallback());
    const duplicate = await service.settleVerified(paidCallback());
    expect(duplicate).toEqual({
      accepted: true,
      duplicate: true,
      settled: false,
    });
    expect(orders.markPaidByGateway).toHaveBeenCalledTimes(1);
  });

  it('rejects amount and currency mismatches without settling', async () => {
    const { service, orders, payment } = createStore();
    await expect(
      service.settleVerified(paidCallback({ amountMinor: 1 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.settleVerified(paidCallback({ currency: 'USD' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(orders.markPaidByGateway).not.toHaveBeenCalled();
    expect(payment.status).toBe(PlatformPaymentStatus.PENDING);
  });

  it('marks the payment failed without settling the order', async () => {
    const { service, orders, payment } = createStore();
    const result = await service.settleVerified(
      paidCallback({ status: 'FAILED', eventName: 'qrcode.payment.failed' }),
    );
    expect(result.settled).toBe(false);
    expect(payment.status).toBe(PlatformPaymentStatus.FAILED);
    expect(orders.markPaidByGateway).not.toHaveBeenCalled();
  });

  it('does not settle when the browser only polls payment status', async () => {
    const { service, orders, prisma } = createStore({ existingActive: true });
    const dto = await service.getForOrder(88, USER_ID);
    expect(dto.status).toBe(PlatformPaymentStatus.PENDING);
    expect(dto.qrImageDataUrl).toBeTruthy();
    expect(orders.markPaidByGateway).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns EXPIRED from polling without settling', async () => {
    const { service, orders, payment, lifecycleEvents } = createStore({
      existingActive: true,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await expect(service.getForOrder(88, USER_ID)).resolves.toMatchObject({
      status: 'EXPIRED',
    });
    expect(payment.status).toBe(PlatformPaymentStatus.EXPIRED);
    expect(orders.cancelUnpaidQrphOrder).toHaveBeenCalledWith(88);
    expect(orders.markPaidByGateway).not.toHaveBeenCalled();
    expect(lifecycleEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: 'PAYMENT_EXPIRED' }),
      ]),
    );
  });

  it('cancels an unpaid QRPH payment and releases the order', async () => {
    const { service, orders, payment, lifecycleEvents } = createStore({
      existingActive: true,
    });
    await expect(service.cancelForOrder(88, USER_ID)).resolves.toMatchObject({
      paymentId: PAYMENT_ID,
    });
    expect(payment.status).toBe(PlatformPaymentStatus.CANCELLED);
    expect(orders.cancelUnpaidQrphOrder).toHaveBeenCalledWith(88);
    expect(lifecycleEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['CANCELLATION_REQUESTED', 'PAYMENT_CANCELLED']),
    );
  });

  it('rejects customer cancellation after the payment is paid or expired', async () => {
    const paid = createStore({
      existingActive: true,
      paymentTxnStatus: PlatformPaymentStatus.PAID,
    });
    await expect(
      paid.service.cancelForOrder(88, USER_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(paid.orders.cancelUnpaidQrphOrder).not.toHaveBeenCalled();
    expect(paid.lifecycleEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'CANCELLATION_REQUESTED',
        'CANCELLATION_REJECTED_ALREADY_PAID',
      ]),
    );

    const expired = createStore({
      existingActive: true,
      paymentTxnStatus: PlatformPaymentStatus.EXPIRED,
    });
    await expect(
      expired.service.cancelForOrder(88, USER_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(expired.orders.cancelUnpaidQrphOrder).not.toHaveBeenCalled();
  });

  it('does not settle a late verified success after cancel or expire', async () => {
    const cancelled = createStore({
      existingActive: true,
      paymentTxnStatus: PlatformPaymentStatus.CANCELLED,
    });
    await expect(
      cancelled.service.settleVerified(paidCallback()),
    ).resolves.toEqual({
      accepted: true,
      duplicate: false,
      settled: false,
      reconciliationRequired: true,
    });
    expect(cancelled.orders.markPaidByGateway).not.toHaveBeenCalled();
    expect(cancelled.payment.status).toBe(PlatformPaymentStatus.CANCELLED);

    const expired = createStore({
      existingActive: true,
      paymentTxnStatus: PlatformPaymentStatus.EXPIRED,
    });
    await expect(
      expired.service.settleVerified(paidCallback()),
    ).resolves.toEqual({
      accepted: true,
      duplicate: false,
      settled: false,
      reconciliationRequired: true,
    });
    expect(expired.orders.markPaidByGateway).not.toHaveBeenCalled();
    expect(expired.payment.status).toBe(PlatformPaymentStatus.EXPIRED);
  });

  it('notifies the merchant only after a verified QRPH settlement', async () => {
    const { service, orders } = createStore();
    await service.settleVerified(paidCallback());
    expect(orders.markPaidByGateway).toHaveBeenCalledWith('88', 'completed');
    expect(orders.notifyMerchantPaidQrphOrder).toHaveBeenCalledWith(88);
  });
});

describe('legacy gateway regressions', () => {
  const paymentGateway = {
    createPayment: jest.fn(async () => ({
      gatewayTransactionId: 'legacy-1',
      paymentUrl: 'https://example.invalid/pay',
    })),
  };

  it('keeps GCash, Maya, Card, and COD outside PayCools', () => {
    expect(['gcash', 'maya', 'card', 'cod']).not.toContain('qrph');
    expect(paymentGateway.createPayment).not.toHaveBeenCalled();
  });

  it('rejects invalid PayCools callback signatures before order settlement', async () => {
    const { service, orders, paycools } = createStore();
    paycools.verifyWebhook.mockRejectedValue(
      new UnauthorizedException('Invalid PayCools callback signature'),
    );
    await expect(
      paycools.verifyWebhook({ sign: 'bad' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(orders.markPaidByGateway).not.toHaveBeenCalled();
    expect(service).toBeDefined();
  });
});
