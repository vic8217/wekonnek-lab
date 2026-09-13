export type AccuraOnboardingPhase =
  | 'unavailable'
  | 'suspended'
  | 'incomplete'
  | 'ready'
  | 'submitted'
  | 'under_review'
  | 'correction'
  | 'approved';

export type AccuraOnboardingPresentationInput = {
  unavailable?: boolean;
  suspended?: boolean;
  reviewStatus?: string | null;
  correctionRequired?: boolean;
  readinessComplete?: boolean;
  readinessPercent?: number;
};

export const SUBMITTED_FOR_REVIEW_NOTICE = {
  title: 'SUBMITTED FOR REVIEW',
  body: 'Your registration has been submitted to ACCURA for review.',
} as const;

export function isAccuraReadinessComplete(input: {
  complete?: boolean;
  percent?: number;
}): boolean {
  return Boolean(input.complete) || Number(input.percent) >= 100;
}

export function accuraOnboardingPresentation(
  input: AccuraOnboardingPresentationInput,
) {
  const review = String(input.reviewStatus || 'INCOMPLETE');
  const ready = isAccuraReadinessComplete({
    complete: input.readinessComplete,
    percent: input.readinessPercent,
  });
  const correction =
    Boolean(input.correctionRequired) || review === 'NEEDS_CORRECTION';

  if (input.unavailable) {
    return {
      phase: 'unavailable' as const,
      title: 'ACCURA status temporarily unavailable',
      body: '',
      submitKind: 'none' as const,
      submitEnabled: false,
      submitLabel: 'Submit for ACCURA Review',
    };
  }

  if (input.suspended) {
    return {
      phase: 'suspended' as const,
      title: 'ACCURA E-Receipt Account Suspended',
      body: '',
      submitKind: 'none' as const,
      submitEnabled: false,
      submitLabel: 'Submit for ACCURA Review',
    };
  }

  if (correction) {
    return {
      phase: 'correction' as const,
      title: 'Correction Required',
      body: 'ACCURA requested changes to your registration. Review the notes below, update the required information, and resubmit.',
      submitKind: 'resubmit' as const,
      submitEnabled: ready,
      submitLabel: 'Resubmit for ACCURA Review',
    };
  }

  if (review === 'APPROVED') {
    return {
      phase: 'approved' as const,
      title: 'Approved for ACCURA Setup',
      body: 'Your registration has been approved for ACCURA setup.',
      submitKind: 'none' as const,
      submitEnabled: false,
      submitLabel: 'Submit for ACCURA Review',
    };
  }

  if (review === 'UNDER_REVIEW') {
    return {
      phase: 'under_review' as const,
      title: 'Under ACCURA Review',
      body: 'ACCURA is reviewing your registration.',
      submitKind: 'none' as const,
      submitEnabled: false,
      submitLabel: 'Submit for ACCURA Review',
    };
  }

  if (review === 'SUBMITTED') {
    return {
      phase: 'submitted' as const,
      title: 'Submitted for Review',
      body: 'Your registration has been submitted to ACCURA. You will be notified when the review status changes.',
      submitKind: 'none' as const,
      submitEnabled: false,
      submitLabel: 'Submit for ACCURA Review',
    };
  }

  if (ready) {
    return {
      phase: 'ready' as const,
      title: 'Ready for Submission',
      body: 'Your E-Receipt setup is complete. Submit your registration for ACCURA review.',
      submitKind: 'submit' as const,
      submitEnabled: true,
      submitLabel: 'Submit for ACCURA Review',
    };
  }

  return {
    phase: 'incomplete' as const,
    title: 'Setup Incomplete',
    body: '',
    submitKind: 'submit' as const,
    submitEnabled: false,
    submitLabel: 'Submit for ACCURA Review',
  };
}

export function submittedForReviewNotice(succeeded: boolean) {
  return succeeded ? SUBMITTED_FOR_REVIEW_NOTICE : null;
}

export type AccuraTaxpayerProfileFields = {
  legalName?: string | null;
  tin?: string | null;
  registeredAddressLine1?: string | null;
  classification?: string | null;
};

/** True when ACCURA's profile already holds taxpayer business information. */
export function hasAuthoritativeTaxpayerProfile(
  profile: AccuraTaxpayerProfileFields | null | undefined,
): boolean {
  if (!profile) return false;
  return Boolean(
    String(profile.legalName || '').trim() ||
      String(profile.tin || '').trim() ||
      String(profile.registeredAddressLine1 || '').trim() ||
      String(profile.classification || '').trim(),
  );
}

