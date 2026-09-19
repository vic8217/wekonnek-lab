/**
 * Stage13B-3A HTTP policy / DTO unit tests.
 * Synthetic frozen items — no database, no HTTP server.
 */
import { UserRole } from '@prisma/client';
import { composeOrderFinancialReconciliation, toMoney } from './financial-reconciliation.policy';
import {
  actorIsReconciliationAdmin,
  itemVisibleToActor,
  projectObligation,
  projectOrderReconciliation,
  ReconciliationHttpActor,
  serializeMoney,
} from './financial-reconciliation.http-policy';
import {
  FinancialReconciliationItem,
  RAIL_EXCEPTION_FINANCIAL,
  RAIL_RETURN_FINANCIAL,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
  RECONCILIATION_FINDING_CODES,
} from './financial-reconciliation.types';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function actor(
  partial: Partial<ReconciliationHttpActor> & { userId: string; role: UserRole },
): ReconciliationHttpActor {
  return {
    ownedMerchantIds: [],
    ...partial,
  };
}

function item(
  partial: Partial<FinancialReconciliationItem> & { obligationId: string },
): FinancialReconciliationItem {
  return {
    rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
    wkOrderId: 42,
    debtor: { type: 'CUSTOMER', userId: 'cust', merchantId: null },
    creditor: { type: 'RIDER', userId: 'rider-a', merchantId: null },
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
      settlementIds: ['settle-hidden'],
      acknowledgedSettlementIds: ['ack-hidden'],
      coverageIds: ['cov-hidden'],
      successorDeterminationId: 'succ-hidden',
    },
    createdAt: NOW,
    relatedItems: [],
    ...partial,
  };
}

const ra = item({
  obligationId: 'ra-1',
  rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
  originalPrincipal: toMoney('0.10'),
  settledAmount: toMoney('0.00'),
  remainingAmount: toMoney('0.10'),
  riderAdvanceId: 'ra-1',
  sourceId: 'ra-src',
  lastFinancialActivityAt: NOW,
});

const m2r = item({
  obligationId: 'ret-m2r',
  rail: RAIL_RETURN_FINANCIAL,
  debtor: { type: 'MERCHANT', userId: null, merchantId: 7 },
  creditor: { type: 'RIDER', userId: 'rider-a', merchantId: null },
  originalPrincipal: toMoney('100.00'),
  settledAmount: toMoney('0.00'),
  remainingAmount: toMoney('100.00'),
  sourceType: 'RETURN_FINANCIAL_OBLIGATION',
  sourceId: 'ret-m2r-src',
  determinationId: 'det-1',
  returnFinancialDeterminationId: 'det-1',
  relatedItems: [
    {
      rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
      obligationId: 'ra-1',
      relation: 'COLLECTION_TRANSFERRED_TO_RETURN',
      fromRail: RAIL_RETURN_FINANCIAL,
      fromObligationId: 'ret-m2r',
    },
  ],
});

const m2c = item({
  obligationId: 'ret-m2c',
  rail: RAIL_RETURN_FINANCIAL,
  debtor: { type: 'MERCHANT', userId: null, merchantId: 7 },
  creditor: { type: 'CUSTOMER', userId: 'cust', merchantId: null },
  originalPrincipal: toMoney('1234.56'),
  settledAmount: toMoney('0.00'),
  remainingAmount: toMoney('1234.56'),
  sourceType: 'RETURN_FINANCIAL_OBLIGATION',
  sourceId: 'ret-m2c-src',
  flags: {
    disputed: true,
    nonExecutable: false,
    collectionRestricted: false,
    reconciliationRequired: true,
  },
  reconciliationState: 'REVIEW_REQUIRED',
});

const siblingRa = item({
  obligationId: 'ra-2',
  rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
  originalPrincipal: toMoney('50.00'),
  settledAmount: toMoney('0.00'),
  remainingAmount: toMoney('50.00'),
  riderAdvanceId: 'ra-2',
});

