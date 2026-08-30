/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { BadRequestException } from '@nestjs/common';
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
});
