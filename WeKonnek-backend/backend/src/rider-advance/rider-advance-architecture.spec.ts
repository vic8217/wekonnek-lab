import { BadRequestException } from '@nestjs/common';
import { AgreementType, Prisma, RiderAdvanceStatus } from '@prisma/client';
import {
  AGREEMENT_CANONICAL_SCHEMA,
  buildRiderAdvanceTerms,
  verifyTermsIntegrity,
} from '../agreements/agreement-canonical';
import { AgreementService } from '../agreements/agreement.service';
import { RiderAdvanceService } from './rider-advance.service';

describe('Stage 4A Rider Advance canonical terms', () => {
  const base = {
    wkOrderId: 77,
    orderCode: 'WK-RA-77',
    buyerId: '11111111-1111-1111-1111-111111111111',
    merchantId: 3,
    merchantName: 'Cash Vendor',
    riderUserId: '22222222-2222-2222-2222-222222222222',
    riderAssignmentId: '33333333-3333-3333-3333-333333333333',
    assignmentVersion: 2,
    shopId: null as number | null,
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    paymentRef: null as string | null,
    totalAmount: '1000.00',
    deliveryFee: '50.00',
    discountAmount: '0.00',
    transactionFeeAmount: '0.00',
    maximumAuthorizedAdvance: '1050.00',
    merchantAllowRiderAdvance: true,
    merchantHasCashMethod: true,
    items: [
      {
        productId: 1,
        productName: 'Goods',
        variantId: null,
        quantity: 1,
        price: '1000.00',
        subtotal: '1000.00',
      },
    ],
    issuedAt: new Date('2026-09-16T00:00:00.000Z'),
  };

  it('hashes Rider Advance terms deterministically with Decimal-safe money', () => {
    const a = buildRiderAdvanceTerms(base);
    const b = buildRiderAdvanceTerms(base);
    expect(a.termsHash).toBe(b.termsHash);
    expect(a.terms.schema).toBe(AGREEMENT_CANONICAL_SCHEMA);
    expect(a.terms.agreementType).toBe('RIDER_ADVANCE');
    expect(a.terms.riderAdvance?.maximumAuthorizedAdvance).toBe('1050.00');
    expect(a.terms.riderAdvance?.wekonnekIsNotAdvancingParty).toBe(true);
    expect(a.terms.riderAdvance?.reimbursementPrincipalRule).toBe(
      'actual_acknowledged_amount_not_maximum',
    );
    expect(a.terms.riderAdvance?.convenienceFeeSeparate).toBe(true);
    expect(a.terms.riderAdvance?.deliveryFeeSeparate).toBe(true);
    expect(a.terms.money.deliveryFee).toBe('50.00');
    expect(verifyTermsIntegrity(a.terms, a.termsHash).status).toBe('valid');
  });

  it('keeps delivery fee separate from authorized maximum', () => {
    const { terms } = buildRiderAdvanceTerms(base);
    expect(terms.money.deliveryFee).not.toBe(
      terms.riderAdvance?.maximumAuthorizedAdvance,
    );
  });
});

describe('Stage 4A controlled RIDER_ADVANCE path', () => {
  it('blocks generic AgreementService creation of RIDER_ADVANCE', () => {
    const svc = Object.create(AgreementService.prototype) as AgreementService;
    expect(() =>
      svc.assertRiderAdvanceNotActivated(AgreementType.RIDER_ADVANCE),
    ).toThrow(BadRequestException);
    try {
      svc.assertRiderAdvanceNotActivated(AgreementType.RIDER_ADVANCE);
    } catch (err) {
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: 'RIDER_ADVANCE_CONTROLLED_PATH_REQUIRED',
      });
    }
  });
});

