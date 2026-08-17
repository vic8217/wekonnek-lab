import { listingInquiryNotificationUrl, merchantOrderNotificationUrl, merchantReservationNotificationUrl } from './notification-routes';

describe('notification routes', () => {
  it('targets the exact shop, delivery tab, and order', () => {
    expect(merchantOrderNotificationUrl({ orderId: 41, shopId: 22, orderType: 'delivery' })).toBe('/merchant/orders?tab=delivery&shopId=22&orderId=41');
  });
  it('targets the merchant reservation context', () => {
    expect(merchantReservationNotificationUrl(9, 17)).toBe('/merchant/orders?tab=reservations&merchantId=9&reservationId=17');
  });
  it.each([['BAZAAR', 'bazaar'], ['PROPERTY', 'property']] as const)('targets the %s inquiry', (type, expected) => {
    expect(listingInquiryNotificationUrl(type, 'inq-7')).toBe(`/my/inquiries?type=${expected}&inquiryId=inq-7`);
  });
});