const exception = item({
  obligationId: 'ex-1',
  rail: RAIL_EXCEPTION_FINANCIAL,
  debtor: { type: 'CUSTOMER', userId: 'other-cust', merchantId: null },
  creditor: { type: 'MERCHANT', userId: null, merchantId: 7 },
  originalPrincipal: toMoney('800.00'),
  settledAmount: toMoney('0.00'),
  remainingAmount: toMoney('800.00'),
  sourceType: 'EXCEPTION_FINANCIAL_OBLIGATION',
  sourceId: 'ex-src',
  economicLossId: 'loss-1',
  determinationId: 'ex-det',
});

const spanningFinding = {
  findingKey: 'RA_RETURN_RESTRICTION_MISSING:EXCEPTION_FINANCIAL:ex-1,RIDER_ADVANCE_REIMBURSEMENT:ra-1:',
  code: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
  reconciliationState: 'REVIEW_REQUIRED' as const,
  wkOrderId: 42,
  checkOutcome: 'FAILED' as const,
  involvedItems: [
    { rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT, obligationId: 'ra-1' },
    { rail: RAIL_EXCEPTION_FINANCIAL, obligationId: 'ex-1' },
  ],
  explanationCode: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
  evidenceRefs: ['evidence-secret', 'det-hidden'],
};

const relatedHidden = {
  rail: RAIL_EXCEPTION_FINANCIAL,
  obligationId: 'ex-1',
  relation: 'POTENTIAL_OVERLAP' as const,
  fromRail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
  fromObligationId: 'ra-1',
};

function fullView() {
  return composeOrderFinancialReconciliation({
    wkOrderId: 42,
    items: [ra, siblingRa, m2r, m2c, exception],
    findings: [spanningFinding],
    relatedItems: [relatedHidden, ...(m2r.relatedItems ?? [])],
  });
}

const customer = actor({ userId: 'cust', role: UserRole.customer });
const riderA = actor({ userId: 'rider-a', role: UserRole.rider });
const riderB = actor({ userId: 'rider-b', role: UserRole.rider });
const merchantOwner = actor({
  userId: 'merchant-owner',
  role: UserRole.merchant,
  ownedMerchantIds: [7],
});
const cashier = actor({
  userId: 'cashier',
  role: UserRole.merchant,
  ownedMerchantIds: [],
});
const staff = actor({ userId: 'staff-1', role: UserRole.staff });
const coordinator = actor({ userId: 'coord-1', role: UserRole.coordinator });
const crew = actor({
  userId: 'crew-1',
  role: UserRole.staff,
  ownedMerchantIds: [],
  portal: 'shop',
});
const admin = actor({ userId: 'admin-1', role: UserRole.admin });
const shopAdmin = actor({
  userId: 'admin-1',
  role: UserRole.admin,
  portal: 'shop',
});

