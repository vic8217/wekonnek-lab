/**
 * Stage 12 Exception Financial Liability & Claims — centralized policy.
 *
 * Frozen parent is Stage 11. Nothing here may change Stage 9 / 5B / 7 / 11
 * financial or custody behavior; Stage 12 only *defers* to Stage 9 through the
 * gate helpers below.
 */
import {
  EconomicLossCoverageSourceKind,
  EconomicLossKind,
  ExceptionClaimStatus,
  ExceptionClaimType,
  ExceptionLiablePartyType,
  FulfillmentStatus,
  GoodsNonConformanceReasonCode,
  LiabilityDeterminationStatus,
  Prisma,
  ReturnFinancialDeterminationStatus,
  ReturnFinancialObligationType,
  VerifiedFactType,
} from '@prisma/client';
import { createHash } from 'crypto';

export const EXCEPTION_FINANCIAL_CURRENCY = 'PHP';

/** Non-terminal claim statuses (one active claim per EconomicLoss). */
export const EXCEPTION_CLAIM_ACTIVE_STATUSES: ExceptionClaimStatus[] = [
  ExceptionClaimStatus.OPEN,
  ExceptionClaimStatus.EVIDENCE_REVIEW,
  ExceptionClaimStatus.VERIFIED,
  ExceptionClaimStatus.DETERMINATION_PROPOSED,
];

export const EXCEPTION_CLAIM_TERMINAL_STATUSES: ExceptionClaimStatus[] = [
  ExceptionClaimStatus.FINALIZED,
  ExceptionClaimStatus.REJECTED,
  ExceptionClaimStatus.WITHDRAWN,
  ExceptionClaimStatus.CANCELLED,
];

export const LIABILITY_DETERMINATION_ACTIVE_STATUSES: LiabilityDeterminationStatus[] =
  [LiabilityDeterminationStatus.DRAFT, LiabilityDeterminationStatus.PROPOSED];

/**
 * Stage 9 statuses that must block a Stage 12 finalize. If Stage 9 money is
 * still being decided, Stage 12 cannot recover the same subject first.
 */
export const STAGE9_BLOCKING_DETERMINATION_STATUSES: ReturnFinancialDeterminationStatus[] =
  [
    ReturnFinancialDeterminationStatus.PENDING,
    ReturnFinancialDeterminationStatus.PROPOSED,
    ReturnFinancialDeterminationStatus.ACKNOWLEDGED,
    ReturnFinancialDeterminationStatus.DISPUTED,
  ];

/** Stage 12 native error codes (kept in one place for tests and clients). */
export const EXCEPTION_FINANCIAL_CODES = {
  FORBIDDEN: 'EXCEPTION_FINANCIAL_FORBIDDEN',
  AUDIT_FIELDS_REQUIRED: 'AUDIT_FIELDS_REQUIRED',
  IDEMPOTENCY_PAYLOAD_CONFLICT: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
  IDEMPOTENCY_CROSS_ORDER_CONFLICT: 'IDEMPOTENCY_CROSS_ORDER_CONFLICT',
  POLICY_NOT_ACTIVE: 'EXCEPTION_LIABILITY_POLICY_NOT_ACTIVE',
  RECOVERY_NOT_FOUND: 'OPERATIONS_RECOVERY_NOT_FOUND',
  RECOVERY_NOT_ELIGIBLE: 'EXCEPTION_CLAIM_RECOVERY_NOT_ELIGIBLE',
  CLAIM_NOT_FOUND: 'EXCEPTION_CLAIM_NOT_FOUND',
  CLAIM_TERMINAL: 'EXCEPTION_CLAIM_TERMINAL',
  CLAIM_ALREADY_ACTIVE: 'EXCEPTION_CLAIM_ALREADY_ACTIVE',
  CLAIM_TYPE_INVALID: 'EXCEPTION_CLAIM_TYPE_INVALID',
  CLAIM_STATE_INVALID: 'INVALID_EXCEPTION_CLAIM_STATE',
  SUBJECT_REF_REQUIRED: 'EXCEPTION_CLAIM_SUBJECT_REF_REQUIRED',
  EVIDENCE_KIND_INVALID: 'EXCEPTION_CLAIM_EVIDENCE_KIND_INVALID',
  EVIDENCE_NOT_FOUND: 'EXCEPTION_CLAIM_EVIDENCE_NOT_FOUND',
  VERIFICATION_STATUS_INVALID: 'EXCEPTION_CLAIM_VERIFICATION_INVALID',
  VERIFIED_EVIDENCE_REQUIRED: 'EXCEPTION_CLAIM_VERIFIED_EVIDENCE_REQUIRED',
  FACT_TYPE_INVALID: 'VERIFIED_FACT_TYPE_INVALID',
  FACT_REQUIRED: 'VERIFIED_FACT_REQUIRED',
  DETERMINATION_NOT_FOUND: 'LIABILITY_DETERMINATION_NOT_FOUND',
  DETERMINATION_STATE_INVALID: 'INVALID_LIABILITY_DETERMINATION_STATE',
  DETERMINATION_ALREADY_ACTIVE: 'LIABILITY_DETERMINATION_ALREADY_ACTIVE',
  ALLOCATIONS_REQUIRED: 'LIABILITY_ALLOCATIONS_REQUIRED',
  ALLOCATION_SUM_MISMATCH: 'LIABILITY_ALLOCATION_SUM_MISMATCH',
  ALLOCATION_PARTY_INVALID: 'LIABILITY_ALLOCATION_PARTY_INVALID',
  PLATFORM_NEVER_LIABLE: 'EXCEPTION_PLATFORM_NEVER_LIABLE',
  REMAINING_EXCEEDED: 'EXCEPTION_REMAINING_COMPENSABLE_EXCEEDED',
  NOTHING_REMAINING: 'EXCEPTION_NOTHING_REMAINING_TO_RECOVER',
  STAGE9_DETERMINATION_IN_PROGRESS: 'STAGE9_DETERMINATION_IN_PROGRESS',
  STAGE9_RETURN_MONEY_PENDING: 'STAGE9_RETURN_MONEY_PENDING',
  /** Stage 9 finalize refuses when Stage 12 already holds positive effective coverage. */
  STAGE12_FINANCIAL_AUTHORITY_EXISTS: 'STAGE12_FINANCIAL_AUTHORITY_EXISTS',
  ADJUSTMENT_SOURCE_INVALID: 'LIABILITY_ADJUSTMENT_SOURCE_INVALID',
  NON_CONFORMANCE_REASON_REQUIRED: 'EXCEPTION_NON_CONFORMANCE_REASON_REQUIRED',
  NON_CONFORMANCE_REASON_FORBIDDEN: 'EXCEPTION_NON_CONFORMANCE_REASON_FORBIDDEN',
  NON_CONFORMANCE_ATTRIBUTION_FORBIDDEN:
    'EXCEPTION_NON_CONFORMANCE_ATTRIBUTION_FORBIDDEN',
  NON_CONFORMANCE_LIABILITY_BASIS_REQUIRED:
    'EXCEPTION_NON_CONFORMANCE_LIABILITY_BASIS_REQUIRED',
} as const;

