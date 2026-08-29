/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { Prisma } from '@prisma/client';
import { MerchantsService } from './merchants.service';
import { MerchantSubscriptionBillingService } from './merchant-subscription-billing.service';
import { MerchantSubscriptionBillingScheduler } from './merchant-subscription-billing.scheduler';
import {
  computeDailySubscriptionFee,
  dailySubscriptionReference,
  philippineBillingDay,
  subscriptionBillingSchedule,
} from './philippine-billing-day';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const WALLET_ID = '33333333-3333-3333-3333-333333333333';
const ADDON_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function billingNow() {
  return new Date('2026-08-29T04:00:00.000Z');
}

function createStore(
  initial: { balance?: number; plan?: string; status?: string } = {},
) {
  const billingDay = philippineBillingDay(billingNow());
  const merchant = {
    id: 9,
    userId: USER_ID,
    merchantCode: 'WK-9',
    subscriptionPlan: initial.plan ?? 'daily',
    subscriptionTier: 'basic',
    subscriptionAmount: 80,
    subscriptionStatus: 'active',
    status: initial.status ?? 'active',
    isActive: true,
  };
  const wallet = {
    id: WALLET_ID,
    userId: USER_ID,
    balance: initial.balance ?? 200,
  };
  const application = {
    merchantCode: 'WK-9',
    subscriptionAmount: 80,
    selectedAddOnIds: [ADDON_ID],
    selectedAddOnQuantities: { [ADDON_ID]: 2 },
  };
  const addOn = { id: ADDON_ID, amount: 10 };
  const walletTxns = new Map<string, any>();
  const subscriptionPayments: any[] = [];
  let claimChain = Promise.resolve();
  const serialize = <T>(fn: () => T | Promise<T>) => {
    const next = claimChain.then(fn, fn);
    claimChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const tx = {
    walletTransaction: {
      create: jest.fn(async ({ data }: any) =>
        serialize(() => {
          if (walletTxns.has(data.referenceNumber)) {
            throw new Prisma.PrismaClientKnownRequestError(
              'Unique constraint failed',
              {
                code: 'P2002',
                clientVersion: 'test',
              },
            );
          }
          walletTxns.set(data.referenceNumber, {
            ...data,
            id: `wt-${walletTxns.size + 1}`,
          });
          return walletTxns.get(data.referenceNumber);
        }),
      ),
    },
    wallet: {
      updateMany: jest.fn(async ({ where, data }: any) =>
        serialize(() => {
          if (where.id !== wallet.id) return { count: 0 };
          if (
            where.balance?.gte !== undefined &&
            wallet.balance < where.balance.gte
          ) {
            return { count: 0 };
          }
          if (data.balance?.decrement !== undefined)
            wallet.balance -= data.balance.decrement;
          if (data.balance?.increment !== undefined)
            wallet.balance += data.balance.increment;
          return { count: 1 };
        }),
      ),
      update: jest.fn(async ({ data }: any) =>
        serialize(() => {
          if (data.balance?.increment !== undefined)
            wallet.balance += data.balance.increment;
          return { ...wallet };
        }),
      ),
    },
    subscriptionPayment: {
      create: jest.fn(async ({ data }: any) => {
        subscriptionPayments.push(data);
        return data;
      }),
    },
    merchant: {
      update: jest.fn(async ({ data }: any) => {
        Object.assign(merchant, data);
        return { ...merchant };
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
      findUnique: jest.fn(async () => ({ ...wallet })),
      updateMany: tx.wallet.updateMany,
      update: tx.wallet.update,
    },
    merchantApplication: {
      findUnique: jest.fn(async () => application),
    },
    subscriptionAddOnPackage: {
      findMany: jest.fn(async () => [addOn]),
    },
    walletTransaction: {
      findUnique: jest.fn(
        async ({ where }: any) => walletTxns.get(where.referenceNumber) || null,
      ),
      create: tx.walletTransaction.create,
    },
    subscriptionPayment: {
      create: tx.subscriptionPayment.create,
    },
    branch: {
      findMany: jest.fn(async () => [{ id: 1, name: 'Main', shopId: 'WKS-1' }]),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      try {
        return await arg(tx);
      } catch (error) {
        const created = [...walletTxns.entries()].filter(([, row]) =>
          String(row.referenceNumber || '').startsWith('SUB-'),
        );
        if (
          error instanceof Error &&
          error.message === 'INSUFFICIENT_WALLET_BALANCE'
        ) {
          for (const [key] of created) walletTxns.delete(key);
        }
        throw error;
      }
    }),
  };

  const coordinator = {
    creditFixedFeeCommission: jest.fn(async () => ({ id: 'coord-1' })),
  };
  const coverage = new MerchantsService(prisma as never, {} as never);
  const billing = new MerchantSubscriptionBillingService(
    prisma as never,
    coordinator as never,
  );
  return {
    coverage,
    billing,
    prisma,
    coordinator,
    merchant,
    wallet,
    walletTxns,
    subscriptionPayments,
    billingDay,
    tx,
  };
}

describe('subscription coverage GET', () => {
  it('does not debit, create payments, or mutate merchant status', async () => {
    const { coverage, prisma, wallet } = createStore({ balance: 500 });
    const first = await coverage.getSubscriptionCoverage(USER_ID);
    const second = await coverage.getSubscriptionCoverage(USER_ID);
    expect(first).toEqual(second);
    expect(first.daily_subscription_fee).toBe(100);
    expect(first.plan_fee).toBe(80);
    expect(first.add_on_fee).toBe(20);
    expect(first.funded_days).toBe(5);
    expect(first.account_active).toBe(false);
    expect(wallet.balance).toBe(500);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
    expect(prisma.merchant.update).not.toHaveBeenCalled();
    expect(prisma.subscriptionPayment.create).not.toHaveBeenCalled();
  });

  it('does not charge merely by visiting the merchant dashboard payload', async () => {
    const { coverage, wallet } = createStore({ balance: 100 });
    await coverage.findByUserId(USER_ID);
    expect(wallet.balance).toBe(100);
  });

  it.each([
    [0, 0],
    [99, 0],
    [100, 1],
    [200, 2],
    [250, 2],
  ])('fundedDays for balance %s is %s', async (balance, days) => {
    const { coverage } = createStore({ balance });
    const result = await coverage.getSubscriptionCoverage(USER_ID);
    expect(result.funded_days).toBe(days);
    expect(result.daily_subscription_fee).toBe(100);
  });
});

describe('MerchantSubscriptionBillingService', () => {
  it('includes add-ons in the daily fee and charges a sufficient wallet once', async () => {
    const store = createStore({ balance: 250 });
    const result = await store.billing.billMerchantForDate(9, billingNow());
    expect(result).toMatchObject({ result: 'charged', amount: 100 });
    expect(store.wallet.balance).toBe(150);
    expect(store.walletTxns.size).toBe(1);
    expect(store.subscriptionPayments).toHaveLength(1);
    expect(store.coordinator.creditFixedFeeCommission).toHaveBeenCalledWith(
      9,
      100,
      dailySubscriptionReference(9, store.billingDay.key),
    );
    expect(store.merchant.subscriptionStatus).toBe('active');
    const coverage = await store.coverage.getSubscriptionCoverage(USER_ID);
    expect(coverage.account_active).toBe(true);
    expect(coverage.funded_days).toBe(1);
    expect(coverage.wallet_balance).toBe(150);
  });

  it('debits an exact wallet balance without going negative', async () => {
    const store = createStore({ balance: 100 });
    const result = await store.billing.billMerchantForDate(9, billingNow());
    expect(result.result).toBe('charged');
    expect(store.wallet.balance).toBe(0);
  });

  it('does not debit or create a completed payment when funds are insufficient', async () => {
    const store = createStore({ balance: 99 });
    const result = await store.billing.billMerchantForDate(9, billingNow());
    expect(result.result).toBe('insufficient');
    expect(store.wallet.balance).toBe(99);
    expect(store.walletTxns.size).toBe(0);
    expect(store.subscriptionPayments).toHaveLength(0);
    expect(store.merchant.subscriptionStatus).toBe('inactive');
    expect(store.wallet.balance).toBeGreaterThanOrEqual(0);
  });

  it('treats a second billing of the same date as a no-op', async () => {
    const store = createStore({ balance: 300 });
    await store.billing.billMerchantForDate(9, billingNow());
    const duplicate = await store.billing.billMerchantForDate(9, billingNow());
    expect(duplicate.result).toBe('alreadyBilled');
    expect(store.wallet.balance).toBe(200);
    expect(store.walletTxns.size).toBe(1);
    expect(store.subscriptionPayments).toHaveLength(1);
  });

  it('lets only one of two simultaneous billings debit the wallet', async () => {
    const store = createStore({ balance: 100 });
    const [first, second] = await Promise.all([
      store.billing.billMerchantForDate(9, billingNow()),
      store.billing.billMerchantForDate(9, billingNow()),
    ]);
    const outcomes = [first.result, second.result].sort();
    expect(outcomes).toEqual(['alreadyBilled', 'charged']);
    expect(store.wallet.balance).toBe(0);
    expect(store.walletTxns.size).toBe(1);
    expect(store.subscriptionPayments).toHaveLength(1);
  });

  it('keeps wallet math correct when a PayCools reload races the daily debit', async () => {
    const store = createStore({ balance: 80 });
    const reload = store.prisma.$transaction(async (tx: any) => {
      await tx.wallet.update({ data: { balance: { increment: 100 } } });
    });
    const debit = store.billing.billMerchantForDate(9, billingNow());
    await Promise.all([reload, debit]);
    expect(store.wallet.balance).toBeGreaterThanOrEqual(0);
    expect(store.wallet.balance === 180 || store.wallet.balance === 80).toBe(
      true,
    );
    if (store.walletTxns.size === 1) {
      expect(store.wallet.balance).toBe(80);
    } else {
      expect(store.wallet.balance).toBe(180);
    }
  });
});

describe('subscription billing schedule', () => {
  it('defaults to 00:05 Asia/Manila with hourly catch-up', () => {
    expect(subscriptionBillingSchedule({ get: () => undefined })).toEqual({
      cron: '5 0 * * *',
      catchupCron: '5 * * * *',
      timeZone: 'Asia/Manila',
    });
  });

  it('uses configured cron and timezone', () => {
    expect(
      subscriptionBillingSchedule({
        get: (key: string) =>
          ({
            SUBSCRIPTION_DAILY_BILLING_CRON: '10 1 * * *',
            SUBSCRIPTION_DAILY_BILLING_TZ: 'Asia/Manila',
            SUBSCRIPTION_DAILY_BILLING_CATCHUP_CRON: '10 * * * *',
          })[key],
      }),
    ).toMatchObject({
      cron: '10 1 * * *',
      timeZone: 'Asia/Manila',
      catchupCron: '10 * * * *',
    });
  });

  it('registers cron jobs that call the billing service', () => {
    const runDailyBilling = jest.fn(async () => ({ charged: 0 }));
    const addCronJob = jest.fn();
    const scheduler = new MerchantSubscriptionBillingScheduler(
      { runDailyBilling } as never,
      { addCronJob } as never,
      { get: () => undefined } as never,
    );
    scheduler.onModuleInit();
    expect(addCronJob).toHaveBeenCalledTimes(2);
    expect(addCronJob.mock.calls[0][0]).toBe('subscription-daily-billing');
    expect(addCronJob.mock.calls[1][0]).toBe(
      'subscription-daily-billing-catchup',
    );
    const jobs = addCronJob.mock.calls.map((call) => call[1]);
    for (const job of jobs) job.stop();
    expect(String(jobs[0].cronTime.source)).toContain('5 0 * * *');
  });

  it('invokes the shared billing service from the scheduler', async () => {
    const runDailyBilling = jest.fn(async () => ({ charged: 1 }));
    const scheduler = new MerchantSubscriptionBillingScheduler(
      { runDailyBilling } as never,
      { addCronJob: jest.fn() } as never,
      { get: () => undefined } as never,
    );
    await scheduler.runScheduledBilling();
    expect(runDailyBilling).toHaveBeenCalledTimes(1);
  });
});

describe('philippine billing day', () => {
  it('uses Asia/Manila rather than UTC for the billing key', () => {
    const stillAugust28Manila = philippineBillingDay(
      new Date('2026-08-28T15:30:00.000Z'),
    );
    const august29Manila = philippineBillingDay(
      new Date('2026-08-28T16:30:00.000Z'),
    );
    expect(stillAugust28Manila.key).toBe('20260828');
    expect(august29Manila.key).toBe('20260829');
    expect(august29Manila.timeZone).toBe('Asia/Manila');
  });

  it('computes add-on quantities into the daily fee', () => {
    expect(
      computeDailySubscriptionFee(80, [{ id: ADDON_ID, amount: 10 }], {
        [ADDON_ID]: 2,
      }),
    ).toEqual({ planFee: 80, addOnFee: 20, dailySubscriptionFee: 100 });
  });
});
