/**
 * Server-side production eligibility gate for ACCURA invoice issuance.
 * ACCURA remains final authority; WeKonnek uses cached status for an early block.
 */

export type AccuraIssuanceEligibilityStatus =
  | 'ACTIVE'
  | 'ONBOARDING'
  | 'NEEDS_ACTION'
  | 'SUSPENDED'
  | 'DISCONNECTED'
  | 'NOT_CONNECTED'
  | 'BRANCH_NOT_MAPPED'
  | 'UNKNOWN';

export type AccuraIssuanceEligibilityReason =
  | 'OK'
  | 'MERCHANT_NOT_MAPPED'
  | 'MERCHANT_NOT_ACTIVE'
  | 'MERCHANT_SUSPENDED'
  | 'MERCHANT_DISCONNECTED'
  | 'BRANCH_NOT_MAPPED'
  | 'COMPLIANCE_NOT_VERIFIED';

export type AccuraIssuanceEligibility = {
  eligible: boolean;
  status: AccuraIssuanceEligibilityStatus;
  reason: AccuraIssuanceEligibilityReason;
  lastSyncedAt: Date | null;
};

const INACTIVE_ACCOUNT = new Set([
  'SUSPENDED',
  'TERMINATED',
  'DISCONNECTED',
  'REVOKED',
]);

export type AccuraMerchantLinkSnapshot = {
  lastAccountStatus: string | null;
  lastReviewStatus: string | null;
  lastProductionEligible?: boolean | null;
  lastSyncedAt: Date | null;
} | null;

/**
 * Early gate using WeKonnek-cached ACCURA status + shop branch mapping.
 * Never overrides an ACCURA HTTP rejection.
 */
export function getAccuraMerchantIssuanceEligibility(input: {
  link: AccuraMerchantLinkSnapshot;
  shopId: number | null | undefined;
  hasBranchMapping: boolean;
}): AccuraIssuanceEligibility {
  const lastSyncedAt = input.link?.lastSyncedAt ?? null;

  if (!input.link) {
    return {
      eligible: false,
      status: 'NOT_CONNECTED',
      reason: 'MERCHANT_NOT_MAPPED',
      lastSyncedAt,
    };
  }

  const account = String(input.link.lastAccountStatus || '').toUpperCase();
  const review = String(input.link.lastReviewStatus || '').toUpperCase();
  const productionEligible =
    input.link.lastProductionEligible === true || account === 'ACTIVE';

  if (INACTIVE_ACCOUNT.has(account)) {
    return {
      eligible: false,
      status: account === 'DISCONNECTED' || account === 'REVOKED'
        ? 'DISCONNECTED'
        : 'SUSPENDED',
      reason:
        account === 'DISCONNECTED' || account === 'REVOKED'
          ? 'MERCHANT_DISCONNECTED'
          : 'MERCHANT_SUSPENDED',
      lastSyncedAt,
    };
  }

  if (!productionEligible) {
    const needsAction =
      review === 'NEEDS_CORRECTION' ||
      Boolean(input.link.lastReviewStatus && review !== 'APPROVED');
    return {
      eligible: false,
      status: needsAction && review === 'NEEDS_CORRECTION' ? 'NEEDS_ACTION' : 'ONBOARDING',
      reason:
        review === 'NEEDS_CORRECTION'
          ? 'COMPLIANCE_NOT_VERIFIED'
          : 'MERCHANT_NOT_ACTIVE',
      lastSyncedAt,
    };
  }

  if (input.shopId == null || !input.hasBranchMapping) {
    return {
      eligible: false,
      status: 'BRANCH_NOT_MAPPED',
      reason: 'BRANCH_NOT_MAPPED',
      lastSyncedAt,
    };
  }

  return {
    eligible: true,
    status: 'ACTIVE',
    reason: 'OK',
    lastSyncedAt,
  };
}

export const ACCURA_MERCHANT_ERROR_COPY: Record<string, { message: string; action?: string }> = {
  MERCHANT_NOT_MAPPED: {
    message: 'ACCURA e-invoicing is not connected for this merchant.',
    action: 'Set Up ACCURA',
  },
  MERCHANT_NOT_ACTIVE: {
    message: 'ACCURA electronic invoicing is not active for this merchant.',
    action: 'Continue ACCURA Setup',
  },
  MERCHANT_SUSPENDED: {
    message: 'ACCURA electronic invoicing is suspended for this merchant.',
    action: 'Open ACCURA',
  },
  MERCHANT_DISCONNECTED: {
    message: 'ACCURA electronic invoicing is disconnected for this merchant.',
    action: 'Open ACCURA',
  },
  BRANCH_NOT_MAPPED: {
    message: 'This shop is not mapped to an ACCURA registered branch.',
    action: 'Open ACCURA Setup',
  },
  COMPLIANCE_NOT_VERIFIED: {
    message: 'ACCURA setup is not yet complete.',
    action: 'Continue ACCURA Setup',
  },
  CLIENT_ACCOUNT_NOT_ACTIVE: {
    message: 'ACCURA electronic invoicing is not active for this merchant.',
    action: 'Continue ACCURA Setup',
  },
  CLIENT_ACCOUNT_SUSPENDED: {
    message: 'ACCURA electronic invoicing is suspended for this merchant.',
    action: 'Open ACCURA',
  },
  CLIENT_ACCOUNT_TERMINATED: {
    message: 'ACCURA electronic invoicing is disconnected for this merchant.',
    action: 'Open ACCURA',
  },
  INVOICE_SERIES_NOT_CONFIGURED: {
    message: 'Your ACCURA invoice setup requires attention.',
    action: 'Open ACCURA',
  },
  MERCHANT_NOT_AUTHORIZED_FOR_ISSUANCE: {
    message: 'ACCURA electronic invoicing is not authorized for this merchant.',
    action: 'Open ACCURA',
  },
  COMPLIANCE_NOT_VERIFIED_CODE: {
    message: 'ACCURA setup is not yet complete.',
    action: 'Continue ACCURA Setup',
  },
};

export function merchantFacingIssuanceMessage(code: string | null | undefined): {
  message: string;
  action?: string;
} {
  const key = String(code || '').trim();
  if (ACCURA_MERCHANT_ERROR_COPY[key]) return ACCURA_MERCHANT_ERROR_COPY[key];
  if (key === 'COMPLIANCE_NOT_VERIFIED') {
    return ACCURA_MERCHANT_ERROR_COPY.COMPLIANCE_NOT_VERIFIED;
  }
  return {
    message: 'ACCURA e-invoicing requires attention.',
    action: 'Open ACCURA',
  };
}