/**
 * Stage 12 never allocates liability to the platform. The enum omits PLATFORM
 * and a DB trigger rejects it; this list keeps the service check explicit.
 */
export const EXCEPTION_LIABLE_PARTY_TYPES: ExceptionLiablePartyType[] = [
  ExceptionLiablePartyType.CUSTOMER,
  ExceptionLiablePartyType.MERCHANT,
  ExceptionLiablePartyType.RIDER,
];

export function isLiablePartyType(value: string): boolean {
  return (EXCEPTION_LIABLE_PARTY_TYPES as string[]).includes(value);
}

const CLAIM_TYPE_TO_LOSS_KIND: Record<ExceptionClaimType, EconomicLossKind> = {
  [ExceptionClaimType.GOODS_LOSS]: EconomicLossKind.GOODS_LOST,
  [ExceptionClaimType.GOODS_DAMAGE]: EconomicLossKind.GOODS_DAMAGED,
  [ExceptionClaimType.NON_RETURN]: EconomicLossKind.GOODS_NOT_RETURNED,
  [ExceptionClaimType.GOODS_NON_CONFORMANCE]:
    EconomicLossKind.GOODS_NON_CONFORMING,
  [ExceptionClaimType.UNRECOVERED_ADVANCE]:
    EconomicLossKind.RIDER_ADVANCE_UNRECOVERED,
  [ExceptionClaimType.UNRECOVERED_PAYMENT]:
    EconomicLossKind.CUSTOMER_PAYMENT_UNRECOVERED,
  [ExceptionClaimType.OTHER]: EconomicLossKind.OTHER,
};

export function lossKindForClaimType(
  claimType: ExceptionClaimType,
): EconomicLossKind {
  return CLAIM_TYPE_TO_LOSS_KIND[claimType];
}

/**
 * Same-subject / containment mapping used when:
 * 1. Importing a FINALIZED Stage 9 determination's obligations as Stage 12
 *    coverage (Stage 9-first), and
 * 2. Stage 9 refusing to finalize after Stage 12 already holds positive
 *    effective coverage for an economically contained sub-scope
 *    (Stage 12-first, including item-level).
 *
 * Stage 9 QUALIFYING_FULL_RETURN monetizes whole-order goods/RA principal.
 * Goods-class Stage 12 losses (order-level OR order-item / quantity sub-scope)
 * are therefore contained in Stage 9's proposed formula. `OTHER` is never
 * contained — it is outside Stage 9 return economics.
 */
const STAGE9_OBLIGATION_COVERS: Record<
  ReturnFinancialObligationType,
  EconomicLossKind[]
