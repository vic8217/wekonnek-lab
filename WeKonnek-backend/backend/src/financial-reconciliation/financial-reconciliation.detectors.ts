/**
 * Stage13B-2 pure cross-rail detectors.
 * Consume Stage13B-1 items + read context. Never write. Never net.
 */
import {
  EconomicLossCoverageSourceKind,
  EconomicLossKind,
  LiabilityDeterminationStatus,
  ReturnFinancialObligationType,
} from '@prisma/client';
import {
  buildStage9EconomicScope,
  maxImportableCoverage,
  stage12LossContainedInStage9Scope,
  stage9ObligationCoversLossKind,
  stage9OrderMoneyOverlapsSubject,
} from '../exception-financial/exception-financial.policy';
import { buildFindingKey, toMoney } from './financial-reconciliation.policy';
import { isExecutableRiderAdvance } from './rider-advance-reimbursement.adapter';
import {
  FinancialReconciliationItem,
  RAIL_EXCEPTION_FINANCIAL,
  RAIL_RETURN_FINANCIAL,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
  RECONCILIATION_FINDING_CODES,
  ReconciliationFinding,
  ReconciliationFindingCode,
  ReconciliationFindingInvolvedItem,
  ReconciliationRelatedItem,
  ReconciliationState,
  ReconciliationSubjectMatch,
} from './financial-reconciliation.types';
import {
  DetectorCoverage,
  DetectorEconomicLoss,
  DetectorLiabilityDetermination,
  DetectorRestriction,
  DetectorReturnDetermination,
  DetectorReturnObligation,
  PATH_ORDINARY_MERCHANT_PAYMENT,
  PATH_RIDER_ADVANCE,
  ReconciliationReadContext,
} from './reconciliation-read-context';

export const SUCCESSOR_TRAVERSAL_CAP = 32;

export type DetectorOutput = {
  findings: ReconciliationFinding[];
  relatedItems: ReconciliationRelatedItem[];
};

function finding(input: {
  code: ReconciliationFindingCode;
  state: ReconciliationState;
  wkOrderId: number;
  involvedItems: ReconciliationFindingInvolvedItem[];
  sourceId?: string;
  expectedRelationship?: string;
  observedRelationship?: string;
  evidenceRefs?: string[];
  subjectMatch?: ReconciliationSubjectMatch;
  checkOutcome?: ReconciliationFinding['checkOutcome'];
}): ReconciliationFinding {
  const involvedItems = [...input.involvedItems].sort((a, b) => {
    const rail = a.rail.localeCompare(b.rail);
    if (rail !== 0) return rail;
    return a.obligationId.localeCompare(b.obligationId);
  });
  return {
    findingKey: buildFindingKey({
      code: input.code,
      involvedItems,
      sourceId: input.sourceId,
    }),
    code: input.code,
    reconciliationState: input.state,
    wkOrderId: input.wkOrderId,
    subjectMatch: input.subjectMatch,
    checkOutcome: input.checkOutcome ?? 'FAILED',
    involvedItems,
    expectedRelationship: input.expectedRelationship,
    observedRelationship: input.observedRelationship,
    explanationCode: input.code,
    evidenceRefs: input.evidenceRefs ?? [],
  };
}

function relation(input: {
  fromRail: FinancialReconciliationItem['rail'];
  fromObligationId: string;
  rail: FinancialReconciliationItem['rail'];
  obligationId: string;
  relation: ReconciliationRelatedItem['relation'];
}): ReconciliationRelatedItem {
  return {
    rail: input.rail,
    obligationId: input.obligationId,
    relation: input.relation,
    fromRail: input.fromRail,
    fromObligationId: input.fromObligationId,
  };
}

function moneyEq(
  a: PrismaDecimal | null | undefined,
  b: PrismaDecimal | null | undefined,
): boolean {
  return toMoney(a).eq(toMoney(b));
}

type PrismaDecimal = Parameters<typeof toMoney>[0];

function raItem(
  items: FinancialReconciliationItem[],
  riderAdvanceId: string,
): FinancialReconciliationItem | undefined {
  return items.find(
    (i) =>
      i.rail === RAIL_RIDER_ADVANCE_REIMBURSEMENT &&
      i.obligationId === riderAdvanceId,
  );
}

function returnItem(
  items: FinancialReconciliationItem[],
  obligationId: string,
): FinancialReconciliationItem | undefined {
  return items.find(
    (i) => i.rail === RAIL_RETURN_FINANCIAL && i.obligationId === obligationId,
  );
}

function merchantToRiderObl(
  det: DetectorReturnDetermination,
): DetectorReturnObligation | undefined {
  return det.obligations.find(
    (o) =>
      o.type === ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
  );
}

function merchantToCustomerObl(
  det: DetectorReturnDetermination,
): DetectorReturnObligation | undefined {
  return det.obligations.find(
    (o) => o.type === ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
  );
}

