import { ConflictException, Injectable } from '@nestjs/common';
import { PlatformPaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const PaymentLifecycleEvent = {
  INITIATED: 'PAYMENT_INITIATED',
  QR_GENERATED: 'QR_GENERATED',
  EXPIRED: 'PAYMENT_EXPIRED',
  CANCELLATION_REQUESTED: 'CANCELLATION_REQUESTED',
  CANCELLED: 'PAYMENT_CANCELLED',
  CANCELLATION_REJECTED_PAID: 'CANCELLATION_REJECTED_ALREADY_PAID',
  CALLBACK_RECEIVED: 'CALLBACK_RECEIVED',
  CALLBACK_VERIFIED: 'CALLBACK_VERIFIED',
  SETTLED: 'PAYMENT_SETTLED',
  DUPLICATE: 'DUPLICATE_CALLBACK_IGNORED',
  LATE_SUCCESS: 'LATE_PROVIDER_SUCCESS_AFTER_CANCEL',
} as const;

type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class PaymentLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async event(
    db: Db,
    payment: {
      id: string;
      provider: string;
      sourceId: string | null;
      merchantId: number | null;
      payerUserId: string | null;
      status: PlatformPaymentStatus;
    },
    input: {
      eventType: string;
      actorType: 'CUSTOMER' | 'SYSTEM' | 'PAYMENT_PROVIDER' | 'ADMIN';
      actorId?: string | null;
      previousStatus?: PlatformPaymentStatus | null;
      resultingStatus?: PlatformPaymentStatus | null;
      safeMessage?: string | null;
    },
  ) {
    await db.platformPaymentLifecycleEvent.create({
      data: {
        platformPaymentTransactionId: payment.id,
        wkOrderId: payment.sourceId ? Number(payment.sourceId) || null : null,
        merchantId: payment.merchantId,
        customerId: payment.payerUserId,
        provider: payment.provider,
        environment: process.env.NODE_ENV || 'unknown',
        eventType: input.eventType,
        actorType: input.actorType,
        actorId: input.actorId || null,
        previousStatus: input.previousStatus ?? null,
        resultingStatus: input.resultingStatus ?? null,
        safeMessage: input.safeMessage || null,
      },
    });
  }

  async transition(
    id: string,
    target: PlatformPaymentStatus,
    input: {
      eventType: string;
      actorType: 'CUSTOMER' | 'SYSTEM' | 'PAYMENT_PROVIDER';
      actorId?: string | null;
      safeMessage?: string | null;
      providerTransactionId?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.platformPaymentTransaction.findUniqueOrThrow({
        where: { id },
      });
      const updated = await tx.platformPaymentTransaction.updateMany({
        where: { id, status: PlatformPaymentStatus.PENDING },
        data: {
          status: target,
          ...(target === PlatformPaymentStatus.PAID
            ? {
                paidAt: new Date(),
                providerTransactionId: input.providerTransactionId,
              }
            : {}),
        },
      });
      const current =
        updated.count === 1
          ? { ...payment, status: target }
          : await tx.platformPaymentTransaction.findUniqueOrThrow({
              where: { id },
            });
      if (updated.count === 1)
        await this.event(tx, current, {
          eventType: input.eventType,
          actorType: input.actorType,
          actorId: input.actorId,
          previousStatus: PlatformPaymentStatus.PENDING,
          resultingStatus: target,
          safeMessage: input.safeMessage,
        });
      return { transitioned: updated.count === 1, payment: current };
    });
  }

  async adminHistory(filter: { orderId?: number; paymentId?: string }) {
    return this.prisma.platformPaymentLifecycleEvent.findMany({
      where: {
        ...(filter.orderId ? { wkOrderId: filter.orderId } : {}),
        ...(filter.paymentId
          ? { platformPaymentTransactionId: filter.paymentId }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        platformPaymentTransactionId: true,
        wkOrderId: true,
        merchantId: true,
        customerId: true,
        provider: true,
        environment: true,
        eventType: true,
        actorType: true,
        actorId: true,
        previousStatus: true,
        resultingStatus: true,
        safeMessage: true,
        createdAt: true,
      },
    });
  }

  assertNotPaid(status: PlatformPaymentStatus) {
    if (status === PlatformPaymentStatus.PAID)
      throw new ConflictException(
        'Payment has already been confirmed and can no longer be cancelled.',
      );
  }
}