> = {
  [ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT]: [
    EconomicLossKind.RIDER_ADVANCE_UNRECOVERED,
    EconomicLossKind.GOODS_NON_CONFORMING,
    EconomicLossKind.GOODS_LOST,
    EconomicLossKind.GOODS_DAMAGED,
    EconomicLossKind.GOODS_NOT_RETURNED,
  ],
  [ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND]: [
    EconomicLossKind.CUSTOMER_PAYMENT_UNRECOVERED,
    EconomicLossKind.GOODS_NON_CONFORMING,
    EconomicLossKind.GOODS_LOST,
    EconomicLossKind.GOODS_DAMAGED,
    EconomicLossKind.GOODS_NOT_RETURNED,
  ],
};

export function stage9ObligationCoversLossKind(
  obligationType: ReturnFinancialObligationType,
  lossKind: EconomicLossKind,
): boolean {
  return (STAGE9_OBLIGATION_COVERS[obligationType] ?? []).includes(lossKind);
}

/** Inverse of {@link stage9ObligationCoversLossKind} for Stage 9 finalize guards. */
export function lossKindsOverlappedByStage9Obligations(
  obligationTypes: ReturnFinancialObligationType[],
): EconomicLossKind[] {
  const kinds = new Set<EconomicLossKind>();
  for (const t of obligationTypes) {
    for (const k of STAGE9_OBLIGATION_COVERS[t] ?? []) kinds.add(k);
  }
  return [...kinds];
}

/** Stage 9 cannot express item-scoped allocation — goods scope is always whole-order. */
export type Stage9GoodsScope = 'WHOLE_ORDER';

/**
 * Explicit description of what a Stage 9 QUALIFYING_FULL_RETURN finalize is
 * about to monetize. Not persisted — used only for overlap/containment reasoning.
 *
 * - RA path: grossPrincipal = P (reimbursementPrincipal); merchant→rider = P−R;
 *   merchant→customer = R. Fees are not included.
 * - Ordinary path: grossPrincipal = ordinaryRefundPrincipal; merchant→customer only.
 * - goodsScope WHOLE_ORDER: every order-item / quantity sub-loss of the order is
 *   economically contained in the proposed principal (Stage 9 cannot finalize
 *   "Item B only").
 */
export type Stage9EconomicScope = {
  wkOrderId: number;
  path: 'RIDER_ADVANCE' | 'ORDINARY_MERCHANT_PAYMENT';
  principalKind: 'RIDER_ADVANCE_PRINCIPAL' | 'ORDINARY_REFUND_PRINCIPAL';
  grossPrincipal: Prisma.Decimal;
  merchantToRiderAmount: Prisma.Decimal;
  merchantToCustomerAmount: Prisma.Decimal;
  riderAdvanceId: string | null;
  goodsScope: Stage9GoodsScope;
  includedLossKinds: EconomicLossKind[];
};

export function buildStage9EconomicScope(input: {
  wkOrderId: number;
  path: 'RIDER_ADVANCE' | 'ORDINARY_MERCHANT_PAYMENT';
  grossPrincipal: Prisma.Decimal.Value;
  merchantToRiderAmount: Prisma.Decimal.Value;
  merchantToCustomerAmount: Prisma.Decimal.Value;
  riderAdvanceId?: string | null;
}): Stage9EconomicScope {
  const gross = MONEY(input.grossPrincipal);
  const toRider = MONEY(input.merchantToRiderAmount);
  const toCustomer = MONEY(input.merchantToCustomerAmount);
  const kinds = new Set<EconomicLossKind>();

  const monetizing =
    gross.gt(0) || toRider.gt(0) || toCustomer.gt(0);
  if (monetizing) {
    // Whole-order return/RA goods economics contain these Stage 12 loss kinds.
    kinds.add(EconomicLossKind.GOODS_LOST);
    kinds.add(EconomicLossKind.GOODS_DAMAGED);
    kinds.add(EconomicLossKind.GOODS_NOT_RETURNED);
    kinds.add(EconomicLossKind.GOODS_NON_CONFORMING);
  }
  if (toRider.gt(0) || input.path === 'RIDER_ADVANCE') {
    kinds.add(EconomicLossKind.RIDER_ADVANCE_UNRECOVERED);
  }
  if (toCustomer.gt(0)) {
    kinds.add(EconomicLossKind.CUSTOMER_PAYMENT_UNRECOVERED);
  }
  // EconomicLossKind.OTHER is intentionally absent — outside Stage 9 formula.

  return {
    wkOrderId: input.wkOrderId,
    path: input.path,
    principalKind:
      input.path === 'RIDER_ADVANCE'
        ? 'RIDER_ADVANCE_PRINCIPAL'
        : 'ORDINARY_REFUND_PRINCIPAL',
    grossPrincipal: gross,
    merchantToRiderAmount: toRider,
    merchantToCustomerAmount: toCustomer,
    riderAdvanceId: input.riderAdvanceId ?? null,
    goodsScope: 'WHOLE_ORDER',
    includedLossKinds: [...kinds],
  };
}

