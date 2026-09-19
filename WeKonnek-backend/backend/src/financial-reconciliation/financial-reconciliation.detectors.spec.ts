import {
  EconomicLossCoverageSourceKind,
  EconomicLossKind,
  LiabilityDeterminationStatus,
  ReturnFinancialObligationType,
} from '@prisma/client';
import {
  detectCoverageConsistency,
  detectCrossRail,
  detectRiderAdvanceReturnTransfer,
  detectStage9Stage12Overlap,
  detectSuccessorTopology,
  SUCCESSOR_TRAVERSAL_CAP,
} from './financial-reconciliation.detectors';
import {
  buildFindingKey,
  composeOrderFinancialReconciliation,
  toMoney,
} from './financial-reconciliation.policy';
import {
  FinancialReconciliationItem,
  RAIL_EXCEPTION_FINANCIAL,
  RAIL_RETURN_FINANCIAL,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
  RECONCILIATION_FINDING_CODES,
  ReconciliationRelatedItem,
} from './financial-reconciliation.types';
import {
  PATH_ORDINARY_MERCHANT_PAYMENT,
  PATH_RIDER_ADVANCE,
  ReconciliationReadContext,
} from './reconciliation-read-context';

const now = new Date('2026-09-01T00:00:00Z');

function flags(overrides: Partial<FinancialReconciliationItem['flags']> = {}) {
  return {
    disputed: false,
    nonExecutable: false,
    collectionRestricted: false,
    reconciliationRequired: false,
    ...overrides,
  };
}

function item(
  partial: Partial<FinancialReconciliationItem> & { obligationId: string },
): FinancialReconciliationItem {
  return {
    rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
    wkOrderId: 1,
    debtor: { type: 'CUSTOMER', userId: 'cust', merchantId: null },
    creditor: { type: 'RIDER', userId: 'rider-a', merchantId: null },
    originalPrincipal: toMoney(0),
    settledAmount: toMoney(0),
    remainingAmount: toMoney(0),
    currency: 'PHP',
    financialState: 'UNPAID',
    flags: flags(),
    sourceType: 'RIDER_ADVANCE',
    sourceId: partial.obligationId,
    reconciliationState: 'CLEAR',
    sourceRefs: {
      settlementIds: [],
      acknowledgedSettlementIds: [],
      coverageIds: [],
    },
    createdAt: now,
    ...partial,
  };
}

function coherentTransfer(): {
  items: FinancialReconciliationItem[];
  ctx: ReconciliationReadContext;
} {
  const ra = item({
    obligationId: 'ra-1',
    riderAdvanceId: 'ra-1',
    originalPrincipal: toMoney(800),
    settledAmount: toMoney(300),
    remainingAmount: toMoney(500),
    collectibleRemaining: toMoney(0),
    financialState: 'PARTIALLY_SETTLED',
    flags: flags({ collectionRestricted: true }),
  });
  const m2r = item({
    obligationId: 'm2r-1',
    rail: RAIL_RETURN_FINANCIAL,
    debtor: { type: 'MERCHANT', userId: null, merchantId: 9 },
    creditor: { type: 'RIDER', userId: 'rider-a', merchantId: null },
    originalPrincipal: toMoney(500),
    remainingAmount: toMoney(500),
    riderAdvanceId: 'ra-1',
    determinationId: 'det-1',
    returnFinancialDeterminationId: 'det-1',
    sourceType: 'RETURN_FINANCIAL_OBLIGATION',
  });
  const m2c = item({
    obligationId: 'm2c-1',
    rail: RAIL_RETURN_FINANCIAL,
    debtor: { type: 'MERCHANT', userId: null, merchantId: 9 },
    creditor: { type: 'CUSTOMER', userId: 'cust', merchantId: null },
    originalPrincipal: toMoney(300),
    remainingAmount: toMoney(300),
    riderAdvanceId: 'ra-1',
    determinationId: 'det-1',
    returnFinancialDeterminationId: 'det-1',
    sourceType: 'RETURN_FINANCIAL_OBLIGATION',
  });
  const ctx: ReconciliationReadContext = {
    wkOrderId: 1,
    riderAdvances: [
      {
        id: 'ra-1',
        riderId: 'rider-a',
        reimbursementPrincipal: toMoney(800),
        currency: 'PHP',
        status: 'REIMBURSEMENT_DUE',
      },
    ],
    returnDeterminations: [
      {
        id: 'det-1',
        path: PATH_RIDER_ADVANCE,
        riderAdvanceId: 'ra-1',
        snapshotPrincipal: toMoney(800),
        snapshotReimbursed: toMoney(300),
        merchantToRiderAmount: toMoney(500),
        merchantToCustomerAmount: toMoney(300),
        currency: 'PHP',
        obligations: [
          {
            id: 'm2r-1',
            type: ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
            principal: toMoney(500),
            currency: 'PHP',
            creditorUserId: 'rider-a',
          },
          {
            id: 'm2c-1',
            type: ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
            principal: toMoney(300),
            currency: 'PHP',
            creditorUserId: 'cust',
          },
        ],
      },
    ],
    restrictions: [
      {
        id: 'rst-1',
        riderAdvanceId: 'ra-1',
        returnFinancialDeterminationId: 'det-1',
        restrictedAmount: toMoney(500),
        status: 'ACTIVE',
      },
    ],
    economicLosses: [],
    coverages: [],
    liabilityDeterminations: [],
  };
  return { items: [ra, m2r, m2c], ctx };
}