function activeRestrictions(
  restrictions: DetectorRestriction[],
  riderAdvanceId: string,
  determinationId: string,
): DetectorRestriction[] {
  return restrictions.filter(
    (r) =>
      r.riderAdvanceId === riderAdvanceId &&
      r.returnFinancialDeterminationId === determinationId &&
      r.status === 'ACTIVE',
  );
}

export function detectRiderAdvanceReturnTransfer(
  items: FinancialReconciliationItem[],
  ctx: ReconciliationReadContext,
): DetectorOutput {
  const findings: ReconciliationFinding[] = [];
  const relatedItems: ReconciliationRelatedItem[] = [];
  const wkOrderId = ctx.wkOrderId;

  for (const det of ctx.returnDeterminations) {
    if (det.path === PATH_ORDINARY_MERCHANT_PAYMENT) continue;
    if (det.path !== PATH_RIDER_ADVANCE) continue;

    const m2r = merchantToRiderObl(det);
    const m2c = merchantToCustomerObl(det);
    const before = findings.length;
    const involved: ReconciliationFindingInvolvedItem[] = [];
    if (m2r) {
      involved.push({
        rail: RAIL_RETURN_FINANCIAL,
        obligationId: m2r.id,
      });
    }

    if (!det.riderAdvanceId) {
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.INSUFFICIENT_SOURCE_LINKAGE,
          state: 'REVIEW_REQUIRED',
          wkOrderId,
          involvedItems: involved,
          sourceId: det.id,
          expectedRelationship: 'riderAdvanceId on RA-path FINALIZED determination',
          observedRelationship: 'riderAdvanceId=null',
          evidenceRefs: [det.id],
          checkOutcome: 'INSUFFICIENT_LINKAGE',
        }),
      );
      continue;
    }

    const raRow = ctx.riderAdvances.find((r) => r.id === det.riderAdvanceId);
    const ra = raItem(items, det.riderAdvanceId);
    if (ra) {
      involved.unshift({
        rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
        obligationId: ra.obligationId,
      });
    }

    if (!raRow || !isExecutableRiderAdvance(raRow) || !ra) {
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.RA_RETURN_RA_MISSING,
          state: 'SOURCE_INCONSISTENCY',
          wkOrderId,
          involvedItems: involved,
          sourceId: det.id,
          expectedRelationship: `RiderAdvance ${det.riderAdvanceId}`,
          observedRelationship: raRow
            ? `non-executable status=${raRow.status}`
            : 'missing',
          evidenceRefs: [det.id, det.riderAdvanceId],
        }),
      );
      continue;
    }

    const currencies = new Set<string>([ra.currency, det.currency]);
    if (m2r) currencies.add(m2r.currency);
    if (m2c) currencies.add(m2c.currency);
    if (currencies.size > 1) {
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.CURRENCY_MISMATCH,
          state: 'SOURCE_INCONSISTENCY',
          wkOrderId,
          involvedItems: involved,
          sourceId: det.id,
          expectedRelationship: ra.currency,
          observedRelationship: [...currencies].sort().join(','),
          evidenceRefs: [det.id, ra.obligationId],
        }),
      );
    }

    if (!moneyEq(det.snapshotPrincipal, ra.originalPrincipal)) {
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.RA_RETURN_SNAPSHOT_PRINCIPAL_MISMATCH,
          state: 'SOURCE_INCONSISTENCY',
          wkOrderId,
          involvedItems: involved,
          sourceId: det.id,
          expectedRelationship: ra.originalPrincipal.toFixed(2),
          observedRelationship:
            det.snapshotPrincipal == null
              ? 'null'
              : toMoney(det.snapshotPrincipal).toFixed(2),
          evidenceRefs: [det.id],
        }),
      );
    }

    if (!moneyEq(det.snapshotReimbursed, ra.settledAmount)) {
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.RA_RETURN_SNAPSHOT_ACK_MISMATCH,
          state: 'SOURCE_INCONSISTENCY',
          wkOrderId,
          involvedItems: involved,
          sourceId: det.id,
          expectedRelationship: ra.settledAmount.toFixed(2),
          observedRelationship:
            det.snapshotReimbursed == null
              ? 'null'
              : toMoney(det.snapshotReimbursed).toFixed(2),
          evidenceRefs: [det.id],
        }),
      );
    }

    const snapP = toMoney(det.snapshotPrincipal);
    const snapR = toMoney(det.snapshotReimbursed);
    const expectedM2r = snapP.sub(snapR).toDecimalPlaces(2);
    const expectedM2c = snapR;
    if (!moneyEq(det.merchantToRiderAmount, expectedM2r)) {
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.RA_RETURN_SNAPSHOT_PRINCIPAL_MISMATCH,
          state: 'SOURCE_INCONSISTENCY',
          wkOrderId,
          involvedItems: involved,
          sourceId: `${det.id}:m2r-formula`,
          expectedRelationship: expectedM2r.toFixed(2),
          observedRelationship:
            det.merchantToRiderAmount == null
              ? 'null'
              : toMoney(det.merchantToRiderAmount).toFixed(2),
          evidenceRefs: [det.id],
        }),
      );
    }
    if (!moneyEq(det.merchantToCustomerAmount, expectedM2c)) {
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.RA_RETURN_SNAPSHOT_ACK_MISMATCH,
          state: 'SOURCE_INCONSISTENCY',
          wkOrderId,
          involvedItems: involved,
          sourceId: `${det.id}:m2c-formula`,
          expectedRelationship: expectedM2c.toFixed(2),
          observedRelationship:
            det.merchantToCustomerAmount == null
              ? 'null'
              : toMoney(det.merchantToCustomerAmount).toFixed(2),
          evidenceRefs: [det.id],
        }),
      );
    }

    const transferAmount = toMoney(det.merchantToRiderAmount ?? expectedM2r);
    if (m2r && !moneyEq(m2r.principal, transferAmount)) {
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.RA_RETURN_SNAPSHOT_PRINCIPAL_MISMATCH,
          state: 'SOURCE_INCONSISTENCY',
          wkOrderId,
          involvedItems: involved,
          sourceId: `${det.id}:m2r-principal`,
          expectedRelationship: transferAmount.toFixed(2),
          observedRelationship: toMoney(m2r.principal).toFixed(2),
          evidenceRefs: [det.id, m2r.id],
        }),
      );
    }
    if (m2c && !moneyEq(m2c.principal, det.merchantToCustomerAmount ?? expectedM2c)) {
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.RA_RETURN_SNAPSHOT_ACK_MISMATCH,
          state: 'SOURCE_INCONSISTENCY',
          wkOrderId,
          involvedItems: involved,
          sourceId: `${det.id}:m2c-principal`,
          expectedRelationship: toMoney(
            det.merchantToCustomerAmount ?? expectedM2c,
          ).toFixed(2),
          observedRelationship: toMoney(m2c.principal).toFixed(2),
          evidenceRefs: [det.id, m2c.id],
        }),
      );
    }

    if (m2r && m2r.creditorUserId !== raRow.riderId) {
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.RA_RETURN_CREDITOR_MISMATCH,
          state: 'SOURCE_INCONSISTENCY',
          wkOrderId,
          involvedItems: involved,
          sourceId: det.id,
          expectedRelationship: raRow.riderId,
          observedRelationship: m2r.creditorUserId,
          evidenceRefs: [det.id, m2r.id],
        }),
      );
    }

    const actives = activeRestrictions(
      ctx.restrictions,
      det.riderAdvanceId,
      det.id,
    );
    if (transferAmount.gt(0)) {
      if (actives.length === 0) {
        findings.push(
          finding({
            code: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
            state: 'OVERLAP_REVIEW_REQUIRED',
            wkOrderId,
            involvedItems: involved,
            sourceId: det.id,
            expectedRelationship: `ACTIVE restriction ${transferAmount.toFixed(2)}`,
            observedRelationship: 'none',
            evidenceRefs: [det.id],
          }),
        );
        if (m2r) {
          relatedItems.push(
            relation({
              fromRail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
              fromObligationId: ra.obligationId,
              rail: RAIL_RETURN_FINANCIAL,
              obligationId: m2r.id,
              relation: 'POTENTIAL_OVERLAP',
            }),
          );
        }
      } else if (actives.length > 1) {
        findings.push(
          finding({
            code: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MULTIPLE,
            state: 'SOURCE_INCONSISTENCY',
            wkOrderId,
            involvedItems: involved,
            sourceId: det.id,
            expectedRelationship: 'exactly one ACTIVE restriction',
            observedRelationship: String(actives.length),
            evidenceRefs: actives.map((r) => r.id),
          }),
        );
      } else {
        const restricted = toMoney(actives[0].restrictedAmount);
        if (!restricted.eq(transferAmount)) {
          findings.push(
            finding({
              code: RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_AMOUNT_MISMATCH,
              state: 'SOURCE_INCONSISTENCY',
              wkOrderId,
              involvedItems: involved,
              sourceId: det.id,
              expectedRelationship: transferAmount.toFixed(2),
              observedRelationship: restricted.toFixed(2),
              evidenceRefs: [actives[0].id],
            }),
          );
          const m2rItem = m2r ? returnItem(items, m2r.id) : undefined;
          const collectible = toMoney(ra.collectibleRemaining);
          if (
            restricted.lt(transferAmount) &&
            collectible.gt(0) &&
            m2rItem &&
            toMoney(m2rItem.remainingAmount).gt(0)
          ) {
            findings.push(
              finding({
                code: RECONCILIATION_FINDING_CODES.RA_RETURN_DOUBLE_COLLECTIBLE,
                state: 'OVERLAP_REVIEW_REQUIRED',
                wkOrderId,
                involvedItems: involved,
                sourceId: det.id,
                expectedRelationship: 'collectibleRemaining=0 after transfer',
                observedRelationship: `collectible=${collectible.toFixed(2)} merchantToRiderRemaining=${toMoney(m2rItem.remainingAmount).toFixed(2)}`,
                evidenceRefs: [actives[0].id, m2rItem.obligationId],
              }),
            );
            relatedItems.push(
              relation({
                fromRail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
                fromObligationId: ra.obligationId,
                rail: RAIL_RETURN_FINANCIAL,
                obligationId: m2rItem.obligationId,
                relation: 'POTENTIAL_OVERLAP',
              }),
            );
          }
        }
      }
    }

    const transferFindings = findings.slice(before);
    const coherent =
      transferFindings.length === 0 &&
      m2r != null &&
      transferAmount.gt(0) &&
      actives.length === 1 &&
      moneyEq(actives[0].restrictedAmount, transferAmount) &&
      m2r.creditorUserId === raRow.riderId &&
      moneyEq(det.snapshotPrincipal, ra.originalPrincipal) &&
      moneyEq(det.snapshotReimbursed, ra.settledAmount) &&
      moneyEq(det.merchantToRiderAmount, expectedM2r) &&
      moneyEq(det.merchantToCustomerAmount, expectedM2c) &&
      moneyEq(m2r.principal, transferAmount) &&
      currencies.size === 1;

    if (coherent && m2r) {
      relatedItems.push(
        relation({
          fromRail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
          fromObligationId: ra.obligationId,
          rail: RAIL_RETURN_FINANCIAL,
          obligationId: m2r.id,
          relation: 'COLLECTION_TRANSFERRED_TO_RETURN',
        }),
      );
    }
  }

  return { findings, relatedItems };
}

