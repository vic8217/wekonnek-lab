import {
  decideLocationRead,
  projectCanonicalLocation,
} from './tracking.canonical-read';

const fulfillment = {
  wkOrderId: 9,
  customerId: 'customer-a',
  activeRiderId: 'rider-a',
  physicalCustodianRiderId: 'rider-a',
};

describe('UCE-2 decideLocationRead', () => {
  it('allows the owning customer, assignee, custodian, and system admin', () => {
    expect(
      decideLocationRead({
        actor: { id: 'customer-a', type: 'CUSTOMER' },
        fulfillment,
      }).ok,
    ).toBe(true);
    expect(
      decideLocationRead({
        actor: { id: 'rider-a', type: 'RIDER' },
        fulfillment: { ...fulfillment, physicalCustodianRiderId: 'rider-b' },
      }).ok,
    ).toBe(true);
    expect(
      decideLocationRead({
        actor: { id: 'rider-b', type: 'RIDER' },
        fulfillment: {
          ...fulfillment,
          activeRiderId: 'rider-a',
          physicalCustodianRiderId: 'rider-b',
        },
      }).ok,
    ).toBe(true);
    expect(
      decideLocationRead({
        actor: { id: 'admin', type: 'SYSTEM_ADMIN' },
        fulfillment,
      }).ok,
    ).toBe(true);
  });

  it('denies other customers, merchants, other riders, and internal service', () => {
    for (const actor of [
      { id: 'customer-b', type: 'CUSTOMER' },
      { id: 'merchant-a', type: 'MERCHANT_OWNER' },
      { id: 'merchant-b', type: 'MERCHANT_ADMIN' },
      { id: 'rider-c', type: 'RIDER' },
      { id: 'svc', type: 'INTERNAL_SERVICE' },
    ]) {
      expect(decideLocationRead({ actor, fulfillment }).ok).toBe(false);
    }
  });

  it('denies a missing fulfillment the same way', () => {
    expect(
      decideLocationRead({
        actor: { id: 'customer-a', type: 'CUSTOMER' },
        fulfillment: {
          wkOrderId: null,
          customerId: null,
          activeRiderId: null,
          physicalCustodianRiderId: null,
        },
      }),
    ).toEqual({ ok: false, message: 'Tracking access denied' });
  });
});

describe('UCE-2 projectCanonicalLocation', () => {
  it('returns null when no canonical sample exists', () => {
    expect(
      projectCanonicalLocation({
        wkOrderId: 9,
        fulfillmentId: 'ful',
        sample: null,
      }),
    ).toEqual({ location: null });
  });
});
