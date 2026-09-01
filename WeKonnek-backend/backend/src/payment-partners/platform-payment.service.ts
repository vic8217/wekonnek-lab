import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PlatformPaymentDestination,
  PlatformPaymentStatus,
  PlatformPaymentSourceType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentPartnerConfigService } from './payment-partner-config.service';

type AdminLifecycleEvent = {
  eventType: string;
  safeMessage: string | null;
  previousStatus: string | null;
  resultingStatus: string | null;
  createdAt: Date;
};
type AdminPaymentRow = {
  id: string;
  reference: string;
  provider: string;
  providerTransactionId: string | null;
  providerQrCodeId: string | null;
  status: string;
  amount: Prisma.Decimal;
  currency: string;
  sourceType: string;
  sourceId: string | null;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
  merchant: { id: number; name: string } | null;
  payerUser: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  lifecycleEvents: AdminLifecycleEvent[];
};
type AdminOrder = {
  id: number;
  orderCode: string;
  orderType: string;
  totalAmount: Prisma.Decimal;
  transactionFeeRate: Prisma.Decimal;
  transactionFeeBasisNetOfVat: Prisma.Decimal;
  transactionFeeAmount: Prisma.Decimal;
  shop: { id: number; name: string } | null;
};

export function createWekonnekPaymentReference(now = new Date()) {
  const date = now.toISOString().slice(2, 10).replaceAll('-', '');
  return `WK${date}${randomBytes(8).toString('hex').toUpperCase()}`;
}

export function createProviderIdempotencyKey() {
  return `IDEM${randomBytes(12).toString('hex').toUpperCase()}`;
}

