import { Prisma } from '@prisma/client';
import { moneyDecimal, moneyNumber } from './wallet-money';

describe('wallet money helpers', () => {
  it('rounds 0.1 + 0.2 to two decimal places', () => {
    expect(moneyNumber(moneyDecimal(0.1).plus(moneyDecimal(0.2)))).toBe(0.3);
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('normalizes Prisma Decimal strings without concatenation', () => {
    const value = new Prisma.Decimal('10.10');
    expect(moneyNumber(value)).toBe(10.1);
    expect(moneyDecimal(value).plus(0.2).toFixed(2)).toBe('10.30');
  });
});
