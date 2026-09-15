import { Injectable } from '@nestjs/common';
import {
  PaymentAllocationComponent,
  PaymentBeneficiaryType,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { moneyDecimal } from '../modules/wallet/wallet-money';

export interface AllocationOrderSnapshot {
  id: number;
  merchantId: number;
  totalAmount: Prisma.Decimal.Value;
  deliveryFee: Prisma.Decimal.Value;
  transactionFeeAmount: Prisma.Decimal.Value;
  discountAmount?: Prisma.Decimal.Value;
}

/**
 * Builds immutable issuance-time payment ownership lines.
 * Does not implement split checkout — only explicit component ownership.
 *
 * Delivery fee: historically bundled into the customer→merchant order total
 * with no separate delivery-provider settlement. Represented as MERCHANT with
 * settlementNote=legacy_bundled_unsettled (not redesigned in Stage 1A).
 */
@Injectable()
export class PaymentAllocationService {
  buildLines(order: AllocationOrderSnapshot): Array<{
    component: PaymentAllocationComponent;
    beneficiaryType: PaymentBeneficiaryType;
    beneficiaryId: string;
    amount: Prisma.Decimal;
    currency: string;
    settlementNote?: string;
  }> {
    const total = moneyDecimal(order.totalAmount);
    const delivery = moneyDecimal(order.deliveryFee ?? 0);
    const platformFee = moneyDecimal(order.transactionFeeAmount ?? 0);
    // Merchandise = total - delivery - platform fee (discount already in total)
    let merchandise = total.minus(delivery).minus(platformFee);
    if (merchandise.lt(0)) merchandise = moneyDecimal(0);

    return [
      {
        component: PaymentAllocationComponent.MERCHANDISE,
        beneficiaryType: PaymentBeneficiaryType.MERCHANT,
        beneficiaryId: String(order.merchantId),
        amount: merchandise,
        currency: 'PHP',
      },
      {
        component: PaymentAllocationComponent.PLATFORM_FEE,
        beneficiaryType: PaymentBeneficiaryType.PLATFORM,
        beneficiaryId: 'WEKONNEK',
        amount: platformFee,
        currency: 'PHP',
      },
      {
        component: PaymentAllocationComponent.DELIVERY_FEE,
        beneficiaryType: PaymentBeneficiaryType.MERCHANT,
        beneficiaryId: String(order.merchantId),
        amount: delivery,
        currency: 'PHP',
        settlementNote: 'legacy_bundled_unsettled',
      },
    ].filter((line) => line.amount.gt(0) || line.component === 'MERCHANDISE');
  }

  async persistForOrder(
    tx: Prisma.TransactionClient,
    order: AllocationOrderSnapshot,
  ) {
    const existing = await tx.orderPaymentAllocation.count({
      where: { wkOrderId: order.id },
    });
    if (existing > 0) return tx.orderPaymentAllocation.findMany({
      where: { wkOrderId: order.id },
    });

    const lines = this.buildLines(order);
    await tx.orderPaymentAllocation.createMany({
      data: lines.map((line) => ({
        id: randomUUID(),
        wkOrderId: order.id,
        component: line.component,
        beneficiaryType: line.beneficiaryType,
        beneficiaryId: line.beneficiaryId,
        amount: line.amount,
        currency: line.currency,
        settlementNote: line.settlementNote,
      })),
    });
    return tx.orderPaymentAllocation.findMany({
      where: { wkOrderId: order.id },
    });
  }
}
