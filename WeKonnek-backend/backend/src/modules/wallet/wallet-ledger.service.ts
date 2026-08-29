import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WalletPaymentGateway,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export class InsufficientWalletBalanceError extends Error {
  constructor() {
    super('INSUFFICIENT_WALLET_BALANCE');
    this.name = 'InsufficientWalletBalanceError';
  }
}

type JsonMeta = Record<string, unknown>;

export type WalletDebitInput = {
  walletId: string;
  amount: number;
  reference: string;
  type: WalletTransactionType;
  description?: string;
  metadata?: JsonMeta;
  orderId?: string;
  fee?: number;
  status?: WalletTransactionStatus;
  gateway?: WalletPaymentGateway;
  cashOutBank?: string;
  cashOutAccountNumber?: string;
  cashOutAccountName?: string;
};

export type WalletCreditInput = {
  walletId: string;
  amount: number;
  reference: string;
  type: WalletTransactionType;
  description?: string;
  metadata?: JsonMeta;
  orderId?: string;
  status?: WalletTransactionStatus;
  gateway?: WalletPaymentGateway;
};

@Injectable()
export class WalletLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async debitWalletAtomic(input: WalletDebitInput) {
    const amount = this.requirePositiveAmount(input.amount);
    const fee = input.fee && input.fee > 0 ? input.fee : 0;
    const total = amount + fee;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.walletTransaction.create({
          data: {
            referenceNumber: input.reference,
            walletId: input.walletId,
            type: input.type,
            status: input.status ?? WalletTransactionStatus.completed,
            gateway: input.gateway ?? WalletPaymentGateway.internal,
            amount,
            fee,
            netAmount: amount,
            orderId: input.orderId,
            description: input.description,
            cashOutBank: input.cashOutBank,
            cashOutAccountNumber: input.cashOutAccountNumber,
            cashOutAccountName: input.cashOutAccountName,
            metadata: (input.metadata || {}) as Prisma.InputJsonValue,
          },
        });
        const deduction = await tx.wallet.updateMany({
          where: { id: input.walletId, balance: { gte: total } },
          data: { balance: { decrement: total } },
        });
        if (deduction.count !== 1) throw new InsufficientWalletBalanceError();
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { id: input.walletId },
        });
        const transaction = await tx.walletTransaction.update({
          where: { id: created.id },
          data: {
            metadata: {
              ...(input.metadata || {}),
              balanceBefore: Number(wallet.balance) + total,
              balanceAfter: Number(wallet.balance),
            } as Prisma.InputJsonValue,
          },
        });
        return { wallet, transaction, duplicate: false as const };
      });
    } catch (error) {
      if (error instanceof InsufficientWalletBalanceError) {
        throw new BadRequestException('Insufficient wallet balance');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.existingByReference(input.reference, true);
      }
      throw error;
    }
  }

  async creditWalletAtomic(input: WalletCreditInput) {
    const amount = this.requirePositiveAmount(input.amount);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.walletTransaction.create({
          data: {
            referenceNumber: input.reference,
            walletId: input.walletId,
            type: input.type,
            status: input.status ?? WalletTransactionStatus.completed,
            gateway: input.gateway ?? WalletPaymentGateway.internal,
            amount,
            fee: 0,
            netAmount: amount,
            orderId: input.orderId,
            description: input.description,
            metadata: (input.metadata || {}) as Prisma.InputJsonValue,
          },
        });
        const credit = await tx.wallet.updateMany({
          where: { id: input.walletId },
          data: { balance: { increment: amount } },
        });
        if (credit.count !== 1) throw new NotFoundException('Wallet not found');
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { id: input.walletId },
        });
        const transaction = await tx.walletTransaction.update({
          where: { id: created.id },
          data: {
            metadata: {
              ...(input.metadata || {}),
              balanceBefore: Number(wallet.balance) - amount,
              balanceAfter: Number(wallet.balance),
            } as Prisma.InputJsonValue,
          },
        });
        return { wallet, transaction, duplicate: false as const };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.existingByReference(input.reference, true);
      }
      throw error;
    }
  }

  async completePendingCredit(transactionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.walletTransaction.updateMany({
        where: {
          id: transactionId,
          status: {
            in: [WalletTransactionStatus.pending, WalletTransactionStatus.processing],
          },
        },
        data: { status: WalletTransactionStatus.completed },
      });
      const txn = await tx.walletTransaction.findUnique({
        where: { id: transactionId },
      });
      if (!txn) throw new NotFoundException('Wallet transaction not found');
      if (claimed.count !== 1) {
        const wallet = await tx.wallet.findUnique({ where: { id: txn.walletId } });
        return { wallet, transaction: txn, duplicate: true as const };
      }
      const amount = Number(txn.netAmount);
      if (!(amount > 0)) {
        throw new BadRequestException('Pending credit amount must be greater than zero');
      }
      await tx.wallet.updateMany({
        where: { id: txn.walletId },
        data: { balance: { increment: amount } },
      });
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { id: txn.walletId },
      });
      const metadata = (txn.metadata && typeof txn.metadata === 'object' && !Array.isArray(txn.metadata)
        ? txn.metadata
        : {}) as JsonMeta;
      const transaction = await tx.walletTransaction.update({
        where: { id: txn.id },
        data: {
          metadata: {
            ...metadata,
            balanceBefore: Number(wallet.balance) - amount,
            balanceAfter: Number(wallet.balance),
          } as Prisma.InputJsonValue,
        },
      });
      return { wallet, transaction, duplicate: false as const };
    });
  }

  async adjustWallet(input: {
    walletId: string;
    amount: number;
    direction: 'credit' | 'debit';
    reason: string;
    actorUserId: string;
    reference?: string;
  }) {
    if (!input.reason || !input.reason.trim()) {
      throw new BadRequestException('Adjustment reason is required');
    }
    if (input.direction !== 'credit' && input.direction !== 'debit') {
      throw new BadRequestException('Adjustment direction must be credit or debit');
    }
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: input.walletId },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    const reference =
      input.reference ||
      `ADJ-${wallet.id.replace(/-/g, '').slice(0, 12)}-${Date.now().toString(36).toUpperCase()}`;
    const metadata = {
      purpose: 'admin_adjustment',
      direction: input.direction,
      reason: input.reason.trim(),
      actorUserId: input.actorUserId,
      ownerUserId: wallet.userId,
    };
    const result =
      input.direction === 'credit'
        ? await this.creditWalletAtomic({
            walletId: wallet.id,
            amount: input.amount,
            reference,
            type: WalletTransactionType.top_up,
            description: `Admin credit: ${input.reason.trim()}`,
            metadata,
          })
        : await this.debitWalletAtomic({
            walletId: wallet.id,
            amount: input.amount,
            reference,
            type: WalletTransactionType.payment,
            description: `Admin debit: ${input.reason.trim()}`,
            metadata,
          });
    return {
      walletId: wallet.id,
      ownerUserId: wallet.userId,
      direction: input.direction,
      amount: input.amount,
      reason: input.reason.trim(),
      actorUserId: input.actorUserId,
      reference,
      duplicate: result.duplicate,
      wallet_balance: Number(result.wallet?.balance ?? wallet.balance),
      transaction: result.transaction,
    };
  }

  private async existingByReference(reference: string, duplicate: true) {
    const transaction = await this.prisma.walletTransaction.findUnique({
      where: { referenceNumber: reference },
    });
    if (!transaction) throw new NotFoundException('Wallet transaction not found');
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: transaction.walletId },
    });
    return { wallet, transaction, duplicate };
  }

  private requirePositiveAmount(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Amount must be greater than zero');
    }
    return amount;
  }
}
