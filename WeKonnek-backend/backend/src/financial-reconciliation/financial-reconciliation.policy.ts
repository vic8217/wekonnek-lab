/**
 * Stage13B-1 pure read-derivation helpers.
 * Decimal-safe. Never writes. Never nets opposite directions.
 */
import { Prisma } from '@prisma/client';
import {
  DerivedFinancialState,
  DirectionalGroup,
  DirectionalGroupKey,
  FinancialReconciliationItem,
  NormalizedParty,
  ReconciliationFlags,
  ReconciliationPartyType,
  ReconciliationState,
} from './financial-reconciliation.types';

export const toMoney = (v: Prisma.Decimal.Value | null | undefined): Prisma.Decimal =>
  new Prisma.Decimal(v ?? 0).toDecimalPlaces(2);

export function assertNotPlatformParty(type: string): ReconciliationPartyType {
  if (type === 'CUSTOMER' || type === 'MERCHANT' || type === 'RIDER') {
    return type;
  }
  throw new Error(
    `PLATFORM_FIREWALL: unsupported reconciliation party type ${type}`,
  );
}

export function customerParty(userId: string): NormalizedParty {
  return { type: 'CUSTOMER', userId, merchantId: null };
}

export function riderParty(userId: string): NormalizedParty {
  return { type: 'RIDER', userId, merchantId: null };
}

export function merchantParty(merchantId: number): NormalizedParty {
  return { type: 'MERCHANT', userId: null, merchantId };
}

export function partyFromFields(input: {
  type: string;
  userId: string | null;
  merchantId: number | null;
}): NormalizedParty {
  const type = assertNotPlatformParty(input.type);
  if (type === 'MERCHANT') {
    if (input.merchantId == null) {
      throw new Error(
        'Merchant economic identity requires merchantId; userId is not a substitute',
      );
    }
    return merchantParty(input.merchantId);
  }
  if (input.userId == null) {
    throw new Error(`${type} party requires userId`);
  }
  return { type, userId: input.userId, merchantId: null };
}

export function sumAcknowledgedAmounts(
  rows: Array<{ status: string; acknowledgedAmount: Prisma.Decimal | null }>,
): Prisma.Decimal {
  let settled = toMoney(0);
  for (const row of rows) {
    if (row.status !== 'ACKNOWLEDGED') continue;
    if (row.acknowledgedAmount != null) {
      settled = settled.add(toMoney(row.acknowledgedAmount));
    }
  }
  return settled.toDecimalPlaces(2);
}

export function remainingAmount(
  principal: Prisma.Decimal.Value,
  settled: Prisma.Decimal.Value,
): Prisma.Decimal {
  const remaining = toMoney(principal).sub(toMoney(settled)).toDecimalPlaces(2);
  return remaining.lt(0) ? toMoney(0) : remaining;
}

/**
 * Stage5B overlay only. Restriction is NOT settlement.
 * collectibleRemaining = max(0, principal − Σ ACK − Σ ACTIVE restrictedAmount)
 */
export function collectibleRemainingAmount(
  principal: Prisma.Decimal.Value,
  settled: Prisma.Decimal.Value,
  restricted: Prisma.Decimal.Value,
): Prisma.Decimal {
  const remaining = toMoney(principal)
    .sub(toMoney(settled))
    .sub(toMoney(restricted))
    .toDecimalPlaces(2);
  return remaining.lt(0) ? toMoney(0) : remaining;
}

export function sumActiveRestrictedAmounts(
  rows: Array<{ status: string; restrictedAmount: Prisma.Decimal }>,
): Prisma.Decimal {
  let restricted = toMoney(0);
  for (const row of rows) {
    if (row.status !== 'ACTIVE') continue;
    restricted = restricted.add(toMoney(row.restrictedAmount));
  }
  return restricted.toDecimalPlaces(2);
}

