/**
 * Stage 11 Operations Recovery — centralized policy.
 * MAX_DELIVERY_ATTEMPTS imported from Stage 10; never hardcode elsewhere.
 */
import {
  FulfillmentStatus,
  OperationsRecoveryDisposition,
  OperationsRecoveryEvidenceKind,
  OperationsRecoveryTrigger,
  OperationsRecoveryVerificationCode,
} from '@prisma/client';
import { MAX_DELIVERY_ATTEMPTS } from '../redelivery/redelivery.policy';

export { MAX_DELIVERY_ATTEMPTS };

export const OPERATIONS_RECOVERY_ACTIVE_STATUSES = [
  'OPEN',
  'INVESTIGATING',
  'DISPOSITION_SELECTED',
] as const;

export const OPERATIONS_RECOVERY_TERMINAL_STATUSES = [
  'CLOSED',
  'CANCELLED',
] as const;

/**
 * Ordinary Stage 11 open triggers — blocked while Stage 10 redelivery is
 * ACTIVATED (execution authority exclusivity).
 */
export const OPERATIONS_RECOVERY_ORDINARY_OPEN_TRIGGERS: OperationsRecoveryTrigger[] =
  [
    OperationsRecoveryTrigger.DELIVERY_ATTEMPTS_EXHAUSTED,
    OperationsRecoveryTrigger.MERCHANT_RETURN_REFUSED,
    OperationsRecoveryTrigger.RETURN_BLOCKED,
    OperationsRecoveryTrigger.OTHER,
  ];

/**
 * Investigative / emergency triggers permitted while Stage 10 redelivery is
 * ACTIVATED. Stage 11 may investigate only — cannot manufacture another
 * delivery execution path (Stage 10 activation remains gated by active Stage 11).
 */
export const OPERATIONS_RECOVERY_INVESTIGATIVE_WHILE_REDELIVERY_TRIGGERS: OperationsRecoveryTrigger[] =
  [
    OperationsRecoveryTrigger.CUSTODY_UNCONFIRMED,
    OperationsRecoveryTrigger.CUSTODY_TRANSFER_ABANDONED,
    OperationsRecoveryTrigger.RIDER_UNAVAILABLE,
    OperationsRecoveryTrigger.GOODS_REPORTED_LOST,
    OperationsRecoveryTrigger.GOODS_REPORTED_DAMAGED,
    OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
  ];

export function isInvestigativeOpenWhileRedeliveryActive(
  trigger: OperationsRecoveryTrigger,
): boolean {
  return OPERATIONS_RECOVERY_INVESTIGATIVE_WHILE_REDELIVERY_TRIGGERS.includes(
    trigger,
  );
}

export const CONTACT_DISPOSITIONS: OperationsRecoveryDisposition[] = [
  OperationsRecoveryDisposition.CONTACT_CUSTOMER,
  OperationsRecoveryDisposition.CONTACT_MERCHANT,
  OperationsRecoveryDisposition.CONTACT_RIDER,
];

export const CONTACT_EVIDENCE_KINDS: OperationsRecoveryEvidenceKind[] = [
  OperationsRecoveryEvidenceKind.CONTACT_ATTEMPT,
  OperationsRecoveryEvidenceKind.CONTACT_RESULT,
];

export const CUSTODY_INVESTIGATION_VERIFICATION_CODES: OperationsRecoveryVerificationCode[] =
  [
    OperationsRecoveryVerificationCode.CUSTODY_UNCONFIRMED_CONCLUDED,
    OperationsRecoveryVerificationCode.ADMIN_OPERATIONAL_CONCLUSION,
    OperationsRecoveryVerificationCode.GOODS_LOST_VERIFIED,
    OperationsRecoveryVerificationCode.GOODS_DAMAGED_VERIFIED,
  ];

export type TriggerEligibilityContext = {
  fulfillmentStatus: FulfillmentStatus;
  pendingCustodyIncomingRiderId: string | null;
  physicalCustodianRiderId: string | null;
  activeRiderId: string | null;
  failedAttemptCount: number;
  hasReturnReceived: boolean;
  notes?: string | null;
};

