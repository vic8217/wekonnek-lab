/**
 * Stage14B-1 display helpers. No financial arithmetic.
 * Server amounts are shown as returned strings.
 */

function formatMoneyAmount(raw: string): string {
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return raw;
  const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return match[3] != null
    ? `${match[1]}${grouped}.${match[3]}`
    : `${match[1]}${grouped}`;
}

export function displayServerField(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return `${value}`;
  if (value instanceof Date) return value.toISOString();
  return '—';
}

export function displayServerAmount(
  amount: unknown,
  currency: unknown,
): string {
  if (typeof amount !== 'string' || amount.trim() === '') return '—';
  const code = typeof currency === 'string' && currency.trim() ? currency : '';
  const formatted = formatMoneyAmount(amount);
  return code ? `${formatted} ${code}`.trim() : formatted;
}

export function partyRoleLabel(type: unknown): string {
  if (type === 'CUSTOMER') return 'Customer';
  if (type === 'MERCHANT') return 'Merchant';
  if (type === 'RIDER') return 'Rider';
  return displayServerField(type);
}

export function expectedOrderMatches(
  expectedWkOrderId: string | null,
  actualWkOrderId: unknown,
): boolean {
  if (expectedWkOrderId == null || expectedWkOrderId === '') return true;
  return `${actualWkOrderId}` === expectedWkOrderId;
}

export function coverageSourceLabel(sourceKind: unknown): string {
  if (sourceKind === 'STAGE9_OBLIGATION') return 'Stage9 obligation';
  if (sourceKind === 'STAGE12_OBLIGATION') return 'Stage12 obligation';
  if (sourceKind === 'EXTERNAL_RECOVERY') return 'External recovery';
  if (sourceKind === 'ADMIN_WRITE_OFF') return 'Admin write-off (record)';
  return displayServerField(sourceKind);
}

export function determinationRoleLabel(
  determination: Record<string, unknown>,
): string {
  if (determination.adjustmentOfDeterminationId) return 'Successor adjustment';
  return 'Original determination';
}
