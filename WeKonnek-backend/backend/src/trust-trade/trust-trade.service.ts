import { Injectable, Logger } from '@nestjs/common';
import { AgreementProvenance } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrustTradeEligibilityService } from './trust-trade-eligibility.service';
import { AgreementService } from '../agreements/agreement.service';

@Injectable()
export class TrustTradeService {
  private readonly logger = new Logger(TrustTradeService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: TrustTradeEligibilityService,
    private readonly agreements: AgreementService,
  ) {}

  async ensureForWkOrder(wkOrderId: number): Promise<void> {
    const eligibility = await this.eligibility.isEligible(wkOrderId);
    if (!eligibility.eligible) {
      this.logger.log(
        `trust_trade_skipped wkOrderId=${wkOrderId} reason=${eligibility.reason}`,
      );
      return;
    }
    const order = await this.prisma.wkOrder.findUniqueOrThrow({
      where: { id: wkOrderId },
      include: {
        merchant: true,
        orderItems: { include: { product: true, variant: true } },
      },
    });

    // Stage 2A: dual-write — legacy TrustTradeTransaction + authoritative Agreement.
    // Auto-create is NOT explicit acceptance → LEGACY_SNAPSHOT provenance.
    const agreement = await this.agreements.offerMerchantTradeForOrder(
      wkOrderId,
      { provenance: AgreementProvenance.LEGACY_SNAPSHOT },
    );

    await this.prisma.trustTradeTransaction.upsert({
      where: { wkOrderId },
      update: {
        agreementId: agreement.id,
      },
      create: {
        trustTradeId: `TT-${new Date().getUTCFullYear()}-${String(wkOrderId).padStart(8, '0')}`,
        wkOrderId,
        merchantId: order.merchantId,
        shopId: order.shopId,
        buyerId: order.userId,
        sourceType: 'DIRECT_CART',
        agreementId: agreement.id,
        agreementSnapshot: {
          wkOrderId,
          orderCode: order.orderCode,
          buyerId: order.userId,
          merchant: { id: order.merchant.id, name: order.merchant.name },
          shopId: order.shopId,
          payment: {
            status: order.paymentStatus,
            method: order.paymentMethod,
            reference: order.paymentRef,
          },
          totals: {
            total: order.totalAmount.toString(),
            deliveryFee: order.deliveryFee.toString(),
            discount: order.discountAmount.toString(),
          },
          items: order.orderItems.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            sku: item.product?.sku,
            imageUrl: item.product?.imageUrl,
            variantId: item.variantId,
            quantity: item.quantity,
            unitPrice: item.price.toString(),
            subtotal: item.subtotal.toString(),
          })),
          stage2: {
            agreementId: agreement.id,
            provenance: AgreementProvenance.LEGACY_SNAPSHOT,
            note: 'Auto-created snapshot is not explicit customer acceptance',
          },
        },
      },
    });
  }
}
