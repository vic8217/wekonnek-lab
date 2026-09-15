import {
  AGREEMENT_CANONICAL_SCHEMA,
  buildMerchantTradeTerms,
  canonicalizeJson,
  sha256Hex,
  verifyTermsIntegrity,
} from './agreement-canonical';
import { AgreementType } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { AgreementService } from './agreement.service';

describe('Stage 2A agreement canonical + integrity', () => {
  const base = {
    wkOrderId: 42,
    orderCode: 'WK-TEST-42',
    buyerId: '11111111-1111-1111-1111-111111111111',
    merchantId: 9,
    merchantName: 'Acme NonFood',
    shopId: 1,
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    paymentRef: null as string | null,
    totalAmount: '910.00',
    deliveryFee: '50.00',
    discountAmount: '0.00',
    transactionFeeAmount: '10.00',
    items: [
      {
        productId: 1,
        productName: 'Widget',
        variantId: null,
        quantity: 1,
        price: '850.00',
        subtotal: '850.00',
      },
    ],
    issuedAt: new Date('2026-09-15T00:00:00.000Z'),
  };

  it('produces deterministic canonical JSON and stable SHA-256', () => {
    const a = buildMerchantTradeTerms(base);
    const b = buildMerchantTradeTerms(base);
    expect(a.canonicalJson).toBe(b.canonicalJson);
    expect(a.termsHash).toBe(b.termsHash);
    expect(a.termsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.terms.schema).toBe(AGREEMENT_CANONICAL_SCHEMA);
    expect(a.terms.paymentFacts.note).toBe(
      'payment_beneficiary_not_decided_by_agreement',
    );
    expect(a.terms.riderAdvance).toBeNull();
  });

  it('property order does not affect hash when using canonicalize', () => {
    const left = canonicalizeJson({ b: 1, a: { d: 2, c: 3 } });
    const right = canonicalizeJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(left).toBe(right);
    expect(sha256Hex(left)).toBe(sha256Hex(right));
  });

  it('detects tampering via integrity verification', () => {
    const { terms, termsHash } = buildMerchantTradeTerms(base);
    expect(verifyTermsIntegrity(terms, termsHash).status).toBe('valid');

    const tampered = {
      ...terms,
      money: { ...terms.money, total: '1.00' },
    };
    const result = verifyTermsIntegrity(tampered, termsHash);
    expect(result.status).toBe('invalid');

    expect(
      verifyTermsIntegrity({ schema: 'OTHER' }, termsHash).status,
    ).toBe('unsupported_schema');
  });

  it('keeps money as decimal strings not floats', () => {
    const { terms } = buildMerchantTradeTerms({
      ...base,
      totalAmount: 910.1,
    });
    expect(terms.money.total).toMatch(/^\d+\.\d{2}$/);
  });
});

describe('Stage 2A Rider Advance activation guard', () => {
  it('refuses operational Rider Advance activation', () => {
    const svc = Object.create(AgreementService.prototype) as AgreementService;
    expect(() =>
      svc.assertRiderAdvanceNotActivated(AgreementType.RIDER_ADVANCE),
    ).toThrow(BadRequestException);
    expect(() =>
      svc.assertRiderAdvanceNotActivated(AgreementType.MERCHANT_TRADE),
    ).not.toThrow();
  });
});

describe('Stage 2A lifecycle semantics (unit)', () => {
  it('documents required multi-party acceptance rule', () => {
    const required = ['CUSTOMER', 'RIDER'];
    const acceptances = [{ partyRole: 'CUSTOMER' }];
    const satisfied = required.every((role) =>
      acceptances.some((a) => a.partyRole === role),
    );
    expect(satisfied).toBe(false);
    acceptances.push({ partyRole: 'RIDER' });
    expect(
      required.every((role) => acceptances.some((a) => a.partyRole === role)),
    ).toBe(true);
  });

  it('documents rider reassignment integrity rule', () => {
    const agreementPartyRiderId = 'rider-a';
    const currentAssignmentRiderId = 'rider-b';
    expect(agreementPartyRiderId).not.toBe(currentAssignmentRiderId);
    // Accepted agreement party must not be silently rewritten on reassignment.
  });
});