/**
 * Exact order-level subject equality (legacy helper). Prefer
 * {@link stage12LossContainedInStage9Scope} for Stage 9 guards — item-level
 * subjects are economically contained in WHOLE_ORDER Stage 9 money.
 */
export function stage9OrderMoneyOverlapsSubject(input: {
  wkOrderId: number;
  subjectRef: string;
}): boolean {
  const orderSubjects = new Set([
    `order-goods:${input.wkOrderId}`,
    `order-nonconformance:${input.wkOrderId}`,
    `rider-advance:${input.wkOrderId}`,
  ]);
  return orderSubjects.has(input.subjectRef);
}

/**
 * Containment: does this Stage 12 EconomicLoss's subject sit inside Stage 9's
 * WHOLE_ORDER goods/RA economic scope? Exact subject equality is NOT required.
 * Item-level and quantity-level refs (`order-item:…`) are contained.
 * Subjects outside return/RA goods economics (e.g. `fee:…`, `external:…`) are not.
 */
export function stage12SubjectContainedInStage9GoodsScope(input: {
  wkOrderId: number;
  subjectRef: string;
  goodsScope: Stage9GoodsScope;
}): boolean {
  const ref = input.subjectRef.trim();
  if (!ref) return false;

  if (stage9OrderMoneyOverlapsSubject({ wkOrderId: input.wkOrderId, subjectRef: ref })) {
    return true;
  }

  if (input.goodsScope !== 'WHOLE_ORDER') return false;

  // Item / quantity / item-scoped non-conformance sub-scopes of the order.
  if (ref.startsWith('order-item:')) return true;
  if (ref.startsWith(`order-nonconformance:${input.wkOrderId}:`)) return true;
  if (ref.startsWith(`order-goods:${input.wkOrderId}:`)) return true;
  if (ref.startsWith(`rider-advance:${input.wkOrderId}:`)) return true;

  return false;
}

export function stage12LossContainedInStage9Scope(input: {
  scope: Stage9EconomicScope;
  lossKind: EconomicLossKind;
  subjectRef: string;
}): boolean {
  if (!input.scope.includedLossKinds.includes(input.lossKind)) return false;
  return stage12SubjectContainedInStage9GoodsScope({
    wkOrderId: input.scope.wkOrderId,
    subjectRef: input.subjectRef,
    goodsScope: input.scope.goodsScope,
  });
}

/**
 * Effective Stage 12 financial authority for the Stage 9 overlap guard.
 * Only FINALIZED Stage 12 obligation coverage counts as blocking authority.
 * ADMIN_WRITE_OFF / EXTERNAL_RECOVERY reduce effective authority (including
 * full offset after a corrective write-down) without deleting historical rows.
 * Claims, evidence, VerifiedFacts, draft/proposed determinations, and
 * STAGE9_OBLIGATION imports never contribute here.
 */
export function effectiveStage12CoverageAmount(
  coverages: Array<{
    sourceKind: EconomicLossCoverageSourceKind;
    amount: Prisma.Decimal.Value;
  }>,
): Prisma.Decimal {
  let stage12 = MONEY(0);
  let offsets = MONEY(0);
  for (const c of coverages) {
    if (c.sourceKind === EconomicLossCoverageSourceKind.STAGE12_OBLIGATION) {
      stage12 = stage12.add(MONEY(c.amount));
    } else if (
      c.sourceKind === EconomicLossCoverageSourceKind.ADMIN_WRITE_OFF ||
      c.sourceKind === EconomicLossCoverageSourceKind.EXTERNAL_RECOVERY
    ) {
      offsets = offsets.add(MONEY(c.amount));
    }
  }
  const net = stage12.sub(offsets).toDecimalPlaces(2);
  return net.lt(0) ? MONEY(0) : net;
}

export function evaluateStage9Stage12OverlapGuard(input: {
  scope: Stage9EconomicScope;
  losses: Array<{
    id: string;
    lossKind: EconomicLossKind;
    subjectRef: string;
    coverages: Array<{
      sourceKind: EconomicLossCoverageSourceKind;
      amount: Prisma.Decimal.Value;
    }>;
  }>;
}): GateResult {
  if (
    input.scope.merchantToRiderAmount.lte(0) &&
    input.scope.merchantToCustomerAmount.lte(0)
  ) {
    return { ok: true };
  }

  for (const loss of input.losses) {
    if (
      !stage12LossContainedInStage9Scope({
        scope: input.scope,
        lossKind: loss.lossKind,
        subjectRef: loss.subjectRef,
      })
    ) {
      continue;
    }
    const effective = effectiveStage12CoverageAmount(loss.coverages);
    if (effective.gt(0)) {
      return {
        ok: false,
        code: EXCEPTION_FINANCIAL_CODES.STAGE12_FINANCIAL_AUTHORITY_EXISTS,
        message:
          'Stage 12 already finalized positive effective financial coverage for an economic sub-scope contained in Stage 9 order-level liability; Stage 9 cannot independently finalize overlapping liability. Resolve remaining item economics via Stage 12 claim/determination (or adjustment), not Stage 9 whole-order money.',
      };
    }
  }
  return { ok: true };
}