type CreatePlatformPayment = {
  destination: PlatformPaymentDestination;
  sourceType: PlatformPaymentSourceType;
  sourceId?: string;
  amount: number;
  merchantId?: number;
  payerUserId?: string;
  riderId?: string;
  walletId?: string;
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class PlatformPaymentService {
  constructor(
    private prisma: PrismaService,
    private paymentPartners: PaymentPartnerConfigService,
  ) {}

  async createPending(input: CreatePlatformPayment) {
    if (!Number.isFinite(input.amount) || input.amount <= 0)
      throw new BadRequestException('Payment amount must be greater than zero');
    const amountMinor = Math.round(input.amount * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor > 2_147_483_647)
      throw new BadRequestException(
        'Payment amount is outside supported limits',
      );
    await this.validateOwnership(input);
    // This is an independent backend guard: a stale enabled flag or source
    // setting can never create a PayCools transaction before readiness passes.
    await this.paymentPartners.getActiveProvider(input.sourceType);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.platformPaymentTransaction.create({
          data: {
            reference: createWekonnekPaymentReference(),
            provider: 'PAYCOOLS',
            idempotencyKey: createProviderIdempotencyKey(),
            destination: input.destination,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            merchantId: input.merchantId,
            payerUserId: input.payerUserId,
            riderId: input.riderId,
            walletId: input.walletId,
            amount: amountMinor / 100,
            providerAmountMinor: amountMinor,
            metadata: input.metadata,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          continue;
        throw error;
      }
    }
    throw new ConflictException(
      'Unable to allocate a unique payment reference',
    );
  }

  async attachProviderIdentifiers(
    id: string,
    values: { transactionId?: string; qrCodeId?: string },
  ) {
    if (!values.transactionId && !values.qrCodeId)
      throw new BadRequestException('A provider identifier is required');
    return this.prisma.platformPaymentTransaction.update({
      where: { id },
      data: {
        providerTransactionId: values.transactionId,
        providerQrCodeId: values.qrCodeId,
      },
    });
  }

  /** Admin-only observability read model. It never creates or mutates payments. */
  async adminTransactions(query: Record<string, string | undefined>) {
    const search = query.search?.trim();
    const where: Prisma.PlatformPaymentTransactionWhereInput = {
      ...(query.status &&
      Object.values(PlatformPaymentStatus).includes(
        query.status as PlatformPaymentStatus,
      )
        ? { status: query.status as PlatformPaymentStatus }
        : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.merchantId ? { merchantId: Number(query.merchantId) } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { reference: { contains: search, mode: 'insensitive' } },
              {
                providerTransactionId: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              { merchant: { name: { contains: search, mode: 'insensitive' } } },
              { sourceId: { contains: search } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.platformPaymentTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        merchant: { select: { id: true, name: true } },
        payerUser: { select: { id: true, firstName: true, lastName: true } },
        lifecycleEvents: {
          orderBy: { createdAt: 'asc' },
          select: {
            eventType: true,
            safeMessage: true,
            previousStatus: true,
            resultingStatus: true,
            createdAt: true,
          },
        },
      },
    });
    const orderIds = rows
      .filter((row) => row.sourceId && /ORDER/.test(String(row.sourceType)))
      .map((row) => Number(row.sourceId))
      .filter(Number.isFinite);
    const orders = orderIds.length
      ? await this.prisma.wkOrder.findMany({
          where: { id: { in: orderIds } },
          include: { shop: { select: { id: true, name: true } } },
        })
      : [];
    const byId = new Map(orders.map((order) => [String(order.id), order]));
    return rows.map((row) =>
      this.adminSerialize(row, byId.get(row.sourceId || '')),
    );
  }

  async adminTransaction(id: string) {
    const rows = await this.adminTransactions({});
    return rows.find((row) => row.id === id) || null;
  }

  private adminSerialize(row: AdminPaymentRow, order?: AdminOrder) {
    const eventAt = (status: string) =>
      row.lifecycleEvents.find((event) => event.resultingStatus === status)
        ?.createdAt || null;
    const customerName =
      [row.payerUser?.firstName, row.payerUser?.lastName]
        .filter(Boolean)
        .join(' ') || null;
    return {
      id: row.id,
      reference: row.reference,
      provider: row.provider,
      providerReference:
        row.providerTransactionId || row.providerQrCodeId || null,
      status: row.status,
      amount: Number(row.amount),
      orderAmount: order ? Number(order.totalAmount) - Number(order.transactionFeeAmount) : null,
      transactionFeeRate: order ? Number(order.transactionFeeRate) : null,
      transactionFeeBasisNetOfVat: order ? Number(order.transactionFeeBasisNetOfVat) : null,
      transactionFeeAmount: order ? Number(order.transactionFeeAmount) : null,
      totalCharged: order ? Number(order.totalAmount) : Number(row.amount),
      currency: row.currency,
      sourceType: row.sourceType,
      orderReference: order?.orderCode || null,
      orderType: order?.orderType || null,
      merchant: row.merchant,
      shop: order?.shop ? { id: order.shop.id, name: order.shop.name } : null,
      customer:
        customerName && row.payerUser
          ? { name: customerName, id: row.payerUser.id }
          : null,
      createdAt: row.createdAt,
      pendingAt: row.createdAt,
      paidAt: row.paidAt,
      expiredAt: eventAt('EXPIRED'),
      cancelledAt: eventAt('CANCELLED'),
      failedAt: eventAt('FAILED'),
      updatedAt: row.updatedAt,
      lifecycle: row.lifecycleEvents,
    };
  }

  private async validateOwnership(input: CreatePlatformPayment) {
    if (input.destination === PlatformPaymentDestination.MERCHANT_ACCOUNT) {
      if (!input.merchantId || input.walletId || input.riderId)
        throw new BadRequestException(
          'Merchant payments require only a merchant destination',
        );
      const merchant = await this.prisma.merchant.findUnique({
        where: { id: input.merchantId },
        select: { id: true },
      });
      if (!merchant) throw new NotFoundException('Merchant not found');
      return;
    }

    if (!input.walletId)
      throw new BadRequestException(
        'Wallet loads require a destination wallet',
      );
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: input.walletId },
      include: { user: { select: { id: true, role: true } } },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (input.destination === PlatformPaymentDestination.USER_WALLET) {
      if (
        !input.payerUserId ||
        input.riderId ||
        input.merchantId ||
        wallet.userId !== input.payerUserId
      )
        throw new BadRequestException('User wallet ownership does not match');
      return;
    }
    if (
      !input.riderId ||
      input.merchantId ||
      wallet.userId !== input.riderId ||
      wallet.user.role !== UserRole.rider
    )
      throw new BadRequestException('Rider wallet ownership does not match');
  }
}
