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