export function deriveFinancialState(
  principal: Prisma.Decimal.Value,
  settledAmount: Prisma.Decimal.Value,
): DerivedFinancialState {
  const p = toMoney(principal);
  const s = toMoney(settledAmount);
  if (s.lte(0)) return 'UNPAID';
  if (p.gt(0) && s.gte(p)) return 'SETTLED';
  return 'PARTIALLY_SETTLED';
}

export function emptyFlags(
  overrides: Partial<ReconciliationFlags> = {},
): ReconciliationFlags {
  return {
    disputed: false,
    nonExecutable: false,
    collectionRestricted: false,
    reconciliationRequired: false,
    ...overrides,
  };
}

export function flagsFromState(input: {
  disputed?: boolean;
  nonExecutable?: boolean;
  collectionRestricted?: boolean;
  reconciliationState: ReconciliationState;
}): ReconciliationFlags {
  return emptyFlags({
    disputed: input.disputed === true,
    nonExecutable: input.nonExecutable === true,
    collectionRestricted: input.collectionRestricted === true,
    reconciliationRequired: input.reconciliationState !== 'CLEAR',
  });
}

export function lastActivityAt(
  createdAt: Date,
  settlements: Array<{
    status: string;
    acknowledgedAt: Date | null;
    createdAt: Date;
  }>,
): Date | undefined {
  let latest: Date | undefined;
  for (const row of settlements) {
    const at =
      row.status === 'ACKNOWLEDGED' && row.acknowledgedAt
        ? row.acknowledgedAt
        : row.createdAt;
    if (!latest || at > latest) latest = at;
  }
  if (!latest) return createdAt;
  return latest;
}

export function partyKey(party: NormalizedParty): string {
  if (party.type === 'MERCHANT') return `MERCHANT:${party.merchantId}`;
  return `${party.type}:${party.userId}`;
}

export function directionalGroupKey(
  item: Pick<
    FinancialReconciliationItem,
    'currency' | 'debtor' | 'creditor' | 'rail'
  >,
): DirectionalGroupKey {
  return {
    currency: item.currency,
    debtorType: item.debtor.type,
    debtorUserId: item.debtor.userId,
    debtorMerchantId: item.debtor.merchantId,
    creditorType: item.creditor.type,
    creditorUserId: item.creditor.userId,
    creditorMerchantId: item.creditor.merchantId,
    rail: item.rail,
  };
}

export function directionalGroupKeyString(key: DirectionalGroupKey): string {
  return [
    key.currency,
    `${key.debtorType}:${key.debtorUserId ?? ''}:${key.debtorMerchantId ?? ''}`,
    `${key.creditorType}:${key.creditorUserId ?? ''}:${key.creditorMerchantId ?? ''}`,
    key.rail,
  ].join('|');
}

/**
 * Group by currency + debtor + creditor + rail.
     * Sums only within a group. Never nets opposite directions.
     * Never produces a net order balance.
 */
export function groupDirectionalItems(
  items: FinancialReconciliationItem[],
): DirectionalGroup[] {
  const map = new Map<string, DirectionalGroup>();
  for (const item of items) {
    const key = directionalGroupKey(item);
    const id = directionalGroupKeyString(key);
    const existing = map.get(id);
    if (!existing) {
      map.set(id, {
        key,
        originalPrincipal: toMoney(item.originalPrincipal),
        settledAmount: toMoney(item.settledAmount),
        remainingAmount: toMoney(item.remainingAmount),
        itemIds: [item.obligationId],
      });
      continue;
    }
    existing.originalPrincipal = existing.originalPrincipal
      .add(toMoney(item.originalPrincipal))
      .toDecimalPlaces(2);
    existing.settledAmount = existing.settledAmount
      .add(toMoney(item.settledAmount))
      .toDecimalPlaces(2);
    existing.remainingAmount = existing.remainingAmount
      .add(toMoney(item.remainingAmount))
      .toDecimalPlaces(2);
    existing.itemIds.push(item.obligationId);
  }
  return [...map.values()];
}
