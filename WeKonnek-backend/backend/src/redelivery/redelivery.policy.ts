/**
 * Stage 10 redelivery / delivery-rescheduling policy (centralized).
 * Do not scatter MAX_DELIVERY_ATTEMPTS or window bounds as literals elsewhere.
 */

export const MAX_DELIVERY_ATTEMPTS = 3;

export const REDELIVERY_TIMEZONE = 'Asia/Manila';

/** Inclusive minimum window duration in milliseconds (1 hour). */
export const REDELIVERY_WINDOW_MIN_MS = 60 * 60 * 1000;

/** Inclusive maximum window duration in milliseconds (4 hours). */
export const REDELIVERY_WINDOW_MAX_MS = 4 * 60 * 60 * 1000;

/** Maximum how far ahead windowStart may be scheduled. */
export const REDELIVERY_WINDOW_MAX_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;

export const REDELIVERY_ADDRESS_MODE_SAME_AS_ORDER = 'SAME_AS_ORDER' as const;

/** Open / blocking Stage 9 determination statuses for redelivery. */
export const REDELIVERY_BLOCKING_DETERMINATION_STATUSES = [
  'PENDING',
  'PROPOSED',
  'ACKNOWLEDGED',
  'DISPUTED',
  'FINALIZED',
] as const;

export type RedeliveryCollectibility = {
  failedAttemptCount: number;
  maxAttempts: number;
  targetAttemptNumber: number;
  remainingAttempts: number;
  allowed: boolean;
  code?: 'REDELIVERY_ATTEMPT_LIMIT_REACHED';
};

/**
 * Collectibility choke-point for attempt budget.
 * targetAttemptNumber = failedAttemptCount + 1; blocked when that exceeds MAX.
 */
export function evaluateRedeliveryAttemptCollectibility(
  failedAttemptCount: number,
  maxAttempts: number = MAX_DELIVERY_ATTEMPTS,
): RedeliveryCollectibility {
  const failed = Math.max(0, Math.floor(failedAttemptCount));
  const targetAttemptNumber = failed + 1;
  const remainingAttempts = Math.max(0, maxAttempts - failed);
  if (targetAttemptNumber > maxAttempts) {
    return {
      failedAttemptCount: failed,
      maxAttempts,
      targetAttemptNumber,
      remainingAttempts: 0,
      allowed: false,
      code: 'REDELIVERY_ATTEMPT_LIMIT_REACHED',
    };
  }
  return {
    failedAttemptCount: failed,
    maxAttempts,
    targetAttemptNumber,
    remainingAttempts,
    allowed: true,
  };
}
