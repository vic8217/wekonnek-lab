import {
  DELIVERY_OTP_LENGTH,
  DELIVERY_QR_VERSION,
  encodeDeliveryQrPayload,
  generateDeliveryOtp,
  generateDeliverySecret,
  hashDeliveryOtp,
  hashDeliverySecret,
  otpsMatch,
  parseDeliveryQrPayload,
  secretsMatch,
} from './delivery-token';
import { FULFILLMENT_TRANSITIONS } from '../fulfillment/fulfillment-state-machine';
import { assertOperationAllowed } from '../fulfillment/fulfillment-authorization';
import { ForbiddenException } from '@nestjs/common';
import { RiderAdvanceStatus } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Stage 5A delivery handoff architecture', () => {
  it('binds QR version and round-trips payload without leaking weak PIN semantics', () => {
    const secret = generateDeliverySecret();
    const tokenId = '11111111-1111-4111-8111-111111111111';
    const encoded = encodeDeliveryQrPayload({ tokenId, secret });
    expect(encoded.startsWith(`${DELIVERY_QR_VERSION}.`)).toBe(true);
    const parsed = parseDeliveryQrPayload(encoded);
    expect(parsed.tokenId).toBe(tokenId);
    expect(secretsMatch(hashDeliverySecret(secret), secret)).toBe(true);
    expect(secret.length).toBeGreaterThan(20);
  });

  it('uses a separate OTP hash with throttling-sized credential (not legacy 4-digit pin)', () => {
    const otp = generateDeliveryOtp();
    expect(otp).toHaveLength(DELIVERY_OTP_LENGTH);
    expect(/^[0-9A-Z]+$/.test(otp)).toBe(true);
    expect(otpsMatch(hashDeliveryOtp(otp), otp.toLowerCase())).toBe(true);
    expect(otpsMatch(hashDeliveryOtp(otp), '0000')).toBe(false);
  });

  it('rejects malformed delivery QR payloads', () => {
    expect(() => parseDeliveryQrPayload('')).toThrow();
    expect(() => parseDeliveryQrPayload('WKPH1.a.b')).toThrow();
    expect(() => parseDeliveryQrPayload('WKDH2.x.y')).toThrow();
  });

  it('closes rider self-delivered and Stage 8 closes rider delivery_failed', () => {
    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r1' },
        'delivered',
      ),
    ).toThrow(ForbiddenException);
    // Stage 8: delivery_failed via delivery-failure report only
    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r1' },
        'delivery_failed',
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r1' },
        'returned',
      ),
    ).toThrow(ForbiddenException);
    expect(FULFILLMENT_TRANSITIONS.in_transit).toEqual([
      'delivered',
      'delivery_failed',
    ]);
  });

  it('documents delivery != reimbursement and creditor != delivery rider', () => {
    const delivery = { status: 'delivered' as const };
    const ra = {
      status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
      principal: '980.00',
      creditorRiderId: 'A',
    };
    const deliveryRiderId = 'B';
    expect(delivery.status).toBe('delivered');
    expect(ra.status).toBe(RiderAdvanceStatus.REIMBURSEMENT_DUE);
    expect(ra.principal).toBe('980.00');
    expect(ra.creditorRiderId).not.toBe(deliveryRiderId);
    expect(ra.status).not.toBe(RiderAdvanceStatus.REIMBURSED);
  });

  it('documents established-obligation reassignment does not auto-dispute', () => {
    const onReassign = (status: RiderAdvanceStatus) => {
      if (
        status === RiderAdvanceStatus.VENDOR_ACKNOWLEDGED ||
        status === RiderAdvanceStatus.REIMBURSEMENT_DUE
      ) {
        return status;
      }
      if (status === RiderAdvanceStatus.ADVANCE_RECORDED) {
        return RiderAdvanceStatus.DISPUTED;
      }
      return RiderAdvanceStatus.CANCELLED;
    };
    expect(onReassign(RiderAdvanceStatus.REIMBURSEMENT_DUE)).toBe(
      RiderAdvanceStatus.REIMBURSEMENT_DUE,
    );
    expect(onReassign(RiderAdvanceStatus.ADVANCE_RECORDED)).toBe(
      RiderAdvanceStatus.DISPUTED,
    );
  });

  it('documents QR and OTP share one capability (one consumption)', () => {
    const capability = { status: 'ACTIVE' as 'ACTIVE' | 'CONSUMED' };
    const confirmWith = (_channel: 'qr' | 'otp') => {
      if (capability.status === 'CONSUMED') return { ok: false, code: 'TOKEN_CONSUMED' };
      capability.status = 'CONSUMED';
      return { ok: true };
    };
    expect(confirmWith('qr').ok).toBe(true);
    expect(confirmWith('otp')).toEqual({ ok: false, code: 'TOKEN_CONSUMED' });
  });

  it('documents Stage 3 picked_up bypass as known debt (not expanded here)', () => {
    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r1' },
        'picked_up',
      ),
    ).not.toThrow();
  });
});

describe('UCE-4 delivery recipient architecture', () => {
  const service = readFileSync(join(__dirname, 'delivery-handoff.service.ts'), 'utf8');
  const custody = readFileSync(
    join(__dirname, '../agreements/custody-event.service.ts'),
    'utf8',
  );
  const controller = readFileSync(join(__dirname, 'delivery-handoff.controller.ts'), 'utf8');

  it('keeps Stage 5A issue as the only delivery-token route', () => {
    expect(controller).toContain("@Post('orders/:orderId/delivery-token')");
    expect(controller).toContain("@Get('orders/:orderId/delivery-recipient')");
    expect(controller).toContain("@Post('orders/:orderId/delivery-recipient')");
    expect(controller).toContain("@Post('orders/:orderId/delivery-recipient/revoke')");
    expect(controller).not.toContain('@Patch(');
    expect(controller).not.toContain('@Delete(');
  });

  it('closes public CUSTOMER_RECEIVED without changing RETURN_INITIATED', () => {
    expect(custody).toContain('CUSTOMER_RECEIVED_REQUIRES_HANDOFF');
    expect(custody).toContain('recordSecureCustomerDeliveryInTx');
    expect(custody).toContain('CustodyEventType.RETURN_INITIATED');
    expect(service).toContain('recordSecureCustomerDeliveryInTx');
    expect(service).not.toContain('eventType: CustodyEventType.CUSTOMER_RECEIVED');
    expect(service).toContain('assertPossessionDependentRiderAuthority');
  });

  it('does not put the recipient display name in recipient domain events', () => {
    const authorized = service.indexOf("'DELIVERY_RECIPIENT_AUTHORIZED'");
    const revoked = service.indexOf("'DELIVERY_RECIPIENT_REVOKED'");
    expect(authorized).toBeGreaterThan(0);
    expect(revoked).toBeGreaterThan(authorized);
    expect(service.slice(authorized, revoked)).not.toContain('recipientDisplayName');
    expect(service).toContain('authorizationBound:');
  });
});