describe('Stage13B-3A financial-reconciliation HTTP policy', () => {
  it('serializes money as exact decimal strings', () => {
    expect(serializeMoney('0.10')).toBe('0.10');
    expect(serializeMoney('100.00')).toBe('100.00');
    expect(serializeMoney('1234.56')).toBe('1234.56');
    expect(serializeMoney(toMoney('0.1'))).toBe('0.10');
    const projected = projectOrderReconciliation(fullView(), customer);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    const raDto = projected.body.items.find((i) => i.obligationId === 'ra-1');
    const m2cDto = projected.body.items.find((i) => i.obligationId === 'ret-m2c');
    expect(raDto?.originalPrincipal).toBe('0.10');
    expect(m2cDto?.originalPrincipal).toBe('1234.56');
    expect(typeof raDto?.originalPrincipal).toBe('string');
    expect(typeof m2cDto?.remainingAmount).toBe('string');
  });

  it('treats only UserRole.admin as reconciliation administrator', () => {
    expect(actorIsReconciliationAdmin(admin)).toBe(true);
    expect(actorIsReconciliationAdmin(staff)).toBe(false);
    expect(actorIsReconciliationAdmin(coordinator)).toBe(false);
    expect(actorIsReconciliationAdmin(shopAdmin)).toBe(false);
    expect(actorIsReconciliationAdmin(merchantOwner)).toBe(false);
  });

  it('authorizes customer, rider frozen party, and merchant owner only', () => {
    expect(itemVisibleToActor(ra, customer)).toBe(true);
    expect(itemVisibleToActor(ra, riderA)).toBe(true);
    expect(itemVisibleToActor(ra, merchantOwner)).toBe(false);
    expect(itemVisibleToActor(ra, riderB)).toBe(false);
    expect(itemVisibleToActor(m2r, customer)).toBe(false);
    expect(itemVisibleToActor(m2r, merchantOwner)).toBe(true);
    expect(itemVisibleToActor(m2r, cashier)).toBe(false);
    expect(itemVisibleToActor(m2r, staff)).toBe(false);
    expect(itemVisibleToActor(m2r, crew)).toBe(false);
    expect(itemVisibleToActor(m2r, coordinator)).toBe(false);
    expect(itemVisibleToActor(m2r, admin)).toBe(true);
  });

  it('P2 customer does not see merchant→rider return unless customer is a party', () => {
    const projected = projectOrderReconciliation(fullView(), customer);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    const ids = projected.body.items.map((i) => i.obligationId).sort();
    expect(ids).toEqual(['ra-1', 'ra-2', 'ret-m2c']);
    expect(ids).not.toContain('ret-m2r');
    expect(ids).not.toContain('ex-1');
  });

  it('P3 merchant owner does not see customer→rider RA', () => {
    const projected = projectOrderReconciliation(fullView(), merchantOwner);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    const ids = projected.body.items.map((i) => i.obligationId).sort();
    expect(ids).toEqual(['ex-1', 'ret-m2c', 'ret-m2r']);
    expect(ids).not.toContain('ra-1');
    expect(ids).not.toContain('ra-2');
  });

  it('P4 omits a finding that spans a hidden item', () => {
    const projected = projectOrderReconciliation(fullView(), customer);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    expect(projected.body.items.some((i) => i.obligationId === 'ra-1')).toBe(
      true,
    );
    expect(projected.body.items.some((i) => i.obligationId === 'ex-1')).toBe(
      false,
    );
    expect(projected.body.findings).toEqual([]);
  });

  it('P5 omits a related-item edge that points at a hidden obligation', () => {
    const projected = projectOrderReconciliation(fullView(), customer);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    expect(projected.body.items.some((i) => i.obligationId === 'ra-1')).toBe(
      true,
    );
    expect(projected.body.items.some((i) => i.obligationId === 'ex-1')).toBe(
      false,
    );
    expect(projected.body.relatedItems).toEqual([]);
    const raDto = projected.body.items.find((i) => i.obligationId === 'ra-1');
    expect(raDto?.relatedItems ?? []).toEqual([]);
  });

  it('P6 recomputes directional groups from visible items only', () => {
    const projected = projectOrderReconciliation(fullView(), riderA);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    const raGroup = projected.body.directionalGroups.find(
      (g) => g.key.rail === RAIL_RIDER_ADVANCE_REIMBURSEMENT,
    );
    expect(raGroup?.itemIds.sort()).toEqual(['ra-1', 'ra-2']);
    const merchantProjected = projectOrderReconciliation(
      fullView(),
      merchantOwner,
    );
    expect(merchantProjected.status).toBe('ok');
    if (merchantProjected.status !== 'ok') return;
    const hiddenSiblingView = composeOrderFinancialReconciliation({
      wkOrderId: 42,
      items: [ra, siblingRa],
      findings: [],
      relatedItems: [],
    });
    const riderOnlyRa1 = actor({ userId: 'nobody', role: UserRole.customer });
    const none = projectOrderReconciliation(hiddenSiblingView, riderOnlyRa1);
    expect(none.status).toBe('forbidden');

    const customerRa = projectOrderReconciliation(hiddenSiblingView, customer);
    expect(customerRa.status).toBe('ok');
    if (customerRa.status !== 'ok') return;
    expect(customerRa.body.directionalGroups).toHaveLength(1);
    expect(customerRa.body.directionalGroups[0].itemIds.sort()).toEqual([
      'ra-1',
      'ra-2',
    ]);
    expect(customerRa.body.directionalGroups[0].originalPrincipal).toBe(
      '50.10',
    );
  });

  it('P6 participant group drops a hidden sibling from the same frozen group', () => {
    const onlyRa1Visible = composeOrderFinancialReconciliation({
      wkOrderId: 42,
      items: [ra, siblingRa],
      findings: [],
      relatedItems: [],
    });
    const riderAOnly = actor({
      userId: 'rider-a',
      role: UserRole.rider,
    });
    const projected = projectOrderReconciliation(onlyRa1Visible, riderAOnly);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    expect(projected.body.items.map((i) => i.obligationId).sort()).toEqual([
      'ra-1',
      'ra-2',
    ]);

    const foreignRiderOnSibling = item({
      ...siblingRa,
      creditor: { type: 'RIDER', userId: 'other-rider', merchantId: null },
      debtor: { type: 'CUSTOMER', userId: 'other-cust-2', merchantId: null },
    });
    const mixed = composeOrderFinancialReconciliation({
      wkOrderId: 42,
      items: [ra, foreignRiderOnSibling],
      findings: [],
      relatedItems: [],
    });
    const riderView = projectOrderReconciliation(mixed, riderA);
    expect(riderView.status).toBe('ok');
    if (riderView.status !== 'ok') return;
    expect(riderView.body.items.map((i) => i.obligationId)).toEqual(['ra-1']);
    expect(riderView.body.directionalGroups).toHaveLength(1);
    expect(riderView.body.directionalGroups[0].itemIds).toEqual(['ra-1']);
    expect(riderView.body.directionalGroups[0].originalPrincipal).toBe('0.10');
    const frozenIds = mixed.directionalGroups.flatMap((g) => g.itemIds).sort();
    expect(frozenIds).toEqual(['ra-1', 'ra-2']);
    expect(riderView.body.directionalGroups[0].itemIds).not.toContain('ra-2');
  });

  it('P7 hidden outstanding does not set participant hasOutstanding', () => {
    const settledVisible = item({
      obligationId: 'ra-settled',
      originalPrincipal: toMoney('10.00'),
      settledAmount: toMoney('10.00'),
      remainingAmount: toMoney('0.00'),
      financialState: 'SETTLED',
    });
    const hiddenOutstanding = item({
      obligationId: 'ex-hidden',
      rail: RAIL_EXCEPTION_FINANCIAL,
      debtor: { type: 'CUSTOMER', userId: 'other-cust', merchantId: null },
      creditor: { type: 'MERCHANT', userId: null, merchantId: 7 },
      remainingAmount: toMoney('800.00'),
      originalPrincipal: toMoney('800.00'),
    });
    const view = composeOrderFinancialReconciliation({
      wkOrderId: 42,
      items: [settledVisible, hiddenOutstanding],
      findings: [],
      relatedItems: [],
    });
    expect(view.hasOutstanding).toBe(true);
    const projected = projectOrderReconciliation(view, customer);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    expect(projected.body.hasOutstanding).toBe(false);
  });

  it('P8 hidden dispute does not set participant hasDispute', () => {
    const view = composeOrderFinancialReconciliation({
      wkOrderId: 42,
      items: [ra, m2c],
      findings: [],
      relatedItems: [],
    });
    expect(view.hasDispute).toBe(true);
    const projected = projectOrderReconciliation(view, riderA);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    expect(projected.body.items.map((i) => i.obligationId)).toEqual(['ra-1']);
    expect(projected.body.hasDispute).toBe(false);
  });

  it('P9 hidden finding does not set participant hasReconciliationIssue', () => {
    const view = fullView();
    expect(view.hasReconciliationIssue).toBe(true);
    const projected = projectOrderReconciliation(view, customer);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    expect(projected.body.findings).toEqual([]);
    expect(projected.body.hasReconciliationIssue).toBe(false);
  });

  it('P10 omits sourceRefs, evidenceRefs, and internal source topology from participants', () => {
    const projected = projectOrderReconciliation(fullView(), customer);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    const json = JSON.stringify(projected.body);
    expect(json).not.toContain('sourceRefs');
    expect(json).not.toContain('evidenceRefs');
    expect(json).not.toContain('settle-hidden');
    expect(json).not.toContain('ack-hidden');
    expect(json).not.toContain('cov-hidden');
    expect(json).not.toContain('succ-hidden');
    expect(json).not.toContain('evidence-secret');
    expect(json).not.toContain('ra-src');
    expect(json).not.toContain('"sourceId"');
    expect(json).not.toContain('"sourceType"');
    expect(json).not.toContain('"economicLossId"');
    expect(json).not.toContain('"determinationId"');
    expect(json).not.toContain('"riderAdvanceId"');
    expect(json).not.toContain('"returnFinancialDeterminationId"');
    for (const row of projected.body.items) {
      expect(row.sourceRefs).toBeUndefined();
      expect(row.sourceId).toBeUndefined();
      expect(row.sourceType).toBeUndefined();
    }
    expect(projected.body.findings.every((f) => f.evidenceRefs == null)).toBe(
      true,
    );
  });

  it('P12 coordinator / staff / cashier / shop crew / foreign rider are denied', () => {
    expect(projectOrderReconciliation(fullView(), coordinator).status).toBe(
      'forbidden',
    );
    expect(projectOrderReconciliation(fullView(), staff).status).toBe(
      'forbidden',
    );
    expect(projectOrderReconciliation(fullView(), cashier).status).toBe(
      'forbidden',
    );
    expect(projectOrderReconciliation(fullView(), crew).status).toBe(
      'forbidden',
    );
    expect(projectOrderReconciliation(fullView(), riderB).status).toBe(
      'forbidden',
    );
    expect(
      projectObligation(ra, coordinator).status,
    ).toBe('not_found');
    expect(projectObligation(ra, staff).status).toBe('not_found');
    expect(projectObligation(ra, riderB).status).toBe('not_found');
    expect(projectObligation(null, admin).status).toBe('not_found');
    expect(projectObligation(null, customer).status).toBe('not_found');
  });

  it('admin receives the complete projection including hidden topology', () => {
    const projected = projectOrderReconciliation(fullView(), admin);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    expect(projected.body.items).toHaveLength(5);
    expect(projected.body.findings).toHaveLength(1);
    expect(projected.body.findings[0].evidenceRefs).toEqual([
      'evidence-secret',
      'det-hidden',
    ]);
    expect(projected.body.hasReconciliationIssue).toBe(true);
    expect(projected.body.hasDispute).toBe(true);
    expect(projected.body.hasOutstanding).toBe(true);
    const raDto = projected.body.items.find((i) => i.obligationId === 'ra-1');
    expect(raDto?.sourceRefs?.settlementIds).toEqual(['settle-hidden']);
    expect(raDto?.sourceId).toBe('ra-src');
    expect(raDto?.riderAdvanceId).toBe('ra-1');
  });

  it('admin with an existing empty order receives an empty 200 projection', () => {
    const empty = composeOrderFinancialReconciliation({
      wkOrderId: 99,
      items: [],
      findings: [],
      relatedItems: [],
    });
    const projected = projectOrderReconciliation(empty, admin);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    expect(projected.body.items).toEqual([]);
    expect(projected.body.findings).toEqual([]);
    expect(projected.body.hasOutstanding).toBe(false);
  });

  it('finding spanning visible A + hidden B is omitted for the participant and kept for admin', () => {
    const projected = projectOrderReconciliation(fullView(), riderA);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    expect(projected.body.items.some((i) => i.obligationId === 'ra-1')).toBe(
      true,
    );
    expect(projected.body.items.some((i) => i.obligationId === 'ex-1')).toBe(
      false,
    );
    expect(projected.body.findings).toEqual([]);
    expect(projected.body.hasReconciliationIssue).toBe(false);
    const adminProjected = projectOrderReconciliation(fullView(), admin);
    expect(adminProjected.status).toBe('ok');
    if (adminProjected.status !== 'ok') return;
    expect(
      adminProjected.body.items.map((i) => i.obligationId).sort(),
    ).toEqual(['ex-1', 'ra-1', 'ra-2', 'ret-m2c', 'ret-m2r']);
    expect(adminProjected.body.findings).toHaveLength(1);
  });

  it('single-obligation participant redaction matches order redaction', () => {
    const projected = projectObligation(ra, customer);
    expect(projected.status).toBe('ok');
    if (projected.status !== 'ok') return;
    expect(projected.body.originalPrincipal).toBe('0.10');
    expect(projected.body.sourceRefs).toBeUndefined();
    expect(projected.body.sourceId).toBeUndefined();
    expect(JSON.stringify(projected.body)).not.toContain('settle-hidden');
  });
});
