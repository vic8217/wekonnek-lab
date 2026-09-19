/**
 * Stage13B-3A HTTP authorization + privacy projection.
 * Pure. Not financial authority. Never writes.
 *
 * Authorization is derived from frozen financial parties only:
 * CUSTOMER/RIDER userId match, MERCHANT Merchant.userId ownership.
 * UserRole.admin is the sole administrative bypass.
 * Shop-portal JWT is deny-only (never a grant).
 */
import { UserRole } from '@prisma/client';
import { groupDirectionalItems, toMoney } from './financial-reconciliation.policy';
import {
  FinancialObligationDto,
  FinancialPartyDto,
  FinancialReconciliationResponseDto,
  ReconciliationFindingDto,
  RelatedFinancialItemDto,
} from './financial-reconciliation.http-dto';
import {
  FINANCIAL_RAIL_IDS,
  FinancialRailId,
  FinancialReconciliationItem,
  NormalizedParty,
  OrderFinancialReconciliation,
  ReconciliationFinding,
  ReconciliationRelatedItem,
} from './financial-reconciliation.types';

export type ReconciliationHttpActor = {
  userId: string;
  role: UserRole;
  ownedMerchantIds: number[];
  portal?: string;
};

export function isFinancialRailId(rail: string): rail is FinancialRailId {
  return (FINANCIAL_RAIL_IDS as readonly string[]).includes(rail);
}

export function actorIsReconciliationAdmin(
  actor: ReconciliationHttpActor,
): boolean {
  return actor.role === UserRole.admin && actor.portal !== 'shop';
}

export function serializeMoney(value: Parameters<typeof toMoney>[0]): string {
  return toMoney(value).toFixed(2);
}

export function itemKey(rail: FinancialRailId, obligationId: string): string {
  return `${rail}:${obligationId}`;
}

function partyMatchesActor(
  party: NormalizedParty,
  actor: ReconciliationHttpActor,
): boolean {
  if (party.type === 'CUSTOMER' || party.type === 'RIDER') {
    return party.userId != null && party.userId === actor.userId;
  }
  if (party.type === 'MERCHANT') {
    return (
      party.merchantId != null &&
      actor.ownedMerchantIds.includes(party.merchantId)
    );
  }
  return false;
}

/**
 * Frozen financial-party predicate. Does not consult WkOrder ownership,
 * fulfillment assignment, custody, staff membership, or coordinator/staff roles.
 */
export function itemVisibleToActor(
  item: FinancialReconciliationItem,
  actor: ReconciliationHttpActor,
): boolean {
  if (actorIsReconciliationAdmin(actor)) return true;
  if (actor.portal === 'shop') return false;
  return (
    partyMatchesActor(item.debtor, actor) ||
    partyMatchesActor(item.creditor, actor)
  );
}

export function visibleItemKeySet(
  items: FinancialReconciliationItem[],
): Set<string> {
  return new Set(items.map((item) => itemKey(item.rail, item.obligationId)));
}

export function findingVisibleToParticipant(
  finding: ReconciliationFinding,
  visibleKeys: Set<string>,
): boolean {
  if (finding.involvedItems.length === 0) return false;
  return finding.involvedItems.every((involved) =>
    visibleKeys.has(itemKey(involved.rail, involved.obligationId)),
  );
}

export function relatedItemVisibleToParticipant(
  rel: ReconciliationRelatedItem,
  visibleKeys: Set<string>,
): boolean {
  if (!visibleKeys.has(itemKey(rel.rail, rel.obligationId))) return false;
  if (rel.fromRail != null && rel.fromObligationId != null) {
    return visibleKeys.has(itemKey(rel.fromRail, rel.fromObligationId));
  }
  return true;
}

function partyDto(party: NormalizedParty): FinancialPartyDto {
  return {
    type: party.type,
    userId: party.userId,
    merchantId: party.merchantId,
  };
}

