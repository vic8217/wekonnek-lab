import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  WalletTransactionType,
  WalletTransactionStatus,
  WalletPaymentGateway,
  NotificationType,
} from '@prisma/client';
import { PaymentGatewayService } from './payment-gateway.service';
import { NotificationsService } from '../notifications/notifications.service';

function addOnQuantity(quantities: unknown, id: string) {
  if (!quantities || typeof quantities !== 'object' || Array.isArray(quantities)) return 1;
  const value = Number((quantities as Record<string, unknown>)[id]);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gatewayService: PaymentGatewayService,
    private readonly notifications: NotificationsService,
  ) {}

  async getOrCreateWallet(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({ data: { userId, balance: 0 } });
    }
    return wallet;
  }

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async getBalance(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    return { balance: wallet.balance };
  }

  async setPin(userId: string, pin: string) {
    if (pin.length !== 6) {
      throw new BadRequestException('PIN must be 6 digits');
    }
    const wallet = await this.getOrCreateWallet(userId);
    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { pin, pinSet: true },
    });
    return { message: 'PIN set successfully' };
  }

  async verifyPin(userId: string, pin: string): Promise<boolean> {
    const wallet = await this.getWallet(userId);
    if (!wallet.pinSet) throw new BadRequestException('No PIN set');
    return wallet.pin === pin;
  }

  async topUp(userId: string, amount: number, gateway: WalletPaymentGateway, paymentMethod: string) {
    if (amount < 50) throw new BadRequestException('Minimum top-up is ₱50');
    if (amount > 50000) throw new BadRequestException('Maximum top-up is ₱50,000');

    const wallet = await this.getOrCreateWallet(userId);
    const refNumber = this.generateRefNumber('TU');

    const txn = await this.prisma.walletTransaction.create({
      data: {
        referenceNumber: refNumber,
        walletId: wallet.id,
        type: WalletTransactionType.top_up,
        status: WalletTransactionStatus.pending,
        gateway,
        amount,
        fee: 0,
        netAmount: amount,
        description: `Top-up via ${gateway} (${paymentMethod})`,
        gatewayPaymentMethod: paymentMethod,
      },
    });

    const paymentResult = await this.gatewayService.createPayment({
      gateway,
      amount,
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

    return { transaction: updatedTxn, paymentUrl: paymentResult.paymentUrl };
  }

  async pay(userId: string, amount: number, orderId: string, pin: string, description?: string) {
    const pinValid = await this.verifyPin(userId, pin);
    if (!pinValid) throw new ForbiddenException('Invalid wallet PIN');

    const wallet = await this.getWallet(userId);
    if (wallet.balance < amount) throw new BadRequestException('Insufficient wallet balance');

    const refNumber = this.generateRefNumber('PAY');

    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { balance: wallet.balance - amount },
    });

    return this.prisma.walletTransaction.create({
      data: {
        referenceNumber: refNumber,
        walletId: wallet.id,
        type: WalletTransactionType.payment,
        status: WalletTransactionStatus.completed,
        gateway: WalletPaymentGateway.internal,
        amount,
        fee: 0,
        netAmount: amount,
        orderId,
        description: description || `Payment for Order ${orderId}`,
      },
    });
  }

  async cashOut(
    userId: string, amount: number, gateway: WalletPaymentGateway,
    bankCode: string, accountNumber: string, accountName: string, pin: string,
  ) {
    const pinValid = await this.verifyPin(userId, pin);
    if (!pinValid) throw new ForbiddenException('Invalid wallet PIN');
    if (amount < 100) throw new BadRequestException('Minimum cash-out is ₱100');

    const wallet = await this.getWallet(userId);
    const fee = this.calculateCashOutFee(amount);
    if (wallet.balance < amount + fee) throw new BadRequestException('Insufficient balance (including fee)');

    const refNumber = this.generateRefNumber('CO');

    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { balance: wallet.balance - amount - fee },
    });

    const txn = await this.prisma.walletTransaction.create({
      data: {
        referenceNumber: refNumber,
        walletId: wallet.id,
        type: WalletTransactionType.cash_out,
        status: WalletTransactionStatus.processing,
        gateway,
        amount,
        fee,
        netAmount: amount - fee,
        description: `Cash-out to ${bankCode} ****${accountNumber.slice(-4)}`,
        cashOutBank: bankCode,
        cashOutAccountNumber: accountNumber,
        cashOutAccountName: accountName,
      },
    });

    try {
      const result = await this.gatewayService.createCashOut({
        gateway,
        amount,
        bankCode,
        accountNumber,
        accountName,
        description: `WeKonnek Pay Cash-out - ${refNumber}`,
      });

      return this.prisma.walletTransaction.update({
        where: { id: txn.id },
        data: { gatewayTransactionId: result.gatewayTransactionId },
      });
    } catch (error) {
      await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: wallet.balance },
      });
      await this.prisma.walletTransaction.update({
        where: { id: txn.id },
        data: { status: WalletTransactionStatus.failed },
      });
      throw error;
    }
  }

  async transfer(senderId: string, recipientPhone: string, amount: number, pin: string) {
    const pinValid = await this.verifyPin(senderId, pin);
    if (!pinValid) throw new ForbiddenException('Invalid wallet PIN');
    if (amount < 1) throw new BadRequestException('Minimum transfer is ₱1');

    const senderWallet = await this.getWallet(senderId);
    if (senderWallet.balance < amount) throw new BadRequestException('Insufficient balance');

    const refNumber = this.generateRefNumber('TRF');

    await this.prisma.wallet.update({
      where: { id: senderWallet.id },
      data: { balance: senderWallet.balance - amount },
    });

    return this.prisma.walletTransaction.create({
      data: {
        referenceNumber: refNumber,
        walletId: senderWallet.id,
        type: WalletTransactionType.transfer_out,
        status: WalletTransactionStatus.completed,
        gateway: WalletPaymentGateway.internal,
        amount,
        fee: 0,
        netAmount: amount,
        description: `Transfer to ${recipientPhone}`,
      },
    });
  }

  async creditEarning(userId: string, amount: number, orderId: string, description?: string) {
    const wallet = await this.getOrCreateWallet(userId);

    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: { balance: wallet.balance + amount },
    });

    const refNumber = this.generateRefNumber('ERN');

    return this.prisma.walletTransaction.create({
      data: {
        referenceNumber: refNumber,
        walletId: wallet.id,
        type: WalletTransactionType.earning,
        status: WalletTransactionStatus.completed,
        gateway: WalletPaymentGateway.internal,
        amount,
        fee: 0,
        netAmount: amount,
        orderId,
        description: description || `Earning from Order ${orderId}`,
      },
    });
  }

  async handleWebhook(gateway: WalletPaymentGateway, body: any, headers: Record<string, string>) {
    const result = await this.gatewayService.verifyWebhook({ gateway, body, headers });

    const txn = await this.prisma.walletTransaction.findFirst({
      where: { gatewayTransactionId: result.transactionId },
    });

    if (!txn) return { status: 'transaction_not_found' };

    if (result.status === 'completed') {
      await this.prisma.walletTransaction.update({
        where: { id: txn.id },
        data: { status: WalletTransactionStatus.completed },
      });

      const wallet = await this.prisma.wallet.findUnique({ where: { id: txn.walletId } });
      if (wallet) {
        const updatedWallet = await this.prisma.wallet.update({
          where: { id: wallet.id },
          data: { balance: wallet.balance + txn.netAmount },
        });
        await this.syncMerchantSubscriptionStatus(wallet.userId, updatedWallet.balance);
      }
    } else {
      await this.prisma.walletTransaction.update({
        where: { id: txn.id },
        data: { status: WalletTransactionStatus.failed },
      });
    }

    return { status: result.status };
  }

  async getTransactions(userId: string, options?: { type?: WalletTransactionType; limit?: number; offset?: number }) {
    const wallet = await this.getOrCreateWallet(userId);

    const where: Record<string, unknown> = { walletId: wallet.id };
    if (options?.type) where.type = options.type;

    return this.prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 20,
      skip: options?.offset || 0,
    });
  }

  private generateRefNumber(prefix: string): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `WHP-${prefix}-${timestamp}${random}`;
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
    const dailyFee = Number(application?.subscriptionAmount ?? merchant.subscriptionAmount)
      + addOns.reduce(
        (sum, addOn) =>
          sum + Number(addOn.amount) * addOnQuantity(application?.selectedAddOnQuantities, addOn.id),
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
