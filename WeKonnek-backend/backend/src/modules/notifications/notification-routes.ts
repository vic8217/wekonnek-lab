const query = (values: Record<string, string | number>) => new URLSearchParams(
  Object.entries(values).map(([key, value]) => [key, String(value)]),
).toString();

export function merchantOrderNotificationUrl(input: { orderId: number; shopId: number; orderType: string }) {
  const tab = input.orderType === 'delivery' ? 'delivery' : input.orderType === 'pickup' ? 'pickup' : 'in_store';
  return `/merchant/orders?${query({ tab, shopId: input.shopId, orderId: input.orderId })}`;
}

export function merchantReservationNotificationUrl(merchantId: number, reservationId: number) {
  return `/merchant/orders?${query({ tab: 'reservations', merchantId, reservationId })}`;
}

export function listingInquiryNotificationUrl(type: 'BAZAAR' | 'PROPERTY', inquiryId: string) {
  return `/my/inquiries?${query({ type: type.toLowerCase(), inquiryId })}`;
}
