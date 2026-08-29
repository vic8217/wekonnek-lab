import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  NotImplementedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WalletTransactionType,
  WalletTransactionStatus,
  WalletPaymentGateway,
  NotificationType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PaymentGatewayService } from './payment-gateway.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletLedgerService } from './wallet-ledger.service';
import {
  moneyDecimal,
  moneyNumber,
  serializeWallet,
  serializeWalletTransaction,
} from './wallet-money';

const PIN_HASH_ROUNDS = 12;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;
const INVALID_PIN = 'Invalid wallet PIN';

function addOnQuantity(quantities: unknown, id: string) {
  if (!quantities || typeof quantities !== 'object' || Array.isArray(quantities)) return 1;
  const value = Number((quantities as Record<string, unknown>)[id]);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

export function scopedWalletReference(prefix: string, userId: string, idempotencyKey: string) {
  const key = idempotencyKey.trim();
  if (key.length < 8 || key.length > 80) {
    throw new BadRequestException('Idempotency key must be 8–80 characters');
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new BadRequestException('Idempotency key contains unsupported characters');
  }
  return { reference: `${prefix}-${userId}-${key}`, key };
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gatewayService: PaymentGatewayService,
    private readonly notifications: NotificationsService,
    private readonly ledger: WalletLedgerService,
  ) {}

  async getOrCreateWallet(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({ data: { userId, balance: 0 } });
    }
    return wallet;
  }

  async getPublicWallet(userId: string) {
    return serializeWallet(await this.getOrCreateWallet(userId));
  }

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async getBalance(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    return { balance: moneyNumber(wallet.balance) };
  }

  async setPin(userId: string, pin: string) {
    if (!/^\d{6}$/.test(pin || '')) {
      throw new BadRequestException('PIN must be 6 digits');
    }
    const wallet = await this.getOrCreateWallet(userId);
    const pinHash = await bcrypt.hash(pin, PIN_HASH_ROUNDS);
    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        pinHash,
        pin: null,
        pinSet: true,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
      },
    });
    return { message: 'PIN set successfully' };
  }

  async verifyPin(userId: string, pin: string): Promise<boolean> {
    await this.assertPin(userId, pin);
    return true;
  }

  async topUp(userId: string, amount: number, gateway: WalletPaymentGateway, paymentMethod: string) {
    if (
      gateway === WalletPaymentGateway.paymongo ||
      gateway === WalletPaymentGateway.maya ||
      gateway === WalletPaymentGateway.xendit
    ) {
      throw new BadRequestException(
        'This top-up provider is disabled until official webhook signature verification is configured.',
      );
    }
    if (moneyNumber(amount) < 50) throw new BadRequestException('Minimum top-up is ₱50');
    if (moneyNumber(amount) > 50000) throw new BadRequestException('Maximum top-up is ₱50,000');

    const wallet = await this.getOrCreateWallet(userId);
    const refNumber = this.generateRefNumber('TU');
    const money = moneyDecimal(amount);

    const txn = await this.prisma.walletTransaction.create({
      data: {
        referenceNumber: refNumber,
        walletId: wallet.id,
        type: WalletTransactionType.top_up,
        status: WalletTransactionStatus.pending,
        gateway,
        amount: money,
        fee: 0,
        netAmount: money,
        description: `Top-up via ${gateway} (${paymentMethod})`,
        gatewayPaymentMethod: paymentMethod,
        purpose: 'legacy_top_up',
      },
    });

    const paymentResult = await this.gatewayService.createPayment({
      gateway,
      amount: moneyNumber(amount),
      description: `WeKonnek Pay Top-up - ${refNumber}`,
      paymentMethod,
      redirectSuccess: `wekonnek://wallet/topup-success?ref=${refNumber}`,
      redirectFailed: `wekonnek://wallet/topup-failed?ref=${refNumber}`,
      metadata: { referenceNumber: refNumber, walletId: wallet.id },
    });

    const updatedTxn = await this.prisma.walletTransaction.update({
      where: { id: txn.id },
      data: {
        gatewayTransactionId: paymentResult.gatewayTransactionId,
        gatewayPaymentUrl: paymentResult.paymentUrl,
        status: WalletTransactionStatus.processing,
      },
    });

    return {
      transaction: serializeWalletTransaction(updatedTxn as unknown as Record<string, unknown>),
      paymentUrl: paymentResult.paymentUrl,
    };
  }

  async pay(userId: string, amount: number, orderId: string, pin: string, description?: string) {
    await this.assertPin(userId, pin);
    if (!orderId) throw new BadRequestException('Order ID is required');
    const wallet = await this.getWallet(userId);
    const result = await this.ledger.debitWalletAtomic({
      walletId: wallet.id,
      amount: moneyNumber(amount),
      reference: `PAY-${userId}-${orderId}`,
      type: WalletTransactionType.payment,
      orderId,
      description: description || `Payment for Order ${orderId}`,
      metadata: { orderId },
      purpose: 'wallet_pay',
      idempotencyKey: `PAY-${orderId}`,
    });
    return serializeWalletTransaction(result.transaction as unknown as Record<string, unknown>);
  }

  async cashOut(
    userId: string,
    amount: number,
    gateway: WalletPaymentGateway,
    bankCode: string,
    accountNumber: string,
    accountName: string,
    pin: string,
    idempotencyKey: string,
  ) {
    await this.assertPin(userId, pin);
    if (moneyNumber(amount) < 100) throw new BadRequestException('Minimum cash-out is ₱100');
    const { reference, key } = scopedWalletReference('CO', userId, idempotencyKey);

    const wallet = await this.getWallet(userId);
    const fee = this.calculateCashOutFee(moneyNumber(amount));
    const result = await this.ledger.debitWalletAtomic({
      walletId: wallet.id,
      amount: moneyNumber(amount),
      fee,
      reference,
      type: WalletTransactionType.cash_out,
      status: WalletTransactionStatus.processing,
      gateway,
      description: `Cash-out request to ${bankCode} ****${accountNumber.slice(-4)} (external payout not disbursed)`,
      cashOutBank: bankCode,
      cashOutAccountNumber: accountNumber,
      cashOutAccountName: accountName,
      purpose: 'cash_out_hold',
      idempotencyKey: key,
      metadata: {
        externalPayout: false,
        bankCode,
      },
    });
    return {
      transaction: serializeWalletTransaction(
        result.transaction as unknown as Record<string, unknown>,
      ),
      disbursed: false,
      duplicate: result.duplicate,
      message:
        'Cash-out is recorded internally and deducted from the wallet. External payout is not available in this release.',
    };
  }

  async transfer(_senderId: string, _recipientPhone: string, _amount: number, _pin: string) {
    throw new NotImplementedException(
      'Wallet transfer is not available until recipient credit can be completed in the same transaction.',
    );
  }

  async creditEarning(userId: string, amount: number, orderId: string, description?: string) {
    if (!orderId) throw new BadRequestException('Order ID is required');
    const wallet = await this.getOrCreateWallet(userId);
    const result = await this.ledger.creditWalletAtomic({
      walletId: wallet.id,
      amount: moneyNumber(amount),
      reference: `ERN-${orderId}`,
      type: WalletTransactionType.earning,
      orderId,
      description: description || `Earning from Order ${orderId}`,
      metadata: { orderId },
      purpose: 'earning',
      idempotencyKey: `ERN-${orderId}`,
    });
    return serializeWalletTransaction(result.transaction as unknown as Record<string, unknown>);
  }

  async creditRefund(userId: string, amount: number, orderId: string, description?: string) {
    if (!orderId) throw new BadRequestException('Order ID is required');
    const wallet = await this.getOrCreateWallet(userId);
    const result = await this.ledger.creditWalletAtomic({
      walletId: wallet.id,
      amount: moneyNumber(amount),
      reference: `REFUND-${orderId}`,
      type: WalletTransactionType.refund,
      orderId,
      description: description || `Refund for Order ${orderId}`,
      metadata: { orderId },
      purpose: 'refund',
      idempotencyKey: `REFUND-${orderId}`,
    });
    return serializeWalletTransaction(result.transaction as unknown as Record<string, unknown>);
  }

  async handleWebhook(gateway: WalletPaymentGateway, body: any, headers: Record<string, string>) {
    const result = await this.gatewayService.verifyWebhook({ gateway, body, headers });

    const txn = await this.prisma.walletTransaction.findFirst({
      where: { gatewayTransactionId: result.transactionId },
    });

    if (!txn) return { status: 'transaction_not_found' };

    if (result.status === 'completed') {
      const credited = await this.ledger.completePendingCredit(txn.id);
      if (!credited.duplicate && credited.wallet) {
        await this.syncMerchantSubscriptionStatus(
          credited.wallet.userId,
          moneyNumber(credited.wallet.balance),
        );
      }
      return {
        status: credited.duplicate ? 'already_processed' : result.status,
      };
    }

    await this.prisma.walletTransaction.updateMany({
      where: {
        id: txn.id,
        status: {
          in: [WalletTransactionStatus.pending, WalletTransactionStatus.processing],
        },
      },
      data: { status: WalletTransactionStatus.failed },
    });

    return { status: result.status };
  }

  async getTransactions(userId: string, options?: { type?: WalletTransactionType; limit?: number; offset?: number }) {
    const wallet = await this.getOrCreateWallet(userId);

    const where: Record<string, unknown> = { walletId: wallet.id };
    if (options?.type) where.type = options.type;

    const rows = await this.prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 20,
      skip: options?.offset || 0,
    });
    return rows.map((row) =>
      serializeWalletTransaction(row as unknown as Record<string, unknown>),
    );
  }

  private generateRefNumber(prefix: string): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `WHP-${prefix}-${timestamp}${random}`;
  }

  private async assertPin(userId: string, pin: string) {
    const wallet = await this.getWallet(userId);
    if (wallet.pinLockedUntil && wallet.pinLockedUntil.getTime() > Date.now()) {
      throw new ForbiddenException(INVALID_PIN);
    }
    const offered = String(pin || '');
    let matched = false;
    if (wallet.pinHash) {
      matched = await bcrypt.compare(offered, wallet.pinHash);
    } else if (wallet.pin) {
      matched = wallet.pin === offered;
    }
    if (!matched) {
      const next = (wallet.pinFailedAttempts || 0) + 1;
      await this.prisma.wallet.update({
        where: { id: wallet.id },
        data:
          next >= PIN_MAX_ATTEMPTS
            ? {
                pinFailedAttempts: next,
                pinLockedUntil: new Date(Date.now() + PIN_LOCK_MS),
              }
            : { pinFailedAttempts: next },
      });
      throw new ForbiddenException(INVALID_PIN);
    }
    if (!wallet.pinHash && wallet.pin) {
      await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          pinHash: await bcrypt.hash(offered, PIN_HASH_ROUNDS),
          pin: null,
          pinSet: true,
          pinFailedAttempts: 0,
          pinLockedUntil: null,
        },
      });
      return;
    }
    if (wallet.pinFailedAttempts > 0 || wallet.pinLockedUntil) {
      await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { pinFailedAttempts: 0, pinLockedUntil: null },
      });
    }
  }

  private async syncMerchantSubscriptionStatus(userId: string, walletBalance: number) {
    const merchant = await this.prisma.merchant.findFirst({
      where: { userId, subscriptionPlan: 'daily' },
      orderBy: { createdAt: 'desc' },
    });
    if (!merchant?.merchantCode) return;
    const application = await this.prisma.merchantApplication.findUnique({
      where: { merchantCode: merchant.merchantCode },
    });
    const addOns = application?.selectedAddOnIds.length
      ? await this.prisma.subscriptionAddOnPackage.findMany({
          where: { id: { in: application.selectedAddOnIds } },
          select: { id: true, amount: true },
        })
      : [];
    const dailyFee =
      moneyNumber(application?.subscriptionAmount ?? merchant.subscriptionAmount) +
      addOns.reduce(
        (sum, addOn) =>
          sum + moneyNumber(addOn.amount) * addOnQuantity(application?.selectedAddOnQuantities, addOn.id),
        0,
      );
    const hasCoverage = walletBalance >= dailyFee;
    const status = hasCoverage
      ? merchant.status === 'inactive' ? 'active' : merchant.status
      : merchant.status === 'active' ? 'inactive' : merchant.status;
    await this.prisma.merchant.update({
      where: { id: merchant.id },
      data: {
        isActive: hasCoverage && status === 'active',
        status,
        subscriptionStatus: hasCoverage ? 'active' : 'inactive',
      },
    });
    if (merchant.subscriptionStatus !== (hasCoverage ? 'active' : 'inactive')) {
      await this.notifications.notify({ userId, title: hasCoverage ? 'Subscription reactivated' : 'Subscription paused', body: hasCoverage ? 'Your merchant subscription is active again.' : 'Your wallet no longer covers the daily subscription fee.', type: NotificationType.system, data: { kind: hasCoverage ? 'subscription_reactivated' : 'subscription_expired', url: '/merchant/subscription/upgrade' } }).catch(() => undefined);
    } else if (hasCoverage && dailyFee > 0 && walletBalance < dailyFee * 3) {
      const recent = await this.prisma.notification.findFirst({ where: { userId, title: 'Low subscription balance', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } }, select: { id: true } });
      if (!recent) await this.notifications.notify({ userId, title: 'Low subscription balance', body: 'Your wallet covers fewer than three days of subscription fees.', type: NotificationType.system, data: { kind: 'subscription_low_balance', url: '/merchant/wallet' } }).catch(() => undefined);
    }
  }

  private calculateCashOutFee(amount: number): number {
    if (amount <= 5000) return 15;
    if (amount <= 20000) return 25;
    return 0;
  }
}
