import { CommerceDomain, PlatformPaymentSourceType } from '@prisma/client';
import { resolvePayCoolsOrderSourceType } from './paycools-order-source';

describe('resolvePayCoolsOrderSourceType', () => {
  it('maps pickup and take-out to TAKE_OUT', () => {
    expect(resolvePayCoolsOrderSourceType('pickup', CommerceDomain.FOOD)).toBe(
      PlatformPaymentSourceType.TAKE_OUT,
    );
    expect(
      resolvePayCoolsOrderSourceType('take_out', CommerceDomain.NON_FOOD),
    ).toBe(PlatformPaymentSourceType.TAKE_OUT);
  });

  it('maps dine-in to RESTAURANT_ORDER', () => {
    expect(
      resolvePayCoolsOrderSourceType('dine_in', CommerceDomain.NON_FOOD),
    ).toBe(PlatformPaymentSourceType.RESTAURANT_ORDER);
  });

  it('maps FOOD merchants to RESTAURANT_ORDER', () => {
    expect(
      resolvePayCoolsOrderSourceType('delivery', CommerceDomain.FOOD),
    ).toBe(PlatformPaymentSourceType.RESTAURANT_ORDER);
  });

  it('maps NON_FOOD merchants to RETAIL_ORDER', () => {
    expect(
      resolvePayCoolsOrderSourceType('delivery', CommerceDomain.NON_FOOD),
    ).toBe(PlatformPaymentSourceType.RETAIL_ORDER);
    expect(
      resolvePayCoolsOrderSourceType('in_store', CommerceDomain.MIXED),
    ).toBe(PlatformPaymentSourceType.RETAIL_ORDER);
  });
});
