import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** API and funded-days arithmetic use JS numbers rounded to 2 decimal places. */
export function moneyNumber(value: unknown): number {
  if (value instanceof Prisma.Decimal) {
    return Number(value.toFixed(2));
  }
  if (value && typeof value === 'object' && 'toFixed' in value) {
    return Number((value as Prisma.Decimal).toFixed(2));
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function moneyDecimal(value: unknown): Prisma.Decimal {
  return new Prisma.Decimal(moneyNumber(value).toFixed(2));
}

export function requirePositiveMoney(value: unknown): Prisma.Decimal {
  const amount = moneyDecimal(value);
  if (amount.lte(0)) {
    throw new BadRequestException('Amount must be greater than zero');
  }
  return amount;
}

export function serializeWallet(wallet: {
  id: string;
  userId: string;
  balance: unknown;
  isActive: boolean;
  isVerified: boolean;
  pinSet: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: wallet.id,
    userId: wallet.userId,
    balance: moneyNumber(wallet.balance),
    isActive: wallet.isActive,
    isVerified: wallet.isVerified,
    pinSet: wallet.pinSet,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  };
}

export function serializeWalletTransaction<T extends Record<string, unknown>>(
  txn: T,
) {
  return {
    ...txn,
    amount: moneyNumber(txn.amount),
    fee: moneyNumber(txn.fee),
    netAmount: moneyNumber(txn.netAmount),
    balanceBefore:
      txn.balanceBefore == null ? txn.balanceBefore : moneyNumber(txn.balanceBefore),
    balanceAfter:
      txn.balanceAfter == null ? txn.balanceAfter : moneyNumber(txn.balanceAfter),
  };
}