/** Server-derived EconomicLoss identity. Clients never supply this. */
export function buildEconomicLossKey(input: {
  wkOrderId: number;
  lossKind: EconomicLossKind;
  subjectRef: string;
}): string {
  const subjectHash = createHash('sha256')
    .update(input.subjectRef)
    .digest('hex')
    .slice(0, 16);
  return `el:${input.wkOrderId}:${input.lossKind}:${subjectHash}`;
}

const MONEY = (v: Prisma.Decimal.Value): Prisma.Decimal =>
  new Prisma.Decimal(v ?? 0).toDecimalPlaces(2);

export { MONEY as toMoney };

export type CompensableComputation = {
  goodsValue: Prisma.Decimal;
  feeComponentAmount: Prisma.Decimal;
  grossLossAmount: Prisma.Decimal;
  compensableAmount: Prisma.Decimal;
};

/**
 * Fees (delivery fee, transaction fee) are operational revenue, not goods
 * value. `compensableAmount` never auto-includes them — they are recorded
 * separately as `feeComponentAmount` for audit only.
 */
export function computeCompensable(input: {
  orderTotalAmount: Prisma.Decimal.Value;
  deliveryFee: Prisma.Decimal.Value;
  transactionFeeAmount: Prisma.Decimal.Value;
  claimedAmount?: Prisma.Decimal.Value | null;
}): CompensableComputation {
  const total = MONEY(input.orderTotalAmount);
  const deliveryFee = MONEY(input.deliveryFee);
  const transactionFee = MONEY(input.transactionFeeAmount);
  const feeComponentAmount = deliveryFee.add(transactionFee).toDecimalPlaces(2);

  let goodsValue = total.sub(feeComponentAmount).toDecimalPlaces(2);
  if (goodsValue.lt(0)) goodsValue = MONEY(0);

  const claimed =
    input.claimedAmount == null ? null : MONEY(input.claimedAmount);
  const grossLossAmount = claimed && claimed.gt(0) ? claimed : goodsValue;

  // Compensable is capped at goods value: a claim can never recover the fees,
  // and can never exceed the goods actually at risk.
  const compensableAmount = grossLossAmount.gt(goodsValue)
    ? goodsValue
    : grossLossAmount;

  return {
    goodsValue,
    feeComponentAmount,
    grossLossAmount: grossLossAmount.gt(goodsValue)
      ? goodsValue
      : grossLossAmount,
    compensableAmount,
  };
}

/** MAX helpers — remaining recoverable amount after prior coverage. */
export function remainingCompensable(input: {
  compensableAmount: Prisma.Decimal.Value;
  coveredAmount: Prisma.Decimal.Value;
}): Prisma.Decimal {
  const remaining = MONEY(input.compensableAmount)
    .sub(MONEY(input.coveredAmount))
    .toDecimalPlaces(2);
  return remaining.lt(0) ? MONEY(0) : remaining;
}

/** Amount a single coverage row may add without breaching the ceiling. */
export function maxImportableCoverage(input: {
  compensableAmount: Prisma.Decimal.Value;
  alreadyCoveredAmount: Prisma.Decimal.Value;
  candidateAmount: Prisma.Decimal.Value;
}): Prisma.Decimal {
  const headroom = remainingCompensable({
    compensableAmount: input.compensableAmount,
    coveredAmount: input.alreadyCoveredAmount,
  });
  const candidate = MONEY(input.candidateAmount);
  return candidate.gt(headroom) ? headroom : candidate;
}

export function sumAmounts(
  values: ReadonlyArray<Prisma.Decimal.Value>,
): Prisma.Decimal {
  return values
    .reduce<Prisma.Decimal>((acc, v) => acc.add(MONEY(v)), MONEY(0))
    .toDecimalPlaces(2);
}

// ─── Stage 9 race gate helpers (Stage 12 side) ───────────────────────────
// Stage 12 refuse-while-Stage9-eligible remains. The reverse race
// (Stage 12 first → later Stage 9) is closed by a minimal Stage 9 finalize
// guard using effectiveStage12CoverageAmount / evaluateStage9Stage12OverlapGuard.

export type Stage9GateContext = {
  /** Statuses of every Stage 9 determination on the order. */
  stage9Statuses: ReturnFinancialDeterminationStatus[];
  fulfillmentStatus: FulfillmentStatus;
  hasReturnReceivedCustody: boolean;
};

export type GateResult =
  { ok: true } | { ok: false; code: string; message: string };

/**
 * True when Stage 9 would still be able to produce return money for this
 * order: physically returned to merchant custody, but no FINALIZED Stage 9
 * determination exists yet.
 */