function classifySubjectMatch(input: {
  wkOrderId: number;
  loss: DetectorEconomicLoss;
  det: DetectorReturnDetermination;
  coverages: DetectorCoverage[];
}): ReconciliationSubjectMatch {
  const scope = buildStage9EconomicScope({
    wkOrderId: input.wkOrderId,
    path:
      input.det.path === PATH_ORDINARY_MERCHANT_PAYMENT
        ? PATH_ORDINARY_MERCHANT_PAYMENT
        : PATH_RIDER_ADVANCE,
    grossPrincipal: input.det.snapshotPrincipal ?? 0,
    merchantToRiderAmount: input.det.merchantToRiderAmount ?? 0,
    merchantToCustomerAmount: input.det.merchantToCustomerAmount ?? 0,
    riderAdvanceId: input.det.riderAdvanceId,
  });
  const exact = stage9OrderMoneyOverlapsSubject({
    wkOrderId: input.wkOrderId,
    subjectRef: input.loss.subjectRef,
  });
  const contained = stage12LossContainedInStage9Scope({
    scope,
    lossKind: input.loss.lossKind,
    subjectRef: input.loss.subjectRef,
  });
  if (exact && contained) return 'EXACT';
  if (contained) return 'CONTAINED';
  const linked = input.coverages.some(
    (c) =>
      c.economicLossId === input.loss.id &&
      c.sourceKind === EconomicLossCoverageSourceKind.STAGE9_OBLIGATION,
  );
  if (linked) return 'RELATED';
  if (scope.includedLossKinds.includes(input.loss.lossKind) && !contained) {
    return 'UNKNOWN';
  }
  return 'NOT_APPLICABLE';
}

