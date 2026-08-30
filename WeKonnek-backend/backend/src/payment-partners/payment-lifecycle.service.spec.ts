/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { PlatformPaymentStatus } from '@prisma/client';
import {
  PaymentLifecycleEvent,
  PaymentLifecycleService,
} from './payment-lifecycle.service';

function createLifecycle() {
  const payment = {
    id: 'pay-1',
    provider: 'PAYCOOLS',
    sourceId: '88',
    merchantId: 9,
    payerUserId: '11111111-1111-1111-1111-111111111111',
    status: PlatformPaymentStatus.PENDING,
    providerTransactionId: null as string | null,
    paidAt: null as Date | null,
  };
  const events: Array<Record<string, unknown>> = [];
  const tx = {
    platformPaymentTransaction: {
      findUniqueOrThrow: jest.fn(async () => ({ ...payment })),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.status && payment.status !== where.status)
          return { count: 0 };
        Object.assign(payment, data);
        return { count: 1 };
      }),
    },
    platformPaymentLifecycleEvent: {
      create: jest.fn(async ({ data }: any) => {
        events.push(data);
        return data;
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(tx)),
    platformPaymentLifecycleEvent: {
      create: jest.fn(async ({ data }: any) => {
        events.push(data);
        return data;
      }),
      findMany: jest.fn(async () => events),
    },
  };
  return {
    service: new PaymentLifecycleService(prisma as never),
    payment,
    events,
    tx,
    prisma,
  };
}

describe('PaymentLifecycleService', () => {
  it('records a lifecycle event without changing payment status', async () => {
    const { service, payment, events, prisma } = createLifecycle();
    await service.event(prisma as never, payment, {
      eventType: PaymentLifecycleEvent.INITIATED,
      actorType: 'CUSTOMER',
      actorId: payment.payerUserId,
      resultingStatus: PlatformPaymentStatus.PENDING,
      safeMessage: 'QRPH payment initiated',
    });
    expect(events).toEqual([
      expect.objectContaining({
        platformPaymentTransactionId: 'pay-1',
        wkOrderId: 88,
        eventType: PaymentLifecycleEvent.INITIATED,
        actorType: 'CUSTOMER',
        resultingStatus: PlatformPaymentStatus.PENDING,
      }),
    ]);
    expect(payment.status).toBe(PlatformPaymentStatus.PENDING);
  });

  it('transitions PENDING to EXPIRED once and writes the event', async () => {
    const { service, payment, events } = createLifecycle();
    const first = await service.transition(
      payment.id,
      PlatformPaymentStatus.EXPIRED,
      {
        eventType: PaymentLifecycleEvent.EXPIRED,
        actorType: 'SYSTEM',
        safeMessage: 'QR payment expired',
      },
    );
    expect(first.transitioned).toBe(true);
    expect(payment.status).toBe(PlatformPaymentStatus.EXPIRED);
    expect(events).toEqual([
      expect.objectContaining({
        eventType: PaymentLifecycleEvent.EXPIRED,
        previousStatus: PlatformPaymentStatus.PENDING,
        resultingStatus: PlatformPaymentStatus.EXPIRED,
      }),
    ]);
    const second = await service.transition(
      payment.id,
      PlatformPaymentStatus.EXPIRED,
      {
        eventType: PaymentLifecycleEvent.EXPIRED,
        actorType: 'SYSTEM',
      },
    );
    expect(second.transitioned).toBe(false);
    expect(events).toHaveLength(1);
  });

  it('does not transition a non-PENDING payment to CANCELLED or PAID', async () => {
    const cancelled = createLifecycle();
    cancelled.payment.status = PlatformPaymentStatus.CANCELLED;
    const cancelResult = await cancelled.service.transition(
      cancelled.payment.id,
      PlatformPaymentStatus.CANCELLED,
      {
        eventType: PaymentLifecycleEvent.CANCELLED,
        actorType: 'CUSTOMER',
      },
    );
    expect(cancelResult.transitioned).toBe(false);
    expect(cancelled.events).toHaveLength(0);

    const paid = createLifecycle();
    paid.payment.status = PlatformPaymentStatus.PAID;
    const paidResult = await paid.service.transition(
      paid.payment.id,
      PlatformPaymentStatus.PAID,
      {
        eventType: PaymentLifecycleEvent.SETTLED,
        actorType: 'PAYMENT_PROVIDER',
        providerTransactionId: 'pc-1',
      },
    );
    expect(paidResult.transitioned).toBe(false);
    expect(paid.payment.providerTransactionId).toBeNull();
  });

  it('returns admin history without secrets', async () => {
    const { service, prisma } = createLifecycle();
    await service.adminHistory({ orderId: 88, paymentId: 'pay-1' });
    expect(prisma.platformPaymentLifecycleEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { wkOrderId: 88, platformPaymentTransactionId: 'pay-1' },
        select: expect.not.objectContaining({
          metadata: true,
          encryptedCallbackSecret: true,
        }),
      }),
    );
  });
});
