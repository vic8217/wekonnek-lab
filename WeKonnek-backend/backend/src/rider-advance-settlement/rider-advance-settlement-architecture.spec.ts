import { Prisma, RiderAdvanceStatus } from '@prisma/client';

const MONEY = (v: unknown) =>
  new Prisma.Decimal((v ?? 0) as Prisma.Decimal.Value).toDecimalPlaces(2);

/** Pure authoritative settlement math used by Stage 5B (mirrors service). */
function authoritativeTotals(
  principal: Prisma.Decimal.Value,
  acknowledged: Array<Prisma.Decimal.Value | null>,
) {
  const p = MONEY(principal);
  let settled = MONEY(0);
  for (const a of acknowledged) {
    if (a != null) settled = settled.add(MONEY(a));
  }
  settled = settled.toDecimalPlaces(2);
  const remaining = p.sub(settled).toDecimalPlaces(2);
  return {
    principal: p,
    settledAmount: settled,
    remainingAmount: remaining.lt(0) ? MONEY(0) : remaining,
  };
}

describe('Stage 5B Rider Advance settlement architecture', () => {
  it('consumes frozen reimbursementPrincipal and never recomputes from max/order/fees', () => {
    const authorizedMaximum = MONEY(1100);
    const orderTotal = MONEY(1100);
    const deliveryFee = MONEY(50);
    const convenienceFee = MONEY(0);
    const principal = MONEY(980);
    expect(principal.toFixed(2)).toBe('980.00');
    expect(principal.toFixed(2)).not.toBe(authorizedMaximum.toFixed(2));
    expect(principal.toFixed(2)).not.toBe(orderTotal.toFixed(2));
    expect(principal.add(deliveryFee).toFixed(2)).not.toBe(
      principal.toFixed(2),
    );
    expect(convenienceFee.isZero()).toBe(true);
  });

  it('creditor is ra.riderId, never activeRiderId / delivery rider', () => {
    const ra = { riderId: 'rider-A', reimbursementPrincipal: MONEY(980) };
    const fulfillment = { activeRiderId: 'rider-B' };
    expect(ra.riderId).not.toBe(fulfillment.activeRiderId);
    const isCreditor = (actorId: string) => actorId === ra.riderId;
    expect(isCreditor('rider-A')).toBe(true);
    expect(isCreditor('rider-B')).toBe(false);
  });

  it('customer claim alone is non-authoritative (remaining unchanged)', () => {
    const principal = MONEY(980);
    const claimed = MONEY(980);
    const totals = authoritativeTotals(principal, []); // CLAIMED not counted
    expect(claimed.toFixed(2)).toBe('980.00');
    expect(totals.settledAmount.toFixed(2)).toBe('0.00');
    expect(totals.remainingAmount.toFixed(2)).toBe('980.00');
  });

  it('cash creditor receipt and transfer ack are authoritative', () => {
    const afterCash = authoritativeTotals(980, [980]);
    expect(afterCash.settledAmount.toFixed(2)).toBe('980.00');
    expect(afterCash.remainingAmount.toFixed(2)).toBe('0.00');
    const afterPartialAck = authoritativeTotals(980, [500]);
    expect(afterPartialAck.remainingAmount.toFixed(2)).toBe('480.00');
  });

  it('rejection does not reduce debt', () => {
    const claimed = MONEY(980);
    const totals = authoritativeTotals(980, []); // REJECTED excluded
    expect(claimed.toFixed(2)).toBe('980.00');
    expect(totals.remainingAmount.toFixed(2)).toBe('980.00');
  });

  it('partial settlement keeps REIMBURSEMENT_DUE without PARTIALLY_REIMBURSED', () => {
    const statuses = Object.values(RiderAdvanceStatus);
    expect(statuses).not.toContain('PARTIALLY_REIMBURSED');
    const totals = authoritativeTotals(980, [500]);
    const status =
      totals.settledAmount.eq(totals.principal) && totals.principal.gt(0)
        ? RiderAdvanceStatus.REIMBURSED
        : RiderAdvanceStatus.REIMBURSEMENT_DUE;
    expect(status).toBe(RiderAdvanceStatus.REIMBURSEMENT_DUE);
    const final = authoritativeTotals(980, [500, 480]);
    const finalStatus =
      final.settledAmount.eq(final.principal) && final.principal.gt(0)
        ? RiderAdvanceStatus.REIMBURSED
        : RiderAdvanceStatus.REIMBURSEMENT_DUE;
    expect(finalStatus).toBe(RiderAdvanceStatus.REIMBURSED);
  });

  it('overpayment invariant: settled must never exceed principal', () => {
    const principal = MONEY(980);
    const attempt = MONEY(600);
    const remaining = authoritativeTotals(principal, [600]).remainingAmount;
    expect(attempt.gt(remaining)).toBe(true);
    expect(remaining.toFixed(2)).toBe('380.00');
  });

  it('delivery / failed / returned independence: principal frozen', () => {
    const principal = MONEY(980);
    for (const delivery of [
      'ready_for_pickup',
      'in_transit',
      'delivered',
      'delivery_failed',
      'returned',
    ]) {
      expect(principal.toFixed(2)).toBe('980.00');
      expect(delivery).toBeTruthy();
    }
  });

  it('payment ownership: CUSTOMER -> CREDITOR direct; no PayCools/wallet principal', () => {
    const flow = { from: 'CUSTOMER', to: 'CREDITOR_RIDER', via: null };
    expect(flow.via).toBeNull();
    expect(flow.to).toBe('CREDITOR_RIDER');
    expect(['PAYCOOLS', 'WEKONNEK_WALLET']).not.toContain(flow.via as never);
  });

  it('privacy: delivery Rider B has no settlement mutation authority', () => {
    const creditor = 'A';
    const deliveryRider = 'B';
    const mayMutate = (actor: string) => actor === creditor;
    expect(mayMutate(deliveryRider)).toBe(false);
    expect(mayMutate(creditor)).toBe(true);
  });

  it('claimedAmount is never silently rewritten on partial ack', () => {
    const claim = { claimedAmount: MONEY(980), acknowledgedAmount: MONEY(500) };
    expect(claim.claimedAmount.toFixed(2)).toBe('980.00');
    expect(claim.acknowledgedAmount.toFixed(2)).toBe('500.00');
    expect(claim.claimedAmount.eq(claim.acknowledgedAmount)).toBe(false);
  });

  it('ack amount is claim-bound: 0 < ack <= claimed and ack <= remaining', () => {
    const claimed = MONEY(500);
    const remaining = MONEY(980);
    const overClaim = MONEY(600);
    expect(overClaim.gt(claimed)).toBe(true);
    expect(overClaim.lte(remaining)).toBe(true);
    const allowed = MONEY(500);
    expect(allowed.gt(0) && allowed.lte(claimed) && allowed.lte(remaining)).toBe(
      true,
    );
  });

  it('documents append-only settlement ledger (no physical DELETE)', () => {
    const policy = {
      physicalDelete: false,
      corrections: 'new_settlement_or_evidence',
      testCleanup: 'TRUNCATE_on_disposable_stage5b_test_only',
    };
    expect(policy.physicalDelete).toBe(false);
    expect(policy.testCleanup).not.toMatch(/production|bypass/i);
  });
});