function coveringStage9Obligations(
  det: DetectorReturnDetermination,
  lossKind: EconomicLossKind,
): DetectorReturnObligation[] {
  return det.obligations.filter((o) =>
    stage9ObligationCoversLossKind(
      o.type as ReturnFinancialObligationType,
      lossKind,
    ),
  );
}

export function detectCoverageConsistency(
  items: FinancialReconciliationItem[],
  ctx: ReconciliationReadContext,
): DetectorOutput {
  const findings: ReconciliationFinding[] = [];
  const relatedItems: ReconciliationRelatedItem[] = [];
  const wkOrderId = ctx.wkOrderId;
  const stage9OblById = new Map<string, DetectorReturnObligation>();
  const detByOblId = new Map<string, DetectorReturnDetermination>();
  for (const det of ctx.returnDeterminations) {
    for (const obl of det.obligations) {
      stage9OblById.set(obl.id, obl);
      detByOblId.set(obl.id, det);
    }
  }
  const lossById = new Map(ctx.economicLosses.map((l) => [l.id, l]));

  for (const loss of ctx.economicLosses) {
    const rows = ctx.coverages.filter((c) => c.economicLossId === loss.id);
    let covered = toMoney(0);
    for (const row of rows) {
      covered = covered.add(toMoney(row.amount)).toDecimalPlaces(2);
    }
    if (covered.gt(toMoney(loss.compensableAmount))) {
      const involved = items
        .filter(
          (i) =>
            i.economicLossId === loss.id && i.rail === RAIL_EXCEPTION_FINANCIAL,
        )
        .map((i) => ({
          rail: i.rail,
          obligationId: i.obligationId,
        }));
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.COVERAGE_EXCEEDS_COMPENSABLE,
          state: 'COVERAGE_REVIEW_REQUIRED',
          wkOrderId,
          involvedItems: involved,
          sourceId: loss.id,
          expectedRelationship: toMoney(loss.compensableAmount).toFixed(2),
          observedRelationship: covered.toFixed(2),
          evidenceRefs: rows.map((r) => r.id),
        }),
      );
    }
    if (loss.currency && rows.some((r) => r.currency !== loss.currency)) {
      const involved = items
        .filter(
          (i) =>
            i.economicLossId === loss.id && i.rail === RAIL_EXCEPTION_FINANCIAL,
        )
        .map((i) => ({
          rail: i.rail,
          obligationId: i.obligationId,
        }));
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.CURRENCY_MISMATCH,
          state: 'SOURCE_INCONSISTENCY',
          wkOrderId,
          involvedItems: involved,
          sourceId: `${loss.id}:coverage-currency`,
          expectedRelationship: loss.currency,
          observedRelationship: rows.map((r) => r.currency).join(','),
          evidenceRefs: rows.map((r) => r.id),
        }),
      );
    }
  }

  const stage9ByLoss = new Map<string, Set<string>>();
  for (const row of ctx.coverages) {
    if (row.sourceKind !== EconomicLossCoverageSourceKind.STAGE9_OBLIGATION) {
      continue;
    }
    const oblId = row.stage9ObligationId ?? row.sourceRef;
    const set = stage9ByLoss.get(row.economicLossId) ?? new Set();
    if (set.has(oblId)) {
      const loss = lossById.get(row.economicLossId);
      const involved: ReconciliationFindingInvolvedItem[] = [];
      if (stage9OblById.has(oblId)) {
        involved.push({ rail: RAIL_RETURN_FINANCIAL, obligationId: oblId });
      }
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.COVERAGE_DUPLICATE_SEMANTIC,
          state: 'COVERAGE_REVIEW_REQUIRED',
          wkOrderId,
          involvedItems: involved,
          sourceId: `${row.economicLossId}:${oblId}`,
          expectedRelationship: 'one STAGE9_OBLIGATION coverage per obligation',
          observedRelationship: 'duplicate source refs',
          evidenceRefs: ctx.coverages
            .filter(
              (c) =>
                c.economicLossId === row.economicLossId &&
                (c.stage9ObligationId === oblId || c.sourceRef === oblId),
            )
            .map((c) => c.id),
          subjectMatch: loss ? 'RELATED' : undefined,
        }),
      );
    }
    set.add(oblId);
    stage9ByLoss.set(row.economicLossId, set);

    const obl = stage9OblById.get(row.sourceRef) ??
      (row.stage9ObligationId
        ? stage9OblById.get(row.stage9ObligationId)
        : undefined);
    if (!obl) {
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.COVERAGE_SOURCE_MISSING,
          state: 'SOURCE_INCONSISTENCY',
          wkOrderId,
          involvedItems: [],
          sourceId: row.id,
          expectedRelationship: row.stage9ObligationId ?? row.sourceRef,
          observedRelationship: 'obligation not in FINALIZED Stage9 set',
          evidenceRefs: [row.id],
        }),
      );
      continue;
    }

    const loss = lossById.get(row.economicLossId);
    const det = detByOblId.get(obl.id);
    if (loss && det) {
      const match = classifySubjectMatch({
        wkOrderId,
        loss,
        det,
        coverages: [row],
      });
      if (
        match === 'NOT_APPLICABLE' &&
        !stage9ObligationCoversLossKind(
          obl.type as ReturnFinancialObligationType,
          loss.lossKind,
        )
      ) {
        findings.push(
          finding({
            code: RECONCILIATION_FINDING_CODES.COVERAGE_WRONG_LOSS,
            state: 'COVERAGE_REVIEW_REQUIRED',
            wkOrderId,
            involvedItems: [
              { rail: RAIL_RETURN_FINANCIAL, obligationId: obl.id },
            ],
            sourceId: row.id,
            expectedRelationship: `loss kinds covered by ${obl.type}`,
            observedRelationship: `${loss.lossKind} ${loss.subjectRef}`,
            evidenceRefs: [row.id, loss.id],
            subjectMatch: match,
          }),
        );
      } else if (match === 'EXACT' || match === 'CONTAINED' || match === 'RELATED') {
        const coveredItem = items.find(
          (i) =>
            i.rail === RAIL_EXCEPTION_FINANCIAL &&
            i.economicLossId === loss.id,
        );
        if (coveredItem) {
          relatedItems.push(
            relation({
              fromRail: RAIL_RETURN_FINANCIAL,
              fromObligationId: obl.id,
              rail: RAIL_EXCEPTION_FINANCIAL,
              obligationId: coveredItem.obligationId,
              relation: 'ECONOMIC_LOSS_COVERED_BY_RETURN',
            }),
          );
        }
      }

      const priorSameLoss = ctx.coverages.filter(
        (c) =>
          c.economicLossId === row.economicLossId &&
          c.createdAt < row.createdAt,
      );
      let already = toMoney(0);
      for (const p of priorSameLoss) {
        already = already.add(toMoney(p.amount)).toDecimalPlaces(2);
      }
      const cap = maxImportableCoverage({
        compensableAmount: loss?.compensableAmount ?? 0,
        alreadyCoveredAmount: already,
        candidateAmount: obl.principal,
      });
      const amount = toMoney(row.amount);
      if (!amount.eq(toMoney(obl.principal)) && !amount.eq(cap)) {
        findings.push(
          finding({
            code: RECONCILIATION_FINDING_CODES.STAGE9_COVERAGE_AMOUNT_MISMATCH,
            state: 'COVERAGE_REVIEW_REQUIRED',
            wkOrderId,
            involvedItems: [
              { rail: RAIL_RETURN_FINANCIAL, obligationId: obl.id },
            ],
            sourceId: row.id,
            expectedRelationship: `principal=${toMoney(obl.principal).toFixed(2)} or cap=${cap.toFixed(2)}`,
            observedRelationship: amount.toFixed(2),
            evidenceRefs: [row.id],
          }),
        );
      }
    }
  }

  return { findings, relatedItems };
}