export type ClosureEvaluationInput = {
  disposition: OperationsRecoveryDisposition;
  pendingCustodyIncomingRiderId: string | null;
  hasPendingCustodyClearedEvent: boolean;
  hasContactEvidence: boolean;
  hasCustodyInvestigationVerification: boolean;
  hasReturnReceived: boolean;
  closeReason?: string | null;
  explicitConclusionAcknowledged?: boolean;
};

export type ClosureEvaluationResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

/** Server-derived opening eligibility for a claimed trigger. */
export function evaluateOpeningTriggerEligibility(
  trigger: OperationsRecoveryTrigger,
  ctx: TriggerEligibilityContext,
): ClosureEvaluationResult {
  if (trigger === OperationsRecoveryTrigger.OTHER) {
    if (!ctx.notes || ctx.notes.trim().length === 0) {
      return {
        ok: false,
        code: 'OPERATIONS_RECOVERY_NOTES_REQUIRED',
        message: 'OTHER trigger requires non-blank notes',
      };
    }
    return { ok: true };
  }

  if (trigger === OperationsRecoveryTrigger.DELIVERY_ATTEMPTS_EXHAUSTED) {
    if (ctx.failedAttemptCount < MAX_DELIVERY_ATTEMPTS) {
      return {
        ok: false,
        code: 'OPERATIONS_RECOVERY_TRIGGER_INCOMPATIBLE',
        message: `DELIVERY_ATTEMPTS_EXHAUSTED requires failed attempts >= ${MAX_DELIVERY_ATTEMPTS}`,
      };
    }
    if (
      ctx.fulfillmentStatus !== FulfillmentStatus.delivery_failed &&
      ctx.fulfillmentStatus !== FulfillmentStatus.returning
    ) {
      return {
        ok: false,
        code: 'OPERATIONS_RECOVERY_TRIGGER_INCOMPATIBLE',
        message:
          'DELIVERY_ATTEMPTS_EXHAUSTED requires delivery_failed or exhausted return-path context',
      };
    }
    return { ok: true };
  }

  if (trigger === OperationsRecoveryTrigger.CUSTODY_TRANSFER_ABANDONED) {
    if (!ctx.pendingCustodyIncomingRiderId) {
      return {
        ok: false,
        code: 'OPERATIONS_RECOVERY_TRIGGER_INCOMPATIBLE',
        message:
          'CUSTODY_TRANSFER_ABANDONED requires pendingCustodyIncomingRiderId',
      };
    }
    return { ok: true };
  }

  if (
    trigger === OperationsRecoveryTrigger.MERCHANT_RETURN_REFUSED ||
    trigger === OperationsRecoveryTrigger.RETURN_BLOCKED
  ) {
    if (
      ctx.fulfillmentStatus !== FulfillmentStatus.returning &&
      !(
        ctx.fulfillmentStatus === FulfillmentStatus.returned &&
        !ctx.hasReturnReceived
      )
    ) {
      return {
        ok: false,
        code: 'OPERATIONS_RECOVERY_TRIGGER_INCOMPATIBLE',
        message: `${trigger} requires returning (or hollow returned) path`,
      };
    }
    return { ok: true };
  }

  if (trigger === OperationsRecoveryTrigger.CUSTODY_UNCONFIRMED) {
    const hollow =
      ctx.fulfillmentStatus === FulfillmentStatus.returned &&
      !ctx.hasReturnReceived;
    const mismatch =
      ctx.physicalCustodianRiderId != null &&
      ctx.activeRiderId != null &&
      ctx.physicalCustodianRiderId !== ctx.activeRiderId;
    if (!hollow && !mismatch && !ctx.pendingCustodyIncomingRiderId) {
      return {
        ok: false,
        code: 'OPERATIONS_RECOVERY_TRIGGER_INCOMPATIBLE',
        message:
          'CUSTODY_UNCONFIRMED requires hollow return, assignment/custody mismatch, or pending transfer',
      };
    }
    return { ok: true };
  }

  if (
    trigger === OperationsRecoveryTrigger.GOODS_REPORTED_LOST ||
    trigger === OperationsRecoveryTrigger.GOODS_REPORTED_DAMAGED ||
    trigger === OperationsRecoveryTrigger.RIDER_UNAVAILABLE ||
    trigger === OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED
  ) {
    return { ok: true };
  }

  return {
    ok: false,
    code: 'OPERATIONS_RECOVERY_TRIGGER_INCOMPATIBLE',
    message: `Unknown or unsupported trigger ${trigger}`,
  };
}

