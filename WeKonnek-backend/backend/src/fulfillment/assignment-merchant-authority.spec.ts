import { persistedAssignmentMerchantIds } from './assignment-merchant-authority';

describe('UCE-1B-A persisted assignment merchant membership', () => {
  const merchantId = 42;

  it('allows MERCHANT_OWNER only when persisted Merchant.userId matches actor', () => {
    expect(
      persistedAssignmentMerchantIds({
        actorType: 'MERCHANT_OWNER',
        actorId: 'owner-a',
        fulfillmentMerchantId: merchantId,
        persistedMerchantUserId: 'owner-a',
        hasActiveStaff: false,
      }),
    ).toEqual([merchantId]);
    expect(
      persistedAssignmentMerchantIds({
        actorType: 'MERCHANT_OWNER',
        actorId: 'owner-a',
        fulfillmentMerchantId: merchantId,
        persistedMerchantUserId: 'owner-b',
        hasActiveStaff: false,
      }),
    ).toEqual([]);
  });

  it('allows MERCHANT_ADMIN only with persisted active staff, not owner id', () => {
    expect(
      persistedAssignmentMerchantIds({
        actorType: 'MERCHANT_ADMIN',
        actorId: 'mgr',
        fulfillmentMerchantId: merchantId,
        persistedMerchantUserId: 'mgr',
        hasActiveStaff: true,
      }),
    ).toEqual([merchantId]);
    expect(
      persistedAssignmentMerchantIds({
        actorType: 'MERCHANT_ADMIN',
        actorId: 'mgr',
        fulfillmentMerchantId: merchantId,
        persistedMerchantUserId: 'owner',
        hasActiveStaff: false,
      }),
    ).toEqual([]);
  });

  it('records MERCHANT_STAFF membership without granting via this helper alone', () => {
    expect(
      persistedAssignmentMerchantIds({
        actorType: 'MERCHANT_STAFF',
        actorId: 'staff',
        fulfillmentMerchantId: merchantId,
        persistedMerchantUserId: 'owner',
        hasActiveStaff: true,
      }),
    ).toEqual([merchantId]);
  });

  it('fails closed for null merchant or missing actor id', () => {
    expect(
      persistedAssignmentMerchantIds({
        actorType: 'MERCHANT_OWNER',
        actorId: 'owner-a',
        fulfillmentMerchantId: null,
        persistedMerchantUserId: 'owner-a',
        hasActiveStaff: false,
      }),
    ).toEqual([]);
    expect(
      persistedAssignmentMerchantIds({
        actorType: 'MERCHANT_OWNER',
        actorId: null,
        fulfillmentMerchantId: merchantId,
        persistedMerchantUserId: 'owner-a',
        hasActiveStaff: false,
      }),
    ).toEqual([]);
  });
});