function relatedDto(rel: ReconciliationRelatedItem): RelatedFinancialItemDto {
  const dto: RelatedFinancialItemDto = {
    rail: rel.rail,
    obligationId: rel.obligationId,
    relation: rel.relation,
  };
  if (rel.fromRail != null) dto.fromRail = rel.fromRail;
  if (rel.fromObligationId != null) dto.fromObligationId = rel.fromObligationId;
  return dto;
}

function mapVisibleRelated(
  related: ReconciliationRelatedItem[] | undefined,
  visibleKeys: Set<string> | null,
): RelatedFinancialItemDto[] {
  const rows = related ?? [];
  const kept =
    visibleKeys == null
      ? rows
      : rows.filter((rel) => relatedItemVisibleToParticipant(rel, visibleKeys));
  return kept.map(relatedDto);
}

function mapObligation(
  item: FinancialReconciliationItem,
  mode: 'admin' | 'participant',
  visibleKeys: Set<string> | null,
): FinancialObligationDto {
  const dto: FinancialObligationDto = {
    rail: item.rail,
    obligationId: item.obligationId,
    wkOrderId: item.wkOrderId,
    debtor: partyDto(item.debtor),
    creditor: partyDto(item.creditor),
    originalPrincipal: serializeMoney(item.originalPrincipal),
    settledAmount: serializeMoney(item.settledAmount),
    remainingAmount: serializeMoney(item.remainingAmount),
    currency: item.currency,
    financialState: item.financialState,
    flags: {
      disputed: item.flags.disputed,
      nonExecutable: item.flags.nonExecutable,
      collectionRestricted: item.flags.collectionRestricted,
      reconciliationRequired: item.flags.reconciliationRequired,
    },
    reconciliationState: item.reconciliationState,
    relatedItems: mapVisibleRelated(item.relatedItems, visibleKeys),
    createdAt: item.createdAt.toISOString(),
  };
  if (item.collectibleRemaining != null) {
    dto.collectibleRemaining = serializeMoney(item.collectibleRemaining);
  }
  if (item.reasonCode != null) dto.reasonCode = item.reasonCode;
  if (item.disputeState != null) dto.disputeState = item.disputeState;
  if (item.lastFinancialActivityAt != null) {
    dto.lastFinancialActivityAt = item.lastFinancialActivityAt.toISOString();
  }
  if (mode === 'admin') {
    dto.sourceType = item.sourceType;
    dto.sourceId = item.sourceId;
    if (item.economicLossId != null) dto.economicLossId = item.economicLossId;
    if (item.determinationId != null) dto.determinationId = item.determinationId;
    if (item.riderAdvanceId != null) dto.riderAdvanceId = item.riderAdvanceId;
    if (item.returnFinancialDeterminationId != null) {
      dto.returnFinancialDeterminationId = item.returnFinancialDeterminationId;
    }
    dto.sourceRefs = {
      settlementIds: [...item.sourceRefs.settlementIds],
      acknowledgedSettlementIds: [...item.sourceRefs.acknowledgedSettlementIds],
      coverageIds: [...item.sourceRefs.coverageIds],
      ...(item.sourceRefs.successorDeterminationId != null
        ? {
            successorDeterminationId: item.sourceRefs.successorDeterminationId,
          }
        : {}),
    };
  }
  return dto;
}

function mapFinding(
  finding: ReconciliationFinding,
  mode: 'admin' | 'participant',
): ReconciliationFindingDto {
  const dto: ReconciliationFindingDto = {
    findingKey: finding.findingKey,
    code: finding.code,
    reconciliationState: finding.reconciliationState,
    checkOutcome: finding.checkOutcome,
    involvedItems: finding.involvedItems.map((involved) => ({
      rail: involved.rail,
      obligationId: involved.obligationId,
    })),
    explanationCode: finding.explanationCode,
  };
  if (mode === 'admin') {
    dto.wkOrderId = finding.wkOrderId;
    if (finding.subjectMatch != null) dto.subjectMatch = finding.subjectMatch;
    if (finding.expectedRelationship != null) {
      dto.expectedRelationship = finding.expectedRelationship;
    }
    if (finding.observedRelationship != null) {
      dto.observedRelationship = finding.observedRelationship;
    }
    dto.evidenceRefs = [...finding.evidenceRefs];
  }
  return dto;
}

