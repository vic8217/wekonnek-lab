import { createHash, generateKeyPairSync } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import {
  canonicalPhilippinePayCoolsContent,
  signPhilippinePayCoolsPayload,
  verifyPhilippinePayCoolsCallback,
} from './paycools.crypto';
import { PayCoolsProvider } from './paycools.provider';

function rsaPrivateKey() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return Buffer.from(privateKey).toString('base64');
}

function callbackSign(payload: Record<string, unknown>, secret: string) {
  return createHash('sha1')
    .update(`${canonicalPhilippinePayCoolsContent(payload)}&secret=${secret}`)
    .digest('hex');
}

describe('PayCoolsProvider Philippine QRPH', () => {
  const callbackSecret = 'synthetic-callback-secret';
  const runtime = {
    environment: 'uat' as const,
    defaultQrExpirySeconds: 600,
    baseUrl: 'https://paycools.test',
    appId: 'app-1',
    appName: 'WeKonnek UAT',
    privateKeyBase64: rsaPrivateKey(),
    callbackSecret,
    channelCode: 'QRPH_DYNAMIC_QR',
    notifyUrl: 'https://example.test/api/payments/callbacks/paycools/payment',
  };
  const provider = new PayCoolsProvider({
    getPayCoolsRuntime: () => Promise.resolve(runtime),
  } as never);

  afterEach(() => jest.restoreAllMocks());

  it('creates a direct Philippine QRPH request at /api/v1/qrcode', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          code: 1000,
          data: {
            qrcodeId: 'qr-1',
            qrcodeContent: '000201QRPH',
            qrLink: 'https://paycools.test/pay/qr-1',
            status: 'ACTIVE',
          },
        }),
    } as Response);

    const created = await provider.createPayment({
      reference: 'WK260829TESTREF0001',
      amountMinor: 50000,
      currency: 'PHP',
      notifyUrl: runtime.notifyUrl,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://paycools.test/api/v1/qrcode',
      expect.objectContaining({ method: 'POST' }),
    );
    const parsed: unknown = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(parsed).toEqual(expect.any(Object));
    const body = parsed as Record<string, unknown>;
    expect(body).toMatchObject({
      appId: runtime.appId,
      appName: runtime.appName,
      channelCode: 'QRPH_DYNAMIC_QR',
      mchOrderId: 'WK260829TESTREF0001',
      amount: 50000,
      callbackUrl: runtime.notifyUrl,
    });
    expect(body.param).toBeUndefined();
    expect(body.sign).toBe(
      signPhilippinePayCoolsPayload(
        {
          appId: runtime.appId,
          appName: runtime.appName,
          amount: 50000,
          callbackUrl: runtime.notifyUrl,
          channelCode: 'QRPH_DYNAMIC_QR',
          mchOrderId: 'WK260829TESTREF0001',
        },
        runtime.privateKeyBase64,
      ),
    );
    expect(created.providerQrCodeId).toBe('qr-1');
  });

  it('includes optional customer fields only when they are present', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          code: 1000,
          data: { qrcodeId: 'qr-2', qrcodeContent: '000201QRPH' },
        }),
    } as Response);

    await provider.createPayment({
      reference: 'WK260829TESTREF0002',
      amountMinor: 15000,
      currency: 'PHP',
      notifyUrl: runtime.notifyUrl,
      customerName: 'Ana Cruz',
      email: 'ana@example.test',
      remark: 'WeKonnek order WK-1',
    });
    const withOptional = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(withOptional).toMatchObject({
      customerName: 'Ana Cruz',
      email: 'ana@example.test',
      remark: 'WeKonnek order WK-1',
    });

    await provider.createPayment({
      reference: 'WK260829TESTREF0003',
      amountMinor: 15000,
      currency: 'PHP',
      notifyUrl: runtime.notifyUrl,
    });
    const withoutOptional = JSON.parse(
      (fetchMock.mock.calls[1][1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(withoutOptional.customerName).toBeUndefined();
    expect(withoutOptional.email).toBeUndefined();
    expect(withoutOptional.remark).toBeUndefined();
  });

  it('accepts a valid Philippine callback signature', async () => {
    const callback = {
      eventName: 'qrcode.payment.success',
      mchOrderId: 'WK260829TESTREF0001',
      transactionId: 'pc-txn-1',
      amount: 50000,
      empty: '',
      optional: null,
    };
    await expect(
      provider.verifyWebhook(
        { ...callback, sign: callbackSign(callback, callbackSecret) },
        {},
      ),
    ).resolves.toMatchObject({
      reference: callback.mchOrderId,
      status: 'PAID',
    });
  });

  it('rejects missing and invalid callback signatures', async () => {
    await expect(
      provider.verifyWebhook({ mchOrderId: 'x' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      provider.verifyWebhook({ mchOrderId: 'x', amount: 1, sign: 'bad' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('uses canonical sorting, excludes empty values, and appends the secret', () => {
    const payload = {
      z: 'last',
      sign: 'ignored',
      a: 'first',
      empty: '',
      nil: null,
    };
    expect(canonicalPhilippinePayCoolsContent(payload)).toBe('a=first&z=last');
    const signed = { ...payload, sign: callbackSign(payload, callbackSecret) };
    expect(verifyPhilippinePayCoolsCallback(signed, callbackSecret)).toBe(true);
    expect(verifyPhilippinePayCoolsCallback(signed, 'wrong-secret')).toBe(
      false,
    );
  });

  it('does not require a callback public key for Philippine QRPH', async () => {
    const callback = { amount: 1, mchOrderId: 'x' };
    await expect(
      provider.verifyWebhook(
        { ...callback, sign: callbackSign(callback, callbackSecret) },
        {},
      ),
    ).resolves.toBeDefined();
  });
});
