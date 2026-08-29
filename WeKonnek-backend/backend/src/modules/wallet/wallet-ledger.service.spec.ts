/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  PlatformPaymentDestination,
  PlatformPaymentSourceType,
  PlatformPaymentStatus,
  Prisma,
  WalletPaymentGateway,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { WalletLedgerService } from './wallet-ledger.service';
import { WalletService } from './wallet.service';
import { WalletReloadService } from '../../payment-partners/wallet-reload.service';
import { MerchantSubscriptionBillingService } from '../../merchants/merchant-subscription-billing.service';
import { dailySubscriptionReference, philippineBillingDay } from '../../merchants/philippine-billing-day';
import { WalletAdminController } from './wallet-admin.controller';
import { CreateWalletAdjustmentDto } from './dto/create-wallet-adjustment.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { moneyDecimal, moneyNumber } from './wallet-money';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const WALLET_ID = '33333333-3333-3333-3333-333333333333';
const PAYMENT_ID = '44444444-4444-4444-4444-444444444444';
const RELOAD_TXN_ID = '55555555-5555-5555-5555-555555555555';
const REFERENCE = 'WK260829RELOAD000001';
const ADDON_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN_ID = 'admin-user-1';

function billingNow() {
  return new Date('2026-08-29T04:00:00.000Z');
}

