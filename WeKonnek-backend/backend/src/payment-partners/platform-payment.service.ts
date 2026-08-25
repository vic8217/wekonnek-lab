import { randomBytes } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPaymentDestination, PlatformPaymentSourceType, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentPartnerConfigService } from './payment-partner-config.service';

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
  constructor(private prisma: PrismaService, private paymentPartners: PaymentPartnerConfigService) {}

  async createPending(input: CreatePlatformPayment) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new BadRequestException('Payment amount must be greater than zero');
    const amountMinor = Math.round(input.amount * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor > 2_147_483_647) throw new BadRequestException('Payment amount is outside supported limits');
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
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue;
        throw error;
      }
    }
    throw new ConflictException('Unable to allocate a unique payment reference');
  }

  async attachProviderIdentifiers(id: string, values: { transactionId?: string; qrCodeId?: string }) {
    if (!values.transactionId && !values.qrCodeId) throw new BadRequestException('A provider identifier is required');
    return this.prisma.platformPaymentTransaction.update({
      where: { id },
      data: { providerTransactionId: values.transactionId, providerQrCodeId: values.qrCodeId },
    });
  }

  private async validateOwnership(input: CreatePlatformPayment) {
    if (input.destination === PlatformPaymentDestination.MERCHANT_ACCOUNT) {
      if (!input.merchantId || input.walletId || input.riderId) throw new BadRequestException('Merchant payments require only a merchant destination');
      const merchant = await this.prisma.merchant.findUnique({ where: { id: input.merchantId }, select: { id: true } });
      if (!merchant) throw new NotFoundException('Merchant not found');
      return;
    }

    if (!input.walletId) throw new BadRequestException('Wallet loads require a destination wallet');
    const wallet = await this.prisma.wallet.findUnique({ where: { id: input.walletId }, include: { user: { select: { id: true, role: true } } } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    if (input.destination === PlatformPaymentDestination.USER_WALLET) {
      if (!input.payerUserId || input.riderId || input.merchantId || wallet.userId !== input.payerUserId) throw new BadRequestException('User wallet ownership does not match');
      return;
    }
    if (!input.riderId || input.merchantId || wallet.userId !== input.riderId || wallet.user.role !== UserRole.rider) throw new BadRequestException('Rider wallet ownership does not match');
  }
}