/** Disposition-specific closure policy (centralized). */
export function evaluateClosurePolicy(
  input: ClosureEvaluationInput,
): ClosureEvaluationResult {
  const d = input.disposition;

  if (d === OperationsRecoveryDisposition.HOLD_FOR_REVIEW) {
    return {
      ok: false,
      code: 'OPERATIONS_RECOVERY_HOLD_CANNOT_CLOSE',
      message:
        'HOLD_FOR_REVIEW cannot close; change disposition to an actionable conclusion first',
    };
  }

  if (d === OperationsRecoveryDisposition.CLEAR_PENDING_CUSTODY_TRANSFER) {
    if (input.pendingCustodyIncomingRiderId != null) {
      return {
        ok: false,
        code: 'OPERATIONS_RECOVERY_PENDING_NOT_CLEARED',
        message:
          'CLEAR_PENDING_CUSTODY_TRANSFER requires pending transfer intent to be cleared first',
      };
    }
    if (!input.hasPendingCustodyClearedEvent) {
      return {
        ok: false,
        code: 'OPERATIONS_RECOVERY_PENDING_CLEAR_EVENT_REQUIRED',
        message:
          'CLEAR_PENDING_CUSTODY_TRANSFER requires audited PENDING_CUSTODY_CLEARED action',
      };
    }
    return { ok: true };
  }

  if (d === OperationsRecoveryDisposition.CUSTODY_INVESTIGATION) {
    if (
      !input.hasCustodyInvestigationVerification &&
      !input.explicitConclusionAcknowledged
    ) {
      return {
        ok: false,
        code: 'OPERATIONS_RECOVERY_VERIFICATION_REQUIRED',
        message:
          'CUSTODY_INVESTIGATION requires verification or explicit admin conclusion',
      };
    }
    return { ok: true };
  }

  if (CONTACT_DISPOSITIONS.includes(d)) {
    if (!input.hasContactEvidence) {
      return {
        ok: false,
        code: 'OPERATIONS_RECOVERY_CONTACT_EVIDENCE_REQUIRED',
        message: `${d} requires audited contact-attempt/result evidence`,
      };
    }
    return { ok: true };
  }

  if (d === OperationsRecoveryDisposition.RETURN_REQUIRED) {
    if (!input.hasReturnReceived) {
      return {
        ok: false,
        code: 'OPERATIONS_RECOVERY_RETURN_NOT_COMPLETED',
        message:
          'RETURN_REQUIRED cannot close without Stage 6 RETURN_RECEIVED; change disposition if no further fulfillment',
      };
    }
    return { ok: true };
  }

  if (
    d === OperationsRecoveryDisposition.NO_FURTHER_FULFILLMENT ||
    d === OperationsRecoveryDisposition.FINANCIAL_REVIEW_REQUIRED
  ) {
    if (!input.closeReason || input.closeReason.trim().length === 0) {
      return {
        ok: false,
        code: 'OPERATIONS_RECOVERY_CLOSE_REASON_REQUIRED',
        message: `${d} requires explicit SYSTEM_ADMIN reason acknowledgement`,
      };
    }
    if (!input.explicitConclusionAcknowledged) {
      return {
        ok: false,
        code: 'OPERATIONS_RECOVERY_ACKNOWLEDGEMENT_REQUIRED',
        message: `${d} requires explicitConclusionAcknowledged=true`,
      };
    }
    return { ok: true };
  }

  return {
    ok: false,
    code: 'OPERATIONS_RECOVERY_UNKNOWN_DISPOSITION',
    message: `No closure policy for disposition ${d}`,
  };
}
