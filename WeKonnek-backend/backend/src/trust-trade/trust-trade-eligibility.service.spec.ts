import { CommerceDomain } from '@prisma/client';
import { TrustTradeEligibilityService } from './trust-trade-eligibility.service';

describe('TrustTradeEligibilityService', () => {
  const findUnique = jest.fn();
  const service = new TrustTradeEligibilityService({
    wkOrder: { findUnique },
  } as never);

  const orderFor = (
    commerceDomain: CommerceDomain | null,
    productDomains: Array<CommerceDomain | null>,
  ) => ({
    merchant: { commerceDomain },
    orderItems: productDomains.map((domain) => ({
      product: { commerceDomain: domain },
    })),
  });

  it.each([
    ['unclassified merchant', null, [], false],
    ['food merchant', CommerceDomain.FOOD, [], false],
    ['non-food merchant', CommerceDomain.NON_FOOD, [], true],
    [
      'mixed merchant with all food',
      CommerceDomain.MIXED,
      [CommerceDomain.FOOD],
      false,
    ],
    [
      'mixed merchant with all non-food',
      CommerceDomain.MIXED,
      [CommerceDomain.NON_FOOD, CommerceDomain.NON_FOOD],
      true,
    ],
    [
      'mixed merchant with an unclassified product',
      CommerceDomain.MIXED,
      [null],
      false,
    ],
    [
      'mixed merchant with food and non-food products',
      CommerceDomain.MIXED,
      [CommerceDomain.FOOD, CommerceDomain.NON_FOOD],
      false,
    ],
  ])(
    'returns %s eligibility correctly',
    async (_name, merchantDomain, productDomains, expected) => {
      findUnique.mockResolvedValueOnce(
        orderFor(
          merchantDomain,
          productDomains as Array<CommerceDomain | null>,
        ),
      );
      await expect(service.isEligible(1)).resolves.toMatchObject({
        eligible: expected,
      });
    },
  );
});