function participantOrderDto(
  view: OrderFinancialReconciliation,
  visibleItems: FinancialReconciliationItem[],
): FinancialReconciliationResponseDto {
  const visibleKeys = visibleItemKeySet(visibleItems);
  const findings = view.findings.filter((finding) =>
    findingVisibleToParticipant(finding, visibleKeys),
  );
  const relatedItems = view.relatedItems.filter((rel) =>
    relatedItemVisibleToParticipant(rel, visibleKeys),
  );
  const groups = groupDirectionalItems(visibleItems);
  return {
    wkOrderId: view.wkOrderId,
    items: visibleItems.map((item) =>
      mapObligation(item, 'participant', visibleKeys),
    ),
    directionalGroups: groups.map((group) => ({
      key: group.key,
      originalPrincipal: serializeMoney(group.originalPrincipal),
      settledAmount: serializeMoney(group.settledAmount),
      remainingAmount: serializeMoney(group.remainingAmount),
      itemIds: [...group.itemIds],
    })),
    findings: findings.map((finding) => mapFinding(finding, 'participant')),
    relatedItems: relatedItems.map(relatedDto),
    hasOutstanding: visibleItems.some((item) =>
      toMoney(item.remainingAmount).gt(0),
    ),
    hasDispute: visibleItems.some((item) => item.flags.disputed),
    hasReconciliationIssue: findings.length > 0,
  };
}

function adminOrderDto(
  view: OrderFinancialReconciliation,
): FinancialReconciliationResponseDto {
  return {
    wkOrderId: view.wkOrderId,
    items: view.items.map((item) => mapObligation(item, 'admin', null)),
    directionalGroups: view.directionalGroups.map((group) => ({
      key: group.key,
      originalPrincipal: serializeMoney(group.originalPrincipal),
      settledAmount: serializeMoney(group.settledAmount),
      remainingAmount: serializeMoney(group.remainingAmount),
      itemIds: [...group.itemIds],
    })),
    findings: view.findings.map((finding) => mapFinding(finding, 'admin')),
    relatedItems: view.relatedItems.map(relatedDto),
    hasOutstanding: view.hasOutstanding,
    hasDispute: view.hasDispute,
    hasReconciliationIssue: view.hasReconciliationIssue,
  };
}

export function projectOrderReconciliation(
  view: OrderFinancialReconciliation,
  actor: ReconciliationHttpActor,
):
  | { status: 'ok'; body: FinancialReconciliationResponseDto }
  | { status: 'forbidden' } {
  if (actorIsReconciliationAdmin(actor)) {
    return { status: 'ok', body: adminOrderDto(view) };
  }
  const visibleItems = view.items.filter((item) =>
    itemVisibleToActor(item, actor),
  );
  if (visibleItems.length === 0) {
    return { status: 'forbidden' };
  }
  return {
    status: 'ok',
    body: participantOrderDto(view, visibleItems),
  };
}

export function projectObligation(
  item: FinancialReconciliationItem | null,
  actor: ReconciliationHttpActor,
):
  | { status: 'ok'; body: FinancialObligationDto }
  | { status: 'not_found' } {
  if (item == null) return { status: 'not_found' };
  if (!itemVisibleToActor(item, actor)) return { status: 'not_found' };
  const mode = actorIsReconciliationAdmin(actor) ? 'admin' : 'participant';
  const visibleKeys =
    mode === 'admin' ? null : visibleItemKeySet([item]);
  return {
    status: 'ok',
    body: mapObligation(item, mode, visibleKeys),
  };
}
