import {
  getAccuraMerchantIssuanceEligibility,
  merchantFacingIssuanceMessage,
} from './accura-eligibility';

describe('getAccuraMerchantIssuanceEligibility', () => {
  const synced = new Date('2026-09-12T00:00:00.000Z');

  it('blocks when merchant link is missing', () => {
    expect(
      getAccuraMerchantIssuanceEligibility({
        link: null,
        shopId: 7,
        hasBranchMapping: true,
      }),
    ).toMatchObject({
      eligible: false,
      status: 'NOT_CONNECTED',
      reason: 'MERCHANT_NOT_MAPPED',
    });
  });

  it('blocks onboarding / inactive cached status without ACCURA HTTP intent', () => {
    expect(
      getAccuraMerchantIssuanceEligibility({
        link: {
          lastAccountStatus: 'PENDING_REVIEW',
          lastReviewStatus: 'UNDER_REVIEW',
          lastSyncedAt: synced,
        },
        shopId: 7,
        hasBranchMapping: true,
      }),
    ).toMatchObject({
      eligible: false,
      status: 'ONBOARDING',
      reason: 'MERCHANT_NOT_ACTIVE',
    });
  });

  it('blocks suspended merchants', () => {
    expect(
      getAccuraMerchantIssuanceEligibility({
        link: {
          lastAccountStatus: 'SUSPENDED',
          lastReviewStatus: 'APPROVED',
          lastProductionEligible: false,
          lastSyncedAt: synced,
        },
        shopId: 7,
        hasBranchMapping: true,
      }),
    ).toMatchObject({
      eligible: false,
      status: 'SUSPENDED',
      reason: 'MERCHANT_SUSPENDED',
    });
  });

  it('blocks disconnected / revoked', () => {
    expect(
      getAccuraMerchantIssuanceEligibility({
        link: {
          lastAccountStatus: 'DISCONNECTED',
          lastReviewStatus: 'APPROVED',
          lastSyncedAt: synced,
        },
        shopId: 7,
        hasBranchMapping: true,
      }),
    ).toMatchObject({
      eligible: false,
      reason: 'MERCHANT_DISCONNECTED',
    });
  });

  it('blocks when branch mapping is missing', () => {
    expect(
      getAccuraMerchantIssuanceEligibility({
        link: {
          lastAccountStatus: 'ACTIVE',
          lastReviewStatus: 'APPROVED',
          lastProductionEligible: true,
          lastSyncedAt: synced,
        },
        shopId: 7,
        hasBranchMapping: false,
      }),
    ).toMatchObject({
      eligible: false,
      status: 'BRANCH_NOT_MAPPED',
      reason: 'BRANCH_NOT_MAPPED',
    });
  });

  it('allows ACTIVE merchants with branch mapping', () => {
    expect(
      getAccuraMerchantIssuanceEligibility({
        link: {
          lastAccountStatus: 'ACTIVE',
          lastReviewStatus: 'APPROVED',
          lastProductionEligible: true,
          lastSyncedAt: synced,
        },
        shopId: 7,
        hasBranchMapping: true,
      }),
    ).toMatchObject({
      eligible: true,
      status: 'ACTIVE',
      reason: 'OK',
      lastSyncedAt: synced,
    });
  });

  it('maps merchant-facing copy for permanent codes', () => {
    expect(merchantFacingIssuanceMessage('COMPLIANCE_NOT_VERIFIED').message).toMatch(
      /not yet complete/i,
    );
    expect(merchantFacingIssuanceMessage('MERCHANT_NOT_ACTIVE').action).toBe(
      'Continue ACCURA Setup',
    );
    expect(
      merchantFacingIssuanceMessage('INVOICE_SERIES_NOT_CONFIGURED').action,
    ).toBe('Open ACCURA');
  });
});
