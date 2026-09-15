import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  PlatformPaymentDestination,
  PlatformPaymentStatus,
} from '@prisma/client';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { DineInSyncService } from '../dine-in-crew/dine-in-sync.service';
import { moneyNumber } from '../modules/wallet/wallet-money';
import { PaymentPartnerConfigService } from './payment-partner-config.service';
import { PayCoolsProvider } from './paycools.provider';
import { PlatformPaymentService } from './platform-payment.service';
import {
  PaymentLifecycleEvent,
  PaymentLifecycleService,
} from './payment-lifecycle.service';
import {
  CUSTOMER_ORDER_PAYMENT_PURPOSE,
  isCustomerOrderPayCoolsMetadata,
  resolvePayCoolsOrderSourceType,
} from './paycools-order-source';
import type { VerifiedWebhookPayment } from './payment-provider';
import { PaymentRoutingService } from '../payment-ownership/payment-routing.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';

const TERMINAL_ORDER_STATUSES = ['cancelled', 'completed', 'delivered'];

export type PayCoolsCustomerStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';

export type PayCoolsOrderPaymentDto = {
  paymentId: string;
  reference: string;
  amount: number;
  currency: string;
  status: PayCoolsCustomerStatus;
  qrcodeContent: string | null;
  qrLink: string | null;
  qrImageDataUrl: string | null;
  expiresAt: string | null;
  createdAt: Date;
  paidAt: Date | null;
};

@Injectable()
export class OrderPayCoolsService {
  private readonly logger = new Logger(OrderPayCoolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly dineInSync: DineInSyncService,
    private readonly platformPayments: PlatformPaymentService,
    private readonly lifecycle: PaymentLifecycleService,
    private readonly paymentPartners: PaymentPartnerConfigService,
    private readonly paycools: PayCoolsProvider,
    private readonly paymentRouting: PaymentRoutingService,
    private readonly domainEvents: OrderDomainEventService,
  ) {}

  async getAvailability(input: {
    merchantId?: number;
    orderType?: string;
    orderId?: number;
    userId?: string;
  }) {
    if (input.orderId != null) {
      const order = await this.prisma.wkOrder.findUnique({
        where: { id: input.orderId },
        select: { id: true, merchantId: true, userId: true },
      });
      if (order && (!input.userId || order.userId === input.userId)) {
        const decision = this.paymentRouting.decide({
          kind: 'wk_order',
          orderId: order.id,
          merchantId: order.merchantId,
        });
        return {
          available: false,
          method: null,
          label: null,
          description:
            'WeKonnek PayCools is not available for merchant commerce. Use merchant payment options.',
          sourceType: null,
          beneficiary: decision.beneficiary,
          purpose: decision.purpose,
          wekonnekPayCoolsAllowed: false,
        };
      }
    }
    // Without a concrete order, still refuse advertising PayCools for merchant commerce contexts.
    if (input.merchantId != null) {
      const decision = this.paymentRouting.decide({
        kind: 'wk_order',
        orderId: 0,
        merchantId: input.merchantId,
      });
      return {
        available: false,
        method: null,
        label: null,
        description:
          'WeKonnek PayCools is not available for merchant commerce. Use merchant payment options.',
        sourceType: null,
        beneficiary: decision.beneficiary,
        purpose: decision.purpose,
        wekonnekPayCoolsAllowed: false,
      };
    }
    const resolved = await this.resolveSource(input);
    const available = await this.paymentPartners.isSourceOperational(
      resolved.sourceType,
    );
    return {
      available,
      method: available ? 'qrph' : null,
      label: available ? 'Pay with QRPH' : null,
      description: available
        ? 'Scan the QR code using your supported banking or e-wallet app.'
        : null,
      sourceType: resolved.sourceType,
    };
  }

  async createForOrder(orderId: number, userId: string) {
    const order = await this.loadOwnedPayableOrder(orderId, userId);
    // Stage 1A critical guard — derive ownership server-side; never start WeKonnek PayCools for merchant orders.
    try {
      this.paymentRouting.assertWekonnekPayCoolsAllowed({
        kind: 'wk_order',
        orderId: order.id,
        merchantId: order.merchantId,
      });
    } catch (err) {
      await this.domainEvents.record({
        aggregateType: 'WK_ORDER',
        aggregateId: String(order.id),
        wkOrderId: order.id,
        actorId: userId,
        actorType: 'CUSTOMER',
        action: 'FORBIDDEN_MERCHANT_ORDER_PAYCOOLS_ATTEMPT',
        reason: 'WEKONNEK_PAYCOOLS_FORBIDDEN_FOR_MERCHANT_ORDER',
        metadata: {
          merchantId: order.merchantId,
          purpose: 'MERCHANT_ORDER',
        },
      });
      throw err;
    }
    // Unreachable for MERCHANT_ORDER: assert always rejects. Kept as fail-closed belt.
    throw new BadRequestException(
      'WeKonnek PayCools cannot initiate merchant commerce payments',
    );
  }

