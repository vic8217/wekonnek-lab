/**
 * UCE-2 start delivery. Narrow capability: picked_up → in_transit only.
 * Physical custody is required. Assignment is not custody.
 */

export type StartDeliveryDenyCode =
  | 'RIDER_ASSIGNMENT_FORBIDDEN'
  | 'RIDER_NOT_ACTIVE_ASSIGNEE'
  | 'RIDER_NOT_PHYSICAL_CUSTODIAN'
  | 'FULFILLMENT_NOT_START_ELIGIBLE';

export type StartDeliveryDecision =
  | { ok: true; alreadyInTransit: boolean }
  | { ok: false; code: StartDeliveryDenyCode; message: string };

export type StartDeliveryFulfillment = {
  wkOrderId: number | null;
  status: string;
  activeRiderId: string | null;
  physicalCustodianRiderId: string | null;
};

export function decideStartDelivery(input: {
  riderId: string;
  fulfillment: StartDeliveryFulfillment;
}): StartDeliveryDecision {
  const { riderId, fulfillment } = input;
  const isActiveRider = fulfillment.activeRiderId === riderId;
  const isCustodian = fulfillment.physicalCustodianRiderId === riderId;

  if (fulfillment.wkOrderId == null || (!isActiveRider && !isCustodian)) {
    return {
      ok: false,
      code: 'RIDER_ASSIGNMENT_FORBIDDEN',
      message: 'Assignment access denied',
    };
  }

  if (!isActiveRider) {
    return {
      ok: false,
      code: 'RIDER_NOT_ACTIVE_ASSIGNEE',
      message: 'Only the active assigned rider may start this delivery',
    };
  }

  if (!isCustodian) {
    return {
      ok: false,
      code: 'RIDER_NOT_PHYSICAL_CUSTODIAN',
      message:
        'Physical custody is not established for this rider; merchant pickup handoff is required first',
    };
  }

  if (fulfillment.status === 'in_transit') {
    return { ok: true, alreadyInTransit: true };
  }

  if (fulfillment.status !== 'picked_up') {
    return {
      ok: false,
      code: 'FULFILLMENT_NOT_START_ELIGIBLE',
      message: 'Delivery can only be started from picked_up',
    };
  }

  return { ok: true, alreadyInTransit: false };
}
