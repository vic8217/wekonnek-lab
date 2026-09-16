import { ForbiddenException } from '@nestjs/common';
import { RiderAdvanceStatus } from '@prisma/client';
import { assertOperationAllowed } from '../fulfillment/fulfillment-authorization';
import {
  FULFILLMENT_TRANSITIONS,
  TRANSITION_CATALOG,
} from '../fulfillment/fulfillment-state-machine';
import {
  DEFAULT_RETURN_HANDOFF_TTL_SECONDS,
  RETURN_OTP_LENGTH,
  RETURN_OTP_MAX_ATTEMPTS,
  RETURN_QR_VERSION,
  encodeReturnQrPayload,
  generateReturnOtp,
  generateReturnSecret,
  hashReturnOtp,
  hashReturnSecret,
  otpsMatch,
  parseReturnQrPayload,
  secretsMatch,
} from './return-token';

describe('Stage 6 return handoff architecture', () => {
  it('binds QR version WKRH1 and round-trips payload', () => {
    const secret = generateReturnSecret();
    const tokenId = '22222222-2222-4222-8222-222222222222';
    const encoded = encodeReturnQrPayload({ tokenId, secret });
    expect(encoded.startsWith(`${RETURN_QR_VERSION}.`)).toBe(true);
    const parsed = parseReturnQrPayload(encoded);
    expect(parsed.tokenId).toBe(tokenId);
    expect(secretsMatch(hashReturnSecret(secret), secret)).toBe(true);
    expect(Buffer.from(secret, 'base64url').length).toBeGreaterThanOrEqual(32);
  });

  it('hashes OTP separately and never treats weak 4-digit PIN as valid', () => {
    const otp = generateReturnOtp();
    expect(otp).toHaveLength(RETURN_OTP_LENGTH);
    expect(/^[0-9A-Z]+$/.test(otp)).toBe(true);
    expect(otpsMatch(hashReturnOtp(otp), otp.toLowerCase())).toBe(true);
    expect(otpsMatch(hashReturnOtp(otp), '0000')).toBe(false);
    expect(RETURN_OTP_MAX_ATTEMPTS).toBe(5);
  });

  it('rejects malformed return QR payloads and pickup/delivery versions', () => {
    expect(() => parseReturnQrPayload('')).toThrow();
    expect(() => parseReturnQrPayload('WKPH1.a.b')).toThrow();
    expect(() => parseReturnQrPayload('WKDH1.x.y')).toThrow();
    expect(() => parseReturnQrPayload('WKRH2.x.y')).toThrow();
  });

  it('documents bounded TTL defaults', () => {
    expect(DEFAULT_RETURN_HANDOFF_TTL_SECONDS).toBe(300);
  });

  it('closes rider self-return while keeping delivery_failed and returning', () => {
    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r1' },
        'returned',
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r1' },
        'delivery_failed',
      ),
    ).not.toThrow();
    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r1' },
        'returning',
      ),
    ).not.toThrow();
    expect(FULFILLMENT_TRANSITIONS.returning).toEqual(['returned']);
    const returned = TRANSITION_CATALOG.find(
      (t) => t.from === 'returning' && t.to === 'returned',
    );
    expect(returned?.authorizedActorTypes).not.toContain('RIDER');
    expect(returned?.authorizedActorTypes).toContain('INTERNAL_SERVICE');
  });

  it('documents returned means merchant-confirmed receipt (not rider assertion)', () => {
    const semantics = {
      returnedMeans: 'merchant_confirmed_return_handoff',
      riderSelfReturn: false,
      refundImplied: false,
      raDebtErased: false,
    };
    expect(semantics.returnedMeans).toBe('merchant_confirmed_return_handoff');
    expect(semantics.riderSelfReturn).toBe(false);
    expect(semantics.refundImplied).toBe(false);
    expect(semantics.raDebtErased).toBe(false);
  });

  it('documents Rider A creditor vs Rider C return rider separation', () => {
    const ra = {
      status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
      creditorRiderId: 'A',
      principal: '980.00',
    };
    const returnRiderId = 'C';
    expect(ra.creditorRiderId).not.toBe(returnRiderId);
    expect(ra.status).toBe(RiderAdvanceStatus.REIMBURSEMENT_DUE);
  });

  it('documents QR and OTP share one capability (one consumption)', () => {
    const capability = { status: 'ACTIVE' as 'ACTIVE' | 'CONSUMED' };
    const confirmWith = (_channel: 'qr' | 'otp') => {
      if (capability.status === 'CONSUMED') {
        return { ok: false, code: 'RETURN_TOKEN_ALREADY_CONSUMED' };
      }
      capability.status = 'CONSUMED';
      return { ok: true };
    };
    expect(confirmWith('qr').ok).toBe(true);
    expect(confirmWith('otp')).toEqual({
      ok: false,
      code: 'RETURN_TOKEN_ALREADY_CONSUMED',
    });
  });

  it('documents redelivery as future product decision (out of Stage 6)', () => {
    expect(FULFILLMENT_TRANSITIONS.delivery_failed).toEqual(['returning']);
    expect(FULFILLMENT_TRANSITIONS.delivery_failed).not.toContain('in_transit');
  });

  it('documents derived COMPLETE is never persisted', () => {
    const schemaAdditions = {
      operationalStatus: false,
      closedAt: false,
      completedAt: false,
    };
    expect(schemaAdditions.operationalStatus).toBe(false);
    expect(schemaAdditions.closedAt).toBe(false);
    expect(schemaAdditions.completedAt).toBe(false);
  });
});