export function isAccuraReviewEditingLocked(input: {
  reviewStatus?: string | null;
  correctionRequired?: boolean;
}): boolean {
  const review = String(input.reviewStatus || '');
  if (input.correctionRequired || review === 'NEEDS_CORRECTION') return false;
  return (
    review === 'SUBMITTED' ||
    review === 'UNDER_REVIEW' ||
    review === 'APPROVED'
  );
}

export function accuraBusinessInfoPresentation(input: {
  profile?: AccuraTaxpayerProfileFields | null;
  reviewStatus?: string | null;
  correctionRequired?: boolean;
  unavailable?: boolean;
  editing?: boolean;
}) {
  const saved = hasAuthoritativeTaxpayerProfile(input.profile);
  const reviewLocked = isAccuraReviewEditingLocked({
    reviewStatus: input.reviewStatus,
    correctionRequired: input.correctionRequired,
  });
  const unavailable = Boolean(input.unavailable);
  const editing = Boolean(input.editing) && saved && !reviewLocked && !unavailable;
  const review = String(input.reviewStatus || '');

  if (reviewLocked) {
    const lockLabel =
      review === 'APPROVED'
        ? 'Approved for ACCURA Setup'
        : review === 'UNDER_REVIEW'
          ? 'Under ACCURA Review'
          : review === 'SUBMITTED'
            ? 'Submitted for Review'
            : '';
    return {
      saved,
      fieldsDisabled: true,
      showSave: false,
      showEdit: false,
      showSaveChanges: false,
      showCancel: false,
      lockLabel,
      primaryLabel: '',
    };
  }

  if (!saved) {
    return {
      saved: false,
      fieldsDisabled: unavailable,
      showSave: true,
      showEdit: false,
      showSaveChanges: false,
      showCancel: false,
      lockLabel: '',
      primaryLabel: 'Save',
    };
  }

  if (editing) {
    return {
      saved: true,
      fieldsDisabled: false,
      showSave: false,
      showEdit: false,
      showSaveChanges: true,
      showCancel: true,
      lockLabel: '',
      primaryLabel: 'Save Changes',
    };
  }

  return {
    saved: true,
    fieldsDisabled: true,
    showSave: false,
    showEdit: !unavailable,
    showSaveChanges: false,
    showCancel: false,
    lockLabel: '',
    primaryLabel: 'Edit',
  };
}

export function statusToneClass(phase: AccuraOnboardingPhase) {
  if (phase === 'suspended') return 'bg-red-50 border-red-200 text-red-800';
  if (phase === 'correction') return 'bg-amber-50 border-amber-200 text-amber-900';
  if (phase === 'approved') return 'bg-green-50 border-green-200 text-green-800';
  if (
    phase === 'submitted' ||
    phase === 'under_review' ||
    phase === 'ready'
  ) {
    return 'bg-blue-50 border-blue-200 text-blue-800';
  }
  return 'bg-gray-50 border-gray-200 text-gray-800';
}

export const ACCURA_MISSING_KEY_LABELS: Record<string, string> = {
  legalName: 'Business legal name is still needed in ACCURA',
  tin: 'Tax identification is still needed in ACCURA',
  classification: 'Tax classification is still needed in ACCURA',
  registeredAddressLine1: 'Registered address is still needed in ACCURA',
  branch: 'A registered branch is still needed in ACCURA',
  activeBranch: 'A registered branch is still needed in ACCURA',
  hasBranches: 'Branch declaration is still needed in ACCURA',
  supportingDocument: 'A registration document is still needed in ACCURA',
  activeNumberSeries: 'Invoice numbering is pending ACCURA activation',
};

export const ACCURA_SECTION_LABELS: Record<string, string> = {
  taxpayerIdentity: 'Business registration',
  taxProfile: 'Tax configuration',
  branches: 'Branch registration',
  documents: 'Documents',
  invoiceSetup: 'Invoice numbering',
  review: 'ACCURA review',
  activation: 'Invoice activation',
};

export type AccuraIntegrationDisplayState =
  | 'NOT_CONNECTED'
  | 'SETUP_INCOMPLETE'
  | 'UNDER_REVIEW'
  | 'CORRECTION_REQUIRED'
  | 'READY_FOR_ACTIVATION'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'UNAVAILABLE';

export type AccuraEInvoiceStatusInput = {
  unavailable?: boolean;
  lastKnown?: boolean;
  lastKnownPercent?: number | null;
  lastSyncedAt?: string | null;
  notConfigured?: boolean;
  suspended?: boolean;
  correctionRequired?: boolean;
  reviewStatus?: string | null;
  /** Prefer ACCURA-derived production eligibility when present. */
  productionEligible?: boolean | null;
  issuanceActive?: boolean;
  approvedForAccuraSetup?: boolean;
  readinessComplete?: boolean;
  readinessPercent?: number | null;
  shopCount?: number;
  mappedShopCount?: number;
  /** @deprecated Checklist sections are not shown on the merchant status page. */
  sections?: Array<{ key: string; label: string; complete: boolean; missing: string[] }>;
};