function createStore(
  initial: {
    balance?: number;
    paymentStatus?: PlatformPaymentStatus;
    reloadTxnStatus?: WalletTransactionStatus;
  } = {},
) {
  const billingDay = philippineBillingDay(billingNow());
  const wallet = {
    id: WALLET_ID,
    userId: USER_ID,
    balance: initial.balance ?? 100,
    isActive: true,
    pin: '123456',
    pinHash: null as string | null,
    pinSet: true,
    pinFailedAttempts: 0,
    pinLockedUntil: null as Date | null,
  };
  const merchant = {
    id: 9,
    userId: USER_ID,
    merchantCode: 'WK-9',
    subscriptionPlan: 'daily',
    subscriptionTier: 'basic',
    subscriptionAmount: 80,
    subscriptionStatus: 'active',
    status: 'active',
    isActive: true,
  };
  const application = {
    merchantCode: 'WK-9',
    subscriptionAmount: 80,
    selectedAddOnIds: [ADDON_ID],
    selectedAddOnQuantities: { [ADDON_ID]: 2 },
  };
  const addOn = { id: ADDON_ID, amount: 10 };
  const txns: any[] = [];
  const subscriptionPayments: any[] = [];
  const payment = {
    id: PAYMENT_ID,
    reference: REFERENCE,
    provider: 'PAYCOOLS',
    providerTransactionId: null as string | null,
    destination: PlatformPaymentDestination.USER_WALLET,
    sourceType: PlatformPaymentSourceType.MERCHANT_SUBSCRIPTION,
    sourceId: RELOAD_TXN_ID,
    merchantId: null,
    payerUserId: USER_ID,
    walletId: WALLET_ID,
    amount: 500,
    providerAmountMinor: 50000,
    currency: 'PHP',
    status: initial.paymentStatus ?? PlatformPaymentStatus.PENDING,
    metadata: { purpose: 'merchant_wallet_reload', merchantId: 9 },
    createdAt: new Date(),
    updatedAt: new Date(),
    paidAt: null as Date | null,
  };
  const reloadTxn = {
    id: RELOAD_TXN_ID,
    referenceNumber: REFERENCE,
    walletId: WALLET_ID,
    type: WalletTransactionType.top_up,
    status: initial.reloadTxnStatus ?? WalletTransactionStatus.pending,
    gateway: WalletPaymentGateway.internal,
    amount: 500,
    fee: 0,
    netAmount: 500,
    metadata: { purpose: 'merchant_wallet_reload' },
  };
  txns.push(reloadTxn);

  let claimChain = Promise.resolve();
  const serialize = <T>(fn: () => T | Promise<T>) => {
    const next = claimChain.then(fn, fn);
    claimChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const cloneTxn = (row: any) => ({
    ...row,
    metadata:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? { ...row.metadata }
        : row.metadata,
  });

  const takeSnapshot = () => ({
    balance: wallet.balance,
    merchant: { ...merchant },
    payment: { ...payment },
    txns: txns.map(cloneTxn),
    subscriptionPayments: subscriptionPayments.map((row) => ({ ...row })),
  });

  const restoreSnapshot = (snap: ReturnType<typeof takeSnapshot>) => {
    wallet.balance = snap.balance;
    Object.assign(merchant, snap.merchant);
    Object.assign(payment, snap.payment);
    txns.length = 0;
    txns.push(...snap.txns);
    subscriptionPayments.length = 0;
    subscriptionPayments.push(...snap.subscriptionPayments);
  };

  const findTxn = (where: any) => {
    if (where.id) return txns.find((row) => row.id === where.id) || null;
    if (where.referenceNumber)
      return txns.find((row) => row.referenceNumber === where.referenceNumber) || null;
    if (where.gatewayTransactionId)
      return (
        txns.find((row) => row.gatewayTransactionId === where.gatewayTransactionId) || null
      );
    return null;
  };

  const tx = {
    walletTransaction: {
      create: jest.fn(async ({ data }: any) => {
        if (txns.some((row) => row.referenceNumber === data.referenceNumber)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        const row = { id: randomUUID(), ...data };
        txns.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = findTxn(where);
        if (!row) throw new Error('wallet transaction missing');
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = findTxn(where);
        if (!row) return { count: 0 };
        const statuses = where.status?.in;
        if (statuses && !statuses.includes(row.status)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = findTxn(where);
        return row ? cloneTxn(row) : null;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const row = findTxn(where);
        return row ? cloneTxn(row) : null;
      }),
    },
    wallet: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.id !== wallet.id) return { count: 0 };
        if (where.balance?.gte !== undefined && Number(wallet.balance) < Number(where.balance.gte)) {
          return { count: 0 };
        }
        if (data.balance?.decrement !== undefined)
          wallet.balance = Number(wallet.balance) - Number(data.balance.decrement);
        if (data.balance?.increment !== undefined)
          wallet.balance = Number(wallet.balance) + Number(data.balance.increment);
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        if (where?.id && where.id !== wallet.id) throw new Error('wallet missing');
        const { balance, ...rest } = data;
        Object.assign(wallet, rest);
        if (balance?.increment !== undefined)
          wallet.balance = Number(wallet.balance) + Number(balance.increment);
        else if (balance?.decrement !== undefined)
          wallet.balance = Number(wallet.balance) - Number(balance.decrement);
        else if (balance !== undefined) wallet.balance = Number(balance);
        return { ...wallet };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id && where.id !== wallet.id) return null;
        if (where.userId && where.userId !== wallet.userId) return null;
        return { ...wallet };
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: any) => {
        if (where.id && where.id !== wallet.id) throw new Error('wallet missing');
        if (where.userId && where.userId !== wallet.userId) throw new Error('wallet missing');
        return { ...wallet };
      }),
    },
    platformPaymentTransaction: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const statusOk = !where.status || payment.status === where.status;
        const providerOk = !where.provider || payment.provider === where.provider;
        const idOk = !where.id || payment.id === where.id;
        if (!statusOk || !providerOk || !idOk) return { count: 0 };
        Object.assign(payment, data);
        return { count: 1 };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id && where.id !== payment.id) return null;
        if (where.reference && where.reference !== payment.reference) return null;
        return { ...payment };
      }),
    },
    merchant: {
      update: jest.fn(async ({ data }: any) => {
        Object.assign(merchant, data);
        return { ...merchant };
      }),
    },
    subscriptionPayment: {
      create: jest.fn(async ({ data }: any) => {
        subscriptionPayments.push(data);
        return data;
      }),
    },
  };

  const prisma = {
    merchant: {
      findFirst: jest.fn(async () => ({ ...merchant })),
      findUnique: jest.fn(async () => ({ ...merchant })),
      findMany: jest.fn(async () => [{ ...merchant }]),
      update: tx.merchant.update,
    },
    wallet: {
      findUnique: tx.wallet.findUnique,
      findUniqueOrThrow: tx.wallet.findUniqueOrThrow,
      updateMany: tx.wallet.updateMany,
      update: tx.wallet.update,
      upsert: jest.fn(async () => ({ ...wallet })),
      create: jest.fn(async () => ({ ...wallet })),
    },
    merchantApplication: {
      findUnique: jest.fn(async () => application),
    },
    subscriptionAddOnPackage: {
      findMany: jest.fn(async () => [addOn]),
    },
    walletTransaction: {
      findUnique: tx.walletTransaction.findUnique,
      findFirst: tx.walletTransaction.findFirst,
      create: tx.walletTransaction.create,
      update: tx.walletTransaction.update,
      updateMany: tx.walletTransaction.updateMany,
      findMany: jest.fn(async () => txns.map(cloneTxn)),
    },
    platformPaymentTransaction: {
      findUnique: tx.platformPaymentTransaction.findUnique,
      updateMany: tx.platformPaymentTransaction.updateMany,
    },
    subscriptionPayment: {
      create: tx.subscriptionPayment.create,
    },
    branch: {
      findMany: jest.fn(async () => [{ id: 1, name: 'Main', shopId: 'WKS-1' }]),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (Array.isArray(arg)) return serialize(() => Promise.all(arg));
      return serialize(async () => {
        const snap = takeSnapshot();
        try {
          return await arg(tx);
        } catch (error) {
          restoreSnapshot(snap);
          throw error;
        }
      });
    }),
  };

  const ledger = new WalletLedgerService(prisma as never);
  const walletService = new WalletService(
    prisma as never,
    {
      verifyWebhook: jest.fn(async () => ({
        transactionId: REFERENCE,
        status: 'completed',
        amount: 500,
      })),
    } as never,
    { notify: jest.fn(async () => undefined) } as never,
    ledger,
  );
  const reload = new WalletReloadService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const billing = new MerchantSubscriptionBillingService(prisma as never, {
    creditFixedFeeCommission: jest.fn(async () => ({ id: 'coord-1' })),
  } as never);

  return {
    prisma,
    tx,
    wallet,
    merchant,
    txns,
    payment,
    reloadTxn,
    billingDay,
    ledger,
    walletService,
    reload,
    billing,
  };
}

