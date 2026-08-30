/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';

function createOrdersService() {
  const order = {
    id: 10,
    userId: 'user-1',
    orderType: 'dine_in',
    status: 'payment_pending',
    paymentMethod: 'pending_selection',
    paymentStatus: 'pending',
    totalAmount: 250,
    orderCode: 'WK-REG-10',
  };
  const prisma = {
    wkOrder: {
      findUnique: jest.fn(async () => ({ ...order })),
      update: jest.fn(async ({ data }: any) => ({ ...order, ...data })),
    },
  };
  const paymentGateway = {
    createPayment: jest.fn(async () => ({
      gatewayTransactionId: 'gw-1',
      paymentUrl: 'https://example.invalid/pay',
    })),
  };
  const dineInSync = { recordOrder: jest.fn(async () => undefined) };
  const service = new OrdersService(
    prisma as never,
    paymentGateway as never,
    { notify: jest.fn() } as never,
    {} as never,
    {} as never,
    dineInSync as never,
    {} as never,
    { ensureForWkOrder: jest.fn() } as never,
  );
  return { service, paymentGateway, order, dineInSync };
}

describe('OrdersService existing payment regressions', () => {
  it('starts GCash bill-out through PaymentGatewayService, not PayCools', async () => {
    const { service, paymentGateway } = createOrdersService();
    await service.checkoutPayment(10, 'user-1', 'gcash');
    expect(paymentGateway.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: 'gcash' }),
    );
  });

  it('starts Maya bill-out through PaymentGatewayService', async () => {
    const { service, paymentGateway } = createOrdersService();
    await service.checkoutPayment(10, 'user-1', 'maya');
    expect(paymentGateway.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ gateway: 'maya' }),
    );
  });

  it('starts card bill-out through PaymentGatewayService', async () => {
    const { service, paymentGateway } = createOrdersService();
    await service.checkoutPayment(10, 'user-1', 'card');
    expect(paymentGateway.createPayment).toHaveBeenCalled();
  });

  it('keeps manual/COD dine-in payment as cash without a gateway', async () => {
    const { service, paymentGateway } = createOrdersService();
    const updated = await service.checkoutPayment(10, 'user-1', 'manual');
    expect(paymentGateway.createPayment).not.toHaveBeenCalled();
    expect(updated.payment_method).toBe('cash');
  });

  it('preserves dine-in eligibility and RFQ payment-selection rules', async () => {
    const dineIn = createOrdersService();
    dineIn.order.status = 'ready';
    await expect(
      dineIn.service.checkoutPayment(10, 'user-1', 'gcash'),
    ).rejects.toBeInstanceOf(BadRequestException);

    const rfq = createOrdersService();
    rfq.order.orderType = 'delivery';
    rfq.order.status = 'pending';
    rfq.order.paymentMethod = 'pending_selection';
    await rfq.service.selectPaymentMethod(10, 'user-1', 'gcash');
    expect(rfq.paymentGateway.createPayment).toHaveBeenCalled();
    await expect(
      rfq.service.selectPaymentMethod(10, 'user-1', 'qrph' as 'gcash'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not notify the merchant when an unpaid QRPH order is created', async () => {
    const notifications = { notify: jest.fn() };
    const dineInSync = { recordOrder: jest.fn(async () => undefined) };
    const trustTrade = { ensureForWkOrder: jest.fn(async () => undefined) };
    const service = new OrdersService(
      {} as never,
      {} as never,
      notifications as never,
      {} as never,
      {} as never,
      dineInSync as never,
      {} as never,
      trustTrade as never,
    );
    await service.runOrderCreatedPostCommitEffects({
      id: 10,
      orderCode: 'WK-QRPH-10',
      orderType: 'delivery',
      paymentMethod: 'qrph',
      totalAmount: { toString: () => '125' },
      shopId: 1,
      merchant: { userId: 'merchant-1' },
      orderItems: [{ quantity: 2 }],
    });
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(dineInSync.recordOrder).toHaveBeenCalledWith(10, 'ORDER_CREATED');
  });

  it('blocks merchant processing of an unpaid QRPH order', async () => {
    const order = {
      id: 10,
      userId: 'user-1',
      merchantId: 9,
      shopId: null,
      orderType: 'delivery',
      status: 'pending',
      paymentMethod: 'qrph',
      paymentStatus: 'pending',
      orderCode: 'WK-QRPH-10',
      orderItems: [],
    };
    const prisma = {
      wkOrder: {
        findUnique: jest.fn(async () => ({ ...order })),
        update: jest.fn(),
      },
      merchant: {
        findFirst: jest.fn(async () => ({ id: 9 })),
      },
    };
    const service = new OrdersService(
      prisma as never,
      { createPayment: jest.fn() } as never,
      { notify: jest.fn() } as never,
      {} as never,
      {} as never,
      { recordOrder: jest.fn() } as never,
      {} as never,
      { ensureForWkOrder: jest.fn() } as never,
    );
    await expect(
      service.updateStatus(10, 'accepted', {
        id: 'merchant-1',
        role: 'merchant',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.wkOrder.update).not.toHaveBeenCalled();
  });

  it('cancels an unpaid QRPH order only once', async () => {
    const order = {
      id: 10,
      status: 'pending',
      paymentMethod: 'qrph',
      paymentStatus: 'pending',
      orderItems: [],
      shopId: null,
      orderType: 'delivery',
      orderCode: 'WK-QRPH-10',
      userId: 'user-1',
    };
    const prisma = {
      wkOrder: {
        findUnique: jest.fn(async () => ({ ...order })),
        update: jest.fn(async ({ data }: any) => {
          Object.assign(order, data);
          return { ...order, merchant: { category: null } };
        }),
        findMany: jest.fn(async () => []),
      },
    };
    const service = new OrdersService(
      prisma as never,
      {} as never,
      { notify: jest.fn(async () => undefined) } as never,
      {} as never,
      {} as never,
      { recordOrder: jest.fn() } as never,
      { creditOrderCommission: jest.fn() } as never,
      { ensureForWkOrder: jest.fn() } as never,
    );
    await service.cancelUnpaidQrphOrder(10);
    expect(order.status).toBe('cancelled');
    await service.cancelUnpaidQrphOrder(10);
    expect(prisma.wkOrder.update).toHaveBeenCalledTimes(1);
  });
});