export function isStage9ReturnMoneyEligible(ctx: Stage9GateContext): boolean {
  const returnedWithCustody =
    ctx.fulfillmentStatus === FulfillmentStatus.returned &&
    ctx.hasReturnReceivedCustody;
  if (!returnedWithCustody) return false;
  return !ctx.stage9Statuses.includes(
    ReturnFinancialDeterminationStatus.FINALIZED,
  );
}

export function hasBlockingStage9Determination(
  ctx: Stage9GateContext,
): boolean {
  return ctx.stage9Statuses.some((s) =>
    STAGE9_BLOCKING_DETERMINATION_STATUSES.includes(s),
  );
}

/**
 * Stage 12 finalize gate. Refuses whenever Stage 9 might still decide money for
 * the same order *while Stage 9 is already return-money-eligible or in progress*.
 * It does NOT cover Stage 12 finalizing before return eligibility (e.g. Trust
 * Trade non-conformance); that reverse race is closed by the Stage 9 guard.
 */
export function evaluateStage9FinalizeGate(ctx: Stage9GateContext): GateResult {
  if (hasBlockingStage9Determination(ctx)) {
    return {
      ok: false,
      code: EXCEPTION_FINANCIAL_CODES.STAGE9_DETERMINATION_IN_PROGRESS,
      message:
        'A Stage 9 return financial determination is still in progress; resolve it before Stage 12 finalize',
    };
  }
  if (isStage9ReturnMoneyEligible(ctx)) {
    return {
      ok: false,
      code: EXCEPTION_FINANCIAL_CODES.STAGE9_RETURN_MONEY_PENDING,
      message:
        'Order is Stage 9 return-money-eligible with no FINALIZED determination; Stage 12 finalize is refused',
    };
  }
  return { ok: true };
}

// ─── Eligibility (strict Stage 11 lineage) ─────────────────────────────

export type RecoveryEligibilityContext = {
  status: string;
  currentDisposition: string | null;
};

/**
 * Strict Stage 11 lineage: a Stage 12 claim may only originate from an
 * OperationsRecovery that reached FINANCIAL_REVIEW_REQUIRED. There is no
 * generic "any open recovery" path.
 */
export function evaluateRecoveryEligibility(
  ctx: RecoveryEligibilityContext,
): GateResult {
  const statusOk =
    ctx.status === 'CLOSED' || ctx.status === 'DISPOSITION_SELECTED';
  if (!statusOk) {
    return {
      ok: false,
      code: EXCEPTION_FINANCIAL_CODES.RECOVERY_NOT_ELIGIBLE,
      message:
        'Stage 12 claims require a CLOSED (or DISPOSITION_SELECTED) operations recovery',
    };
  }
  if (ctx.currentDisposition !== 'FINANCIAL_REVIEW_REQUIRED') {
    return {
      ok: false,
      code: EXCEPTION_FINANCIAL_CODES.RECOVERY_NOT_ELIGIBLE,
      message:
        'Stage 12 claims require currentDisposition=FINANCIAL_REVIEW_REQUIRED',
    };
  }
  return { ok: true };
}

// ─── Verified-fact gating for determinations ───────────────────────────

/** Fact types that can carry party attribution into an allocation. */
export const ATTRIBUTING_FACT_TYPES: VerifiedFactType[] = [
  VerifiedFactType.GOODS_LOST_CONFIRMED,
  VerifiedFactType.GOODS_DAMAGED_CONFIRMED,
  VerifiedFactType.CUSTODY_LAST_HOLDER_CONFIRMED,
  VerifiedFactType.RETURN_NOT_COMPLETED_CONFIRMED,
  VerifiedFactType.PAYMENT_NOT_COLLECTED_CONFIRMED,
  VerifiedFactType.PARTY_NEGLIGENCE_CONFIRMED,
  VerifiedFactType.GOODS_NON_CONFORMANCE_CONFIRMED,
];

/**
 * Trust Trade facts that record investigation outcomes but NEVER authorize
 * party liability attribution by themselves.
 */
export const NON_ATTRIBUTING_NON_CONFORMANCE_FACT_TYPES: VerifiedFactType[] = [
  VerifiedFactType.GOODS_CONFORMANCE_CONFIRMED,
  VerifiedFactType.NON_CONFORMANCE_ALLEGATION_UNSUPPORTED,
];

export const GOODS_NON_CONFORMANCE_REASON_CODES: GoodsNonConformanceReasonCode[] =
  Object.values(GoodsNonConformanceReasonCode);

export function isGoodsNonConformanceReasonCode(
  value: string,
): value is GoodsNonConformanceReasonCode {
  return (GOODS_NON_CONFORMANCE_REASON_CODES as string[]).includes(value);
}

/**
 * Core Trust Trade invariant: selecting WRONG_ITEM (or any reason) is an
 * operational allegation taxonomy. It never by itself creates liability.
 */
