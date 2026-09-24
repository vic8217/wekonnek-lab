import {
  decideStartDelivery,
  StartDeliveryDecision,
} from './rider-assignments.start-delivery';

const RIDER = 'rider-a';
const OTHER = 'rider-b';

function fulfillment(
  partial: Partial<{
    wkOrderId: number | null;
    status: string;
    activeRiderId: string | null;
    physicalCustodianRiderId: string | null;
  }> = {},
) {
  return {
    wkOrderId: 861,
    status: 'picked_up',
    activeRiderId: RIDER,
    physicalCustodianRiderId: RIDER,
    ...partial,
  };
}

function deny(
  decision: StartDeliveryDecision,
): Extract<StartDeliveryDecision, { ok: false }> {
  if (decision.ok) throw new Error('expected a denial');
  return decision;
}

describe('UCE-2 decideStartDelivery', () => {
  it('allows picked_up when the rider is assignee and custodian', () => {
    expect(
      decideStartDelivery({ riderId: RIDER, fulfillment: fulfillment() }),
    ).toEqual({ ok: true, alreadyInTransit: false });
  });

  it('treats already in_transit as an idempotent success', () => {
    expect(
      decideStartDelivery({
        riderId: RIDER,
        fulfillment: fulfillment({ status: 'in_transit' }),
      }),
    ).toEqual({ ok: true, alreadyInTransit: true });
  });

  it('rejects an assignee without custody', () => {
    expect(
      deny(
        decideStartDelivery({
          riderId: RIDER,
          fulfillment: fulfillment({ physicalCustodianRiderId: null }),
        }),
      ).code,
    ).toBe('RIDER_NOT_PHYSICAL_CUSTODIAN');
  });

  it('rejects a custodian who is not the active assignee', () => {
    expect(
      deny(
        decideStartDelivery({
          riderId: RIDER,
          fulfillment: fulfillment({ activeRiderId: OTHER }),
        }),
      ).code,
    ).toBe('RIDER_NOT_ACTIVE_ASSIGNEE');
  });

  it('denies a rider with neither pointer', () => {
    expect(
      deny(
        decideStartDelivery({
          riderId: RIDER,
          fulfillment: fulfillment({
            activeRiderId: OTHER,
            physicalCustodianRiderId: OTHER,
          }),
        }),
      ).code,
    ).toBe('RIDER_ASSIGNMENT_FORBIDDEN');
  });

  it.each([
    'rider_assigned',
    'delivered',
    'returned',
    'cancelled',
    'delivery_failed',
    'returning',
  ])('rejects start from %s', (status) => {
    expect(
      deny(
        decideStartDelivery({
          riderId: RIDER,
          fulfillment: fulfillment({ status }),
        }),
      ).code,
    ).toBe('FULFILLMENT_NOT_START_ELIGIBLE');
  });
});
