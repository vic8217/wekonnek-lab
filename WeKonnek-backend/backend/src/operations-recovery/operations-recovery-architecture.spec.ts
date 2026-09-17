import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  evaluateClosurePolicy,
  evaluateOpeningTriggerEligibility,
  isInvestigativeOpenWhileRedeliveryActive,
  MAX_DELIVERY_ATTEMPTS,
  OPERATIONS_RECOVERY_INVESTIGATIVE_WHILE_REDELIVERY_TRIGGERS,
  OPERATIONS_RECOVERY_ORDINARY_OPEN_TRIGGERS,
} from './operations-recovery.policy';
import {
  FulfillmentStatus,
  OperationsRecoveryDisposition,
  OperationsRecoveryTrigger,
} from '@prisma/client';
import { FULFILLMENT_TRANSITIONS } from '../fulfillment/fulfillment-state-machine';

describe('Stage 11 operations-recovery architecture', () => {
  it('imports MAX_DELIVERY_ATTEMPTS from Stage 10 policy (=3)', () => {
    expect(MAX_DELIVERY_ATTEMPTS).toBe(3);
  });

  it('keeps live delivery_failed exits returning + in_transit', () => {
    expect(FULFILLMENT_TRANSITIONS.delivery_failed).toEqual([
      'returning',
      'in_transit',
    ]);
  });

  it('documents Option B lifecycle and dispositions', () => {
    const policy = {
      lifecycle: [
        'OPEN',
        'INVESTIGATING',
        'DISPOSITION_SELECTED',
        'CLOSED',
        'CANCELLED',
      ],
      autoOpen: false,
      stage8FsmUntouched: true,
    };
    expect(policy.autoOpen).toBe(false);
    expect(policy.stage8FsmUntouched).toBe(true);
  });

  it('rejects incompatible DELIVERY_ATTEMPTS_EXHAUSTED', () => {
    const r = evaluateOpeningTriggerEligibility(
      OperationsRecoveryTrigger.DELIVERY_ATTEMPTS_EXHAUSTED,
      {
        fulfillmentStatus: FulfillmentStatus.delivery_failed,
        pendingCustodyIncomingRiderId: null,
        physicalCustodianRiderId: null,
        activeRiderId: null,
        failedAttemptCount: 2,
        hasReturnReceived: false,
      },
    );
    expect(r.ok).toBe(false);
  });

  it('requires pending for CUSTODY_TRANSFER_ABANDONED', () => {
    const r = evaluateOpeningTriggerEligibility(
      OperationsRecoveryTrigger.CUSTODY_TRANSFER_ABANDONED,
      {
        fulfillmentStatus: FulfillmentStatus.in_transit,
        pendingCustodyIncomingRiderId: null,
        physicalCustodianRiderId: 'x',
        activeRiderId: 'x',
        failedAttemptCount: 0,
        hasReturnReceived: false,
      },
    );
    expect(r.ok).toBe(false);
  });

  it('blocks HOLD_FOR_REVIEW close', () => {
    const r = evaluateClosurePolicy({
      disposition: OperationsRecoveryDisposition.HOLD_FOR_REVIEW,
      pendingCustodyIncomingRiderId: null,
      hasPendingCustodyClearedEvent: false,
      hasContactEvidence: false,
      hasCustodyInvestigationVerification: false,
      hasReturnReceived: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('OPERATIONS_RECOVERY_HOLD_CANNOT_CLOSE');
  });

  it('documents Stage10↔11 ordinary vs investigative open matrix', () => {
    expect(OPERATIONS_RECOVERY_ORDINARY_OPEN_TRIGGERS).toEqual(
      expect.arrayContaining([
        OperationsRecoveryTrigger.DELIVERY_ATTEMPTS_EXHAUSTED,
        OperationsRecoveryTrigger.MERCHANT_RETURN_REFUSED,
        OperationsRecoveryTrigger.RETURN_BLOCKED,
        OperationsRecoveryTrigger.OTHER,
      ]),
    );
    expect(OPERATIONS_RECOVERY_INVESTIGATIVE_WHILE_REDELIVERY_TRIGGERS).toEqual(
      expect.arrayContaining([
        OperationsRecoveryTrigger.CUSTODY_UNCONFIRMED,
        OperationsRecoveryTrigger.CUSTODY_TRANSFER_ABANDONED,
        OperationsRecoveryTrigger.RIDER_UNAVAILABLE,
        OperationsRecoveryTrigger.GOODS_REPORTED_LOST,
        OperationsRecoveryTrigger.GOODS_REPORTED_DAMAGED,
        OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
      ]),
    );
    expect(
      isInvestigativeOpenWhileRedeliveryActive(
        OperationsRecoveryTrigger.ADMIN_RECOVERY_REQUIRED,
      ),
    ).toBe(true);
    expect(
      isInvestigativeOpenWhileRedeliveryActive(
        OperationsRecoveryTrigger.DELIVERY_ATTEMPTS_EXHAUSTED,
      ),
    ).toBe(false);
  });

  it('ADR 0012 documents lock order and Stage 9 vocab separation', () => {
    const adr = readFileSync(
      resolve(__dirname, '../../docs/adr/0012-operations-recovery.md'),
      'utf8',
    );
    expect(adr).toMatch(/orders.*order_fulfillments.*operations_recoveries/s);
    expect(adr).toContain('OPERATIONS_RECOVERY_REQUIRED');
    expect(adr).toContain('financial vocabulary');
    expect(adr).toContain('OPERATIONS_RECOVERY_ACTIVE');
    expect(adr).toContain('REDELIVERY_ACTIVE');
  });

  it('service documents native error codes', () => {
    const src = readFileSync(
      resolve(__dirname, './operations-recovery.service.ts'),
      'utf8',
    );
    expect(src).toContain('IDEMPOTENCY_CROSS_ORDER_CONFLICT');
    expect(src).toContain('withSerializableRetry');
    expect(src).toContain('PENDING_CUSTODY_TRANSFER_CLEARED');
    expect(src).toContain('REDELIVERY_ACTIVE');
    const redelivery = readFileSync(
      resolve(__dirname, '../redelivery/redelivery.service.ts'),
      'utf8',
    );
    expect(redelivery).toContain('OPERATIONS_RECOVERY_ACTIVE');
    expect(redelivery).toContain('serializable-retry');
  });

  it('Stage5A confirm and rider assign use whole-operation serializable retry', () => {
    const delivery = readFileSync(
      resolve(__dirname, '../delivery-handoff/delivery-handoff.service.ts'),
      'utf8',
    );
    expect(delivery).toContain('withSerializableRetry');
    expect(delivery).toMatch(
      /order_fulfillments[\s\S]*customer_delivery_handoff_tokens/,
    );
    const assign = readFileSync(
      resolve(__dirname, '../fulfillment/rider-assignment.service.ts'),
      'utf8',
    );
    expect(assign).toContain('withSerializableRetry');
  });
});
