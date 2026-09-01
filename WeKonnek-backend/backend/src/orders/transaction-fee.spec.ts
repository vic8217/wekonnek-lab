import { calculateTransactionFee, isMerchantVatRegistered, transactionFeeSnapshot } from './transaction-fee';

describe('calculateTransactionFee', () => {
  it('calculates 2.5% from VAT-inclusive merchandise net of 12% VAT', () => {
    const fee = calculateTransactionFee({ merchandiseGross: 1120, ratePercent: 2.5, vatRatePercent: 12, isVatRegistered: true });
    expect(fee.basisNetOfVat.toString()).toBe('1000');
    expect(fee.amount.toString()).toBe('25');
    expect(fee.merchandiseAfterDiscount.plus(fee.amount).toString()).toBe('1145');
  });

  it('produces zero fee for a 0% subscription tier', () => {
    const fee = calculateTransactionFee({ merchandiseGross: 1120, ratePercent: 0, vatRatePercent: 12, isVatRegistered: true });
    expect(fee.amount.toString()).toBe('0');
  });

  it('rounds the final fee to centavos', () => {
    const fee = calculateTransactionFee({ merchandiseGross: 100, ratePercent: 2.5, vatRatePercent: 12, isVatRegistered: true });
    expect(fee.amount.toString()).toBe('2.23');
  });

  it('applies discount before deriving the VAT-exclusive fee basis', () => {
    const fee = calculateTransactionFee({ merchandiseGross: 1120, merchandiseDiscount: 112, ratePercent: 2.5, vatRatePercent: 12, isVatRegistered: true });
    expect(fee.merchandiseAfterDiscount.toString()).toBe('1008');
    expect(fee.basisNetOfVat.toString()).toBe('900');
    expect(fee.amount.toString()).toBe('22.5');
  });

  it('excludes delivery and the fee itself from the basis', () => {
    const fee = calculateTransactionFee({ merchandiseGross: 1120, ratePercent: 2.5, vatRatePercent: 12, isVatRegistered: true });
    // Adding delivery after calculation cannot affect the ₱1,000 merchandise basis.
    expect(fee.basisNetOfVat.toString()).toBe('1000');
    expect(fee.amount.toString()).toBe('25');
    expect(fee.basisNetOfVat.plus(fee.amount).toString()).toBe('1025');
  });

  it('keeps a persisted snapshot when an administrator later changes the plan rate', () => {
    const historicalOrder = transactionFeeSnapshot({ transactionFeeRate: 2.5, transactionFeeBasisNetOfVat: 1000, transactionFeeAmount: 25 });
    const currentPlanRate = 3;
    expect(historicalOrder.rate.toString()).toBe('2.5');
    expect(historicalOrder.basisNetOfVat.toString()).toBe('1000');
    expect(historicalOrder.amount.toString()).toBe('25');
    expect(currentPlanRate).toBe(3);
  });

  it('uses the merchant tax classification ahead of the global billing default', () => {
    expect(isMerchantVatRegistered('vat_registered', false)).toBe(true);
    expect(isMerchantVatRegistered('vat_exempt', true)).toBe(false);
    expect(isMerchantVatRegistered('', true)).toBe(true);
  });
});
