/**
 * UCE-2 canonical location write policy.
 * Write authority is physical custody while in_transit, not active assignment.
 * A client timestamp is ignored by parseLocationSample.
 */

export type ReportLocationDenyCode =
  | 'RIDER_ASSIGNMENT_FORBIDDEN'
  | 'RIDER_NOT_PHYSICAL_CUSTODIAN'
  | 'FULFILLMENT_NOT_TRACKABLE';

export type ReportLocationDecision =
  | { ok: true }
  | { ok: false; code: ReportLocationDenyCode; message: string };

export type ReportLocationFulfillment = {
  wkOrderId: number | null;
  status: string;
  activeRiderId: string | null;
  physicalCustodianRiderId: string | null;
};

export function decideReportLocation(input: {
  riderId: string;
  fulfillment: ReportLocationFulfillment;
}): ReportLocationDecision {
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

  if (!isCustodian) {
    return {
      ok: false,
      code: 'RIDER_NOT_PHYSICAL_CUSTODIAN',
      message: 'Physical custody is not established for this rider',
    };
  }

  if (fulfillment.status !== 'in_transit') {
    return {
      ok: false,
      code: 'FULFILLMENT_NOT_TRACKABLE',
      message: 'Location can only be reported while the delivery is in transit',
    };
  }

  return { ok: true };
}

export const MAX_ACCURACY_METRES = 10_000;

export type LocationSampleBody = {
  lat?: unknown;
  lng?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  accuracy?: unknown;
  heading?: unknown;
  speed?: unknown;
  recordedAt?: unknown;
};

export type LocationSample = {
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
};

export type LocationSampleResult =
  | { ok: true; sample: LocationSample }
  | { ok: false; message: string };

function optional(
  value: unknown,
  label: string,
  range: { min: number; max: number },
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, message: `${label} must be a finite number` };
  }
  if (value < range.min || value > range.max) {
    return { ok: false, message: `${label} is out of range` };
  }
  return { ok: true, value };
}

function coordinate(
  primary: unknown,
  alias: unknown,
  label: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (primary != null && alias != null && primary !== alias) {
    return { ok: false, message: `${label} and its alias disagree` };
  }
  return { ok: true, value: primary ?? alias };
}

export function parseLocationSample(
  body: LocationSampleBody | undefined,
): LocationSampleResult {
  const latField = coordinate(body?.latitude, body?.lat, 'latitude');
  if (!latField.ok) return latField;
  const lngField = coordinate(body?.longitude, body?.lng, 'longitude');
  if (!lngField.ok) return lngField;
  const lat = latField.value;
  const lng = lngField.value;
  if (
    typeof lat !== 'number' ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90
  ) {
    return {
      ok: false,
      message: 'lat must be a finite number between -90 and 90',
    };
  }
  if (
    typeof lng !== 'number' ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return {
      ok: false,
      message: 'lng must be a finite number between -180 and 180',
    };
  }

  const accuracy = optional(body?.accuracy, 'accuracy', {
    min: 0,
    max: MAX_ACCURACY_METRES,
  });
  if (!accuracy.ok) return accuracy;
  const heading = optional(body?.heading, 'heading', { min: 0, max: 360 });
  if (!heading.ok) return heading;
  const speed = optional(body?.speed, 'speed', { min: 0, max: 1000 });
  if (!speed.ok) return speed;

  return {
    ok: true,
    sample: {
      lat,
      lng,
      accuracy: accuracy.value,
      heading: heading.value,
      speed: speed.value,
    },
  };
}
