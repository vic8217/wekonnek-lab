import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  WalletPaymentGateway,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CoordinatorApplicationsService } from '../coordinator-applications/coordinator-applications.service';
import {
  computeDailySubscriptionFee,
  dailySubscriptionReference,
  philippineBillingDay,
} from './philippine-billing-day';

export type DailyBillingResultCode =
  'charged' | 'alreadyBilled' | 'insufficient' | 'skipped' | 'failed';

export type DailyBillingResult = {
  merchantId: number;
  reference: string | null;
  amount: number;
  result: DailyBillingResultCode;
};

export type DailyBillingSummary = {
  billingDate: string;
  timeZone: 'Asia/Manila';
  processed: number;
  charged: number;
  alreadyBilled: number;
  insufficient: number;
  skipped: number;
  failed: number;
  results: DailyBillingResult[];
};

@Injectable()
export class MerchantSubscriptionBillingService {
  private readonly logger = new Logger(MerchantSubscriptionBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coordinatorApplications: CoordinatorApplicationsService,
  ) {}

  async runDailyBilling(now = new Date()): Promise<DailyBillingSummary> {
    const billingDay = philippineBillingDay(now);
    const merchants = await this.prisma.merchant.findMany({
      where: { userId: { not: null } },
      select: {
        id: true,
        userId: true,
        subscriptionPlan: true,
        subscriptionTier: true,
        subscriptionAmount: true,
        subscriptionStatus: true,
        status: true,
        merchantCode: true,
      },
    });
    const summary: DailyBillingSummary = {
      billingDate: billingDay.key,
      timeZone: 'Asia/Manila',
      processed: 0,
      charged: 0,
      alreadyBilled: 0,
      insufficient: 0,
      skipped: 0,
      failed: 0,
      results: [],
    };
    for (const merchant of merchants) {
      const row = await this.billMerchantForDate(merchant.id, now);
      summary.processed += 1;
      if (row.result === 'charged') summary.charged += 1;
      else if (row.result === 'alreadyBilled') summary.alreadyBilled += 1;
      else if (row.result === 'insufficient') summary.insufficient += 1;
      else if (row.result === 'skipped') summary.skipped += 1;
      else summary.failed += 1;
      summary.results.push(row);
    }
    this.logger.log(
      `subscription_daily_billing_complete date=${billingDay.key} processed=${summary.processed} charged=${summary.charged} alreadyBilled=${summary.alreadyBilled} insufficient=${summary.insufficient} skipped=${summary.skipped} failed=${summary.failed}`,
    );
    return summary;
  }