export function detectStage9Stage12Overlap(
  items: FinancialReconciliationItem[],
  ctx: ReconciliationReadContext,
): DetectorOutput {
  const findings: ReconciliationFinding[] = [];
  const relatedItems: ReconciliationRelatedItem[] = [];
  const wkOrderId = ctx.wkOrderId;
  if (ctx.returnDeterminations.length === 0) {
    return { findings, relatedItems };
  }

  const exceptionItems = items.filter(
    (i) =>
      i.rail === RAIL_EXCEPTION_FINANCIAL &&
      !i.flags.nonExecutable &&
      toMoney(i.remainingAmount).gt(0),
  );

  for (const ex of exceptionItems) {
    const loss = ctx.economicLosses.find((l) => l.id === ex.economicLossId);
    if (!loss) continue;
    let proven = false;
    let unknown = false;
    for (const det of ctx.returnDeterminations) {
      const match = classifySubjectMatch({
        wkOrderId,
        loss,
        det,
        coverages: ctx.coverages.filter((c) => c.economicLossId === loss.id),
      });
      if (match === 'NOT_APPLICABLE') continue;
      if (match === 'UNKNOWN') {
        unknown = true;
        continue;
      }
      proven = true;
      const covering = coveringStage9Obligations(det, loss.lossKind);
      if (covering.length === 0) continue;
      const stage9Coverage = ctx.coverages.filter(
        (c) =>
          c.economicLossId === loss.id &&
          c.sourceKind === EconomicLossCoverageSourceKind.STAGE9_OBLIGATION,
      );
      const involved: ReconciliationFindingInvolvedItem[] = [
        { rail: RAIL_EXCEPTION_FINANCIAL, obligationId: ex.obligationId },
        ...covering.map((o) => ({
          rail: RAIL_RETURN_FINANCIAL,
          obligationId: o.id,
        })),
      ];
      if (stage9Coverage.length === 0) {
        findings.push(
          finding({
            code: RECONCILIATION_FINDING_CODES.STAGE9_COVERAGE_MISSING,
            state: 'COVERAGE_REVIEW_REQUIRED',
            wkOrderId,
            involvedItems: involved,
            sourceId: `${det.id}:${loss.id}`,
            expectedRelationship: 'STAGE9_OBLIGATION coverage on contained loss',
            observedRelationship: 'missing',
            evidenceRefs: [det.id, loss.id],
            subjectMatch: match,
          }),
        );
        const stage9Remaining = covering.some((o) => {
          const item = returnItem(items, o.id);
          return item && toMoney(item.remainingAmount).gt(0);
        });
        if (stage9Remaining) {
          findings.push(
            finding({
              code: RECONCILIATION_FINDING_CODES.STAGE9_COVERAGE_MISSING,
              state: 'OVERLAP_REVIEW_REQUIRED',
              wkOrderId,
              involvedItems: involved,
              sourceId: `${det.id}:${loss.id}:overlap`,
              expectedRelationship: 'Stage9 coverage accounts for contained loss',
              observedRelationship:
                'Stage9 remaining and Stage12 remaining both executable',
              evidenceRefs: [det.id, loss.id],
              subjectMatch: match,
            }),
          );
          for (const o of covering) {
            relatedItems.push(
              relation({
                fromRail: RAIL_RETURN_FINANCIAL,
                fromObligationId: o.id,
                rail: RAIL_EXCEPTION_FINANCIAL,
                obligationId: ex.obligationId,
                relation: 'POTENTIAL_OVERLAP',
              }),
            );
          }
        }
      }
    }
    if (unknown && !proven) {
      const involved: ReconciliationFindingInvolvedItem[] = [
        { rail: RAIL_EXCEPTION_FINANCIAL, obligationId: ex.obligationId },
      ];
      for (const det of ctx.returnDeterminations) {
        for (const o of det.obligations) {
          involved.push({ rail: RAIL_RETURN_FINANCIAL, obligationId: o.id });
        }
      }
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.SUBJECT_MATCH_UNKNOWN,
          state: 'REVIEW_REQUIRED',
          wkOrderId,
          involvedItems: involved,
          sourceId: loss.id,
          expectedRelationship: 'EXACT or CONTAINED subject',
          observedRelationship: loss.subjectRef,
          evidenceRefs: [loss.id],
          subjectMatch: 'UNKNOWN',
          checkOutcome: 'INSUFFICIENT_LINKAGE',
        }),
      );
    }
  }

  return { findings, relatedItems };
}

