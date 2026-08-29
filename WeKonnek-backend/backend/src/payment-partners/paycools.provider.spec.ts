import { generateKeyPairSync } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { signPayCoolsParam } from './paycools.crypto';
import { PayCoolsProvider } from './paycools.provider';

function rsaPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    publicKeyBase64: Buffer.from(publicKey).toString('base64'),
    privateKeyBase64: Buffer.from(privateKey).toString('base64'),
  };
}

describe('PayCoolsProvider', () => {
  const keys = rsaPair();
  const runtime = {
    environment: 'uat' as const,
    defaultQrExpirySeconds: 600,
    baseUrl: 'https://paycools.test',
    appId: 'app-1',
    privateKeyBase64: keys.privateKeyBase64,
    callbackPublicKeyBase64: keys.publicKeyBase64,
    channelCode: 'QRPH_DYNAMIC_QR',
    notifyUrl: 'http://localhost:3000/api/payments/callbacks/paycools/payment',
  };
  const provider = new PayCoolsProvider({
    getPayCoolsRuntime: () => Promise.resolve(runtime),
  } as never);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a PayCools QR payment without treating the response as a wallet credit', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          code: 10000,
          data: {
            qrCodeId: 'qr-1',
            qrCodeContent: '000201QRPH',
            paymentUrl: 'https://paycools.test/pay/qr-1',
            qrStatus: 'ACTIVE',
          },
        }),
    } as Response);
    const created = await provider.createPayment({
      reference: 'WK260829TESTREF0001',
      amountMinor: 50000,
      currency: 'PHP',
      notifyUrl: runtime.notifyUrl,
      expiresInSeconds: 600,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://paycools.test/open-api/qr/generate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(created.providerQrCodeId).toBe('qr-1');
    expect(created.qrData).toBe('000201QRPH');
    expect(created.paymentUrl).toBe('https://paycools.test/pay/qr-1');
  });

  it('verifies an envelope callback signed with the PayCools public key', async () => {
    const param = JSON.stringify({
      eventName: 'qrcode.payment.success',
      mchOrderId: 'WK260829TESTREF0001',
      transactionId: 'pc-txn-1',
      amount: 50000,
      currency: 'PHP',
      transactionStatus: 'COMPLETED',
    });
    const verified = await provider.verifyWebhook(
      { param, sign: signPayCoolsParam(param, keys.privateKeyBase64) },
      {},
    );
    expect(verified).toMatchObject({
      reference: 'WK260829TESTREF0001',
      providerTransactionId: 'pc-txn-1',
      amountMinor: 50000,
      currency: 'PHP',
      status: 'PAID',
    });
  });

  it('rejects an unsigned or invalid callback', async () => {
    await expect(
      provider.verifyWebhook({ param: '{}', sign: 'not-a-signature' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed when the callback public key is a shared secret instead of an RSA key', async () => {
    const locked = new PayCoolsProvider({
      getPayCoolsRuntime: () =>
        Promise.resolve({
          ...runtime,
          callbackPublicKeyBase64: 'shared-secret',
        }),
    } as never);
    try {
      await locked.verifyWebhook(
        { param: '{}', sign: 'x' },
        { authorization: 'Bearer shared-secret' },
      );
      throw new Error('expected verification to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).getResponse()).toMatchObject({
        code: 'PAYCOOLS_CALLBACK_KEY_MISSING',
      });
    }
  });
});
