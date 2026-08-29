import { Injectable } from '@nestjs/common';
import { CommerceDomain } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TrustTradeEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async isEligible(wkOrderId: number): Promise<{ eligible: boolean; reason?: string }> {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
      include: { merchant: { select: { commerceDomain: true } }, orderItems: { include: { product: { select: { commerceDomain: true } } } } },
    });
    if (!order) return { eligible: false, reason: 'ORDER_NOT_FOUND' };
    const merchantDomain = order.merchant.commerceDomain;
    if (merchantDomain !== CommerceDomain.NON_FOOD && merchantDomain !== CommerceDomain.MIXED)
      return { eligible: false, reason: merchantDomain === CommerceDomain.FOOD ? 'MERCHANT_FOOD' : 'MERCHANT_UNCLASSIFIED' };
    if (merchantDomain === CommerceDomain.NON_FOOD) return { eligible: true };
    const domains = order.orderItems.map(item => item.product?.commerceDomain);
    return domains.length > 0 && domains.every(domain => domain === CommerceDomain.NON_FOOD)
      ? { eligible: true }
      : { eligible: false, reason: domains.some(domain => domain === CommerceDomain.FOOD) ? 'MIXED_OR_FOOD_CART' : 'PRODUCT_UNCLASSIFIED' };
  }
}