export function evaluateNonConformanceReasonForOpen(input: {
  claimType: ExceptionClaimType;
  nonConformanceReasonCode?: string | null;
}): GateResult {
  const reason = input.nonConformanceReasonCode?.trim() || null;
  if (input.claimType === ExceptionClaimType.GOODS_NON_CONFORMANCE) {
    if (!reason || !isGoodsNonConformanceReasonCode(reason)) {
      return {
        ok: false,
        code: EXCEPTION_FINANCIAL_CODES.NON_CONFORMANCE_REASON_REQUIRED,
        message:
          'GOODS_NON_CONFORMANCE claims require a GoodsNonConformanceReasonCode',
      };
    }
    return { ok: true };
  }
  if (reason) {
    return {
      ok: false,
      code: EXCEPTION_FINANCIAL_CODES.NON_CONFORMANCE_REASON_FORBIDDEN,
      message:
        'nonConformanceReasonCode is only valid for GOODS_NON_CONFORMANCE claims',
    };
  }
  return { ok: true };
}

export function evaluateNonConformanceFactAttribution(input: {
  factType: VerifiedFactType;
  attributedPartyType?: ExceptionLiablePartyType | string | null;
}): GateResult {
  if (
    NON_ATTRIBUTING_NON_CONFORMANCE_FACT_TYPES.includes(input.factType) &&
    input.attributedPartyType
  ) {
    return {
      ok: false,
      code: EXCEPTION_FINANCIAL_CODES.NON_CONFORMANCE_ATTRIBUTION_FORBIDDEN,
      message:
        'GOODS_CONFORMANCE_CONFIRMED / NON_CONFORMANCE_ALLEGATION_UNSUPPORTED cannot attribute liability',
    };
  }
  return { ok: true };
}

export type OrderTermsSnapshotLine = {
  orderItemId: number;
  productId: number | null;
  variantId: number | null;
  productName: string;
  quantity: number;
  price: string;
  subtotal: string;
  productSku: string | null;
  variantSku: string | null;
};

/**
 * Immutable read model of authoritative WkOrder line terms for evidence.
 * Never mutates historical order rows.
 */
export function buildOrderTermsSnapshot(input: {
  wkOrderId: number;
  orderCode: string | null;
  merchantId: number | null;
  lines: Array<{
    id: number;
    productId: number | null;
    variantId: number | null;
    productName: string;
    quantity: number;
    price: Prisma.Decimal.Value;
    subtotal: Prisma.Decimal.Value;
    productSku?: string | null;
    variantSku?: string | null;
  }>;
}): {
  kind: 'ORDER_TERMS_SNAPSHOT';
  wkOrderId: number;
  orderCode: string | null;
  merchantId: number | null;
  capturedAt: string;
  lines: OrderTermsSnapshotLine[];
} {
  return {
    kind: 'ORDER_TERMS_SNAPSHOT',
    wkOrderId: input.wkOrderId,
    orderCode: input.orderCode,
    merchantId: input.merchantId,
    capturedAt: new Date().toISOString(),
    lines: input.lines.map((l) => ({
      orderItemId: l.id,
      productId: l.productId,
      variantId: l.variantId,
      productName: l.productName,
      quantity: l.quantity,
      price: MONEY(l.price).toFixed(2),
      subtotal: MONEY(l.subtotal).toFixed(2),
      productSku: l.productSku ?? null,
      variantSku: l.variantSku ?? null,
    })),
  };
}

export function factSupportsAttribution(factType: VerifiedFactType): boolean {
  return ATTRIBUTING_FACT_TYPES.includes(factType);
}

export type AllocationDraft = {
  partyType: ExceptionLiablePartyType;
  partyUserId?: string | null;
  partyMerchantId?: number | null;
  amount: Prisma.Decimal.Value;
  verifiedFactId?: string | null;
  basis?: string | null;
};

/**
 * Merchant/rider liability on a non-conformance claim requires a verified
 * non-conformance (or negligence / custody-substitution) fact — never the
 * reason code alone, and never CONFORMANCE / UNSUPPORTED facts.
 */
