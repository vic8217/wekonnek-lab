/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PlatformPaymentDestination,
  PlatformPaymentSourceType,
  PlatformPaymentStatus,
  WalletPaymentGateway,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { WalletReloadService } from './wallet-reload.service';
import type { VerifiedWebhookPayment } from './payment-provider';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER = '22222222-2222-2222-2222-222222222222';
const WALLET_ID = '33333333-3333-3333-3333-333333333333';
const PAYMENT_ID = '44444444-4444-4444-4444-444444444444';
const TXN_ID = '55555555-5555-5555-5555-555555555555';
const REFERENCE = 'WK260829RELOAD000001';

function paidCallback(
  overrides: Partial<VerifiedWebhookPayment> = {},
): VerifiedWebhookPayment {
  return {
    reference: REFERENCE,
    providerTransactionId: 'pc-txn-1',
    amountMinor: 50000,
    currency: 'PHP',
    status: 'PAID',
    eventName: 'qrcode.payment.success',
    ...overrides,
  };
}

function createStore(
  initial: {
    paymentStatus?: PlatformPaymentStatus;
    walletBalance?: number;
  } = {},
) {
  const payment = {
    id: PAYMENT_ID,
    reference: REFERENCE,
    provider: 'PAYCOOLS',
    providerTransactionId: null as string | null,
    destination: PlatformPaymentDestination.USER_WALLET,
    sourceType: PlatformPaymentSourceType.MERCHANT_SUBSCRIPTION,
    sourceId: TXN_ID,
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
  const wallet = {
    id: WALLET_ID,
    userId: USER_ID,
    balance: initial.walletBalance ?? 100,
    isActive: true,
  };
  const walletTxn = {
    id: TXN_ID,
    referenceNumber: REFERENCE,
    walletId: WALLET_ID,
    type: WalletTransactionType.top_up,
    status: WalletTransactionStatus.pending,
    gateway: WalletPaymentGateway.internal,
    amount: 500,
    gatewayPaymentUrl: 'https://paycools.test/pay',
    gatewayTransactionId: 'qr-1',
    metadata: {
      purpose: 'merchant_wallet_reload',
      platformPaymentId: PAYMENT_ID,
      provider: 'paycools',
      qrData: '000201',
    },
  };

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
    platformPaymentTransaction: {
      updateMany: jest.fn(async ({ where, data }: any) =>
        serialize(() => {
          const statusOk = !where.status || payment.status === where.status;
          const providerOk =
            !where.provider || payment.provider === where.provider;
          const idOk = !where.id || payment.id === where.id;
          if (!statusOk || !providerOk || !idOk) return { count: 0 };
          Object.assign(payment, data);
          return { count: 1 };
        }),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id && where.id !== payment.id) return null;
        if (where.reference && where.reference !== payment.reference)
          return null;
        return { ...payment };
      }),
    },
    wallet: {
      update: jest.fn(async ({ where, data }: any) => {
        if (where.id !== wallet.id) throw new Error('wallet missing');
        if (data.balance?.increment !== undefined)
          wallet.balance += Number(data.balance.increment);
        return { ...wallet };
      }),
    },
    walletTransaction: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const statusList =
          where.status?.in || (where.status ? [where.status] : null);
        if (where.id && where.id !== walletTxn.id) return { count: 0 };
        if (statusList && !statusList.includes(walletTxn.status))
          return { count: 0 };
        Object.assign(walletTxn, data);
        return { count: 1 };
      }),
    },
  };

  const prisma = {
    merchant: {
      findFirst: jest.fn(async () => ({ id: 9, isActive: true })),
    },
    wallet: {
      upsert: jest.fn(async () => ({ ...wallet })),
      findUnique: jest.fn(async () => ({ ...wallet })),
      update: tx.wallet.update,
    },
    walletTransaction: {
      create: jest.fn(async ({ data }: any) => {
        Object.assign(walletTxn, data, { id: TXN_ID });
        return { ...walletTxn };
      }),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(walletTxn, data);
        return { ...walletTxn };
      }),
      updateMany: tx.walletTransaction.updateMany,
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id && where.id !== walletTxn.id) return null;
        if (
          where.referenceNumber &&
          where.referenceNumber !== walletTxn.referenceNumber
        )
          return null;
        return { ...walletTxn };
      }),
    },
    platformPaymentTransaction: {
      update: jest.fn(async ({ data }: any) => {
        Object.assign(payment, data);
        return { ...payment };
      }),
      updateMany: tx.platformPaymentTransaction.updateMany,
      findUnique: tx.platformPaymentTransaction.findUnique,
      findUniqueOrThrow: jest.fn(async () => ({ ...payment })),
    },
    $transaction: jest.fn(async (arg: any) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return arg(tx);
    }),
  };

  const platformPayments = {
    createPending: jest.fn(async () => ({ ...payment })),
    attachProviderIdentifiers: jest.fn(async () => ({
      ...payment,
      providerQrCodeId: 'qr-1',
    })),
  };
  const paymentPartners = {
    getActiveProvider: jest.fn(async () => ({
      providerCode: 'PAYCOOLS',
      defaultQrExpirySeconds: 600,
    })),
    paymentCallbackUrl: jest.fn(
      () => 'http://localhost:3000/api/payments/callbacks/paycools/payment',
    ),
  };
  const paycools = {
    createPayment: jest.fn(async () => ({
      providerQrCodeId: 'qr-1',
      paymentUrl: 'https://paycools.test/pay',
      qrData: '000201',
      status: 'ACTIVE',
      expiresAt: new Date('2026-08-29T12:00:00Z'),
    })),
    verifyWebhook: jest.fn(),
  };

  const service = new WalletReloadService(
    prisma as never,
    platformPayments as never,
    paymentPartners as never,
    paycools as never,
  );

  return {
    service,
    prisma,
    platformPayments,
    paymentPartners,
    paycools,
    payment,
    wallet,
    walletTxn,
    tx,
  };
}

