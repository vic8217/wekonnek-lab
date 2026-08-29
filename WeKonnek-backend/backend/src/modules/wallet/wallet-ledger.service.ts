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
import {
  moneyDecimal,
  moneyNumber,
  requirePositiveMoney,
  serializeWalletTransaction,
} from './wallet-money';

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
  purpose?: string;
  actorUserId?: string;
  idempotencyKey?: string;
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
  purpose?: string;
  actorUserId?: string;
  idempotencyKey?: string;
};

@Injectable()
export class WalletLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async debitWalletAtomic(input: WalletDebitInput) {
    const amount = requirePositiveMoney(input.amount);
    const fee =
      input.fee && moneyNumber(input.fee) > 0 ? moneyDecimal(input.fee) : moneyDecimal(0);
    const total = amount.plus(fee);
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
            purpose: input.purpose,
            actorUserId: input.actorUserId,
            idempotencyKey: input.idempotencyKey,
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
        const balanceAfter = moneyDecimal(wallet.balance);
        const balanceBefore = balanceAfter.plus(total);
        const transaction = await tx.walletTransaction.update({
          where: { id: created.id },
          data: { balanceBefore, balanceAfter },
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
    const amount = requirePositiveMoney(input.amount);
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
            purpose: input.purpose,
            actorUserId: input.actorUserId,
            idempotencyKey: input.idempotencyKey,
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
        const balanceAfter = moneyDecimal(wallet.balance);
        const balanceBefore = balanceAfter.minus(amount);
        const transaction = await tx.walletTransaction.update({
          where: { id: created.id },
          data: { balanceBefore, balanceAfter },
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
      const amount = requirePositiveMoney(txn.netAmount);
      await tx.wallet.updateMany({
        where: { id: txn.walletId },
        data: { balance: { increment: amount } },
      });
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { id: txn.walletId },
      });
      const balanceAfter = moneyDecimal(wallet.balance);
      const transaction = await tx.walletTransaction.update({
        where: { id: txn.id },
        data: {
          balanceBefore: balanceAfter.minus(amount),
          balanceAfter,
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
    const amount = moneyNumber(input.amount);
    const metadata = {
      direction: input.direction,
      reason: input.reason.trim(),
      ownerUserId: wallet.userId,
    };
    const result =
      input.direction === 'credit'
        ? await this.creditWalletAtomic({
            walletId: wallet.id,
            amount,
            reference,
            type: WalletTransactionType.top_up,
            description: `Admin credit: ${input.reason.trim()}`,
            metadata,
            purpose: 'admin_adjustment',
            actorUserId: input.actorUserId,
            idempotencyKey: input.reference,
          })
        : await this.debitWalletAtomic({
            walletId: wallet.id,
            amount,
            reference,
            type: WalletTransactionType.payment,
            description: `Admin debit: ${input.reason.trim()}`,
            metadata,
            purpose: 'admin_adjustment',
            actorUserId: input.actorUserId,
            idempotencyKey: input.reference,
          });
    return {
      walletId: wallet.id,
      ownerUserId: wallet.userId,
      direction: input.direction,
      amount,
      reason: input.reason.trim(),
      actorUserId: input.actorUserId,
      reference,
      duplicate: result.duplicate,
      wallet_balance: moneyNumber(result.wallet?.balance ?? wallet.balance),
      transaction: serializeWalletTransaction(
        result.transaction as unknown as Record<string, unknown>,
      ),
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
}
