import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  assertFulfillmentTransition,
  FULFILLMENT_TRANSITIONS,
  isFulfillmentLifecycleStatus,
  TRANSITION_CATALOG,
} from './fulfillment-state-machine';
import {
  assertOperationAllowed,
  FULFILLMENT_AUTH_MATRIX,
  matrixAllows,
  resolveActorTypeFromRoles,
} from './fulfillment-authorization';
import { evaluateLegacyCodPaidOnCommerceComplete } from './payment-fulfillment-separation';

describe('Stage 0A fulfillment state machine', () => {
  it('encodes the required lifecycle including ready_for_pickup → rider_assigned', () => {
    expect(FULFILLMENT_TRANSITIONS.ready_for_pickup).toEqual([
      'rider_assigned',
      'cancelled',
    ]);
    expect(FULFILLMENT_TRANSITIONS.rider_assigned).toContain('picked_up');
    expect(FULFILLMENT_TRANSITIONS.picked_up).toEqual(['in_transit']);
    expect(FULFILLMENT_TRANSITIONS.in_transit).toEqual([
      'delivered',
      'delivery_failed',
    ]);
    expect(FULFILLMENT_TRANSITIONS.delivery_failed).toEqual([
      'returning',
      'in_transit',
    ]);
    expect(FULFILLMENT_TRANSITIONS.returning).toEqual(['returned']);
  });

  it('rejects incompatible transitions', () => {
    expect(() =>
      assertFulfillmentTransition('pending', 'delivered'),
    ).toThrow(BadRequestException);
    expect(() =>
      assertFulfillmentTransition('in_transit', 'cancelled'),
    ).toThrow(BadRequestException);
  });

  it('accepts valid transitions', () => {
    expect(() =>
      assertFulfillmentTransition('ready_for_pickup', 'rider_assigned'),
    ).not.toThrow();
    expect(isFulfillmentLifecycleStatus('picked_up')).toBe(true);
  });

  it('documents critical transition contracts', () => {
    expect(TRANSITION_CATALOG.some((t) => t.to === 'rider_assigned')).toBe(
      true,
    );
    expect(TRANSITION_CATALOG.some((t) => t.to === 'delivered')).toBe(true);
  });
});

describe('Stage 0A authorization matrix', () => {
  it('keeps customer read scoped and blocks rider assign', () => {
    expect(matrixAllows('CUSTOMER', 'read')).toBe(true);
    expect(matrixAllows('CUSTOMER', 'assign_rider')).toBe(false);
    expect(FULFILLMENT_AUTH_MATRIX.RIDER.transition).toBe(true);
    expect(FULFILLMENT_AUTH_MATRIX.PAYMENT_PROVIDER.transition).toBe(false);
  });

  it('enforces ownership for customers and assignment for riders', () => {
    expect(() =>
      assertOperationAllowed(
        { id: 'c1', type: 'CUSTOMER' },
        'read',
        { customerId: 'c2' },
      ),
    ).toThrow(ForbiddenException);

    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r1', customerId: 'c1' },
        'picked_up',
      ),
    ).not.toThrow();

    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r1' },
        'delivered',
      ),
    ).toThrow(ForbiddenException);

    // Stage 6: rider cannot self-confirm merchant return receipt
    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r1' },
        'returned',
      ),
    ).toThrow(ForbiddenException);

    // Stage 8: rider cannot self-transition to delivery_failed
    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r1' },
        'delivery_failed',
      ),
    ).toThrow(ForbiddenException);

    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r2' },
        'picked_up',
      ),
    ).toThrow(ForbiddenException);
  });

  it('resolves actor types from roles', () => {
    expect(resolveActorTypeFromRoles({ userRole: 'rider' })).toBe('RIDER');
    expect(
      resolveActorTypeFromRoles({
        userRole: 'merchant',
        merchantStaffRole: 'manager',
      }),
    ).toBe('MERCHANT_ADMIN');
    expect(resolveActorTypeFromRoles({ isPaymentProvider: true })).toBe(
      'PAYMENT_PROVIDER',
    );
  });
});

describe('Stage 0A payment/fulfillment separation', () => {
  it('isolates legacy COD mark-paid on commerce complete', () => {
    expect(
      evaluateLegacyCodPaidOnCommerceComplete({
        nextCommerceStatus: 'completed',
        paymentMethod: 'cod',
        currentPaymentStatus: 'pending',
      }),
    ).toEqual({
      shouldMarkPaid: true,
      reason: 'LEGACY_COD_MARK_PAID_ON_COMPLETE',
    });

    expect(
      evaluateLegacyCodPaidOnCommerceComplete({
        nextCommerceStatus: 'delivered',
        paymentMethod: 'gcash',
        currentPaymentStatus: 'pending',
      }).shouldMarkPaid,
    ).toBe(false);

    expect(
      evaluateLegacyCodPaidOnCommerceComplete({
        nextCommerceStatus: 'processing',
        paymentMethod: 'cod',
        currentPaymentStatus: 'pending',
      }).shouldMarkPaid,
    ).toBe(false);
  });
});