export function friendlyMissingLabel(key: string) {
  return ACCURA_MISSING_KEY_LABELS[key] || 'Additional information is still needed in ACCURA';
}

function isProductionEligible(input: AccuraEInvoiceStatusInput): boolean {
  if (typeof input.productionEligible === 'boolean') {
    return input.productionEligible;
  }
  return Boolean(input.issuanceActive);
}

export function accuraIntegrationDisplayState(
  input: AccuraEInvoiceStatusInput,
): AccuraIntegrationDisplayState {
  if (input.unavailable) {
    if (!input.lastKnown && input.notConfigured) return 'NOT_CONNECTED';
    return 'UNAVAILABLE';
  }
  if (input.suspended) return 'SUSPENDED';
  if (input.correctionRequired || input.reviewStatus === 'NEEDS_CORRECTION') {
    return 'CORRECTION_REQUIRED';
  }
  if (isProductionEligible(input)) return 'ACTIVE';
  if (input.approvedForAccuraSetup || input.reviewStatus === 'APPROVED') {
    return 'READY_FOR_ACTIVATION';
  }
  if (input.reviewStatus === 'SUBMITTED' || input.reviewStatus === 'UNDER_REVIEW') {
    return 'UNDER_REVIEW';
  }
  return 'SETUP_INCOMPLETE';
}

/** Merchant-facing primary status titles (not raw ACCURA enums). */
const DISPLAY_TITLES: Record<AccuraIntegrationDisplayState, string> = {
  NOT_CONNECTED: 'Not Set Up',
  SETUP_INCOMPLETE: 'Setup In Progress',
  UNDER_REVIEW: 'Pending Review',
  CORRECTION_REQUIRED: 'Action Required',
  READY_FOR_ACTIVATION: 'Ready for Activation',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  UNAVAILABLE: 'Status temporarily unavailable',
};

const DISPLAY_BODIES: Record<AccuraIntegrationDisplayState, string> = {
  NOT_CONNECTED:
    'Connect ACCURA to manage electronic invoicing for your WeKonnek transactions.',
  SETUP_INCOMPLETE:
    'Your ACCURA setup requires additional information before electronic invoicing can be activated.',
  UNDER_REVIEW:
    'Your ACCURA setup has been submitted and is currently being reviewed. No action is required in WeKonnek.',
  CORRECTION_REQUIRED:
    'ACCURA requires additional information before electronic invoicing can be activated.',
  READY_FOR_ACTIVATION:
    'Your ACCURA setup is ready. Open ACCURA to complete production activation.',
  ACTIVE: 'Electronic invoicing is active for your WeKonnek transactions.',
  SUSPENDED:
    'Electronic invoice issuance is currently unavailable. Open ACCURA for details.',
  UNAVAILABLE:
    'We could not refresh ACCURA status right now. Last known status is shown below when available.',
};

export type AccuraConnectionSummary = {
  connectionLabel: string;
  invoicingLabel: string;
  productionLabel: string;
  shopMappingLabel: string;
};

export function accuraConnectionSummary(
  input: AccuraEInvoiceStatusInput & { displayState?: AccuraIntegrationDisplayState },
): AccuraConnectionSummary {
  const state = input.displayState || accuraIntegrationDisplayState(input);
  const shopCount = Number(input.shopCount) || 0;
  const mapped = Number(input.mappedShopCount) || 0;
  const unmapped = Math.max(0, shopCount - mapped);

  let shopMappingLabel = 'No shops yet';
  if (shopCount > 0) {
    shopMappingLabel =
      unmapped === 0
        ? `${mapped} of ${shopCount} mapped`
        : unmapped === 1
          ? '1 shop requires mapping'
          : `${unmapped} shops require mapping`;
  }

  return {
    connectionLabel:
      state === 'NOT_CONNECTED' ? 'Not Connected' : 'Connected',
    invoicingLabel: DISPLAY_TITLES[state],
    productionLabel: isProductionEligible(input) ? 'Active' : 'Not Active',
    shopMappingLabel,
  };
}

function authoritativeProgressPercent(
  input: AccuraEInvoiceStatusInput,
): number | null {
  if (input.unavailable) {
    if (!input.lastKnown) return null;
    return typeof input.lastKnownPercent === 'number' &&
      Number.isFinite(input.lastKnownPercent)
      ? input.lastKnownPercent
      : null;
  }
  return typeof input.readinessPercent === 'number' &&
    Number.isFinite(input.readinessPercent)
    ? input.readinessPercent
    : null;
}