  async billMerchantForDate(
    merchantId: number,
    now = new Date(),
  ): Promise<DailyBillingResult> {
    const billingDay = philippineBillingDay(now);
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    });
    if (!merchant?.userId) {
      return {
        merchantId,
        reference: null,
        amount: 0,
        result: 'skipped',
      };
    }
    const isDailyPlan = merchant.subscriptionPlan.toLowerCase() === 'daily';
    const reference = dailySubscriptionReference(merchant.id, billingDay.key);
    if (!isDailyPlan) {
      this.logger.log(
        `subscription_billing_skipped date=${billingDay.key} merchantId=${merchant.id} reference=${reference} reason=not_daily`,
      );
      return {
        merchantId: merchant.id,
        reference,
        amount: 0,
        result: 'skipped',
      };
    }

    const [wallet, application] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId: merchant.userId } }),
      merchant.merchantCode
        ? this.prisma.merchantApplication.findUnique({
            where: { merchantCode: merchant.merchantCode },
          })
        : null,
    ]);
    const addOns = application?.selectedAddOnIds.length
      ? await this.prisma.subscriptionAddOnPackage.findMany({
          where: { id: { in: application.selectedAddOnIds } },
          select: { id: true, amount: true },
        })
      : [];
    const fees = computeDailySubscriptionFee(
      Number(application?.subscriptionAmount ?? merchant.subscriptionAmount),
      addOns,
      application?.selectedAddOnQuantities,
    );
    if (fees.dailySubscriptionFee <= 0) {
      await this.syncMerchantAccount(merchant.id, merchant.status, true);
      return {
        merchantId: merchant.id,
        reference,
        amount: 0,
        result: 'skipped',
      };
    }

    const existingCharge = await this.prisma.walletTransaction.findUnique({
      where: { referenceNumber: reference },
      select: { id: true, status: true },
    });
    if (existingCharge?.status === WalletTransactionStatus.completed) {
      await this.syncMerchantAccount(merchant.id, merchant.status, true);
      this.logger.log(
        `subscription_billing_already_billed date=${billingDay.key} merchantId=${merchant.id} reference=${reference} amount=${fees.dailySubscriptionFee}`,
      );
      return {
        merchantId: merchant.id,
        reference,
        amount: fees.dailySubscriptionFee,
        result: 'alreadyBilled',
      };
    }

    if (!wallet) {
      await this.syncMerchantAccount(merchant.id, merchant.status, false);
      this.logger.log(
        `subscription_billing_insufficient date=${billingDay.key} merchantId=${merchant.id} reference=${reference} amount=${fees.dailySubscriptionFee} reason=no_wallet`,
      );
      return {
        merchantId: merchant.id,
        reference,
        amount: fees.dailySubscriptionFee,
        result: 'insufficient',
      };
    }

    const coveredShops = await this.prisma.branch.findMany({
      where: { merchantId: merchant.id },
      select: { id: true, name: true, shopId: true },
      orderBy: { createdAt: 'asc' },
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.walletTransaction.create({
          data: {
            referenceNumber: reference,
            walletId: wallet.id,
            type: WalletTransactionType.payment,
            status: WalletTransactionStatus.completed,
            gateway: WalletPaymentGateway.internal,
            amount: fees.dailySubscriptionFee,
            fee: 0,
            netAmount: fees.dailySubscriptionFee,
            description: `Daily ${merchant.subscriptionTier} subscription fee`,
            metadata: {
              merchantId: merchant.id,
              billingDate: billingDay.key,
              purpose: 'daily_subscription',
              shops: coveredShops.map((shop) => ({
                id: shop.id,
                name: shop.name,
                shopId: shop.shopId,
              })),
            },
          },
        });
        const deduction = await tx.wallet.updateMany({
          where: {
            id: wallet.id,
            balance: { gte: fees.dailySubscriptionFee },
          },
          data: { balance: { decrement: fees.dailySubscriptionFee } },
        });
        if (deduction.count !== 1) {
          throw new Error('INSUFFICIENT_WALLET_BALANCE');
        }
        await tx.subscriptionPayment.create({
          data: {
            merchantId: merchant.id,
            tier: merchant.subscriptionTier,
            plan: 'daily',
            amount: fees.dailySubscriptionFee,
            paymentMethod: 'wallet',
            gateway: 'internal',
            status: 'paid',
            paymentRef: reference,
            periodStart: billingDay.periodStart,
            periodEnd: billingDay.periodEnd,
          },
        });
        await this.applyMerchantAccount(tx, merchant.id, merchant.status, true);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const charged = await this.prisma.walletTransaction.findUnique({
          where: { referenceNumber: reference },
          select: { status: true },
        });
        if (charged?.status === WalletTransactionStatus.completed) {
          await this.syncMerchantAccount(merchant.id, merchant.status, true);
          this.logger.log(
            `subscription_billing_already_billed date=${billingDay.key} merchantId=${merchant.id} reference=${reference} amount=${fees.dailySubscriptionFee}`,
          );
          return {
            merchantId: merchant.id,
            reference,
            amount: fees.dailySubscriptionFee,
            result: 'alreadyBilled',
          };
        }
      }
      if (
        error instanceof Error &&
        error.message === 'INSUFFICIENT_WALLET_BALANCE'
      ) {
        await this.syncMerchantAccount(merchant.id, merchant.status, false);
        this.logger.log(
          `subscription_billing_insufficient date=${billingDay.key} merchantId=${merchant.id} reference=${reference} amount=${fees.dailySubscriptionFee}`,
        );
        return {
          merchantId: merchant.id,
          reference,
          amount: fees.dailySubscriptionFee,
          result: 'insufficient',
        };
      }
      this.logger.error(
        `subscription_billing_failed date=${billingDay.key} merchantId=${merchant.id} reference=${reference}`,
      );
      return {
        merchantId: merchant.id,
        reference,
        amount: fees.dailySubscriptionFee,
        result: 'failed',
      };
    }

    await this.coordinatorApplications.creditFixedFeeCommission(
      merchant.id,
      fees.dailySubscriptionFee,
      reference,
    );
    await this.syncMerchantAccount(merchant.id, merchant.status, true);
    this.logger.log(
      `subscription_billing_charged date=${billingDay.key} merchantId=${merchant.id} reference=${reference} amount=${fees.dailySubscriptionFee}`,
    );
    return {
      merchantId: merchant.id,
      reference,
      amount: fees.dailySubscriptionFee,
      result: 'charged',
    };
  }

  private async syncMerchantAccount(
    merchantId: number,
    currentStatus: string,
    accountActive: boolean,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.applyMerchantAccount(
        tx,
        merchantId,
        currentStatus,
        accountActive,
      );
    });
  }

  private async applyMerchantAccount(
    tx: Prisma.TransactionClient,
    merchantId: number,
    currentStatus: string,
    accountActive: boolean,
  ) {
    const nextStatus = accountActive
      ? currentStatus === 'inactive'
        ? 'active'
        : currentStatus
      : currentStatus === 'active'
        ? 'inactive'
        : currentStatus;
    await tx.merchant.update({
      where: { id: merchantId },
      data: {
        isActive: accountActive && nextStatus === 'active',
        status: nextStatus,
        subscriptionStatus: accountActive ? 'active' : 'inactive',
      },
    });
  }
}