export function evaluateNonConformanceLiabilityBasis(input: {
  claimType: ExceptionClaimType;
  allocations: AllocationDraft[];
  facts: Array<{
    id: string;
    factType: VerifiedFactType;
  }>;
}): GateResult {
  if (input.claimType !== ExceptionClaimType.GOODS_NON_CONFORMANCE) {
    return { ok: true };
  }

  const factById = new Map(input.facts.map((f) => [f.id, f]));
  const hasNonConformanceConfirmed = input.facts.some(
    (f) => f.factType === VerifiedFactType.GOODS_NON_CONFORMANCE_CONFIRMED,
  );
  const hasNegligence = input.facts.some(
    (f) => f.factType === VerifiedFactType.PARTY_NEGLIGENCE_CONFIRMED,
  );
  const hasCustodyHolder = input.facts.some(
    (f) => f.factType === VerifiedFactType.CUSTODY_LAST_HOLDER_CONFIRMED,
  );

  for (const a of input.allocations) {
    if (a.verifiedFactId) {
      const fact = factById.get(a.verifiedFactId);
      if (
        fact &&
        NON_ATTRIBUTING_NON_CONFORMANCE_FACT_TYPES.includes(fact.factType)
      ) {
        return {
          ok: false,
          code: EXCEPTION_FINANCIAL_CODES.NON_CONFORMANCE_LIABILITY_BASIS_REQUIRED,
          message:
            'Conformance/unsupported allegation facts cannot ground liability allocations',
        };
      }
    }

    if (a.partyType === ExceptionLiablePartyType.MERCHANT) {
      if (!hasNonConformanceConfirmed && !hasNegligence) {
        return {
          ok: false,
          code: EXCEPTION_FINANCIAL_CODES.NON_CONFORMANCE_LIABILITY_BASIS_REQUIRED,
          message:
            'Merchant liability on GOODS_NON_CONFORMANCE requires GOODS_NON_CONFORMANCE_CONFIRMED (or PARTY_NEGLIGENCE_CONFIRMED)',
        };
      }
    }
    if (a.partyType === ExceptionLiablePartyType.RIDER) {
      if (!hasNegligence && !hasCustodyHolder) {
        return {
          ok: false,
          code: EXCEPTION_FINANCIAL_CODES.NON_CONFORMANCE_LIABILITY_BASIS_REQUIRED,
          message:
            'Rider liability on GOODS_NON_CONFORMANCE requires PARTY_NEGLIGENCE_CONFIRMED or CUSTODY_LAST_HOLDER_CONFIRMED — custody during allegation is not automatic liability',
        };
      }
    }
  }
  return { ok: true };
}

export type AllocationValidationInput = {
  allocations: AllocationDraft[];
  totalLiabilityAmount: Prisma.Decimal.Value;
  remainingAmount: Prisma.Decimal.Value;
};

export function validateAllocations(
  input: AllocationValidationInput,
): GateResult {
  if (input.allocations.length === 0) {
    return {
      ok: false,
      code: EXCEPTION_FINANCIAL_CODES.ALLOCATIONS_REQUIRED,
      message: 'At least one liability allocation is required',
    };
  }
  for (const a of input.allocations) {
    if (!isLiablePartyType(a.partyType)) {
      return {
        ok: false,
        code: EXCEPTION_FINANCIAL_CODES.PLATFORM_NEVER_LIABLE,
        message: `Liable party type ${a.partyType} is not permitted`,
      };
    }
    if (MONEY(a.amount).lte(0)) {
      return {
        ok: false,
        code: EXCEPTION_FINANCIAL_CODES.ALLOCATION_PARTY_INVALID,
        message: 'Allocation amounts must be greater than zero',
      };
    }
    const isMerchant = a.partyType === ExceptionLiablePartyType.MERCHANT;
    if (isMerchant && (a.partyMerchantId == null || a.partyUserId != null)) {
      return {
        ok: false,
        code: EXCEPTION_FINANCIAL_CODES.ALLOCATION_PARTY_INVALID,
        message: 'MERCHANT allocations require partyMerchantId only',
      };
    }
    if (!isMerchant && (a.partyUserId == null || a.partyMerchantId != null)) {
      return {
        ok: false,
        code: EXCEPTION_FINANCIAL_CODES.ALLOCATION_PARTY_INVALID,
        message: `${a.partyType} allocations require partyUserId only`,
      };
    }
  }

  const total = MONEY(input.totalLiabilityAmount);
  const sum = sumAmounts(input.allocations.map((a) => a.amount));
  if (!sum.eq(total)) {
    return {
      ok: false,
      code: EXCEPTION_FINANCIAL_CODES.ALLOCATION_SUM_MISMATCH,
      message: `Allocations sum ${sum.toFixed(2)} does not equal total ${total.toFixed(2)}`,
    };
  }
  if (total.gt(MONEY(input.remainingAmount))) {
    return {
      ok: false,
      code: EXCEPTION_FINANCIAL_CODES.REMAINING_EXCEEDED,
      message: `Total liability ${total.toFixed(2)} exceeds remaining compensable ${MONEY(
        input.remainingAmount,
      ).toFixed(2)}`,
    };
  }
  return { ok: true };
}

// ─── Seeded policy document ────────────────────────────────────────────

export const EXCEPTION_LIABILITY_POLICY_V1 = {
  version: 1,
  name: 'wekonnek.exception_liability.v1',
  liableParties: ['CUSTOMER', 'MERCHANT', 'RIDER'],
  platformLiable: false,
  feesCompensable: false,
  compensableBasis: 'ORDER_GOODS_VALUE_EXCLUDING_FEES',
  doubleRecoveryControl: 'ECONOMIC_LOSS_COVERAGE_CEILING',
  stage9Precedence: 'STAGE9_FIRST',
} as const;

export function policyHash(policy: unknown): string {
  return createHash('sha256').update(JSON.stringify(policy)).digest('hex');
}