export function accuraEInvoiceStatusPage(input: AccuraEInvoiceStatusInput) {
  const displayState = accuraIntegrationDisplayState(input);
  const productionEligible = isProductionEligible(input);
  const progressPercent = authoritativeProgressPercent(input);
  const connection = accuraConnectionSummary({ ...input, displayState });
  const lastKnownTitle = input.lastKnown
    ? lastKnownMerchantTitle(input)
    : null;

  return {
    displayState,
    title: DISPLAY_TITLES[displayState],
    body: DISPLAY_BODIES[displayState],
    /** Secondary ACCURA lifecycle label (e.g. Pending Review while overall is Setup In Progress). */
    accuraStatusLabel: secondaryAccuraStatusLabel(input, displayState),
    productionLabel: connection.productionLabel,
    productionEligible,
    progressPercent,
    lastKnown: Boolean(input.unavailable && input.lastKnown),
    lastKnownTitle,
    lastSyncedAt: input.lastSyncedAt || null,
    connection,
    handoffLabel: handoffLabelFor(displayState, productionEligible),
    // Not Set Up still offers secure handoff; temporary outages disable it.
    handoffEnabled: displayState !== 'UNAVAILABLE',
    showRefresh: true,
    /** Checklist intentionally omitted — compliance steps live in ACCURA. */
    sections: [] as Array<{
      key: string;
      label: string;
      complete: boolean;
      missing: string[];
    }>,
  };
}

function lastKnownMerchantTitle(input: AccuraEInvoiceStatusInput): string {
  if (input.suspended || input.reviewStatus === 'SUSPENDED') return 'Suspended';
  if (isProductionEligible(input)) return 'Active';
  if (input.approvedForAccuraSetup || input.reviewStatus === 'APPROVED') {
    return 'Ready for Activation';
  }
  if (input.correctionRequired || input.reviewStatus === 'NEEDS_CORRECTION') {
    return 'Action Required';
  }
  if (
    input.reviewStatus === 'SUBMITTED' ||
    input.reviewStatus === 'UNDER_REVIEW'
  ) {
    return 'Pending Review';
  }
  if (input.reviewStatus) return 'Setup In Progress';
  return 'Unknown';
}

function secondaryAccuraStatusLabel(
  input: AccuraEInvoiceStatusInput,
  state: AccuraIntegrationDisplayState,
): string {
  if (state === 'UNAVAILABLE' && input.lastKnown) {
    return lastKnownMerchantTitle(input);
  }
  if (state === 'ACTIVE') return 'Active';
  if (state === 'SUSPENDED') return 'Suspended';
  if (state === 'CORRECTION_REQUIRED') return 'Action Required';
  if (state === 'UNDER_REVIEW') return 'Pending Review';
  if (state === 'READY_FOR_ACTIVATION') return 'Ready for Activation';
  if (state === 'NOT_CONNECTED') return 'Not Set Up';
  return 'Setup In Progress';
}

function handoffLabelFor(
  state: AccuraIntegrationDisplayState,
  productionEligible: boolean,
): string {
  if (state === 'NOT_CONNECTED') return 'Set Up ACCURA';
  if (state === 'ACTIVE' || productionEligible) return 'Manage ACCURA';
  if (state === 'SUSPENDED') return 'Open ACCURA';
  if (state === 'UNDER_REVIEW' || state === 'READY_FOR_ACTIVATION') {
    return 'Open ACCURA';
  }
  if (state === 'CORRECTION_REQUIRED' || state === 'SETUP_INCOMPLETE') {
    return 'Continue ACCURA Setup';
  }
  return 'Continue ACCURA Setup';
}

export function statusPageToneClass(state: AccuraIntegrationDisplayState) {
  if (state === 'SUSPENDED') {
    return 'bg-red-50 border-red-200 text-red-800';
  }
  if (state === 'CORRECTION_REQUIRED') {
    return 'bg-amber-50 border-amber-200 text-amber-900';
  }
  if (state === 'ACTIVE') {
    return 'bg-green-50 border-green-200 text-green-800';
  }
  if (state === 'READY_FOR_ACTIVATION' || state === 'UNDER_REVIEW') {
    return 'bg-blue-50 border-blue-200 text-blue-800';
  }
  if (state === 'UNAVAILABLE' || state === 'NOT_CONNECTED') {
    return 'bg-gray-50 border-gray-200 text-gray-700';
  }
  return 'bg-gray-50 border-gray-200 text-gray-800';
}

export function formatAccuraStatusTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