  async getForOrder(orderId: number, userId: string) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true },
    });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('Order payment not found');
    }
    const payment = await this.findLatestOrderPayment(orderId);
    if (!payment) throw new NotFoundException('Order payment not found');
    if (
      payment.status === PlatformPaymentStatus.PENDING &&
      this.isExpired(payment.metadata)
    ) {
      const expired = await this.lifecycle.transition(
        payment.id,
        PlatformPaymentStatus.EXPIRED,
        {
          eventType: PaymentLifecycleEvent.EXPIRED,
          actorType: 'SYSTEM',
          safeMessage: 'QR payment expired',
        },
      );
      if (expired.transitioned)
        await this.orders.cancelUnpaidQrphOrder(orderId);
    }
    return this.toDto(payment.id);
  }

  async cancelForOrder(orderId: number, userId: string) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: orderId },
    });
    if (!order || order.userId !== userId)
      throw new NotFoundException('Order payment not found');
    const payment = await this.findLatestOrderPayment(orderId);
    if (
      !payment ||
      payment.provider !== 'PAYCOOLS' ||
      !isCustomerOrderPayCoolsMetadata(payment.metadata)
    )
      throw new NotFoundException('Order payment not found');
    await this.lifecycle.event(this.prisma, payment, {
      eventType: PaymentLifecycleEvent.CANCELLATION_REQUESTED,
      actorType: 'CUSTOMER',
      actorId: userId,
      previousStatus: payment.status,
      safeMessage: 'Customer requested cancellation',
    });
    if (payment.status === PlatformPaymentStatus.PAID) {
      await this.lifecycle.event(this.prisma, payment, {
        eventType: PaymentLifecycleEvent.CANCELLATION_REJECTED_PAID,
        actorType: 'SYSTEM',
        previousStatus: payment.status,
        resultingStatus: payment.status,
        safeMessage: 'Payment has already been confirmed',
      });
      throw new ConflictException(
        'Payment has already been confirmed and can no longer be cancelled.',
      );
    }
    if (payment.status === PlatformPaymentStatus.CANCELLED)
      return this.toDto(payment.id);
    if (payment.status === PlatformPaymentStatus.EXPIRED)
      throw new ConflictException(
        'Payment has expired and can no longer be cancelled.',
      );
    const result = await this.lifecycle.transition(
      payment.id,
      PlatformPaymentStatus.CANCELLED,
      {
        eventType: PaymentLifecycleEvent.CANCELLED,
        actorType: 'CUSTOMER',
        actorId: userId,
        safeMessage: 'Customer cancelled unpaid QRPH payment',
      },
    );
    if (result.transitioned) await this.orders.cancelUnpaidQrphOrder(orderId);
    return this.toDto(payment.id);
  }

  async settleVerified(verified: VerifiedWebhookPayment) {
    const payment = await this.prisma.platformPaymentTransaction.findUnique({
      where: { reference: verified.reference },
    });
    if (!payment) {
      this.logger.warn(
        `paycools_order_callback_unknown_reference reference=${verified.reference}`,
      );
      throw new NotFoundException('Unknown PayCools payment reference');
    }
    await this.lifecycle.event(this.prisma, payment, {
      eventType: PaymentLifecycleEvent.CALLBACK_RECEIVED,
      actorType: 'PAYMENT_PROVIDER',
      previousStatus: payment.status,
      safeMessage: 'PayCools callback received',
    });
    if (payment.provider !== 'PAYCOOLS') {
      throw new BadRequestException('Provider mismatch');
    }
    if (payment.destination !== PlatformPaymentDestination.MERCHANT_ACCOUNT) {
      throw new BadRequestException('Payment is not a customer order payment');
    }
    if (!isCustomerOrderPayCoolsMetadata(payment.metadata)) {
      throw new BadRequestException('Payment is not a customer order payment');
    }
    const metadata = payment.metadata as Record<string, unknown>;
    const orderId = Number(metadata.orderId || payment.sourceId);
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Associated order not found');
    if (payment.payerUserId && payment.payerUserId !== order.userId) {
      throw new BadRequestException(
        'Payment customer does not match the order',
      );
    }
    if (payment.merchantId && payment.merchantId !== order.merchantId) {
      throw new BadRequestException(
        'Payment merchant does not match the order',
      );
    }
    if (
      payment.status === PlatformPaymentStatus.FAILED ||
      payment.status === PlatformPaymentStatus.REFUNDED
    ) {
      throw new BadRequestException('Payment is not eligible for settlement');
    }

    if (verified.status === 'PENDING') {
      await this.lifecycle.event(this.prisma, payment, {
        eventType: PaymentLifecycleEvent.CALLBACK_VERIFIED,
        actorType: 'PAYMENT_PROVIDER',
        previousStatus: payment.status,
        resultingStatus: payment.status,
        safeMessage: 'Verified pending callback',
      });
      return { accepted: true, duplicate: false, settled: false };
    }

    if (verified.status === 'FAILED') {
      await this.prisma.platformPaymentTransaction.updateMany({
        where: { id: payment.id, status: PlatformPaymentStatus.PENDING },
        data: { status: PlatformPaymentStatus.FAILED },
      });
      this.logger.log(
        `paycools_order_callback_failed reference=${payment.reference}`,
      );
      return { accepted: true, duplicate: false, settled: false };
    }

    if (verified.amountMinor !== payment.providerAmountMinor) {
      throw new BadRequestException(
        'PayCools amount does not match the stored payment',
      );
    }
    if (
      verified.currency &&
      verified.currency.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      throw new BadRequestException(
        'PayCools currency does not match the stored payment',
      );
    }

    await this.lifecycle.event(this.prisma, payment, {
      eventType: PaymentLifecycleEvent.CALLBACK_VERIFIED,
      actorType: 'PAYMENT_PROVIDER',
      previousStatus: payment.status,
      safeMessage: 'PayCools callback verified',
    });
    const claimed = await this.lifecycle.transition(
      payment.id,
      PlatformPaymentStatus.PAID,
      {
        eventType: PaymentLifecycleEvent.SETTLED,
        actorType: 'PAYMENT_PROVIDER',
        safeMessage: 'Verified PayCools payment settled',
        providerTransactionId: verified.providerTransactionId,
      },
    );
    const result = claimed.transitioned
      ? { duplicate: false, settle: true }
      : {
          duplicate: claimed.payment.status === PlatformPaymentStatus.PAID,
          settle: false,
          status: claimed.payment.status,
        };

    if (result.duplicate) {
      await this.lifecycle.event(this.prisma, payment, {
        eventType: PaymentLifecycleEvent.DUPLICATE,
        actorType: 'PAYMENT_PROVIDER',
        previousStatus: PlatformPaymentStatus.PAID,
        resultingStatus: PlatformPaymentStatus.PAID,
        safeMessage: 'Duplicate callback ignored',
      });
      this.logger.log(
        `paycools_order_callback_duplicate reference=${payment.reference}`,
      );
      return { accepted: true, duplicate: true, settled: false };
    }
    if (!result.settle) {
      await this.lifecycle.event(this.prisma, payment, {
        eventType: PaymentLifecycleEvent.LATE_SUCCESS,
        actorType: 'PAYMENT_PROVIDER',
        previousStatus: result.status,
        resultingStatus: result.status,
        safeMessage:
          'Verified provider success received after local terminal state; reconciliation required',
      });
      return {
        accepted: true,
        duplicate: false,
        settled: false,
        reconciliationRequired: true,
      };
    }

    await this.orders.markPaidByGateway(String(order.id), 'completed');
    await this.prisma.wkOrder.update({
      where: { id: order.id },
      data: { paymentMethod: 'qrph', paymentRef: payment.reference },
    });
    await this.orders.notifyMerchantPaidQrphOrder(order.id);
    this.logger.log(
      `order_paycools_settled reference=${payment.reference} orderId=${order.id}`,
    );
    return { accepted: true, duplicate: false, settled: true };
  }

  private async resolveSource(input: {
    merchantId?: number;
    orderType?: string;
    orderId?: number;
    userId?: string;
  }) {
    if (input.orderId) {
      const order = await this.prisma.wkOrder.findUnique({
        where: { id: input.orderId },
        include: { merchant: { select: { commerceDomain: true } } },
      });
      if (!order || (input.userId && order.userId !== input.userId)) {
        throw new NotFoundException('Order not found');
      }
      return {
        sourceType: resolvePayCoolsOrderSourceType(
          order.orderType,
          order.merchant.commerceDomain,
        ),
      };
    }
    if (!input.merchantId) {
      throw new BadRequestException('merchantId is required');
    }
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: input.merchantId },
      select: { commerceDomain: true },
    });
    if (!merchant) throw new NotFoundException('Merchant not found');
    return {
      sourceType: resolvePayCoolsOrderSourceType(
        input.orderType,
        merchant.commerceDomain,
      ),
    };
  }

  private async loadOwnedPayableOrder(orderId: number, userId: string) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: orderId },
      include: {
        merchant: { select: { id: true, commerceDomain: true } },
        orderItems: { select: { id: true } },
      },
    });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('Order not found');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: order.userId },
      select: { firstName: true, lastName: true, email: true },
    });
    if (order.paymentStatus === 'paid') {
      throw new BadRequestException('Order is already paid');
    }
    if (
      !Number.isFinite(moneyNumber(order.totalAmount)) ||
      moneyNumber(order.totalAmount) <= 0 ||
      order.orderItems?.length === 0
    ) {
      throw new BadRequestException('Order is not eligible for payment');
    }
    if (TERMINAL_ORDER_STATUSES.includes(order.status)) {
      throw new BadRequestException('Order is not eligible for payment');
    }
    if (order.orderType === 'dine_in') {
      if (order.status !== 'payment_pending') {
        throw new BadRequestException(
          'Wait for the merchant to confirm bill-out',
        );
      }
    } else if (order.paymentMethod === 'pending_selection') {
      throw new BadRequestException(
        'This order is awaiting a different payment selection flow',
      );
    }
    return { ...order, user };
  }

  private async findActiveOrderPayment(orderId: number) {
    const rows = await this.prisma.platformPaymentTransaction.findMany({
      where: {
        provider: 'PAYCOOLS',
        sourceId: String(orderId),
        status: PlatformPaymentStatus.PENDING,
        destination: PlatformPaymentDestination.MERCHANT_ACCOUNT,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.find((row) => {
      if (!isCustomerOrderPayCoolsMetadata(row.metadata)) return false;
      return !this.isExpired(row.metadata);
    });
  }

  private async findLatestOrderPayment(orderId: number) {
    const rows = await this.prisma.platformPaymentTransaction.findMany({
      where: {
        provider: 'PAYCOOLS',
        sourceId: String(orderId),
        destination: PlatformPaymentDestination.MERCHANT_ACCOUNT,
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.find((row) => isCustomerOrderPayCoolsMetadata(row.metadata));
  }

  private isExpired(metadata: unknown) {
    const expiresAt =
      metadata &&
      typeof metadata === 'object' &&
      typeof (metadata as { expiresAt?: unknown }).expiresAt === 'string'
        ? String((metadata as { expiresAt: string }).expiresAt)
        : null;
    if (!expiresAt) return false;
    const at = new Date(expiresAt).getTime();
    return Number.isFinite(at) && at <= Date.now();
  }

  private async toDto(
    paymentId: string,
    extras?: {
      qrcodeContent?: string | null;
      qrLink?: string | null;
      expiresAt?: string | null;
    },
  ): Promise<PayCoolsOrderPaymentDto> {
    const payment =
      await this.prisma.platformPaymentTransaction.findUniqueOrThrow({
        where: { id: paymentId },
      });
    const metadata = (payment.metadata || {}) as Record<string, unknown>;
    const qrcodeContent =
      extras?.qrcodeContent ??
      (typeof metadata.qrData === 'string' ? metadata.qrData : null);
    const qrLink =
      extras?.qrLink ??
      (typeof metadata.qrLink === 'string' ? metadata.qrLink : null);
    const expiresAt =
      extras?.expiresAt ??
      (typeof metadata.expiresAt === 'string' ? metadata.expiresAt : null);
    let status: PayCoolsCustomerStatus = 'PENDING';
    if (payment.status === PlatformPaymentStatus.PAID) status = 'PAID';
    else if (
      payment.status === PlatformPaymentStatus.FAILED ||
      payment.status === PlatformPaymentStatus.REFUNDED
    ) {
      status = 'FAILED';
    } else if (payment.status === PlatformPaymentStatus.CANCELLED) {
      status = 'FAILED';
    } else if (payment.status === PlatformPaymentStatus.EXPIRED) {
      status = 'EXPIRED';
    } else if (this.isExpired(metadata)) {
      status = 'EXPIRED';
    }
    return {
      paymentId: payment.id,
      reference: payment.reference,
      amount: moneyNumber(payment.amount),
      currency: payment.currency,
      status,
      qrcodeContent,
      qrLink,
      qrImageDataUrl: qrcodeContent
        ? await QRCode.toDataURL(qrcodeContent, { width: 280, margin: 1 })
        : null,
      expiresAt,
      createdAt: payment.createdAt,
      paidAt: payment.paidAt,
    };
  }
}
