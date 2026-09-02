import { Prisma } from '@prisma/client';
import { ACCURA_SOURCE_SYSTEM } from './accura-webhook.types';
import {
  accuraExternalClientReference,
  accuraInvoiceIdempotencyKey,
  type AccuraInvoiceIssueRequest,
  type AccuraInvoiceLineInput,
} from './accura-client.types';

export type AccuraShopSnapshot = {
  id: number;
  name: string;
  merchantId: number;
  accuraBranchMapping: {
    merchantId: number;
    accuraBranchId: string;
  } | null;
};

export type AccuraOrderSnapshot = {
  id: number;
  orderCode: string;
  userId: string;
  merchantId: number;
  shopId: number | null;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  paymentRef: string | null;
  discountAmount: Prisma.Decimal | number | string;
  deliveryFee: Prisma.Decimal | number | string;
  transactionFeeAmount: Prisma.Decimal | number | string;
  deliveryAddress: string | null;
  orderItems: Array<{
    productName: string;
    quantity: number;
    price: Prisma.Decimal | number | string;
    productId: number | null;
  }>;
  shop: AccuraShopSnapshot | null;
  buyer: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

const PAID = 'paid';
const COMPLETED_STATUSES = new Set(['completed', 'delivered']);
const CASH_METHODS = new Set(['cash', 'cod', 'manual']);

function moneyText(value: Prisma.Decimal | number | string): string {
  return new Prisma.Decimal(value).toDecimalPlaces(2).toFixed(2);
}

export function isWkOrderEligibleForAccuraInvoice(
  order: Pick<
    AccuraOrderSnapshot,
    'paymentStatus' | 'paymentMethod' | 'status'
  >,
): boolean {
  if (order.paymentStatus === PAID) return true;
  return (
    CASH_METHODS.has(String(order.paymentMethod).toLowerCase()) &&
    COMPLETED_STATUSES.has(String(order.status).toLowerCase())
  );
}

export function mapBuyerSnapshot(
  order: AccuraOrderSnapshot,
): Record<string, string> | undefined {
  const buyer: Record<string, string> = {};
  const name = [order.buyer?.firstName, order.buyer?.lastName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ')
    .trim();
  if (name) buyer.name = name;
  if (order.buyer?.phone) buyer.phone = order.buyer.phone;
  if (order.buyer?.email) buyer.email = order.buyer.email;
  if (order.deliveryAddress?.trim())
    buyer.address = order.deliveryAddress.trim();
  return Object.keys(buyer).length ? buyer : undefined;
}

export function mapPaymentSnapshot(
  order: AccuraOrderSnapshot,
): Record<string, string | number> {
  const payment: Record<string, string | number> = {
    method: order.paymentMethod,
    status: order.paymentStatus,
    processor: 'WEKONNEK',
  };
  if (order.paymentRef) payment.reference = order.paymentRef;
  if (order.shopId != null) payment.wekonnekShopId = order.shopId;
  if (order.shop?.name) payment.wekonnekShopName = order.shop.name;
  return payment;
}

export function resolveAccuraIssuanceTargets(order: AccuraOrderSnapshot):
  | {
      ok: true;
      merchantId: number;
      externalClientReference: string;
      branchId: string;
    }
  | { ok: false; message: string } {
  const merchantId = order.merchantId;
  if (!Number.isInteger(merchantId) || merchantId <= 0) {
    return { ok: false, message: 'Order is missing an owning merchant' };
  }
  if (order.shopId == null || !order.shop) {
    return {
      ok: false,
      message: 'Order shop has no ACCURA registered branch mapping',
    };
  }
  if (order.shop.merchantId !== merchantId) {
    return { ok: false, message: 'Order shop does not belong to this merchant' };
  }
  const mapping = order.shop.accuraBranchMapping;
  if (!mapping?.accuraBranchId) {
    return {
      ok: false,
      message: 'Order shop has no ACCURA registered branch mapping',
    };
  }
  if (mapping.merchantId !== merchantId) {
    return {
      ok: false,
      message: 'ACCURA branch mapping does not belong to this merchant',
    };
  }
  return {
    ok: true,
    merchantId,
    externalClientReference: accuraExternalClientReference(merchantId),
    branchId: mapping.accuraBranchId,
  };
}

export function mapWkOrderToAccuraInvoiceRequest(
  order: AccuraOrderSnapshot,
  ids: {
    branchId: string;
    seriesId: string;
    externalClientReference: string;
  },
): AccuraInvoiceIssueRequest {
  const items: AccuraInvoiceLineInput[] = order.orderItems.map((item) => {
    const line: AccuraInvoiceLineInput = {
      description: item.productName.trim() || 'Order item',
      quantity: String(item.quantity),
      unit: 'unit',
      unitPrice: moneyText(item.price),
      discountAmount: '0.00',
      taxClass: 'NON_VAT',
    };
    if (item.productId != null) line.productReference = String(item.productId);
    return line;
  });

  const discount = new Prisma.Decimal(order.discountAmount);
  if (discount.gt(0) && items[0]) {
    const gross = new Prisma.Decimal(items[0].quantity).mul(items[0].unitPrice);
    items[0].discountAmount = Prisma.Decimal.min(discount, gross)
      .toDecimalPlaces(2)
      .toFixed(2);
  }

  const delivery = new Prisma.Decimal(order.deliveryFee);
  if (delivery.gt(0)) {
    items.push({
      description: 'Delivery fee',
      quantity: '1',
      unit: 'unit',
      unitPrice: moneyText(delivery),
      discountAmount: '0.00',
      taxClass: 'NON_VAT',
    });
  }

  return {
    sourceSystem: ACCURA_SOURCE_SYSTEM,
    branchId: ids.branchId,
    seriesId: ids.seriesId,
    items,
    buyer: mapBuyerSnapshot(order),
    payment: mapPaymentSnapshot(order),
    idempotencyKey: accuraInvoiceIdempotencyKey(order.id),
    externalOrderId: String(order.id),
    externalOrderCode: order.orderCode,
    externalClientReference: ids.externalClientReference,
  };
}
