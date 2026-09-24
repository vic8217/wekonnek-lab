/**
 * UCE-2: who may read the latest canonical rider location for a WkOrder.
 * Observational telemetry only. Merchants are denied, including the owner.
 * Legacy order_id samples are not part of this contract.
 */

export type LocationReadFulfillment = {
  wkOrderId: number | null;
  customerId: string | null;
  activeRiderId: string | null;
  physicalCustodianRiderId: string | null;
};

export type LocationReadDecision = { ok: true } | { ok: false; message: string };

export function decideLocationRead(input: {
  actor: { id?: string | null; type: string };
  fulfillment: LocationReadFulfillment;
}): LocationReadDecision {
  const denied: LocationReadDecision = {
    ok: false,
    message: 'Tracking access denied',
  };
  const { actor, fulfillment } = input;
  if (fulfillment.wkOrderId == null) return denied;

  if (actor.type === 'SYSTEM_ADMIN') return { ok: true };

  if (actor.type === 'CUSTOMER') {
    return actor.id && actor.id === fulfillment.customerId
      ? { ok: true }
      : denied;
  }

  if (actor.type === 'RIDER') {
    const entitled =
      actor.id != null &&
      (actor.id === fulfillment.physicalCustodianRiderId ||
        actor.id === fulfillment.activeRiderId);
    return entitled ? { ok: true } : denied;
  }

  return denied;
}

export type CanonicalLocationSample = {
  riderId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  recordedAt: Date;
};

export type CanonicalLocationView = {
  wkOrderId: number;
  fulfillmentId: string;
  riderId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  recordedAt: string;
};

export function projectCanonicalLocation(input: {
  wkOrderId: number;
  fulfillmentId: string;
  sample: CanonicalLocationSample | null;
}): { location: CanonicalLocationView | null } {
  if (!input.sample) return { location: null };
  return {
    location: {
      wkOrderId: input.wkOrderId,
      fulfillmentId: input.fulfillmentId,
      riderId: input.sample.riderId,
      lat: input.sample.lat,
      lng: input.sample.lng,
      accuracy: input.sample.accuracy,
      heading: input.sample.heading,
      speed: input.sample.speed,
      recordedAt: input.sample.recordedAt.toISOString(),
    },
  };
}