describe('Stage13B-2 detectors (unit)', () => {
  it('findingKey is stable and undirected for overlap pairs', () => {
    const a = buildFindingKey({
      code: 'EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE',
      involvedItems: [
        { rail: RAIL_EXCEPTION_FINANCIAL, obligationId: 'b' },
        { rail: RAIL_EXCEPTION_FINANCIAL, obligationId: 'a' },
      ],
    });
    const b = buildFindingKey({
      code: 'EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE',
      involvedItems: [
        { rail: RAIL_EXCEPTION_FINANCIAL, obligationId: 'a' },
        { rail: RAIL_EXCEPTION_FINANCIAL, obligationId: 'b' },
      ],
    });
    expect(a).toBe(b);
  });

  it('RA only — no findings and no transfer relation', () => {
    const items = [
      item({
        obligationId: 'ra-1',
        originalPrincipal: toMoney(800),
        remainingAmount: toMoney(800),
      }),
    ];
    const ctx: ReconciliationReadContext = {
      wkOrderId: 1,
      riderAdvances: [
        {
          id: 'ra-1',
          riderId: 'rider-a',
          reimbursementPrincipal: toMoney(800),
          currency: 'PHP',
          status: 'REIMBURSEMENT_DUE',
        },
      ],
      returnDeterminations: [],
      restrictions: [],
      economicLosses: [],
      coverages: [],
      liabilityDeterminations: [],
    };
    const out = detectCrossRail(items, ctx);
    const order = composeOrderFinancialReconciliation({
      wkOrderId: 1,
      items,
      findings: out.findings,
      relatedItems: out.relatedItems,
    });
    expect(order.findings).toEqual([]);
    expect(order.hasReconciliationIssue).toBe(false);
    expect(order.hasOutstanding).toBe(true);
    expect(
      order.relatedItems.some(
        (r) => r.relation === 'COLLECTION_TRANSFERRED_TO_RETURN',
      ),
    ).toBe(false);
  });

  it('coherent RA→Stage9 transfer — no finding, transfer relation only', () => {
    const { items, ctx } = coherentTransfer();
    const out = detectRiderAdvanceReturnTransfer(items, ctx);
    expect(out.findings).toEqual([]);
    expect(out.relatedItems).toEqual([
      expect.objectContaining({
        fromObligationId: 'ra-1',
        obligationId: 'm2r-1',
        relation: 'COLLECTION_TRANSFERRED_TO_RETURN',
      }),
    ]);
    expect(
      out.relatedItems.some((r) => r.relation === 'POTENTIAL_OVERLAP'),
    ).toBe(false);
  });

  it('ordinary Stage9 path is not a transfer check', () => {
    const { items, ctx } = coherentTransfer();
    ctx.returnDeterminations[0].path = PATH_ORDINARY_MERCHANT_PAYMENT;
    ctx.returnDeterminations[0].riderAdvanceId = null;
    const out = detectRiderAdvanceReturnTransfer(items, ctx);
    expect(out.findings).toEqual([]);
    expect(out.relatedItems).toEqual([]);
  });

  it('missing restriction → OVERLAP_REVIEW_REQUIRED', () => {
    const { items, ctx } = coherentTransfer();
    items[0].collectibleRemaining = toMoney(500);
    ctx.restrictions = [];
    const out = detectRiderAdvanceReturnTransfer(items, ctx);
    expect(out.findings.map((f) => f.code)).toEqual([
      RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
    ]);
    expect(out.findings[0].reconciliationState).toBe('OVERLAP_REVIEW_REQUIRED');
    expect(out.relatedItems.some((r) => r.relation === 'POTENTIAL_OVERLAP')).toBe(
      true,
    );
  });

  it('restriction too small emits mismatch and double collectible', () => {
    const { items, ctx } = coherentTransfer();
    items[0].collectibleRemaining = toMoney(100);
    ctx.restrictions[0].restrictedAmount = toMoney(400);
    const out = detectRiderAdvanceReturnTransfer(items, ctx);
    expect(out.findings.map((f) => f.code).sort()).toEqual([
      RECONCILIATION_FINDING_CODES.RA_RETURN_DOUBLE_COLLECTIBLE,
      RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_AMOUNT_MISMATCH,
    ]);
    expect(
      out.findings.find((f) => f.code === 'RA_RETURN_RESTRICTION_AMOUNT_MISMATCH')
        ?.reconciliationState,
    ).toBe('SOURCE_INCONSISTENCY');
    expect(
      out.findings.find((f) => f.code === 'RA_RETURN_DOUBLE_COLLECTIBLE')
        ?.reconciliationState,
    ).toBe('OVERLAP_REVIEW_REQUIRED');
  });

  it('restriction too large is mismatch only', () => {
    const { items, ctx } = coherentTransfer();
    ctx.restrictions[0].restrictedAmount = toMoney(700);
    const out = detectRiderAdvanceReturnTransfer(items, ctx);
    expect(out.findings.map((f) => f.code)).toEqual([
      RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_AMOUNT_MISMATCH,
    ]);
    expect(out.findings[0].reconciliationState).toBe('SOURCE_INCONSISTENCY');
    expect(out.findings.some((f) => f.code === 'RA_RETURN_DOUBLE_COLLECTIBLE')).toBe(
      false,
    );
  });

  it('multiple ACTIVE restrictions', () => {
    const { items, ctx } = coherentTransfer();
    ctx.restrictions.push({
      id: 'rst-2',
      riderAdvanceId: 'ra-1',
      returnFinancialDeterminationId: 'det-1',
      restrictedAmount: toMoney(500),
      status: 'ACTIVE',
    });
    const out = detectRiderAdvanceReturnTransfer(items, ctx);
    expect(out.findings.map((f) => f.code)).toEqual([
      RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MULTIPLE,
    ]);
  });

  it('SUPERSEDED plus one coherent ACTIVE is passed', () => {
    const { items, ctx } = coherentTransfer();
    ctx.restrictions.push({
      id: 'rst-old',
      riderAdvanceId: 'ra-1',
      returnFinancialDeterminationId: 'det-1',
      restrictedAmount: toMoney(400),
      status: 'SUPERSEDED',
    });
    const out = detectRiderAdvanceReturnTransfer(items, ctx);
    expect(out.findings).toEqual([]);
    expect(out.relatedItems[0].relation).toBe('COLLECTION_TRANSFERRED_TO_RETURN');
  });

  it('wrong rider creditor', () => {
    const { items, ctx } = coherentTransfer();
    ctx.returnDeterminations[0].obligations[0].creditorUserId = 'rider-b';
    const out = detectRiderAdvanceReturnTransfer(items, ctx);
    expect(out.findings.map((f) => f.code)).toContain(
      RECONCILIATION_FINDING_CODES.RA_RETURN_CREDITOR_MISMATCH,
    );
  });

  it('snapshot principal mismatch', () => {
    const { items, ctx } = coherentTransfer();
    ctx.returnDeterminations[0].snapshotPrincipal = toMoney(900);
    const out = detectRiderAdvanceReturnTransfer(items, ctx);
    expect(out.findings.map((f) => f.code)).toContain(
      RECONCILIATION_FINDING_CODES.RA_RETURN_SNAPSHOT_PRINCIPAL_MISMATCH,
    );
  });

  it('snapshot ACK mismatch', () => {
    const { items, ctx } = coherentTransfer();
    items[0].settledAmount = toMoney(400);
    const out = detectRiderAdvanceReturnTransfer(items, ctx);
    expect(out.findings.map((f) => f.code)).toContain(
      RECONCILIATION_FINDING_CODES.RA_RETURN_SNAPSHOT_ACK_MISMATCH,
    );
  });

  it('missing RA', () => {
    const { items, ctx } = coherentTransfer();
    ctx.riderAdvances = [];
    const out = detectRiderAdvanceReturnTransfer(
      items.filter((i) => i.rail !== RAIL_RIDER_ADVANCE_REIMBURSEMENT),
      ctx,
    );
    expect(out.findings.map((f) => f.code)).toEqual([
      RECONCILIATION_FINDING_CODES.RA_RETURN_RA_MISSING,
    ]);
  });

  it('RA-path without riderAdvanceId is insufficient linkage', () => {
    const { items, ctx } = coherentTransfer();
    ctx.returnDeterminations[0].riderAdvanceId = null;
    const out = detectRiderAdvanceReturnTransfer(items, ctx);
    expect(out.findings[0].code).toBe(
      RECONCILIATION_FINDING_CODES.INSUFFICIENT_SOURCE_LINKAGE,
    );
    expect(out.findings[0].checkOutcome).toBe('INSUFFICIENT_LINKAGE');
    expect(out.findings[0].reconciliationState).toBe('REVIEW_REQUIRED');
  });

  it('currency mismatch', () => {
    const { items, ctx } = coherentTransfer();
    ctx.returnDeterminations[0].currency = 'USD';
    const out = detectRiderAdvanceReturnTransfer(items, ctx);
    expect(out.findings.map((f) => f.code)).toContain(
      RECONCILIATION_FINDING_CODES.CURRENCY_MISMATCH,
    );
  });

  it('does not emit RA_RETURN_TRANSFER_COHERENT', () => {
    const { items, ctx } = coherentTransfer();
    const out = detectCrossRail(items, ctx);
    expect(JSON.stringify(out)).not.toMatch(/RA_RETURN_TRANSFER_COHERENT/);
  });

  it('coverage equals importable headroom cap is PASSED', () => {
    const items = [
      item({
        obligationId: 'm2c-1',
        rail: RAIL_RETURN_FINANCIAL,
        originalPrincipal: toMoney(500),
        remainingAmount: toMoney(500),
        determinationId: 'det-1',
      }),
      item({
        obligationId: 'ex-1',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        originalPrincipal: toMoney(300),
        remainingAmount: toMoney(300),
        determinationId: 'd1',
      }),
    ];
    const ctx: ReconciliationReadContext = {
      wkOrderId: 1,
      riderAdvances: [],
      returnDeterminations: [
        {
          id: 'det-1',
          path: PATH_ORDINARY_MERCHANT_PAYMENT,
          riderAdvanceId: null,
          snapshotPrincipal: toMoney(500),
          snapshotReimbursed: toMoney(0),
          merchantToRiderAmount: toMoney(0),
          merchantToCustomerAmount: toMoney(500),
          currency: 'PHP',
          obligations: [
            {
              id: 'm2c-1',
              type: ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
              principal: toMoney(500),
              currency: 'PHP',
              creditorUserId: 'cust',
            },
          ],
        },
      ],
      restrictions: [],
      economicLosses: [
        {
          id: 'loss-1',
          lossKind: EconomicLossKind.GOODS_LOST,
          subjectRef: 'order-goods:1',
          currency: 'PHP',
          compensableAmount: toMoney(800),
        },
      ],
      coverages: [
        {
          id: 'cov-prior',
          economicLossId: 'loss-1',
          sourceKind: EconomicLossCoverageSourceKind.STAGE12_OBLIGATION,
          sourceRef: 'ex-other',
          stage9ObligationId: null,
          subjectRefSnapshot: 'order-goods:1',
          amount: toMoney(500),
          currency: 'PHP',
          createdAt: new Date('2026-08-01T00:00:00Z'),
        },
        {
          id: 'cov-s9',
          economicLossId: 'loss-1',
          sourceKind: EconomicLossCoverageSourceKind.STAGE9_OBLIGATION,
          sourceRef: 'm2c-1',
          stage9ObligationId: 'm2c-1',
          subjectRefSnapshot: 'order-goods:1',
          amount: toMoney(300),
          currency: 'PHP',
          createdAt: new Date('2026-09-01T00:00:00Z'),
        },
      ],
      liabilityDeterminations: [],
    };
    const out = detectCoverageConsistency(items, ctx);
    expect(out.findings.map((f) => f.code)).not.toContain(
      RECONCILIATION_FINDING_CODES.STAGE9_COVERAGE_AMOUNT_MISMATCH,
    );
    expect(
      out.relatedItems.some(
        (r: ReconciliationRelatedItem) =>
          r.relation === 'ECONOMIC_LOSS_COVERED_BY_RETURN',
      ),
    ).toBe(true);
  });

  it('coverage amount mismatch when neither principal nor cap', () => {
    const items = [
      item({
        obligationId: 'm2c-1',
        rail: RAIL_RETURN_FINANCIAL,
        originalPrincipal: toMoney(500),
        remainingAmount: toMoney(500),
        determinationId: 'det-1',
      }),
    ];
    const ctx: ReconciliationReadContext = {
      wkOrderId: 1,
      riderAdvances: [],
      returnDeterminations: [
        {
          id: 'det-1',
          path: PATH_ORDINARY_MERCHANT_PAYMENT,
          riderAdvanceId: null,
          snapshotPrincipal: toMoney(500),
          snapshotReimbursed: toMoney(0),
          merchantToRiderAmount: toMoney(0),
          merchantToCustomerAmount: toMoney(500),
          currency: 'PHP',
          obligations: [
            {
              id: 'm2c-1',
              type: ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
              principal: toMoney(500),
              currency: 'PHP',
              creditorUserId: 'cust',
            },
          ],
        },
      ],
      restrictions: [],
      economicLosses: [
        {
          id: 'loss-1',
          lossKind: EconomicLossKind.GOODS_LOST,
          subjectRef: 'order-goods:1',
          currency: 'PHP',
          compensableAmount: toMoney(800),
        },
      ],
      coverages: [
        {
          id: 'cov-s9',
          economicLossId: 'loss-1',
          sourceKind: EconomicLossCoverageSourceKind.STAGE9_OBLIGATION,
          sourceRef: 'm2c-1',
          stage9ObligationId: 'm2c-1',
          subjectRefSnapshot: 'order-goods:1',
          amount: toMoney(200),
          currency: 'PHP',
          createdAt: now,
        },
      ],
      liabilityDeterminations: [],
    };
    const out = detectCoverageConsistency(items, ctx);
    expect(out.findings.map((f) => f.code)).toContain(
      RECONCILIATION_FINDING_CODES.STAGE9_COVERAGE_AMOUNT_MISMATCH,
    );
  });

  it('coverage source missing', () => {
    const ctx: ReconciliationReadContext = {
      wkOrderId: 1,
      riderAdvances: [],
      returnDeterminations: [],
      restrictions: [],
      economicLosses: [
        {
          id: 'loss-1',
          lossKind: EconomicLossKind.GOODS_LOST,
          subjectRef: 'order-goods:1',
          currency: 'PHP',
          compensableAmount: toMoney(800),
        },
      ],
      coverages: [
        {
          id: 'cov-ghost',
          economicLossId: 'loss-1',
          sourceKind: EconomicLossCoverageSourceKind.STAGE9_OBLIGATION,
          sourceRef: 'missing-obl',
          stage9ObligationId: 'missing-obl',
          subjectRefSnapshot: 'order-goods:1',
          amount: toMoney(100),
          currency: 'PHP',
          createdAt: now,
        },
      ],
      liabilityDeterminations: [],
    };
    const out = detectCoverageConsistency([], ctx);
    expect(out.findings.map((f) => f.code)).toContain(
      RECONCILIATION_FINDING_CODES.COVERAGE_SOURCE_MISSING,
    );
  });

  it('coverage exceeds compensable', () => {
    const ctx: ReconciliationReadContext = {
      wkOrderId: 1,
      riderAdvances: [],
      returnDeterminations: [],
      restrictions: [],
      economicLosses: [
        {
          id: 'loss-1',
          lossKind: EconomicLossKind.GOODS_LOST,
          subjectRef: 'order-goods:1',
          currency: 'PHP',
          compensableAmount: toMoney(100),
        },
      ],
      coverages: [
        {
          id: 'c1',
          economicLossId: 'loss-1',
          sourceKind: EconomicLossCoverageSourceKind.STAGE12_OBLIGATION,
          sourceRef: 'a',
          stage9ObligationId: null,
          subjectRefSnapshot: 'order-goods:1',
          amount: toMoney(80),
          currency: 'PHP',
          createdAt: now,
        },
        {
          id: 'c2',
          economicLossId: 'loss-1',
          sourceKind: EconomicLossCoverageSourceKind.EXTERNAL_RECOVERY,
          sourceRef: 'b',
          stage9ObligationId: null,
          subjectRefSnapshot: 'order-goods:1',
          amount: toMoney(50),
          currency: 'PHP',
          createdAt: now,
        },
      ],
      liabilityDeterminations: [],
    };
    const out = detectCoverageConsistency([], ctx);
    expect(out.findings.map((f) => f.code)).toContain(
      RECONCILIATION_FINDING_CODES.COVERAGE_EXCEEDS_COMPENSABLE,
    );
  });

  it('duplicate semantic Stage9 coverage', () => {
    const items = [
      item({
        obligationId: 'm2c-1',
        rail: RAIL_RETURN_FINANCIAL,
        originalPrincipal: toMoney(300),
        remainingAmount: toMoney(300),
        determinationId: 'det-1',
      }),
    ];
    const ctx: ReconciliationReadContext = {
      wkOrderId: 1,
      riderAdvances: [],
      returnDeterminations: [
        {
          id: 'det-1',
          path: PATH_ORDINARY_MERCHANT_PAYMENT,
          riderAdvanceId: null,
          snapshotPrincipal: toMoney(300),
          snapshotReimbursed: toMoney(0),
          merchantToRiderAmount: toMoney(0),
          merchantToCustomerAmount: toMoney(300),
          currency: 'PHP',
          obligations: [
            {
              id: 'm2c-1',
              type: ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
              principal: toMoney(300),
              currency: 'PHP',
              creditorUserId: 'cust',
            },
          ],
        },
      ],
      restrictions: [],
      economicLosses: [
        {
          id: 'loss-1',
          lossKind: EconomicLossKind.GOODS_LOST,
          subjectRef: 'order-goods:1',
          currency: 'PHP',
          compensableAmount: toMoney(800),
        },
      ],
      coverages: [
        {
          id: 'c1',
          economicLossId: 'loss-1',
          sourceKind: EconomicLossCoverageSourceKind.STAGE9_OBLIGATION,
          sourceRef: 'm2c-1',
          stage9ObligationId: 'm2c-1',
          subjectRefSnapshot: 'order-goods:1',
          amount: toMoney(150),
          currency: 'PHP',
          createdAt: now,
        },
        {
          id: 'c2',
          economicLossId: 'loss-1',
          sourceKind: EconomicLossCoverageSourceKind.STAGE9_OBLIGATION,
          sourceRef: 'alias-m2c-1',
          stage9ObligationId: 'm2c-1',
          subjectRefSnapshot: 'order-goods:1',
          amount: toMoney(150),
          currency: 'PHP',
          createdAt: now,
        },
      ],
      liabilityDeterminations: [],
    };
    const out = detectCoverageConsistency(items, ctx);
    expect(out.findings.map((f) => f.code)).toContain(
      RECONCILIATION_FINDING_CODES.COVERAGE_DUPLICATE_SEMANTIC,
    );
  });

  it('missing Stage9 coverage on contained remaining Stage12 is review', () => {
    const items = [
      item({
        obligationId: 'm2c-1',
        rail: RAIL_RETURN_FINANCIAL,
        originalPrincipal: toMoney(500),
        remainingAmount: toMoney(500),
        determinationId: 'det-1',
      }),
      item({
        obligationId: 'ex-1',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        originalPrincipal: toMoney(400),
        remainingAmount: toMoney(400),
        determinationId: 'd1',
      }),
    ];
    const ctx: ReconciliationReadContext = {
      wkOrderId: 1,
      riderAdvances: [],
      returnDeterminations: [
        {
          id: 'det-1',
          path: PATH_ORDINARY_MERCHANT_PAYMENT,
          riderAdvanceId: null,
          snapshotPrincipal: toMoney(500),
          snapshotReimbursed: toMoney(0),
          merchantToRiderAmount: toMoney(0),
          merchantToCustomerAmount: toMoney(500),
          currency: 'PHP',
          obligations: [
            {
              id: 'm2c-1',
              type: ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
              principal: toMoney(500),
              currency: 'PHP',
              creditorUserId: 'cust',
            },
          ],
        },
      ],
      restrictions: [],
      economicLosses: [
        {
          id: 'loss-1',
          lossKind: EconomicLossKind.GOODS_LOST,
          subjectRef: 'order-goods:1',
          currency: 'PHP',
          compensableAmount: toMoney(800),
        },
      ],
      coverages: [],
      liabilityDeterminations: [],
    };
    const out = detectStage9Stage12Overlap(items, ctx);
    expect(out.findings.map((f) => f.code)).toContain(
      RECONCILIATION_FINDING_CODES.STAGE9_COVERAGE_MISSING,
    );
    expect(
      out.findings.some((f) => f.reconciliationState === 'COVERAGE_REVIEW_REQUIRED'),
    ).toBe(true);
    expect(
      out.findings.some((f) => f.reconciliationState === 'OVERLAP_REVIEW_REQUIRED'),
    ).toBe(true);
  });

  it('UNKNOWN subject is REVIEW_REQUIRED not CLEAR', () => {
    const items = [
      item({
        obligationId: 'm2c-1',
        rail: RAIL_RETURN_FINANCIAL,
        originalPrincipal: toMoney(500),
        remainingAmount: toMoney(500),
        determinationId: 'det-1',
      }),
      item({
        obligationId: 'ex-1',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        originalPrincipal: toMoney(400),
        remainingAmount: toMoney(400),
        determinationId: 'd1',
      }),
    ];
    const ctx: ReconciliationReadContext = {
      wkOrderId: 1,
      riderAdvances: [],
      returnDeterminations: [
        {
          id: 'det-1',
          path: PATH_ORDINARY_MERCHANT_PAYMENT,
          riderAdvanceId: null,
          snapshotPrincipal: toMoney(500),
          snapshotReimbursed: toMoney(0),
          merchantToRiderAmount: toMoney(0),
          merchantToCustomerAmount: toMoney(500),
          currency: 'PHP',
          obligations: [
            {
              id: 'm2c-1',
              type: ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
              principal: toMoney(500),
              currency: 'PHP',
              creditorUserId: 'cust',
            },
          ],
        },
      ],
      restrictions: [],
      economicLosses: [
        {
          id: 'loss-1',
          lossKind: EconomicLossKind.GOODS_LOST,
          subjectRef: 'external-event:xyz',
          currency: 'PHP',
          compensableAmount: toMoney(800),
        },
      ],
      coverages: [],
      liabilityDeterminations: [],
    };
    const out = detectStage9Stage12Overlap(items, ctx);
    expect(out.findings[0].code).toBe(
      RECONCILIATION_FINDING_CODES.SUBJECT_MATCH_UNKNOWN,
    );
    expect(out.findings[0].reconciliationState).toBe('REVIEW_REQUIRED');
    expect(out.findings[0].checkOutcome).toBe('INSUFFICIENT_LINKAGE');
  });

  it('valid one-hop successor emits SUCCESSOR / SUCCESSOR_OF and review finding', () => {
    const items = [
      item({
        obligationId: 'ex-1',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        determinationId: 'd1',
        originalPrincipal: toMoney(800),
        settledAmount: toMoney(300),
        remainingAmount: toMoney(500),
        flags: flags({ nonExecutable: true, reconciliationRequired: true }),
        reconciliationState: 'SUCCESSOR_REVIEW_REQUIRED',
      }),
      item({
        obligationId: 'ex-2',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        determinationId: 'd2',
        originalPrincipal: toMoney(500),
        remainingAmount: toMoney(500),
      }),
    ];
    const ctx: ReconciliationReadContext = {
      wkOrderId: 1,
      riderAdvances: [],
      returnDeterminations: [],
      restrictions: [],
      economicLosses: [
        {
          id: 'loss-1',
          lossKind: EconomicLossKind.GOODS_LOST,
          subjectRef: 'order-goods:1',
          currency: 'PHP',
          compensableAmount: toMoney(800),
        },
      ],
      coverages: [],
      liabilityDeterminations: [
        {
          id: 'd1',
          economicLossId: 'loss-1',
          status: LiabilityDeterminationStatus.FINALIZED,
          adjustmentOfDeterminationId: null,
          obligationIds: ['ex-1'],
        },
        {
          id: 'd2',
          economicLossId: 'loss-1',
          status: LiabilityDeterminationStatus.FINALIZED,
          adjustmentOfDeterminationId: 'd1',
          obligationIds: ['ex-2'],
        },
      ],
    };
    const out = detectSuccessorTopology(items, ctx);
    expect(out.findings.map((f) => f.code)).toEqual([
      RECONCILIATION_FINDING_CODES.SUCCESSOR_REVIEW_REQUIRED,
    ]);
    expect(
      out.relatedItems.some(
        (r) => r.relation === 'SUCCESSOR' && r.obligationId === 'ex-2',
      ),
    ).toBe(true);
    expect(
      out.relatedItems.some(
        (r) => r.relation === 'SUCCESSOR_OF' && r.obligationId === 'ex-1',
      ),
    ).toBe(true);
    expect(out.findings.some((f) => f.code === 'EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE')).toBe(
      false,
    );
  });

  it('successor branch is SOURCE_INCONSISTENCY', () => {
    const ctx: ReconciliationReadContext = {
      wkOrderId: 1,
      riderAdvances: [],
      returnDeterminations: [],
      restrictions: [],
      economicLosses: [],
      coverages: [],
      liabilityDeterminations: [
        {
          id: 'd1',
          economicLossId: 'loss-1',
          status: LiabilityDeterminationStatus.FINALIZED,
          adjustmentOfDeterminationId: null,
          obligationIds: ['ex-1'],
        },
        {
          id: 'd2',
          economicLossId: 'loss-1',
          status: LiabilityDeterminationStatus.FINALIZED,
          adjustmentOfDeterminationId: 'd1',
          obligationIds: ['ex-2'],
        },
        {
          id: 'd3',
          economicLossId: 'loss-1',
          status: LiabilityDeterminationStatus.FINALIZED,
          adjustmentOfDeterminationId: 'd1',
          obligationIds: ['ex-3'],
        },
      ],
    };
    const items = [
      item({
        obligationId: 'ex-1',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        determinationId: 'd1',
        remainingAmount: toMoney(0),
        flags: flags({ nonExecutable: true }),
      }),
      item({
        obligationId: 'ex-2',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        determinationId: 'd2',
        remainingAmount: toMoney(100),
      }),
      item({
        obligationId: 'ex-3',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        determinationId: 'd3',
        remainingAmount: toMoney(100),
      }),
    ];
    const out = detectSuccessorTopology(items, ctx);
    expect(out.findings.map((f) => f.code)).toContain(
      RECONCILIATION_FINDING_CODES.SUCCESSOR_BRANCH_DETECTED,
    );
  });

  it('successor cycle terminates within cap', () => {
    const ctx: ReconciliationReadContext = {
      wkOrderId: 1,
      riderAdvances: [],
      returnDeterminations: [],
      restrictions: [],
      economicLosses: [],
      coverages: [],
      liabilityDeterminations: [
        {
          id: 'd1',
          economicLossId: 'loss-1',
          status: LiabilityDeterminationStatus.FINALIZED,
          adjustmentOfDeterminationId: 'd2',
          obligationIds: ['ex-1'],
        },
        {
          id: 'd2',
          economicLossId: 'loss-1',
          status: LiabilityDeterminationStatus.FINALIZED,
          adjustmentOfDeterminationId: 'd1',
          obligationIds: ['ex-2'],
        },
      ],
    };
    const items = [
      item({
        obligationId: 'ex-1',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        determinationId: 'd1',
        remainingAmount: toMoney(1),
      }),
      item({
        obligationId: 'ex-2',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        determinationId: 'd2',
        remainingAmount: toMoney(1),
      }),
    ];
    const out = detectSuccessorTopology(items, ctx);
    expect(SUCCESSOR_TRAVERSAL_CAP).toBe(32);
    expect(out.findings.map((f) => f.code)).toContain(
      RECONCILIATION_FINDING_CODES.SUCCESSOR_CYCLE_DETECTED,
    );
  });

  it('two active non-successor obligations on same loss overlap', () => {
    const items = [
      item({
        obligationId: 'ex-1',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        determinationId: 'd1',
        remainingAmount: toMoney(200),
      }),
      item({
        obligationId: 'ex-2',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        determinationId: 'd2',
        remainingAmount: toMoney(200),
      }),
    ];
    const ctx: ReconciliationReadContext = {
      wkOrderId: 1,
      riderAdvances: [],
      returnDeterminations: [],
      restrictions: [],
      economicLosses: [
        {
          id: 'loss-1',
          lossKind: EconomicLossKind.GOODS_LOST,
          subjectRef: 'order-goods:1',
          currency: 'PHP',
          compensableAmount: toMoney(800),
        },
      ],
      coverages: [],
      liabilityDeterminations: [
        {
          id: 'd1',
          economicLossId: 'loss-1',
          status: LiabilityDeterminationStatus.FINALIZED,
          adjustmentOfDeterminationId: null,
          obligationIds: ['ex-1'],
        },
        {
          id: 'd2',
          economicLossId: 'loss-1',
          status: LiabilityDeterminationStatus.FINALIZED,
          adjustmentOfDeterminationId: null,
          obligationIds: ['ex-2'],
        },
      ],
    };
    const out = detectSuccessorTopology(items, ctx);
    expect(out.findings.map((f) => f.code)).toEqual([
      RECONCILIATION_FINDING_CODES.EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE,
    ]);
    expect(out.findings[0].reconciliationState).toBe('OVERLAP_REVIEW_REQUIRED');
  });

  it('chain D1→D2→D3 does not net remaining amounts', () => {
    const items = [
      item({
        obligationId: 'ex-1',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        determinationId: 'd1',
        originalPrincipal: toMoney(800),
        settledAmount: toMoney(300),
        remainingAmount: toMoney(500),
        flags: flags({ nonExecutable: true }),
      }),
      item({
        obligationId: 'ex-2',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        determinationId: 'd2',
        originalPrincipal: toMoney(500),
        remainingAmount: toMoney(500),
        flags: flags({ nonExecutable: true }),
      }),
      item({
        obligationId: 'ex-3',
        rail: RAIL_EXCEPTION_FINANCIAL,
        economicLossId: 'loss-1',
        determinationId: 'd3',
        originalPrincipal: toMoney(500),
        remainingAmount: toMoney(500),
      }),
    ];
    const ctx: ReconciliationReadContext = {
      wkOrderId: 1,
      riderAdvances: [],
      returnDeterminations: [],
      restrictions: [],
      economicLosses: [],
      coverages: [],
      liabilityDeterminations: [
        {
          id: 'd1',
          economicLossId: 'loss-1',
          status: LiabilityDeterminationStatus.FINALIZED,
          adjustmentOfDeterminationId: null,
          obligationIds: ['ex-1'],
        },
        {
          id: 'd2',
          economicLossId: 'loss-1',
          status: LiabilityDeterminationStatus.FINALIZED,
          adjustmentOfDeterminationId: 'd1',
          obligationIds: ['ex-2'],
        },
        {
          id: 'd3',
          economicLossId: 'loss-1',
          status: LiabilityDeterminationStatus.FINALIZED,
          adjustmentOfDeterminationId: 'd2',
          obligationIds: ['ex-3'],
        },
      ],
    };
    const out = detectSuccessorTopology(items, ctx);
    expect(items[0].remainingAmount.toFixed(2)).toBe('500.00');
    expect(items[1].remainingAmount.toFixed(2)).toBe('500.00');
    expect(out.findings.filter((f) => f.code === 'SUCCESSOR_REVIEW_REQUIRED')).toHaveLength(
      2,
    );
    expect(out.findings.some((f) => f.code === 'EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE')).toBe(
      false,
    );
  });
});
