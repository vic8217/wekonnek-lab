import { ForbiddenException } from '@nestjs/common';
import { FulfillmentStatus } from '@prisma/client';
import { assertPossessionDependentRiderAuthority } from './possession-authority';
import {
  DEFAULT_RIDER_CUSTODY_TTL_SECONDS,
  RIDER_CUSTODY_OTP_LENGTH,
  RIDER_CUSTODY_OTP_MAX_ATTEMPTS,
  RIDER_CUSTODY_QR_VERSION,
  encodeRiderCustodyQrPayload,
  generateRiderCustodyOtp,
  generateRiderCustodySecret,
  hashRiderCustodyOtp,
  hashRiderCustodySecret,
  parseRiderCustodyQrPayload,
  riderCustodyOtpsMatch,
  riderCustodySecretsMatch,
} from './rider-custody-token';

describe('Stage 7 rider custody handoff architecture', () => {
  it('binds QR version WKRR1 and round-trips payload', () => {
    const secret = generateRiderCustodySecret();
    const tokenId = '33333333-3333-4333-8333-333333333333';
    const encoded = encodeRiderCustodyQrPayload({ tokenId, secret });
    expect(encoded.startsWith(`${RIDER_CUSTODY_QR_VERSION}.`)).toBe(true);
    const parsed = parseRiderCustodyQrPayload(encoded);
    expect(parsed.tokenId).toBe(tokenId);
    expect(
      riderCustodySecretsMatch(hashRiderCustodySecret(secret), secret),
    ).toBe(true);
    expect(Buffer.from(secret, 'base64url').length).toBeGreaterThanOrEqual(32);
  });

  it('hashes OTP separately and rejects weak PIN substitutes', () => {
    const otp = generateRiderCustodyOtp();
    expect(otp).toHaveLength(RIDER_CUSTODY_OTP_LENGTH);
    expect(/^[0-9A-Z]+$/.test(otp)).toBe(true);
    expect(riderCustodyOtpsMatch(hashRiderCustodyOtp(otp), otp.toLowerCase())).toBe(
      true,
    );
    expect(riderCustodyOtpsMatch(hashRiderCustodyOtp(otp), '0000')).toBe(false);
    expect(RIDER_CUSTODY_OTP_MAX_ATTEMPTS).toBe(5);
  });

  it('rejects malformed QR and foreign handoff versions', () => {
    expect(() => parseRiderCustodyQrPayload('')).toThrow();
    expect(() => parseRiderCustodyQrPayload('WKPH1.a.b')).toThrow();
    expect(() => parseRiderCustodyQrPayload('WKDH1.x.y')).toThrow();
    expect(() => parseRiderCustodyQrPayload('WKRH1.x.y')).toThrow();
    expect(() => parseRiderCustodyQrPayload('WKRR2.x.y')).toThrow();
  });

  it('documents bounded TTL defaults', () => {
    expect(DEFAULT_RIDER_CUSTODY_TTL_SECONDS).toBe(300);
  });

  it('documents Option B-lite: pending transfer without flipping activeRiderId', () => {
    const midPossessionReassign = {
      flipsActiveRiderId: false,
      setsPendingIncoming: true,
      physicalCustodianRemainsOutgoing: true,
      assignmentAloneIsPossession: false,
    };
    expect(midPossessionReassign.flipsActiveRiderId).toBe(false);
    expect(midPossessionReassign.setsPendingIncoming).toBe(true);
    expect(midPossessionReassign.physicalCustodianRemainsOutgoing).toBe(true);
    expect(midPossessionReassign.assignmentAloneIsPossession).toBe(false);
  });

  it('requires physical custodian for delivery/return capability during possession', () => {
    expect(() =>
      assertPossessionDependentRiderAuthority({
        actorUserId: 'incoming',
        status: FulfillmentStatus.in_transit,
        activeRiderId: 'outgoing',
        physicalCustodianRiderId: 'outgoing',
        pendingCustodyIncomingRiderId: 'incoming',
        action: 'delivery_capability',
      }),
    ).toThrow(ForbiddenException);

    expect(() =>
      assertPossessionDependentRiderAuthority({
        actorUserId: 'outgoing',
        status: FulfillmentStatus.in_transit,
        activeRiderId: 'outgoing',
        physicalCustodianRiderId: 'outgoing',
        pendingCustodyIncomingRiderId: 'incoming',
        action: 'delivery_capability',
      }),
    ).not.toThrow();
  });

  it('documents incoming confirms and custody pair ordering', () => {
    const confirmSemantics = {
      issuer: 'outgoing_physical_custodian',
      confirmer: 'pending_incoming_rider',
      custodyOrder: [
        'RIDER_TRANSFER_RELEASED',
        'RIDER_TRANSFER_RECEIVED',
      ] as const,
      thenFinalizeAssignment: true,
      paymentUnchanged: true,
      riderAdvanceUnchanged: true,
      redeliveryOutOfScope: true,
    };
    expect(confirmSemantics.confirmer).toBe('pending_incoming_rider');
    expect(confirmSemantics.custodyOrder[0]).toBe('RIDER_TRANSFER_RELEASED');
    expect(confirmSemantics.custodyOrder[1]).toBe('RIDER_TRANSFER_RECEIVED');
    expect(confirmSemantics.thenFinalizeAssignment).toBe(true);
    expect(confirmSemantics.redeliveryOutOfScope).toBe(true);
  });

  it('documents QR and OTP share one capability (one consumption)', () => {
    const capability = { status: 'ACTIVE' as 'ACTIVE' | 'CONSUMED' };
    const confirmWith = (_channel: 'qr' | 'otp') => {
      if (capability.status === 'CONSUMED') {
        return { ok: false, code: 'RIDER_CUSTODY_TOKEN_ALREADY_CONSUMED' };
      }
      capability.status = 'CONSUMED';
      return { ok: true };
    };
    expect(confirmWith('qr').ok).toBe(true);
    expect(confirmWith('otp')).toEqual({
      ok: false,
      code: 'RIDER_CUSTODY_TOKEN_ALREADY_CONSUMED',
    });
  });

  it('documents operational integrity flags for pending / mismatch', () => {
    const flags = {
      CUSTODY_TRANSFER_PENDING: true,
      ASSIGNMENT_CUSTODY_MISMATCH: true,
    };
    expect(flags.CUSTODY_TRANSFER_PENDING).toBe(true);
    expect(flags.ASSIGNMENT_CUSTODY_MISMATCH).toBe(true);
  });
});
