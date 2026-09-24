import {
  decideReportLocation,
  parseLocationSample,
} from './rider-assignments.report-location';

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
    status: 'in_transit',
    activeRiderId: RIDER,
    physicalCustodianRiderId: RIDER,
    ...partial,
  };
}

describe('UCE-2 decideReportLocation', () => {
  it('allows the custodian while in_transit', () => {
    expect(
      decideReportLocation({ riderId: RIDER, fulfillment: fulfillment() }),
    ).toEqual({ ok: true });
  });

  it('allows a custodian who is no longer the active assignee', () => {
    expect(
      decideReportLocation({
        riderId: RIDER,
        fulfillment: fulfillment({ activeRiderId: OTHER }),
      }),
    ).toEqual({ ok: true });
  });

  it('denies an assignee without custody', () => {
    const decision = decideReportLocation({
      riderId: RIDER,
      fulfillment: fulfillment({ physicalCustodianRiderId: null }),
    });
    expect(decision).toMatchObject({
      ok: false,
      code: 'RIDER_NOT_PHYSICAL_CUSTODIAN',
    });
  });

  it('denies an unrelated rider', () => {
    const decision = decideReportLocation({
      riderId: RIDER,
      fulfillment: fulfillment({
        activeRiderId: OTHER,
        physicalCustodianRiderId: OTHER,
      }),
    });
    expect(decision).toMatchObject({
      ok: false,
      code: 'RIDER_ASSIGNMENT_FORBIDDEN',
    });
  });

  it.each([
    'picked_up',
    'rider_assigned',
    'delivered',
    'returned',
    'cancelled',
    'delivery_failed',
    'returning',
  ])('denies location write from %s', (status) => {
    const decision = decideReportLocation({
      riderId: RIDER,
      fulfillment: fulfillment({ status }),
    });
    expect(decision).toMatchObject({
      ok: false,
      code: 'FULFILLMENT_NOT_TRACKABLE',
    });
  });
});

describe('UCE-2 parseLocationSample', () => {
  it('accepts aliases and optional fields and ignores recordedAt', () => {
    const parsed = parseLocationSample({
      latitude: 14.5,
      lng: 121.0,
      accuracy: 12,
      heading: 90,
      speed: 4,
      recordedAt: '2000-01-01T00:00:00.000Z',
    });
    expect(parsed).toEqual({
      ok: true,
      sample: { lat: 14.5, lng: 121, accuracy: 12, heading: 90, speed: 4 },
    });
  });

  it('rejects disagreeing aliases and out-of-range values', () => {
    expect(parseLocationSample({ lat: 1, latitude: 2, lng: 3 }).ok).toBe(false);
    expect(parseLocationSample({ lat: 91, lng: 0 }).ok).toBe(false);
    expect(parseLocationSample({ lat: 0, lng: 181 }).ok).toBe(false);
    expect(parseLocationSample({ lat: 0, lng: 0, accuracy: -1 }).ok).toBe(false);
    expect(parseLocationSample({ lat: 0, lng: 0, heading: 361 }).ok).toBe(false);
    expect(parseLocationSample({ lat: 0, lng: 0, speed: 1001 }).ok).toBe(false);
  });
});