describe('WalletReloadService', () => {
  it('creates a PayCools wallet reload without crediting the wallet', async () => {
    const { service, prisma, paycools, wallet } = createStore();
    const created = await service.createPayCoolsReload(USER_ID, 500);
    expect(paycools.createPayment).toHaveBeenCalled();
    expect(prisma.wallet.update).not.toHaveBeenCalled();
    expect(wallet.balance).toBe(100);
    expect(created.status).toBe(PlatformPaymentStatus.PENDING);
    expect(created.provider).toBe('paycools');
    expect(created.paymentUrl).toBe('https://paycools.test/pay');
  });

  it('rejects invalid reload amounts', async () => {
    const { service, prisma } = createStore();
    await expect(
      service.createPayCoolsReload(USER_ID, 0),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createPayCoolsReload(USER_ID, 49),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createPayCoolsReload(USER_ID, 50001),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.walletTransaction.create).not.toHaveBeenCalled();
  });

  it('enforces merchant wallet ownership on create', async () => {
    const { service, prisma } = createStore();
    prisma.merchant.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.createPayCoolsReload(USER_ID, 500),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('credits the stored amount once on a valid PayCools PAID callback', async () => {
    const { service, payment, wallet, walletTxn } = createStore();
    const result = await service.settleVerified(paidCallback());
    expect(result).toEqual({
      accepted: true,
      duplicate: false,
      credited: true,
    });
    expect(payment.status).toBe(PlatformPaymentStatus.PAID);
    expect(wallet.balance).toBe(600);
    expect(walletTxn.status).toBe(WalletTransactionStatus.completed);
    expect(payment.paidAt).toBeInstanceOf(Date);
  });

  it('does not credit a second time for a duplicate PAID callback', async () => {
    const { service, wallet } = createStore();
    await service.settleVerified(paidCallback());
    const duplicate = await service.settleVerified(paidCallback());
    expect(duplicate).toEqual({
      accepted: true,
      duplicate: true,
      credited: false,
    });
    expect(wallet.balance).toBe(600);
  });

  it('lets only one of two simultaneous callbacks increment the wallet', async () => {
    const { service, wallet, walletTxn, payment } = createStore();
    const [first, second] = await Promise.all([
      service.settleVerified(paidCallback()),
      service.settleVerified(
        paidCallback({ providerTransactionId: 'pc-txn-2' }),
      ),
    ]);
    const credited = [first, second].filter((row) => row.credited);
    const duplicates = [first, second].filter((row) => row.duplicate);
    expect(credited).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
    expect(wallet.balance).toBe(600);
    expect(walletTxn.status).toBe(WalletTransactionStatus.completed);
    expect(payment.status).toBe(PlatformPaymentStatus.PAID);
  });

  it('rejects an unknown payment reference without crediting', async () => {
    const { service, wallet } = createStore();
    await expect(
      service.settleVerified(paidCallback({ reference: 'UNKNOWN' })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(wallet.balance).toBe(100);
  });

  it('rejects an amount mismatch without crediting', async () => {
    const { service, wallet, payment } = createStore();
    await expect(
      service.settleVerified(paidCallback({ amountMinor: 49999 })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.balance).toBe(100);
    expect(payment.status).toBe(PlatformPaymentStatus.PENDING);
  });

  it('rejects a currency mismatch without crediting', async () => {
    const { service, wallet } = createStore();
    await expect(
      service.settleVerified(paidCallback({ currency: 'USD' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(wallet.balance).toBe(100);
  });

  it('does not credit a failed PayCools payment', async () => {
    const { service, wallet, payment, walletTxn } = createStore();
    const result = await service.settleVerified(
      paidCallback({ status: 'FAILED', eventName: 'qrcode.payment.failed' }),
    );
    expect(result.credited).toBe(false);
    expect(wallet.balance).toBe(100);
    expect(payment.status).toBe(PlatformPaymentStatus.FAILED);
    expect(walletTxn.status).toBe(WalletTransactionStatus.failed);
  });

  it('rejects invalid callback authentication before any wallet credit', async () => {
    const { service, paycools, wallet } = createStore();
    paycools.verifyWebhook.mockRejectedValue(
      new UnauthorizedException('Invalid PayCools callback signature'),
    );
    await expect(
      service.handlePayCoolsCallback({ sign: 'bad' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(wallet.balance).toBe(100);
  });

  it('enforces ownership on the payment status endpoint', async () => {
    const { service } = createStore();
    await expect(
      service.getReload(OTHER_USER, PAYMENT_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
    const owned = await service.getReload(USER_ID, PAYMENT_ID);
    expect(owned.paymentId).toBe(PAYMENT_ID);
    expect(owned.status).toBe(PlatformPaymentStatus.PENDING);
  });

  it('does not credit the wallet when the browser only polls payment status', async () => {
    const { service, wallet, prisma } = createStore();
    await service.getReload(USER_ID, PAYMENT_ID);
    expect(wallet.balance).toBe(100);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
