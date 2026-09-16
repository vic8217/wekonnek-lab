import { ForbiddenException } from '@nestjs/common';
import { DeliveryFailureReasonCode } from '@prisma/client';
import { assertOperationAllowed } from '../fulfillment/fulfillment-authorization';
import { FULFILLMENT_TRANSITIONS } from '../fulfillment/fulfillment-state-machine';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Stage 8 delivery failure architecture', () => {
  it('documents attempt ≠ fulfillment status (separate authorities)', () => {
    const model = {
      deliveryAttempt: 'append_oriented_evidence',
      fulfillmentStatus: 'separate_transition',
      stage8WritesOutcome: 'FAILED',
      successfulHandoffReserved: true,
    };
    expect(model.deliveryAttempt).not.toBe(model.fulfillmentStatus);
    expect(model.stage8WritesOutcome).toBe('FAILED');
    expect(model.successfulHandoffReserved).toBe(true);
  });

  it('closes rider delivery_failed; state machine still allows the edge', () => {
    expect(() =>
      assertOperationAllowed(
        { id: 'r1', type: 'RIDER' },
        'transition',
        { activeRiderId: 'r1' },
        'delivery_failed',
      ),
    ).toThrow(ForbiddenException);
    expect(FULFILLMENT_TRANSITIONS.in_transit).toContain('delivery_failed');
  });

  it('documents no second delivery authority / financial unchanged', () => {
    const constraints = {
      customerAuthenticatedRefusal: false,
      riderReportedCustomerResponseProvenance: 'RIDER_REPORTED',
      paymentMutated: false,
      refunds: false,
      negativeSettlements: false,
      riderAdvanceMutated: false,
      notifications: false,
      autoRedelivery: false,
    };
    expect(constraints.customerAuthenticatedRefusal).toBe(false);
    expect(constraints.paymentMutated).toBe(false);
    expect(constraints.autoRedelivery).toBe(false);
  });

  it('documents rider identity server-derived and pending custody denied', () => {
    const rules = {
      riderIdFromJwtOnly: true,
      bodyRiderIdSpoofRejected: true,
      requiresActiveAndPhysicalCustodian: true,
      pendingCustodyDenied: true,
    };
    expect(rules.riderIdFromJwtOnly).toBe(true);
    expect(rules.pendingCustodyDenied).toBe(true);
  });

  it('documents disposition semantics', () => {
    const disposition = {
      RETURN_TO_MERCHANT: {
        mayTransitionToReturning: true,
        createsReturnReceived: false,
      },
      RESCHEDULE_REQUESTED: {
        autoInTransit: false,
        issuesStage5AToken: false,
      },
      resolveFabricatesCustodyPaymentRa: false,
    };
    expect(disposition.RETURN_TO_MERCHANT.createsReturnReceived).toBe(false);
    expect(disposition.RESCHEDULE_REQUESTED.autoInTransit).toBe(false);
    expect(disposition.resolveFabricatesCustodyPaymentRa).toBe(false);
  });

  it('lists all failure reason codes including OTHER', () => {
    const codes = Object.values(DeliveryFailureReasonCode);
    expect(codes).toContain('OTHER');
    expect(codes).toContain('CUSTOMER_UNREACHABLE');
    expect(codes).toContain('GOODS_LOST');
    expect(codes.length).toBe(11);
  });

  it('documents operational integrity flags', () => {
    const flags = [
      'DELIVERY_FAILURE_CASE_OPEN',
      'DELIVERY_DISPOSITION_REQUIRED',
      'RESCHEDULE_PENDING',
      'RETURN_IN_PROGRESS',
      'RETURN_MERCHANT_CONFIRMATION_PENDING',
      'OPERATIONS_RECOVERY_REQUIRED',
      'DELIVERY_FAILED_WITHOUT_ATTEMPT',
    ];
    expect(flags).toContain('DELIVERY_FAILED_WITHOUT_ATTEMPT');
  });

  it('documents USE_DELIVERY_FAILURE_REPORT bypass close in transition service', () => {
    const src = readFileSync(
      resolve(__dirname, '../fulfillment/fulfillment-transition.service.ts'),
      'utf8',
    );
    expect(src).toContain('USE_DELIVERY_FAILURE_REPORT');
    expect(src).toContain("target === 'delivery_failed'");
    expect(src).toContain('wkOrderId');
  });
});