describe('WalletLedgerService Stage 3 concurrency', () => {
  it('lets only one simultaneous wallet payment debit when balance covers one', async () => {
    const { ledger, wallet, txns } = createStore({ balance: 100 });
    const results = await Promise.allSettled([
      ledger.debitWalletAtomic({
        walletId: WALLET_ID,
        amount: 100,
        reference: 'PAY-user-order-a',
        type: WalletTransactionType.payment,
      }),
      ledger.debitWalletAtomic({
        walletId: WALLET_ID,
        amount: 100,
        reference: 'PAY-user-order-b',
        type: WalletTransactionType.payment,
      }),
    ]);
    const ok = results.filter((row) => row.status === 'fulfilled');
    const failed = results.filter((row) => row.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].status).toBe('rejected');
    if (failed[0].status === 'rejected') {
      expect(failed[0].reason).toBeInstanceOf(BadRequestException);
    }
    expect(wallet.balance).toBe(0);
    expect(txns.filter((row) => String(row.referenceNumber).startsWith('PAY-'))).toHaveLength(1);
  });

  it('lets only one simultaneous cash-out succeed and never goes negative', async () => {
    const { ledger, wallet } = createStore({ balance: 115 });
    const results = await Promise.allSettled([
      ledger.debitWalletAtomic({
        walletId: WALLET_ID,
        amount: 100,
        fee: 15,
        reference: 'CO-1',
        type: WalletTransactionType.cash_out,
      }),
      ledger.debitWalletAtomic({
        walletId: WALLET_ID,
        amount: 100,
        fee: 15,
        reference: 'CO-2',
        type: WalletTransactionType.cash_out,
      }),
    ]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((row) => row.status === 'rejected')).toHaveLength(1);
    expect(wallet.balance).toBe(0);
  });

  it('lets only one simultaneous admin debit succeed and never goes negative', async () => {
    const { ledger, wallet } = createStore({ balance: 40 });
    const results = await Promise.allSettled([
      ledger.adjustWallet({
        walletId: WALLET_ID,
        amount: 40,
        direction: 'debit',
        reason: 'Chargeback A',
        actorUserId: ADMIN_ID,
        reference: 'ADJ-A',
      }),
      ledger.adjustWallet({
        walletId: WALLET_ID,
        amount: 40,
        direction: 'debit',
        reason: 'Chargeback B',
        actorUserId: ADMIN_ID,
        reference: 'ADJ-B',
      }),
    ]);
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((row) => row.status === 'rejected')).toHaveLength(1);
    expect(wallet.balance).toBe(0);
  });

  it('does not lose updates when two credits run at once', async () => {
    const { ledger, wallet } = createStore({ balance: 100 });
    await Promise.all([
      ledger.creditWalletAtomic({
        walletId: WALLET_ID,
        amount: 50,
        reference: 'CR-1',
        type: WalletTransactionType.top_up,
      }),
      ledger.creditWalletAtomic({
        walletId: WALLET_ID,
        amount: 75,
        reference: 'CR-2',
        type: WalletTransactionType.top_up,
      }),
    ]);
    expect(wallet.balance).toBe(225);
  });

  it('credits a duplicate reference only once', async () => {
    const { ledger, wallet, txns } = createStore({ balance: 10 });
    const first = await ledger.creditWalletAtomic({
      walletId: WALLET_ID,
      amount: 20,
      reference: 'ERN-order-1',
      type: WalletTransactionType.earning,
    });
    const second = await ledger.creditWalletAtomic({
      walletId: WALLET_ID,
      amount: 20,
      reference: 'ERN-order-1',
      type: WalletTransactionType.earning,
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(wallet.balance).toBe(30);
    expect(txns.filter((row) => row.referenceNumber === 'ERN-order-1')).toHaveLength(1);
  });

  it('debits a duplicate reference only once', async () => {
    const { ledger, wallet } = createStore({ balance: 80 });
    const first = await ledger.debitWalletAtomic({
      walletId: WALLET_ID,
      amount: 30,
      reference: 'PAY-user-order-9',
      type: WalletTransactionType.payment,
    });
    const second = await ledger.debitWalletAtomic({
      walletId: WALLET_ID,
      amount: 30,
      reference: 'PAY-user-order-9',
      type: WalletTransactionType.payment,
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(wallet.balance).toBe(50);
  });

  it('does not partially debit when transfer is requested', async () => {
    const { walletService, wallet, txns } = createStore({ balance: 90 });
    await expect(
      walletService.transfer(USER_ID, '09171234567', 90, '123456'),
    ).rejects.toBeInstanceOf(NotImplementedException);
    expect(wallet.balance).toBe(90);
    expect(
      txns.filter(
        (row) =>
          row.type === WalletTransactionType.transfer_out ||
          row.type === WalletTransactionType.transfer_in,
      ),
    ).toHaveLength(0);
  });

  it('keeps a non-negative balance when PayCools credit races a generic debit', async () => {
    const { ledger, reload, wallet } = createStore({ balance: 100 });
    const [pay, callback] = await Promise.allSettled([
      ledger.debitWalletAtomic({
        walletId: WALLET_ID,
        amount: 100,
        reference: 'PAY-user-order-race',
        type: WalletTransactionType.payment,
      }),
      reload.settleVerified({
        reference: REFERENCE,
        providerTransactionId: 'pc-txn-1',
        amountMinor: 50000,
        currency: 'PHP',
        status: 'PAID',
        eventName: 'qrcode.payment.success',
      }),
    ]);
    expect(pay.status).toBe('fulfilled');
    expect(callback.status).toBe('fulfilled');
    expect(wallet.balance).toBe(500);
    expect(wallet.balance).toBeGreaterThanOrEqual(0);
  });

  it('does not go negative when subscription debit races a wallet payment', async () => {
    const { ledger, billing, wallet } = createStore({ balance: 100 });
    const results = await Promise.allSettled([
      billing.billMerchantForDate(9, billingNow()),
      ledger.debitWalletAtomic({
        walletId: WALLET_ID,
        amount: 100,
        reference: 'PAY-user-order-sub',
        type: WalletTransactionType.payment,
      }),
    ]);
    const fulfilled = results.filter((row) => row.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(wallet.balance).toBeGreaterThanOrEqual(0);
    expect(wallet.balance === 0 || wallet.balance === 100).toBe(true);
  });

  it('leaves zero after an exact-balance debit', async () => {
    const { ledger, wallet } = createStore({ balance: 42 });
    const result = await ledger.debitWalletAtomic({
      walletId: WALLET_ID,
      amount: 42,
      reference: 'PAY-exact',
      type: WalletTransactionType.payment,
    });
    expect(wallet.balance).toBe(0);
    expect(Number(result.transaction.balanceBefore)).toBe(42);
    expect(Number(result.transaction.balanceAfter)).toBe(0);
  });

  it('leaves the wallet unchanged when funds are insufficient', async () => {
    const { ledger, wallet, txns } = createStore({ balance: 20 });
    const before = txns.length;
    await expect(
      ledger.debitWalletAtomic({
        walletId: WALLET_ID,
        amount: 21,
        reference: 'PAY-short',
        type: WalletTransactionType.payment,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.balance).toBe(20);
    expect(txns).toHaveLength(before);
  });

  it('leaves no orphan ledger row when the wallet update fails', async () => {
    const { ledger, wallet, txns, tx } = createStore({ balance: 80 });
    const before = txns.length;
    tx.wallet.updateMany.mockImplementationOnce(async () => {
      throw new Error('connection reset');
    });
    await expect(
      ledger.debitWalletAtomic({
        walletId: WALLET_ID,
        amount: 10,
        reference: 'PAY-fail',
        type: WalletTransactionType.payment,
      }),
    ).rejects.toThrow('connection reset');
    expect(wallet.balance).toBe(80);
    expect(txns).toHaveLength(before);
    expect(txns.some((row) => row.referenceNumber === 'PAY-fail')).toBe(false);
  });
});

describe('WalletLedgerService admin adjustments', () => {
  it('requires a reason', async () => {
    const { ledger } = createStore();
    await expect(
      ledger.adjustWallet({
        walletId: WALLET_ID,
        amount: 10,
        direction: 'credit',
        reason: '  ',
        actorUserId: ADMIN_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores actor, owner, reason, and snapshots on credit', async () => {
    const { ledger, wallet } = createStore({ balance: 5 });
    const result = await ledger.adjustWallet({
      walletId: WALLET_ID,
      amount: 15,
      direction: 'credit',
      reason: 'UAT correction',
      actorUserId: ADMIN_ID,
      reference: 'ADJ-CREDIT-1',
    });
    expect(wallet.balance).toBe(20);
    expect(result.actorUserId).toBe(ADMIN_ID);
    expect(result.ownerUserId).toBe(USER_ID);
    expect(result.reason).toBe('UAT correction');
    expect((result.transaction.metadata as any).purpose).toBeUndefined();
    expect(result.transaction.purpose).toBe('admin_adjustment');
    expect(Number(result.transaction.balanceBefore)).toBe(5);
    expect(Number(result.transaction.balanceAfter)).toBe(20);
  });

  it('debits with the same audited path', async () => {
    const { ledger, wallet } = createStore({ balance: 50 });
    const result = await ledger.adjustWallet({
      walletId: WALLET_ID,
      amount: 12,
      direction: 'debit',
      reason: 'Duplicate top-up reversal',
      actorUserId: ADMIN_ID,
      reference: 'ADJ-DEBIT-1',
    });
    expect(wallet.balance).toBe(38);
    expect((result.transaction.metadata as any).direction).toBe('debit');
    expect(result.transaction.actorUserId).toBe(ADMIN_ID);
  });

  it('rejects an insufficient admin debit without changing balance', async () => {
    const { ledger, wallet, txns } = createStore({ balance: 8 });
    const before = txns.length;
    await expect(
      ledger.adjustWallet({
        walletId: WALLET_ID,
        amount: 9,
        direction: 'debit',
        reason: 'Too large',
        actorUserId: ADMIN_ID,
        reference: 'ADJ-DEBIT-SHORT',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.balance).toBe(8);
    expect(txns).toHaveLength(before);
  });

  it('returns the existing adjustment on a retried reference', async () => {
    const { ledger, wallet } = createStore({ balance: 1 });
    const first = await ledger.adjustWallet({
      walletId: WALLET_ID,
      amount: 4,
      direction: 'credit',
      reason: 'Retryable credit',
      actorUserId: ADMIN_ID,
      reference: 'ADJ-RETRY',
    });
    const second = await ledger.adjustWallet({
      walletId: WALLET_ID,
      amount: 4,
      direction: 'credit',
      reason: 'Retryable credit',
      actorUserId: ADMIN_ID,
      reference: 'ADJ-RETRY',
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(wallet.balance).toBe(5);
  });

  it('rejects unknown wallets', async () => {
    const { ledger } = createStore();
    await expect(
      ledger.adjustWallet({
        walletId: randomUUID(),
        amount: 1,
        direction: 'credit',
        reason: 'missing wallet',
        actorUserId: ADMIN_ID,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WalletService Stage 3 paths', () => {
  it('pays with an owner-scoped idempotent reference', async () => {
    const { walletService, wallet } = createStore({ balance: 70 });
    const first = await walletService.pay(USER_ID, 20, 'order-77', '123456');
    const second = await walletService.pay(USER_ID, 20, 'order-77', '123456');
    expect(first.referenceNumber).toBe(`PAY-${USER_ID}-order-77`);
    expect(second.id).toBe(first.id);
    expect(wallet.balance).toBe(50);
  });

  it('records cash-out internally without pretending funds were disbursed', async () => {
    const { walletService, wallet } = createStore({ balance: 200 });
    const result = await walletService.cashOut(
      USER_ID,
      100,
      WalletPaymentGateway.maya,
      'BDO',
      '1234567890',
      'Test User',
      '123456',
      'CASHOUT01',
    );
    expect(result.disbursed).toBe(false);
    expect(wallet.balance).toBe(85);
    expect(result.transaction.status).toBe(WalletTransactionStatus.processing);
  });

  it('does not debit twice on sequential cash-out retries with the same key', async () => {
    const { walletService, wallet } = createStore({ balance: 200 });
    const first = await walletService.cashOut(
      USER_ID,
      100,
      WalletPaymentGateway.maya,
      'BDO',
      '1234567890',
      'Test User',
      '123456',
      'CASHOUT-RETRY-1',
    );
    const second = await walletService.cashOut(
      USER_ID,
      100,
      WalletPaymentGateway.maya,
      'BDO',
      '1234567890',
      'Test User',
      '123456',
      'CASHOUT-RETRY-1',
    );
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.disbursed).toBe(false);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(wallet.balance).toBe(85);
  });

  it('credits earnings and refunds once per order', async () => {
    const { walletService, wallet } = createStore({ balance: 0 });
    await walletService.creditEarning(USER_ID, 11, 'order-earn');
    await walletService.creditEarning(USER_ID, 11, 'order-earn');
    await walletService.creditRefund(USER_ID, 7, 'order-ref');
    await walletService.creditRefund(USER_ID, 7, 'order-ref');
    expect(wallet.balance).toBe(18);
  });

  it('does not double-credit an old gateway webhook for the same pending row', async () => {
    const { walletService, wallet, reloadTxn } = createStore({
      balance: 10,
      reloadTxnStatus: WalletTransactionStatus.pending,
    });
    reloadTxn.gatewayTransactionId = REFERENCE;
    reloadTxn.netAmount = 40;
    const first = await walletService.handleWebhook(WalletPaymentGateway.paymongo, {}, {});
    const second = await walletService.handleWebhook(WalletPaymentGateway.paymongo, {}, {});
    expect(first).toEqual({ status: 'completed' });
    expect(second).toEqual({ status: 'already_processed' });
    expect(wallet.balance).toBe(50);
  });
});

describe('Wallet admin HTTP contract', () => {
  it('requires a reason on the DTO', async () => {
    const dto = plainToInstance(CreateWalletAdjustmentDto, {
      amount: 10,
      direction: 'credit',
      reason: '',
    });
    const errors = await validate(dto);
    expect(errors.some((row) => row.property === 'reason')).toBe(true);
  });

  it('rejects unauthorized roles', () => {
    const guard = new RolesGuard({
      getAllAndOverride: () => [UserRole.admin],
    } as never);
    const merchantCtx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'm1', role: UserRole.merchant } }),
      }),
    };
    const adminCtx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: ADMIN_ID, role: UserRole.admin } }),
      }),
    };
    expect(guard.canActivate(merchantCtx as never)).toBe(false);
    expect(guard.canActivate(adminCtx as never)).toBe(true);
  });

  it('passes the authenticated admin actor into the adjustment service', async () => {
    const ledger = { adjustWallet: jest.fn(async (input) => input) };
    const controller = new WalletAdminController(ledger as never);
    await controller.adjust(
      WALLET_ID,
      { amount: 3, direction: 'credit', reason: 'manual top-up', idempotencyKey: 'ADJ-HTTP-1' },
      { user: { id: ADMIN_ID } },
    );
    expect(ledger.adjustWallet).toHaveBeenCalledWith({
      walletId: WALLET_ID,
      amount: 3,
      direction: 'credit',
      reason: 'manual top-up',
      actorUserId: ADMIN_ID,
      reference: 'ADJ-HTTP-1',
    });
  });
});

describe('Stage 4 money precision and PIN', () => {
  it('does not drift on 0.1 + 0.2 style credits', async () => {
    const { ledger, wallet } = createStore({ balance: 0 });
    const first = await ledger.creditWalletAtomic({
      walletId: WALLET_ID,
      amount: 0.1,
      reference: 'CR-PREC-1',
      type: WalletTransactionType.top_up,
    });
    const second = await ledger.creditWalletAtomic({
      walletId: WALLET_ID,
      amount: 0.2,
      reference: 'CR-PREC-2',
      type: WalletTransactionType.top_up,
    });
    expect(moneyNumber(wallet.balance)).toBe(0.3);
    expect(Number(first.transaction.balanceAfter)).toBe(0.1);
    expect(Number(second.transaction.balanceAfter)).toBe(0.3);
    expect(moneyNumber(moneyDecimal(0.1).plus(moneyDecimal(0.2)))).toBe(0.3);
  });

  it('does not drift across ten repeated 0.10 credits or debits', async () => {
    const { ledger, wallet } = createStore({ balance: 0 });
    for (let i = 0; i < 10; i += 1) {
      await ledger.creditWalletAtomic({
        walletId: WALLET_ID,
        amount: 0.1,
        reference: `CR-LOOP-${i}`,
        type: WalletTransactionType.top_up,
      });
    }
    expect(moneyNumber(wallet.balance)).toBe(1);
    for (let i = 0; i < 10; i += 1) {
      await ledger.debitWalletAtomic({
        walletId: WALLET_ID,
        amount: 0.1,
        reference: `DR-LOOP-${i}`,
        type: WalletTransactionType.payment,
      });
    }
    expect(moneyNumber(wallet.balance)).toBe(0);
  });

  it('stores hashed PINs and never returns plaintext', async () => {
    const { walletService, wallet, prisma } = createStore({ balance: 10 });
    wallet.pin = null;
    wallet.pinSet = false;
    const publicWallet = await walletService.getPublicWallet(USER_ID);
    expect((publicWallet as any).pin).toBeUndefined();
    expect((publicWallet as any).pinHash).toBeUndefined();
    await walletService.setPin(USER_ID, '654321');
    expect(wallet.pin).toBeNull();
    expect(wallet.pinHash).toMatch(/^\$2[aby]?\$/);
    expect(prisma.wallet.update).toHaveBeenCalled();
    await expect(walletService.verifyPin(USER_ID, '654321')).resolves.toBe(true);
  });

  it('rejects an invalid PIN with a generic error', async () => {
    const { walletService } = createStore();
    await expect(walletService.verifyPin(USER_ID, '000000')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(walletService.verifyPin(USER_ID, '000000')).rejects.toThrow(
      'Invalid wallet PIN',
    );
  });

  it('migrates a legacy plaintext PIN on success and clears plaintext', async () => {
    const { walletService, wallet } = createStore();
    wallet.pin = '123456';
    wallet.pinHash = null;
    await expect(walletService.verifyPin(USER_ID, '123456')).resolves.toBe(true);
    expect(wallet.pinHash).toMatch(/^\$2[aby]?\$/);
    expect(wallet.pin).toBeNull();
    await expect(walletService.verifyPin(USER_ID, '123456')).resolves.toBe(true);
  });

  it('applies a Decimal admin adjustment with typed snapshots', async () => {
    const { ledger, wallet } = createStore({ balance: 1.15 });
    const result = await ledger.adjustWallet({
      walletId: WALLET_ID,
      amount: 0.15,
      direction: 'credit',
      reason: 'cent correction',
      actorUserId: ADMIN_ID,
      reference: 'ADJ-CENTS-1',
    });
    expect(result.wallet_balance).toBe(1.3);
    expect(Number(result.transaction.balanceBefore)).toBe(1.15);
    expect(Number(result.transaction.balanceAfter)).toBe(1.3);
    expect(moneyNumber(wallet.balance)).toBe(1.3);
  });
});

describe('canonical SUB reference helper', () => {
  it('uses compact YYYYMMDD rather than dashed dates', () => {
    const key = philippineBillingDay(billingNow()).key;
    expect(key).toBe('20260829');
    expect(dailySubscriptionReference(9, key)).toBe('SUB-9-20260829');
    expect(dailySubscriptionReference(9, key)).not.toContain('-2026-08-29');
  });
});
