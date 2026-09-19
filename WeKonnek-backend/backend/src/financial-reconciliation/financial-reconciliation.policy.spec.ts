import { Prisma } from '@prisma/client';
import {
  collectibleRemainingAmount,
  deriveFinancialState,
  groupDirectionalItems,
  remainingAmount,
  sumAcknowledgedAmounts,
  sumActiveRestrictedAmounts,
  toMoney,
} from './financial-reconciliation.policy';
import {
  FinancialReconciliationItem,
  RAIL_EXCEPTION_FINANCIAL,
  RAIL_RETURN_FINANCIAL,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
} from './financial-reconciliation.types';

function item(partial: Partial<FinancialReconciliationItem> & { obligationId: string }): FinancialReconciliationItem {
  return {
    rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
    wkOrderId: 1,
    debtor: { type: 'CUSTOMER', userId: 'c', merchantId: null },
    creditor: { type: 'RIDER', userId: 'a', merchantId: null },
    originalPrincipal: toMoney(0),
    settledAmount: toMoney(0),
    remainingAmount: toMoney(0),
    currency: 'PHP',
    financialState: 'UNPAID',
    flags: {
      disputed: false,
      nonExecutable: false,
      collectionRestricted: false,
      reconciliationRequired: false,
    },
    sourceType: 'RIDER_ADVANCE',
    sourceId: partial.obligationId,
    reconciliationState: 'CLEAR',
    sourceRefs: {
      settlementIds: [],
      acknowledgedSettlementIds: [],
      coverageIds: [],
    },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  };
}

describe('Stage13B-1 financial-reconciliation policy', () => {
  it('derives remaining without floating-point artifacts', () => {
    expect(remainingAmount('800.10', '300.05').toFixed(2)).toBe('500.05');
    expect(remainingAmount('0.02', '0.01').toFixed(2)).toBe('0.01');
    expect(remainingAmount(800, 900).toFixed(2)).toBe('0.00');
  });

  it('counts only ACKNOWLEDGED settlement amounts', () => {
    const settled = sumAcknowledgedAmounts([
      { status: 'CLAIMED', acknowledgedAmount: toMoney('800.00') },
      { status: 'REJECTED', acknowledgedAmount: toMoney('50.00') },
      { status: 'ACKNOWLEDGED', acknowledgedAmount: toMoney('300.05') },
      { status: 'ACKNOWLEDGED', acknowledgedAmount: null },
    ]);
    expect(settled.toFixed(2)).toBe('300.05');
  });

  it('derives financial state independently of persisted status', () => {
    expect(deriveFinancialState('800.00', '0')).toBe('UNPAID');
    expect(deriveFinancialState('800.00', '300.00')).toBe('PARTIALLY_SETTLED');
    expect(deriveFinancialState('250.00', '250.00')).toBe('SETTLED');
    expect(deriveFinancialState('0.00', '0.00')).toBe('UNPAID');
    expect(deriveFinancialState('800.00', '800.00')).toBe('SETTLED');
  });

  it('restriction overlay does not change remainingAmount formula', () => {
    const remaining = remainingAmount(800, 300);
    const collectible = collectibleRemainingAmount(800, 300, 500);
    const restricted = sumActiveRestrictedAmounts([
      { status: 'ACTIVE', restrictedAmount: toMoney(500) },
      { status: 'SUPERSEDED', restrictedAmount: toMoney(500) },
    ]);
    expect(remaining.toFixed(2)).toBe('500.00');
    expect(collectible.toFixed(2)).toBe('0.00');
    expect(restricted.toFixed(2)).toBe('500.00');
  });

  it('groups same-direction items and never nets opposite directions', () => {
    const items = [
      item({
        obligationId: 'ra',
        originalPrincipal: toMoney(800),
        settledAmount: toMoney(300),
        remainingAmount: toMoney(500),
      }),
      item({
        obligationId: 'm2r',
        rail: RAIL_RETURN_FINANCIAL,
        debtor: { type: 'MERCHANT', userId: null, merchantId: 9 },
        creditor: { type: 'RIDER', userId: 'a', merchantId: null },
        originalPrincipal: toMoney(500),
        settledAmount: toMoney(0),
        remainingAmount: toMoney(500),
      }),
      item({
        obligationId: 'm2c',
        rail: RAIL_RETURN_FINANCIAL,
        debtor: { type: 'MERCHANT', userId: null, merchantId: 9 },
        creditor: { type: 'CUSTOMER', userId: 'c', merchantId: null },
        originalPrincipal: toMoney(300),
        settledAmount: toMoney(0),
        remainingAmount: toMoney(300),
      }),
      item({
        obligationId: 'ex',
        rail: RAIL_EXCEPTION_FINANCIAL,
        originalPrincipal: toMoney(800),
        settledAmount: toMoney(300),
        remainingAmount: toMoney(500),
      }),
    ];
    const groups = groupDirectionalItems(items);
    expect(groups).toHaveLength(4);
    const merchantRemaining = groups
      .filter((g) => g.key.debtorType === 'MERCHANT')
      .reduce(
        (acc, g) => acc.add(g.remainingAmount),
        new Prisma.Decimal(0),
      );
    expect(merchantRemaining.toFixed(2)).toBe('800.00');
    const keys = groups.map((g) => `${g.key.debtorType}->${g.key.creditorType}:${g.key.rail}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        'CUSTOMER->RIDER:RIDER_ADVANCE_REIMBURSEMENT',
        'MERCHANT->RIDER:RETURN_FINANCIAL',
        'MERCHANT->CUSTOMER:RETURN_FINANCIAL',
      ]),
    );
    expect(JSON.stringify(groups)).not.toMatch(/"orderNetBalance"/);
  });
});
