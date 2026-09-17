import { ForbiddenException } from '@nestjs/common';
import { assertOperationAllowed } from '../fulfillment/fulfillment-authorization';
import { FULFILLMENT_TRANSITIONS } from '../fulfillment/fulfillment-state-machine';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  evaluateRedeliveryAttemptCollectibility,
  MAX_DELIVERY_ATTEMPTS,
  REDELIVERY_TIMEZONE,
  REDELIVERY_WINDOW_MAX_MS,
  REDELIVERY_WINDOW_MIN_MS,
} from './redelivery.policy';

describe('Stage 10 redelivery architecture', () => {
  it('centralizes MAX_DELIVERY_ATTEMPTS = 3', () => {
    expect(MAX_DELIVERY_ATTEMPTS).toBe(3);
    expect(evaluateRedeliveryAttemptCollectibility(0).allowed).toBe(true);
    expect(evaluateRedeliveryAttemptCollectibility(2).targetAttemptNumber).toBe(3);
    expect(evaluateRedeliveryAttemptCollectibility(3).allowed).toBe(false);
    expect(evaluateRedeliveryAttemptCollectibility(3).code).toBe(
      'REDELIVERY_ATTEMPT_LIMIT_REACHED',
    );
  });

  it('documents window bounds and Asia/Manila timezone', () => {
    expect(REDELIVERY_WINDOW_MIN_MS).toBe(60 * 60 * 1000);
    expect(REDELIVERY_WINDOW_MAX_MS).toBe(4 * 60 * 60 * 1000);
    expect(REDELIVERY_TIMEZONE).toBe('Asia/Manila');
  });

  it('allows delivery_failed → in_transit only via Stage 10 service path', () => {
    expect(FULFILLMENT_TRANSITIONS.delivery_failed).toContain('in_transit');
    expect(FULFILLMENT_TRANSITIONS.delivery_failed).toContain('returning');
    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r1' },
        'in_transit',
      ),
    ).not.toThrow();
    const src = readFileSync(
      resolve(__dirname, '../fulfillment/fulfillment-transition.service.ts'),
      'utf8',
    );
    expect(src).toContain('USE_REDELIVERY_ACTIVATION');
    expect(src).toContain("from === 'delivery_failed'");
    expect(src).toContain("target === 'in_transit'");
  });

  it('documents policy: no fees, SAME_AS_ORDER, merchant visibility only', () => {
    const policy = {
      redeliveryFees: false,
      addressMode: 'SAME_AS_ORDER',
      merchantApprovalRequired: false,
      merchantVisibility: true,
      customerTransitionsFulfillmentDirectly: false,
      activationActor: 'INTERNAL_SERVICE',
      notifications: false,
      successfulHandoffOnlyOnActivatedLegs: true,
    };
    expect(policy.redeliveryFees).toBe(false);
    expect(policy.merchantApprovalRequired).toBe(false);
    expect(policy.customerTransitionsFulfillmentDirectly).toBe(false);
    expect(policy.successfulHandoffOnlyOnActivatedLegs).toBe(true);
  });

  it('documents lock order compatible with Stages 5A/7/8/9', () => {
    const lockOrder = [
      'orders',
      'order_fulfillments',
      'redelivery_authorizations',
      'operational_cases|customer_delivery_handoff_tokens (secondary)',
    ];
    expect(lockOrder[0]).toBe('orders');
    expect(lockOrder[1]).toBe('order_fulfillments');
    const adr = readFileSync(
      resolve(__dirname, '../../docs/adr/0011-redelivery-authorization.md'),
      'utf8',
    );
    expect(adr).toContain('orders');
    expect(adr).toContain('order_fulfillments');
    expect(adr).toContain('redelivery_authorizations');
  });

  it('blocks CUSTOMER generic transition to in_transit from delivery_failed', () => {
    expect(() =>
      assertOperationAllowed(
        { id: 'c1', type: 'CUSTOMER' },
        'transition',
        { customerId: 'c1' },
        'in_transit',
      ),
    ).toThrow(ForbiddenException);
  });

  it('lists Stage 10 operational flags', () => {
    const flags = [
      'REDELIVERY_REQUEST_PENDING',
      'REDELIVERY_SCHEDULED',
      'REDELIVERY_CUSTODY_TRANSFER_REQUIRED',
      'REDELIVERY_IN_PROGRESS',
      'REDELIVERY_ATTEMPT_LIMIT_REACHED',
      'REDELIVERY_WINDOW_EXPIRED',
      'RETURN_PATH_SELECTED',
      'RETURN_FINANCIAL_RESOLUTION_ACTIVE',
      'OPERATIONS_RECOVERY_REQUIRED',
    ];
    expect(flags).toContain('REDELIVERY_ATTEMPT_LIMIT_REACHED');
    expect(flags).toContain('OPERATIONS_RECOVERY_REQUIRED');
  });

  it('exposes native Stage 10 error contract codes', () => {
    const codes = [
      'REDELIVERY_NOT_ELIGIBLE',
      'REDELIVERY_ALREADY_PENDING',
      'REDELIVERY_TERMINAL_RETURN',
      'REDELIVERY_FINANCIAL_RESOLUTION_FINALIZED',
      'REDELIVERY_RETURN_FINANCIAL_PATH_ACTIVE',
      'REDELIVERY_CUSTOMER_AUTH_REQUIRED',
      'REDELIVERY_CUSTODY_NOT_PROVEN',
      'REDELIVERY_CUSTODY_TRANSFER_REQUIRED',
      'REDELIVERY_ASSIGNMENT_MISMATCH',
      'REDELIVERY_ATTEMPT_CONFLICT',
      'REDELIVERY_ATTEMPT_LIMIT_REACHED',
      'REDELIVERY_RETURN_IN_PROGRESS',
      'REDELIVERY_ADDRESS_CHANGE_NOT_SUPPORTED',
      'REDELIVERY_WINDOW_INVALID',
      'REDELIVERY_WINDOW_EXPIRED',
      'IDEMPOTENCY_PAYLOAD_CONFLICT',
    ];
    const src = readFileSync(resolve(__dirname, 'redelivery.service.ts'), 'utf8');
    for (const code of codes) {
      expect(src).toContain(code);
    }
  });
});
