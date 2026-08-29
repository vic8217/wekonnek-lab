import { createHash, generateKeyPairSync } from 'crypto';
import {
  canonicalCallbackContent,
  canonicalPhilippinePayCoolsContent,
  signPayCoolsParam,
  verifyPhilippinePayCoolsCallback,
  verifyPayCoolsSign,
} from './paycools.crypto';

function testKeys() {
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

describe('PayCools RSA helpers', () => {
  it('signs and verifies a PayCools param string', () => {
    const keys = testKeys();
    const param = JSON.stringify({
      amount: 5000,
      mchOrderId: 'WK260829ABCDEF',
    });
    const sign = signPayCoolsParam(param, keys.privateKeyBase64);
    expect(verifyPayCoolsSign(param, sign, keys.publicKeyBase64)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const keys = testKeys();
    const sign = signPayCoolsParam('{"amount":5000}', keys.privateKeyBase64);
    expect(
      verifyPayCoolsSign('{"amount":5001}', sign, keys.publicKeyBase64),
    ).toBe(false);
  });

  it('builds a stable canonical callback string', () => {
    expect(
      canonicalCallbackContent({ sign: 'x', b: '2', a: '1', empty: '' }),
    ).toBe('a=1&b=2');
  });

  it('verifies Philippine callbacks using SHA-1 with the appended secret', () => {
    const payload = { b: '2', a: '1', empty: '', sign: 'ignored' };
    expect(canonicalPhilippinePayCoolsContent(payload)).toBe('a=1&b=2');
    const signed = {
      ...payload,
      sign: createHash('sha1')
        .update('a=1&b=2&secret=synthetic-secret')
        .digest('hex'),
    };
    expect(verifyPhilippinePayCoolsCallback(signed, 'synthetic-secret')).toBe(
      true,
    );
  });
});
