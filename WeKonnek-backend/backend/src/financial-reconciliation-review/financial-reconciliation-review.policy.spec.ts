import {
  RECONCILIATION_FINDING_CODES,
} from '../financial-reconciliation/financial-reconciliation.types';
import { relatedItemKey } from '../financial-reconciliation/financial-reconciliation.policy';
import {
  REVIEW_ONLY_CLOSE_CODES,
  allowedRouteClassifications,
  assertRouteAllowed,
  buildDetectorFingerprint,
  isReviewOnlyCloseCode,
  locateLiveFinding,
  parseReviewListQuery,
  validateNoteBody,
} from './financial-reconciliation-review.policy';

describe('Stage14A review policy', () => {
  it('uses a conservative review-only allowlist', () => {
    expect(REVIEW_ONLY_CLOSE_CODES).toEqual([
      RECONCILIATION_FINDING_CODES.SUCCESSOR_REVIEW_REQUIRED,
      RECONCILIATION_FINDING_CODES.SUBJECT_MATCH_UNKNOWN,
    ]);
    expect(isReviewOnlyCloseCode('RA_RETURN_RESTRICTION_MISSING')).toBe(false);
    expect(isReviewOnlyCloseCode('SUCCESSOR_REVIEW_REQUIRED')).toBe(true);
  });

  it('allows engineering routing for cycle findings and rejects operations recovery', () => {
    expect(
      allowedRouteClassifications('SUCCESSOR_CYCLE_DETECTED'),
    ).toEqual(['ENGINEERING']);
    expect(
      assertRouteAllowed('SUCCESSOR_CYCLE_DETECTED', 'ENGINEERING').ok,
    ).toBe(true);
    expect(
      assertRouteAllowed('SUCCESSOR_CYCLE_DETECTED', 'REVIEW_ONLY').ok,
    ).toBe(false);
    expect(assertRouteAllowed('SUCCESSOR_CYCLE_DETECTED', 'OPERATIONS_RECOVERY').ok).toBe(
      false,
    );
  });

  it('fingerprints sorted finding keys deterministically without amounts', () => {
    const a = buildDetectorFingerprint({
      findings: [{ findingKey: 'B:x:' }, { findingKey: 'A:x:' }],
      relatedItems: [
        {
          rail: 'EXCEPTION_FINANCIAL',
          obligationId: '2',
          relation: 'SUCCESSOR',
          fromRail: 'EXCEPTION_FINANCIAL',
          fromObligationId: '1',
        },
      ],
    });
    const b = buildDetectorFingerprint({
      findings: [{ findingKey: 'A:x:' }, { findingKey: 'B:x:' }],
      relatedItems: [
        {
          rail: 'EXCEPTION_FINANCIAL',
          obligationId: '2',
          relation: 'SUCCESSOR',
          fromRail: 'EXCEPTION_FINANCIAL',
          fromObligationId: '1',
        },
      ],
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(relatedItemKey).toBeDefined();
  });

  it('locates live findings by canonical findingKey only', () => {
    const found = locateLiveFinding(
      [
        {
          findingKey: 'CURRENCY_MISMATCH:RIDER_ADVANCE_REIMBURSEMENT:ra-1:',
          code: 'CURRENCY_MISMATCH',
          reconciliationState: 'SOURCE_INCONSISTENCY',
          wkOrderId: 1,
          checkOutcome: 'FAILED',
          involvedItems: [],
          explanationCode: 'CURRENCY_MISMATCH',
          evidenceRefs: [],
        },
      ],
      'CURRENCY_MISMATCH:RIDER_ADVANCE_REIMBURSEMENT:ra-1:',
    );
    expect(found?.code).toBe('CURRENCY_MISMATCH');
    expect(
      locateLiveFinding(
        [
          {
            findingKey: 'CURRENCY_MISMATCH:RIDER_ADVANCE_REIMBURSEMENT:ra-1:',
            code: 'CURRENCY_MISMATCH',
            reconciliationState: 'SOURCE_INCONSISTENCY',
            wkOrderId: 1,
            checkOutcome: 'FAILED',
            involvedItems: [],
            explanationCode: 'CURRENCY_MISMATCH',
            evidenceRefs: [],
          },
        ],
        'tampered-key',
      ),
    ).toBeNull();
  });

  it('rejects empty and oversized notes', () => {
    expect(validateNoteBody('').ok).toBe(false);
    expect(validateNoteBody('   ').ok).toBe(false);
    expect(validateNoteBody('ok').ok).toBe(true);
    expect(validateNoteBody('x'.repeat(2001)).ok).toBe(false);
  });

  it('bounds review list created windows to 30 days', () => {
    const now = new Date('2026-09-19T12:00:00.000Z');
    const over = parseReviewListQuery({
      since: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      until: now.toISOString(),
    });
    expect(over.ok).toBe(false);
  });
});