function isFinalizedDet(d: DetectorLiabilityDetermination): boolean {
  return d.status === LiabilityDeterminationStatus.FINALIZED;
}

export function detectSuccessorTopology(
  items: FinancialReconciliationItem[],
  ctx: ReconciliationReadContext,
): DetectorOutput {
  const findings: ReconciliationFinding[] = [];
  const relatedItems: ReconciliationRelatedItem[] = [];
  const wkOrderId = ctx.wkOrderId;
  const byId = new Map(ctx.liabilityDeterminations.map((d) => [d.id, d]));
  const children = new Map<string, DetectorLiabilityDetermination[]>();
  for (const d of ctx.liabilityDeterminations) {
    if (!d.adjustmentOfDeterminationId) continue;
    const list = children.get(d.adjustmentOfDeterminationId) ?? [];
    list.push(d);
    children.set(d.adjustmentOfDeterminationId, list);
  }

  const visitedGlobal = new Set<string>();
  const cycleIds = new Set<string>();
  const recStack: string[] = [];
  const visit = (id: string, depth: number): void => {
    if (depth > SUCCESSOR_TRAVERSAL_CAP) return;
    if (recStack.includes(id)) {
      cycleIds.add(id);
      return;
    }
    if (visitedGlobal.has(id)) return;
    visitedGlobal.add(id);
    recStack.push(id);
    for (const child of children.get(id) ?? []) {
      visit(child.id, depth + 1);
    }
    recStack.pop();
  };
  for (const d of ctx.liabilityDeterminations) {
    if (!d.adjustmentOfDeterminationId) visit(d.id, 0);
  }
  for (const d of ctx.liabilityDeterminations) {
    if (!visitedGlobal.has(d.id)) visit(d.id, 0);
  }

  if (cycleIds.size > 0) {
    const involved: ReconciliationFindingInvolvedItem[] = [];
    for (const id of cycleIds) {
      const det = byId.get(id);
      for (const oblId of det?.obligationIds ?? []) {
        involved.push({
          rail: RAIL_EXCEPTION_FINANCIAL,
          obligationId: oblId,
        });
      }
    }
    findings.push(
      finding({
        code: RECONCILIATION_FINDING_CODES.SUCCESSOR_CYCLE_DETECTED,
        state: 'SOURCE_INCONSISTENCY',
        wkOrderId,
        involvedItems: involved,
        sourceId: [...cycleIds].sort().join(','),
        expectedRelationship: 'acyclic successor graph',
        observedRelationship: 'SUCCESSOR_CYCLE_DETECTED',
        evidenceRefs: [...cycleIds].sort(),
      }),
    );
  }

  for (const [parentId, kids] of children) {
    const finalizedKids = kids.filter(isFinalizedDet);
    const parent = byId.get(parentId);
    if (!parent) continue;
    if (finalizedKids.length > 1) {
      const involved: ReconciliationFindingInvolvedItem[] = [];
      for (const oblId of parent.obligationIds) {
        involved.push({
          rail: RAIL_EXCEPTION_FINANCIAL,
          obligationId: oblId,
        });
      }
      for (const kid of finalizedKids) {
        for (const oblId of kid.obligationIds) {
          involved.push({
            rail: RAIL_EXCEPTION_FINANCIAL,
            obligationId: oblId,
          });
        }
      }
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.SUCCESSOR_BRANCH_DETECTED,
          state: 'SOURCE_INCONSISTENCY',
          wkOrderId,
          involvedItems: involved,
          sourceId: parentId,
          expectedRelationship: 'at most one FINALIZED successor',
          observedRelationship: String(finalizedKids.length),
          evidenceRefs: [parentId, ...finalizedKids.map((k) => k.id)],
        }),
      );
    }
    if (finalizedKids.length === 1 && isFinalizedDet(parent)) {
      const child = finalizedKids[0];
      for (const fromId of parent.obligationIds) {
        for (const toId of child.obligationIds) {
          relatedItems.push(
            relation({
              fromRail: RAIL_EXCEPTION_FINANCIAL,
              fromObligationId: fromId,
              rail: RAIL_EXCEPTION_FINANCIAL,
              obligationId: toId,
              relation: 'SUCCESSOR',
            }),
          );
          relatedItems.push(
            relation({
              fromRail: RAIL_EXCEPTION_FINANCIAL,
              fromObligationId: toId,
              rail: RAIL_EXCEPTION_FINANCIAL,
              obligationId: fromId,
              relation: 'SUCCESSOR_OF',
            }),
          );
        }
      }
      const involved: ReconciliationFindingInvolvedItem[] = [
        ...parent.obligationIds.map((id) => ({
          rail: RAIL_EXCEPTION_FINANCIAL,
          obligationId: id,
        })),
        ...child.obligationIds.map((id) => ({
          rail: RAIL_EXCEPTION_FINANCIAL,
          obligationId: id,
        })),
      ];
      findings.push(
        finding({
          code: RECONCILIATION_FINDING_CODES.SUCCESSOR_REVIEW_REQUIRED,
          state: 'SUCCESSOR_REVIEW_REQUIRED',
          wkOrderId,
          involvedItems: involved,
          sourceId: `${parentId}->${child.id}`,
          expectedRelationship: 'historical original remains visible',
          observedRelationship: 'FINALIZED successor',
          evidenceRefs: [parentId, child.id],
        }),
      );
    }
  }

  const byLoss = new Map<string, FinancialReconciliationItem[]>();
  for (const item of items) {
    if (item.rail !== RAIL_EXCEPTION_FINANCIAL || !item.economicLossId) continue;
    const list = byLoss.get(item.economicLossId) ?? [];
    list.push(item);
    byLoss.set(item.economicLossId, list);
  }
  const successorLinked = new Set<string>();
  for (const rel of relatedItems) {
    if (rel.relation === 'SUCCESSOR' || rel.relation === 'SUCCESSOR_OF') {
      successorLinked.add(
        `${rel.fromObligationId ?? ''}:${rel.obligationId}`,
      );
    }
  }
  const ancestorOf = (fromDetId: string, toDetId: string): boolean => {
    const seen = new Set<string>();
    let cur: string | null | undefined = fromDetId;
    let hops = 0;
    while (cur && hops < SUCCESSOR_TRAVERSAL_CAP) {
      if (seen.has(cur)) return false;
      seen.add(cur);
      if (cur === toDetId) return true;
      const node = byId.get(cur);
      cur = node?.adjustmentOfDeterminationId;
      hops += 1;
    }
    return false;
  };

  for (const [lossId, lossItems] of byLoss) {
    const active = lossItems.filter(
      (i) => !i.flags.nonExecutable && toMoney(i.remainingAmount).gt(0),
    );
    if (active.length < 2) continue;
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        const a = active[i];
        const b = active[j];
        const linked =
          (a.determinationId &&
            b.determinationId &&
            (ancestorOf(a.determinationId, b.determinationId) ||
              ancestorOf(b.determinationId, a.determinationId))) ||
          successorLinked.has(`${a.obligationId}:${b.obligationId}`) ||
          successorLinked.has(`${b.obligationId}:${a.obligationId}`);
        if (linked) continue;
        findings.push(
          finding({
            code: RECONCILIATION_FINDING_CODES.EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE,
            state: 'OVERLAP_REVIEW_REQUIRED',
            wkOrderId,
            involvedItems: [
              {
                rail: RAIL_EXCEPTION_FINANCIAL,
                obligationId: a.obligationId,
              },
              {
                rail: RAIL_EXCEPTION_FINANCIAL,
                obligationId: b.obligationId,
              },
            ],
            sourceId: lossId,
            expectedRelationship: 'successor-linked or single active exposure',
            observedRelationship: 'two executable remaining obligations',
            evidenceRefs: [lossId],
          }),
        );
        relatedItems.push(
          relation({
            fromRail: RAIL_EXCEPTION_FINANCIAL,
            fromObligationId: a.obligationId,
            rail: RAIL_EXCEPTION_FINANCIAL,
            obligationId: b.obligationId,
            relation: 'POTENTIAL_OVERLAP',
          }),
        );
      }
    }
  }

  return { findings, relatedItems };
}

export function detectCrossRail(
  items: FinancialReconciliationItem[],
  ctx: ReconciliationReadContext,
): DetectorOutput {
  const parts = [
    detectRiderAdvanceReturnTransfer(items, ctx),
    detectCoverageConsistency(items, ctx),
    detectStage9Stage12Overlap(items, ctx),
    detectSuccessorTopology(items, ctx),
  ];
  return {
    findings: parts.flatMap((p) => p.findings),
    relatedItems: parts.flatMap((p) => p.relatedItems),
  };
}
