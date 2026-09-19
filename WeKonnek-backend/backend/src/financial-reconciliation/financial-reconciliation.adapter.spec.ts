import { Prisma, RiderAdvanceStatus } from '@prisma/client';
import { buildExceptionFinancialItem } from './exception-financial.adapter';
import { toMoney } from './financial-reconciliation.policy';
import { buildReturnFinancialItem } from './return-financial.adapter';
import {
  buildRiderAdvanceReimbursementItem,
  isExecutableRiderAdvance,
} from './rider-advance-reimbursement.adapter';

const now = new Date('2026-09-01T00:00:00Z');

describe('Stage13B-1 read adapters (unit)', () => {
  it('CASE A — Rider Advance P800 ACK300 remaining 500 collectible 500', () => {
    const item = buildRiderAdvanceReimbursementItem({
      id: 'ra-a',
      wkOrderId: 1,
      customerId: 'cust',
      riderId: 'rider-a',
      reimbursementPrincipal: toMoney(800),
      currency: 'PHP',
      status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
      disputeReason: null,
      createdAt: now,
      settlements: [
        {
          id: 's1',
          status: 'ACKNOWLEDGED',
          acknowledgedAmount: toMoney(300),
          acknowledgedAt: now,
          createdAt: now,
        },
      ],
      collectionRestrictions: [],
    });
    expect(item).not.toBeNull();
    expect(item!.rail).toBe('RIDER_ADVANCE_REIMBURSEMENT');
    expect(item!.originalPrincipal.toFixed(2)).toBe('800.00');
    expect(item!.settledAmount.toFixed(2)).toBe('300.00');
    expect(item!.remainingAmount.toFixed(2)).toBe('500.00');
    expect(item!.collectibleRemaining?.toFixed(2)).toBe('500.00');
    expect(item!.creditor).toEqual({
      type: 'RIDER',
      userId: 'rider-a',
      merchantId: null,
    });
    expect(item!.financialState).toBe('PARTIALLY_SETTLED');
  });

  it('CASE B overlay — restriction 500 leaves remaining 500 collectible 0', () => {
    const item = buildRiderAdvanceReimbursementItem({
      id: 'ra-b',
      wkOrderId: 1,
      customerId: 'cust',
      riderId: 'rider-a',
      reimbursementPrincipal: toMoney(800),
      currency: 'PHP',
      status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
      disputeReason: null,
      createdAt: now,
      settlements: [
        {
          id: 's1',
          status: 'ACKNOWLEDGED',
          acknowledgedAmount: toMoney(300),
          acknowledgedAt: now,
          createdAt: now,
        },
      ],
      collectionRestrictions: [
        {
          id: 'r1',
          status: 'ACTIVE',
          restrictedAmount: toMoney(500),
        },
      ],
    });
    expect(item!.remainingAmount.toFixed(2)).toBe('500.00');
    expect(item!.settledAmount.toFixed(2)).toBe('300.00');
    expect(item!.collectibleRemaining?.toFixed(2)).toBe('0.00');
    expect(item!.flags.collectionRestricted).toBe(true);
  });

  it('restriction firewall — SUPERSEDED restriction does not reduce collectible', () => {
    const item = buildRiderAdvanceReimbursementItem({
      id: 'ra-s',
      wkOrderId: 1,
      customerId: 'cust',
      riderId: 'rider-a',
      reimbursementPrincipal: toMoney(800),
      currency: 'PHP',
      status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
      disputeReason: null,
      createdAt: now,
      settlements: [],
      collectionRestrictions: [
        { id: 'old', status: 'SUPERSEDED', restrictedAmount: toMoney(800) },
      ],
    });
    expect(item!.remainingAmount.toFixed(2)).toBe('800.00');
    expect(item!.collectibleRemaining?.toFixed(2)).toBe('800.00');
    expect(item!.flags.collectionRestricted).toBe(false);
  });

  it('omits CANCELLED and null-principal RiderAdvance rows', () => {
    expect(
      isExecutableRiderAdvance({
        reimbursementPrincipal: toMoney(800),
        status: RiderAdvanceStatus.CANCELLED,
      }),
    ).toBe(false);
    expect(
      isExecutableRiderAdvance({
        reimbursementPrincipal: null,
        status: RiderAdvanceStatus.PROPOSED,
      }),
    ).toBe(false);
    expect(
      buildRiderAdvanceReimbursementItem({
        id: 'cancelled',
        wkOrderId: 1,
        customerId: 'c',
        riderId: 'a',
        reimbursementPrincipal: toMoney(800),
        currency: 'PHP',
        status: RiderAdvanceStatus.CANCELLED,
        disputeReason: null,
        createdAt: now,
        settlements: [],
        collectionRestrictions: [],
      }),
    ).toBeNull();
  });

  it('never collapses two RiderAdvance principals into one obligation', () => {
    const a = buildRiderAdvanceReimbursementItem({
      id: 'ra-old',
      wkOrderId: 1,
      customerId: 'c',
      riderId: 'a',
      reimbursementPrincipal: toMoney(800),
      currency: 'PHP',
      status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
      disputeReason: null,
      createdAt: now,
      settlements: [],
      collectionRestrictions: [],
    });
    const b = buildRiderAdvanceReimbursementItem({
      id: 'ra-new',
      wkOrderId: 1,
      customerId: 'c',
      riderId: 'a',
      reimbursementPrincipal: toMoney(200),
      currency: 'PHP',
      status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
      disputeReason: null,
      createdAt: now,
      settlements: [],
      collectionRestrictions: [],
    });
    expect(a!.obligationId).toBe('ra-old');
    expect(b!.obligationId).toBe('ra-new');
    expect(a!.originalPrincipal.toFixed(2)).toBe('800.00');
    expect(b!.originalPrincipal.toFixed(2)).toBe('200.00');
  });

  it('CASE F — financial creditor remains Rider A when fulfillment rider is B', () => {
    const item = buildRiderAdvanceReimbursementItem({
      id: 'ra-f',
      wkOrderId: 1,
      customerId: 'c',
      riderId: 'rider-a',
      reimbursementPrincipal: toMoney(800),
      currency: 'PHP',
      status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
      disputeReason: null,
      createdAt: now,
      settlements: [],
      collectionRestrictions: [],
    });
    const fulfillment = {
      activeRiderId: 'rider-b',
      physicalCustodianRiderId: 'rider-b',
    };
    expect(item!.creditor.userId).toBe('rider-a');
    expect(item!.creditor.userId).not.toBe(fulfillment.activeRiderId);
    expect(item!.creditor.userId).not.toBe(fulfillment.physicalCustodianRiderId);
  });

  it('Stage9 remaining does not re-subtract Stage5B ACK', () => {
    const m2r = buildReturnFinancialItem(
      {
        id: 'rfo-r',
        determinationId: 'det',
        wkOrderId: 1,
        merchantId: 9,
        type: 'MERCHANT_TO_RIDER_ADVANCE_REPAYMENT',
        debtorType: 'MERCHANT',
        debtorUserId: null,
        debtorMerchantId: 9,
        creditorType: 'RIDER',
        creditorUserId: 'rider-a',
        principal: toMoney(500),
        currency: 'PHP',
        reason: 'Stage 9 P−R merchant→rider repayment',
        createdAt: now,
        settlements: [],
      },
      'ra-b',
    );
    const m2c = buildReturnFinancialItem(
      {
        id: 'rfo-c',
        determinationId: 'det',
        wkOrderId: 1,
        merchantId: 9,
        type: 'MERCHANT_TO_CUSTOMER_REFUND',
        debtorType: 'MERCHANT',
        debtorUserId: null,
        debtorMerchantId: 9,
        creditorType: 'CUSTOMER',
        creditorUserId: 'cust',
        principal: toMoney(300),
        currency: 'PHP',
        reason: 'Stage 9 R merchant→customer refund',
        createdAt: now,
        settlements: [],
      },
      'ra-b',
    );
    expect(m2r.originalPrincipal.toFixed(2)).toBe('500.00');
    expect(m2r.remainingAmount.toFixed(2)).toBe('500.00');
    expect(m2c.originalPrincipal.toFixed(2)).toBe('300.00');
    expect(m2c.remainingAmount.toFixed(2)).toBe('300.00');
    expect(m2r.obligationId).not.toBe(m2c.obligationId);
    const merchantOneParty = toMoney(m2r.originalPrincipal).add(
      m2c.originalPrincipal,
    );
    expect(merchantOneParty.toFixed(2)).toBe('800.00');
    expect(m2r.creditor.userId).toBe('rider-a');
  });

  it('CASE C — exception ACK 300 remaining 500; coverage does not reduce remaining', () => {
    const item = buildExceptionFinancialItem(
      {
        id: 'efo',
        liabilityDeterminationId: 'det',
        exceptionClaimId: 'claim',
        economicLossId: 'loss',
        wkOrderId: 1,
        debtorType: 'RIDER',
        debtorUserId: 'rider-a',
        debtorMerchantId: null,
        creditorType: 'MERCHANT',
        creditorUserId: null,
        creditorMerchantId: 9,
        principal: toMoney(800),
        currency: 'PHP',
        status: 'OPEN',
        reason: 'loss',
        createdAt: now,
        settlements: [
          {
            id: 'ack',
            status: 'ACKNOWLEDGED',
            acknowledgedAmount: toMoney(300),
            acknowledgedAt: now,
            createdAt: now,
          },
        ],
      },
      { successorDeterminationId: null, successorObligationIds: [] },
      ['coverage-800'],
    );
    expect(item.originalPrincipal.toFixed(2)).toBe('800.00');
    expect(item.settledAmount.toFixed(2)).toBe('300.00');
    expect(item.remainingAmount.toFixed(2)).toBe('500.00');
    expect(item.financialState).toBe('PARTIALLY_SETTLED');
    expect(item.sourceRefs.coverageIds).toEqual(['coverage-800']);
  });

  it('CASE D — successor preserves historical ACK and flags original', () => {
    const original = buildExceptionFinancialItem(
      {
        id: 'efo-orig',
        liabilityDeterminationId: 'det-orig',
        exceptionClaimId: 'claim',
        economicLossId: 'loss',
        wkOrderId: 1,
        debtorType: 'RIDER',
        debtorUserId: 'rider-a',
        debtorMerchantId: null,
        creditorType: 'MERCHANT',
        creditorUserId: null,
        creditorMerchantId: 9,
        principal: toMoney(800),
        currency: 'PHP',
        status: 'PARTIALLY_SETTLED',
        reason: 'original',
        createdAt: now,
        settlements: [
          {
            id: 'ack300',
            status: 'ACKNOWLEDGED',
            acknowledgedAmount: toMoney(300),
            acknowledgedAt: now,
            createdAt: now,
          },
        ],
      },
      {
        successorDeterminationId: 'det-succ',
        successorObligationIds: ['efo-succ'],
      },
      [],
    );
    const successor = buildExceptionFinancialItem(
      {
        id: 'efo-succ',
        liabilityDeterminationId: 'det-succ',
        exceptionClaimId: 'claim',
        economicLossId: 'loss',
        wkOrderId: 1,
        debtorType: 'RIDER',
        debtorUserId: 'rider-a',
        debtorMerchantId: null,
        creditorType: 'MERCHANT',
        creditorUserId: null,
        creditorMerchantId: 9,
        principal: toMoney(500),
        currency: 'PHP',
        status: 'OPEN',
        reason: 'successor',
        createdAt: now,
        settlements: [],
      },
      { successorDeterminationId: null, successorObligationIds: [] },
      [],
    );
    expect(original.originalPrincipal.toFixed(2)).toBe('800.00');
    expect(original.settledAmount.toFixed(2)).toBe('300.00');
    expect(original.remainingAmount.toFixed(2)).toBe('500.00');
    expect(original.flags.nonExecutable).toBe(true);
    expect(original.flags.reconciliationRequired).toBe(true);
    expect(original.reconciliationState).toBe('SUCCESSOR_REVIEW_REQUIRED');
    expect(successor.settledAmount.toFixed(2)).toBe('0.00');
    expect(successor.originalPrincipal.toFixed(2)).toBe('500.00');
    expect(successor.flags.nonExecutable).toBe(false);
  });

  it('CASE E — merchant liability 250 ACK 250 SETTLED remaining 0', () => {
    const item = buildExceptionFinancialItem(
      {
        id: 'efo-e',
        liabilityDeterminationId: 'det',
        exceptionClaimId: 'claim',
        economicLossId: 'loss',
        wkOrderId: 1,
        debtorType: 'MERCHANT',
        debtorUserId: null,
        debtorMerchantId: 9,
        creditorType: 'CUSTOMER',
        creditorUserId: 'cust',
        creditorMerchantId: null,
        principal: toMoney(250),
        currency: 'PHP',
        status: 'SETTLED',
        reason: 'wrong item',
        createdAt: now,
        settlements: [
          {
            id: 'ack',
            status: 'ACKNOWLEDGED',
            acknowledgedAmount: toMoney(250),
            acknowledgedAt: now,
            createdAt: now,
          },
        ],
      },
      { successorDeterminationId: null, successorObligationIds: [] },
      [],
    );
    expect(item.financialState).toBe('SETTLED');
    expect(item.remainingAmount.toFixed(2)).toBe('0.00');
    expect(item.debtor).toEqual({
      type: 'MERCHANT',
      userId: null,
      merchantId: 9,
    });
  });

  it('CASE F exception — debtor remains Rider A despite custodian B', () => {
    const item = buildExceptionFinancialItem(
      {
        id: 'efo-f',
        liabilityDeterminationId: 'det',
        exceptionClaimId: 'claim',
        economicLossId: 'loss',
        wkOrderId: 1,
        debtorType: 'RIDER',
        debtorUserId: 'rider-a',
        debtorMerchantId: null,
        creditorType: 'MERCHANT',
        creditorUserId: null,
        creditorMerchantId: 9,
        principal: toMoney(800),
        currency: 'PHP',
        status: 'OPEN',
        reason: 'lost goods',
        createdAt: now,
        settlements: [],
      },
      { successorDeterminationId: null, successorObligationIds: [] },
      [],
    );
    expect(item.debtor.userId).toBe('rider-a');
    expect(item.debtor.userId).not.toBe('rider-b');
  });

  it('decimal remaining 800.10 − 300.05 = 500.05', () => {
    const item = buildRiderAdvanceReimbursementItem({
      id: 'ra-dec',
      wkOrderId: 1,
      customerId: 'c',
      riderId: 'a',
      reimbursementPrincipal: toMoney('800.10'),
      currency: 'PHP',
      status: RiderAdvanceStatus.REIMBURSEMENT_DUE,
      disputeReason: null,
      createdAt: now,
      settlements: [
        {
          id: 's',
          status: 'ACKNOWLEDGED',
          acknowledgedAmount: toMoney('300.05'),
          acknowledgedAt: now,
          createdAt: now,
        },
      ],
      collectionRestrictions: [],
    });
    expect(item!.remainingAmount.toFixed(2)).toBe('500.05');
    expect(item!.remainingAmount).toBeInstanceOf(Prisma.Decimal);
  });
});
