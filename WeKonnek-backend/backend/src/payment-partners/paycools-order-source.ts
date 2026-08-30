import { PlatformPaymentSourceType } from '@prisma/client';

export const CUSTOMER_ORDER_PAYMENT_PURPOSE = 'customer_order_payment';

export function resolvePayCoolsOrderSourceType(
  orderType?: string | null,
  commerceDomain?: string | null,
): PlatformPaymentSourceType {
  const type = String(orderType || '').toLowerCase();
  if (type === 'pickup' || type === 'take_out' || type === 'takeout') {
    return PlatformPaymentSourceType.TAKE_OUT;
  }
  if (type === 'dine_in') return PlatformPaymentSourceType.RESTAURANT_ORDER;
  if (commerceDomain === 'FOOD') {
    return PlatformPaymentSourceType.RESTAURANT_ORDER;
  }
  return PlatformPaymentSourceType.RETAIL_ORDER;
}

export function isCustomerOrderPayCoolsMetadata(
  metadata: unknown,
): metadata is { purpose: string } {
  return (
    !!metadata &&
    typeof metadata === 'object' &&
    (metadata as { purpose?: unknown }).purpose ===
      CUSTOMER_ORDER_PAYMENT_PURPOSE
  );
}
