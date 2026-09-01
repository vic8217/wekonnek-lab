import { Prisma } from '@prisma/client';

const HUNDRED = new Prisma.Decimal(100);

/** Merchant tax classification takes precedence over the global billing default. */
export function isMerchantVatRegistered(
  taxClassification: string | null | undefined,
  defaultIsVatRegistered: boolean,
) {
  const classification = String(taxClassification || '').trim().toLowerCase();
  if (classification === 'vat_registered') return true;
  if (['non_vat_percentage_tax', 'vat_exempt', 'zero_rated_vat', 'government_entity', 'boi_peza_registered'].includes(classification)) return false;
  return defaultIsVatRegistered;
}

export type TransactionFeeCalculation = {
  rate: Prisma.Decimal;
  merchandiseAfterDiscount: Prisma.Decimal;
  basisNetOfVat: Prisma.Decimal;
  amount: Prisma.Decimal;
};

/** Historical reads must use these persisted values, never the current plan. */
export function transactionFeeSnapshot(order: {
  transactionFeeRate: Prisma.Decimal.Value;
  transactionFeeBasisNetOfVat: Prisma.Decimal.Value;
  transactionFeeAmount: Prisma.Decimal.Value;
}) {
  return {
    rate: new Prisma.Decimal(order.transactionFeeRate),
    basisNetOfVat: new Prisma.Decimal(order.transactionFeeBasisNetOfVat),
    amount: new Prisma.Decimal(order.transactionFeeAmount),
  };
}

/** Decimal-only calculation for the persisted order money authority. */
export function calculateTransactionFee(input: {
  merchandiseGross: Prisma.Decimal.Value;
  merchandiseDiscount?: Prisma.Decimal.Value;
  ratePercent?: Prisma.Decimal.Value | null;
  vatRatePercent?: Prisma.Decimal.Value;
  isVatRegistered?: boolean;
}): TransactionFeeCalculation {
  const gross = new Prisma.Decimal(input.merchandiseGross);
  const discount = new Prisma.Decimal(input.merchandiseDiscount ?? 0);
  const rate = new Prisma.Decimal(input.ratePercent ?? 0);
  const sale = Prisma.Decimal.max(new Prisma.Decimal(0), gross.minus(discount));
  const vatRate = new Prisma.Decimal(input.vatRatePercent ?? 0);
  const basis = input.isVatRegistered && vatRate.gt(0)
    ? sale.div(vatRate.div(HUNDRED).plus(1))
    : sale;
  return {
    rate,
    merchandiseAfterDiscount: sale.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    basisNetOfVat: basis.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    amount: basis.mul(rate).div(HUNDRED).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
  };
}
