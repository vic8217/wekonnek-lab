import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  PlatformPaymentDestination,
  PlatformPaymentSourceType,
  PlatformPaymentStatus,
  WalletPaymentGateway,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentPartnerConfigService } from './payment-partner-config.service';
import { PayCoolsProvider } from './paycools.provider';
import { PlatformPaymentService } from './platform-payment.service';
import type { VerifiedWebhookPayment } from './payment-provider';

const RELOAD_PURPOSE = 'merchant_wallet_reload';
const RELOAD_SOURCE = PlatformPaymentSourceType.MERCHANT_SUBSCRIPTION;

@Injectable()
export class WalletReloadService {
  private readonly logger = new Logger(WalletReloadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformPayments: PlatformPaymentService,
    private readonly paymentPartners: PaymentPartnerConfigService,
    private readonly paycools: PayCoolsProvider,
  ) {}

  async createPayCoolsReload(userId: string, amount: number) {
    if (!Number.isFinite(amount) || amount < 50 || amount > 50000) {
      throw new BadRequestException('Enter an amount from ₱50 to ₱50,000.');
    }
    const merchant = await this.prisma.merchant.findFirst({
      where: { userId },
      select: { id: true, isActive: true },
    });
    if (!merchant?.isActive)
      throw new ForbiddenException(
        'Only an active merchant owner can reload this wallet',
      );
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId, balance: 0 },
    });
    if (!wallet.isActive) throw new ForbiddenException('Wallet is not active');
    const active = await this.paymentPartners.getActiveProvider(RELOAD_SOURCE);
    const pending = await this.platformPayments.createPending({
      destination: PlatformPaymentDestination.USER_WALLET,
      sourceType: RELOAD_SOURCE,
      amount,
      payerUserId: userId,
      walletId: wallet.id,
      metadata: { purpose: RELOAD_PURPOSE, merchantId: merchant.id },
    });
    const walletTxn = await this.prisma.walletTransaction.create({
      data: {
        referenceNumber: pending.reference,
        walletId: wallet.id,
        type: WalletTransactionType.top_up,
        status: WalletTransactionStatus.pending,
        gateway: WalletPaymentGateway.internal,
        amount,
        fee: 0,
        netAmount: amount,
        description: 'PayCools wallet reload',
        metadata: {
          purpose: RELOAD_PURPOSE,
          platformPaymentId: pending.id,
          provider: 'paycools',
        },
      },
    });
    await this.prisma.platformPaymentTransaction.update({
      where: { id: pending.id },
      data: { sourceId: walletTxn.id },
    });

    try {
      const created = await this.paycools.createPayment({
        reference: pending.reference,
        amountMinor: pending.providerAmountMinor,
        currency: pending.currency,
        notifyUrl: this.paymentPartners.paymentCallbackUrl(),
        expiresInSeconds: active.defaultQrExpirySeconds,
      });
      await this.platformPayments.attachProviderIdentifiers(pending.id, {
        qrCodeId: created.providerQrCodeId,
        transactionId: created.providerTransactionId,
      });
      await this.prisma.walletTransaction.update({
        where: { id: walletTxn.id },
        data: {
          gatewayPaymentUrl: created.paymentUrl || undefined,
          gatewayTransactionId:
            created.providerQrCodeId ||
            created.providerTransactionId ||
            undefined,
          metadata: {
            purpose: RELOAD_PURPOSE,
            platformPaymentId: pending.id,
            provider: 'paycools',
            qrData: created.qrData || null,
            expiresAt: created.expiresAt?.toISOString() || null,
          },
        },
      });
      this.logger.log(
        `wallet_reload_created reference=${pending.reference} amount=${amount}`,
      );
      return this.toReloadResponse(pending.id, {
        paymentUrl: created.paymentUrl || null,
        qrData: created.qrData || null,
        expiresAt: created.expiresAt || null,
      });
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.platformPaymentTransaction.update({
          where: { id: pending.id },
          data: { status: PlatformPaymentStatus.FAILED },
        }),
        this.prisma.walletTransaction.update({
          where: { id: walletTxn.id },
          data: { status: WalletTransactionStatus.failed },
        }),
      ]);
      throw error;
    }
  }

  async getReload(userId: string, paymentId: string) {
    const payment = await this.prisma.platformPaymentTransaction.findUnique({
      where: { id: paymentId },
    });
    if (
      !payment ||
      payment.payerUserId !== userId ||
      payment.destination !== PlatformPaymentDestination.USER_WALLET
    ) {
      throw new NotFoundException('Reload payment not found');
    }
    return this.toReloadResponse(payment.id);
  }

  async handlePayCoolsCallback(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const verified = await this.paycools.verifyWebhook(body, headers);
    return this.settleVerified(verified);
  }

  async settleVerified(verified: VerifiedWebhookPayment) {
    const payment = await this.prisma.platformPaymentTransaction.findUnique({
      where: { reference: verified.reference },
    });
    if (!payment) {
      this.logger.warn(
        `paycools_callback_unknown_reference reference=${verified.reference}`,
      );
      throw new NotFoundException('Unknown PayCools payment reference');
    }
    if (payment.provider !== 'PAYCOOLS')
      throw new BadRequestException('Provider mismatch');
    if (payment.destination !== PlatformPaymentDestination.USER_WALLET) {
      throw new BadRequestException('Payment is not a wallet reload');
    }
    const metadata = (payment.metadata || {}) as Record<string, unknown>;
    if (metadata.purpose !== RELOAD_PURPOSE)
      throw new BadRequestException('Payment is not a wallet reload');
    if (!payment.walletId || !payment.payerUserId)
      throw new BadRequestException('Wallet owner is missing');
    if (
      payment.status === PlatformPaymentStatus.FAILED ||
      payment.status === PlatformPaymentStatus.REFUNDED
    ) {
      throw new BadRequestException(
        'Payment is not eligible for wallet credit',
      );
    }

    if (verified.status === 'PENDING') {
      this.logger.log(
        `paycools_callback_pending reference=${payment.reference}`,
      );
      return { accepted: true, duplicate: false, credited: false };
    }

    if (verified.status === 'FAILED') {
      await this.markFailed(payment.id, payment.sourceId);
      this.logger.log(
        `paycools_callback_failed reference=${payment.reference}`,
      );
      return { accepted: true, duplicate: false, credited: false };
    }

    if (verified.amountMinor !== payment.providerAmountMinor) {
      this.logger.warn(
        `paycools_callback_amount_mismatch reference=${payment.reference}`,
      );
      throw new BadRequestException(
        'PayCools amount does not match the stored payment',
      );
    }
    if (
      verified.currency &&
      verified.currency.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      this.logger.warn(
        `paycools_callback_currency_mismatch reference=${payment.reference}`,
      );
      throw new BadRequestException(
        'PayCools currency does not match the stored payment',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.platformPaymentTransaction.updateMany({
        where: {
          id: payment.id,
          status: PlatformPaymentStatus.PENDING,
          provider: 'PAYCOOLS',
        },
        data: {
          status: PlatformPaymentStatus.PAID,
          paidAt: new Date(),
          providerTransactionId: verified.providerTransactionId,
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.platformPaymentTransaction.findUnique({
          where: { id: payment.id },
        });
        if (current?.status === PlatformPaymentStatus.PAID) {
          this.logger.log(
            `paycools_callback_duplicate reference=${payment.reference}`,
          );
          return { duplicate: true, credited: false };
        }
        throw new BadRequestException(
          'Payment is not eligible for wallet credit',
        );
      }
      await tx.wallet.update({
        where: { id: payment.walletId! },
        data: { balance: { increment: Number(payment.amount) } },
      });
      if (payment.sourceId) {
        await tx.walletTransaction.updateMany({
          where: {
            id: payment.sourceId,
            status: {
              in: [
                WalletTransactionStatus.pending,
                WalletTransactionStatus.processing,
              ],
            },
          },
          data: {
            status: WalletTransactionStatus.completed,
            gatewayTransactionId: verified.providerTransactionId,
          },
        });
      }
      this.logger.log(
        `wallet_reload_credited reference=${payment.reference} amount=${String(payment.amount)}`,
      );
      return { duplicate: false, credited: true };
    });
    return { accepted: true, ...result };
  }

  private async markFailed(paymentId: string, walletTxnId: string | null) {
    await this.prisma.$transaction([
      this.prisma.platformPaymentTransaction.updateMany({
        where: { id: paymentId, status: PlatformPaymentStatus.PENDING },
        data: { status: PlatformPaymentStatus.FAILED },
      }),
      ...(walletTxnId
        ? [
            this.prisma.walletTransaction.updateMany({
              where: {
                id: walletTxnId,
                status: {
                  in: [
                    WalletTransactionStatus.pending,
                    WalletTransactionStatus.processing,
                  ],
                },
              },
              data: { status: WalletTransactionStatus.failed },
            }),
          ]
        : []),
    ]);
  }

  private async toReloadResponse(
    paymentId: string,
    extras?: {
      paymentUrl?: string | null;
      qrData?: string | null;
      expiresAt?: Date | null;
    },
  ) {
    const payment =
      await this.prisma.platformPaymentTransaction.findUniqueOrThrow({
        where: { id: paymentId },
      });
    const walletTxn = payment.sourceId
      ? await this.prisma.walletTransaction.findUnique({
          where: { id: payment.sourceId },
        })
      : await this.prisma.walletTransaction.findUnique({
          where: { referenceNumber: payment.reference },
        });
    const metadata = (walletTxn?.metadata || {}) as Record<string, unknown>;
    return {
      paymentId: payment.id,
      reference: payment.reference,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      provider: 'paycools',
      paymentUrl: extras?.paymentUrl ?? walletTxn?.gatewayPaymentUrl ?? null,
      qrData:
        extras?.qrData ??
        (typeof metadata.qrData === 'string' ? metadata.qrData : null),
      expiresAt:
        extras?.expiresAt ??
        (typeof metadata.expiresAt === 'string' ? metadata.expiresAt : null),
      createdAt: payment.createdAt,
      paidAt: payment.paidAt,
      updatedAt: payment.updatedAt,
    };
  }
}