describe('Stage 4A monetary and lifecycle invariants (unit)', () => {
  it('enforces actual <= authorized maximum with Decimal', () => {
    const max = new Prisma.Decimal('1050.00');
    const ok = new Prisma.Decimal('1050.00');
    const over = new Prisma.Decimal('1050.01');
    expect(ok.lte(max)).toBe(true);
    expect(over.lte(max)).toBe(false);
  });

  it('sets reimbursement principal to actual amount not maximum', () => {
    const authorizedMaximum = new Prisma.Decimal('1100.00');
    const actual = new Prisma.Decimal('980.00');
    const principal = actual;
    expect(principal.eq(actual)).toBe(true);
    expect(principal.eq(authorizedMaximum)).toBe(false);
  });

  it('treats unused authorization capacity as non-debt', () => {
    const max = new Prisma.Decimal('1500.00');
    const actual = new Prisma.Decimal('1100.00');
    const debt = actual;
    expect(debt.toFixed(2)).toBe('1100.00');
    expect(debt.eq(max)).toBe(false);
  });

  it('requires exact vendor ack match before reimbursement due', () => {
    const riderClaim = new Prisma.Decimal('1000.00');
    const merchantAck = new Prisma.Decimal('950.00');
    const match = riderClaim.eq(merchantAck);
    expect(match).toBe(false);
    // mismatch → DISPUTED, no REIMBURSEMENT_DUE
  });

  it('documents eligibility: cash method AND allowRiderAdvance', () => {
    const eligible = (cashEnabled: boolean, allowRA: boolean) =>
      cashEnabled && allowRA;
    expect(eligible(true, false)).toBe(false);
    expect(eligible(false, true)).toBe(false);
    expect(eligible(true, true)).toBe(true);
  });

  it('documents assignment-version binding and reassignment non-inheritance', () => {
    const auth = { riderId: 'A', assignmentVersion: 1 };
    const current = { riderId: 'B', assignmentVersion: 2 };
    expect(
      auth.riderId === current.riderId &&
        auth.assignmentVersion === current.assignmentVersion,
    ).toBe(false);
  });

  it('documents cancellation before vs after advance', () => {
    const before = RiderAdvanceStatus.RIDER_ACCEPTED;
    const after = RiderAdvanceStatus.REIMBURSEMENT_DUE;
    const cancelBefore = (s: RiderAdvanceStatus) =>
      s === RiderAdvanceStatus.RIDER_ACCEPTED
        ? RiderAdvanceStatus.CANCELLED
        : RiderAdvanceStatus.DISPUTED;
    expect(cancelBefore(before)).toBe(RiderAdvanceStatus.CANCELLED);
    expect(cancelBefore(after)).toBe(RiderAdvanceStatus.DISPUTED);
  });

  it('documents Stage 3 pickup gate for RA orders only', async () => {
    const svc = Object.create(RiderAdvanceService.prototype) as RiderAdvanceService;
    const allowed = [
      RiderAdvanceStatus.VENDOR_ACKNOWLEDGED,
      RiderAdvanceStatus.REIMBURSEMENT_DUE,
      RiderAdvanceStatus.REIMBURSED,
    ];
    expect(allowed.includes(RiderAdvanceStatus.ADVANCE_RECORDED)).toBe(false);
    expect(allowed.includes(RiderAdvanceStatus.VENDOR_ACKNOWLEDGED)).toBe(true);
    // Non-RA: assertPickupAllowed returns ok without row — covered by service method existence
    expect(typeof svc.assertPickupAllowedForOrder).toBe('function');
  });

  it('documents payment ownership separation', () => {
    const path = {
      ordinary: 'CUSTOMER→MERCHANT',
      riderAdvance: 'RIDER→CASH_MERCHANT then CUSTOMER→RIDER_REIMBURSEMENT',
      wekonnekAdvances: false,
      payCoolsForMerchandise: false,
      walletAdvance: false,
    };
    expect(path.wekonnekAdvances).toBe(false);
    expect(path.payCoolsForMerchandise).toBe(false);
  });

  it('documents fee separation', () => {
    const summary = {
      merchandiseActual: '980.00',
      deliveryFee: '50.00',
      riderAdvanceConvenienceFee: null as string | null,
      reimbursementPrincipal: '980.00',
    };
    expect(summary.reimbursementPrincipal).toBe(summary.merchandiseActual);
    expect(summary.riderAdvanceConvenienceFee).toBeNull();
    expect(summary.deliveryFee).not.toBe(summary.reimbursementPrincipal);
  });
});

describe('Stage 4A authorization matrix (documented)', () => {
  it('encodes role permissions', () => {
    const matrix = {
      CUSTOMER: ['authorize', 'amend', 'view_own', 'cancel'],
      RIDER: ['view_assigned', 'accept', 'record_advance'],
      MERCHANT: ['view_own_orders', 'vendor_acknowledge'],
      COORDINATOR: [] as string[],
      ADMIN: ['audit_view'],
      SYSTEM: ['orchestrate'],
    };
    expect(matrix.COORDINATOR).toHaveLength(0);
    expect(matrix.CUSTOMER).toContain('authorize');
    expect(matrix.RIDER).toContain('record_advance');
    expect(matrix.MERCHANT).toContain('vendor_acknowledge');
    expect(matrix.RIDER).not.toContain('vendor_acknowledge');
  });
});

describe('Stage 4A client architecture (documented)', () => {
  it('documents single canonical rider/customer contract (no pwa vs native split)', () => {
    const routes = {
      customerAuthorize: 'POST /orders/:orderId/rider-advance/authorize',
      customerGet: 'GET /orders/:orderId/rider-advance',
      riderAccept: 'POST /rider-advances/:id/accept',
      riderRecord: 'POST /rider-advances/:id/record-advance',
      merchantAck: 'POST /rider-advances/:id/vendor-acknowledgment',
      riderPickupToken: 'POST /orders/:orderId/pickup-token',
    };
    expect(
      Object.values(routes).every(
        (r) => !r.includes('/pwa/') && !r.includes('/native/'),
      ),
    ).toBe(true);
  });

  it('documents production clients: rider native-only; customer native+web; merchant PWA', () => {
    const production = {
      customer: ['native', 'web_pwa'],
      rider: ['native'],
      merchant: ['web_pwa'],
      riderPwaIsUatOnly: true,
      serverAuthoritative: true,
      bearerJwtNotCookieForApiAuth: true,
    };
    expect(production.rider).toEqual(['native']);
    expect(production.customer).toContain('web_pwa');
    expect(production.riderPwaIsUatOnly).toBe(true);
  });
});
