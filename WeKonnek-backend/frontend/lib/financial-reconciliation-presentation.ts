/**
 * Stage13C presentation maps only.
 * Does not calculate financial authority or recreate detectors.
 */

export const SEARCH_MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export const FINANCIAL_RAILS = [
  'RIDER_ADVANCE_REIMBURSEMENT',
  'RETURN_FINANCIAL',
  'EXCEPTION_FINANCIAL',
] as const;

export type FinancialRailId = (typeof FINANCIAL_RAILS)[number];

export const RECONCILIATION_STATES = [
  'CLEAR',
  'SUCCESSOR_REVIEW_REQUIRED',
  'OVERLAP_REVIEW_REQUIRED',
  'COVERAGE_REVIEW_REQUIRED',
  'SOURCE_INCONSISTENCY',
  'REVIEW_REQUIRED',
] as const;

export type ReconciliationState = (typeof RECONCILIATION_STATES)[number];

export const RECONCILIATION_FINDING_CODES = [
  'RA_RETURN_RESTRICTION_MISSING',
  'RA_RETURN_RESTRICTION_AMOUNT_MISMATCH',
  'RA_RETURN_RESTRICTION_MULTIPLE',
  'RA_RETURN_DOUBLE_COLLECTIBLE',
  'RA_RETURN_SNAPSHOT_PRINCIPAL_MISMATCH',
  'RA_RETURN_SNAPSHOT_ACK_MISMATCH',
  'RA_RETURN_CREDITOR_MISMATCH',
  'RA_RETURN_RA_MISSING',
  'INSUFFICIENT_SOURCE_LINKAGE',
  'CURRENCY_MISMATCH',
  'COVERAGE_SOURCE_MISSING',
  'STAGE9_COVERAGE_MISSING',
  'STAGE9_COVERAGE_AMOUNT_MISMATCH',
  'COVERAGE_WRONG_LOSS',
  'COVERAGE_DUPLICATE_SEMANTIC',
  'COVERAGE_EXCEEDS_COMPENSABLE',
  'SUBJECT_MATCH_UNKNOWN',
  'EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE',
  'SUCCESSOR_REVIEW_REQUIRED',
  'SUCCESSOR_BRANCH_DETECTED',
  'SUCCESSOR_CYCLE_DETECTED',
] as const;

export type ReconciliationFindingCode =
  (typeof RECONCILIATION_FINDING_CODES)[number];

export const RECONCILIATION_RELATIONS = [
  'SUCCESSOR',
  'SUCCESSOR_OF',
  'COLLECTION_TRANSFERRED_TO_RETURN',
  'ECONOMIC_LOSS_COVERED_BY_RETURN',
  'POTENTIAL_OVERLAP',
] as const;

export type ReconciliationRelation = (typeof RECONCILIATION_RELATIONS)[number];

export type PeriodPreset = 'today' | '7d' | '14d' | '30d' | 'custom';

export type QueueSearchItem = {
  wkOrderId: number;
  rails: FinancialRailId[];
  hasOutstanding: boolean;
  hasDispute: boolean;
  hasReconciliationIssue: boolean;
  reconciliationStates: ReconciliationState[];
  findingCodes: ReconciliationFindingCode[];
  itemCount: number;
  sourceActivityAt: string;
};

export const RAIL_LABELS: Record<FinancialRailId, string> = {
  RIDER_ADVANCE_REIMBURSEMENT: 'Rider Advance',
  RETURN_FINANCIAL: 'Return Financial',
  EXCEPTION_FINANCIAL: 'Exception Liability',
};

export const STATE_LABELS: Record<ReconciliationState, string> = {
  CLEAR: 'No detected issue',
  SUCCESSOR_REVIEW_REQUIRED: 'Successor review',
  OVERLAP_REVIEW_REQUIRED: 'Potential overlap',
  COVERAGE_REVIEW_REQUIRED: 'Coverage review',
  SOURCE_INCONSISTENCY: 'Source inconsistency',
  REVIEW_REQUIRED: 'Review required',
};

export const FINDING_DISPLAY: Record<
  ReconciliationFindingCode,
  { title: string; explanation: string; category: string }
> = {
  RA_RETURN_RESTRICTION_MISSING: {
    title: 'Return collection restriction is missing',
    explanation:
      'The Rider Advance reimbursement remains collectible while the return financial flow may also create a merchant obligation.',
    category: 'Rider Advance / Return',
  },
  RA_RETURN_RESTRICTION_AMOUNT_MISMATCH: {
    title: 'Restriction amount does not match transfer',
    explanation:
      'The active collection restriction amount does not match the return transfer amount.',
    category: 'Rider Advance / Return',
  },
  RA_RETURN_RESTRICTION_MULTIPLE: {
    title: 'Multiple active restrictions',
    explanation:
      'More than one active collection restriction is present for the same Rider Advance and return determination.',
    category: 'Rider Advance / Return',
  },
  RA_RETURN_DOUBLE_COLLECTIBLE: {
    title: 'Potential double collection',
    explanation:
      'Rider Advance remaining collectible and return remaining may both still be collectible.',
    category: 'Potential overlap',
  },
  RA_RETURN_SNAPSHOT_PRINCIPAL_MISMATCH: {
    title: 'Return snapshot principal mismatch',
    explanation:
      'The return snapshot principal does not match the Rider Advance principal.',
    category: 'Source consistency',
  },
  RA_RETURN_SNAPSHOT_ACK_MISMATCH: {
    title: 'Return snapshot settled mismatch',
    explanation:
      'The return snapshot settled amount does not match acknowledged Rider Advance settlement.',
    category: 'Source consistency',
  },
  RA_RETURN_CREDITOR_MISMATCH: {
    title: 'Return creditor does not match Rider Advance',
    explanation:
      'The return merchant-to-rider creditor does not match the Rider Advance creditor rider.',
    category: 'Source consistency',
  },
  RA_RETURN_RA_MISSING: {
    title: 'Linked Rider Advance is missing',
    explanation:
      'A return determination is linked to a Rider Advance that is missing or not executable.',
    category: 'Source consistency',
  },
  INSUFFICIENT_SOURCE_LINKAGE: {
    title: 'Return is not linked to Rider Advance',
    explanation:
      'A return determination on the Rider Advance path is not linked to a Rider Advance.',
    category: 'Source consistency',
  },
  CURRENCY_MISMATCH: {
    title: 'Currency mismatch',
    explanation:
      'Linked financial sources do not share the same currency.',
    category: 'Source consistency',
  },
  COVERAGE_SOURCE_MISSING: {
    title: 'Coverage source is missing',
    explanation:
      'Economic-loss coverage points at a return obligation that is not in the finalized set.',
    category: 'Coverage',
  },
  STAGE9_COVERAGE_MISSING: {
    title: 'Expected return coverage is missing',
    explanation:
      'A covering return obligation is present without matching economic-loss coverage.',
    category: 'Coverage',
  },
  STAGE9_COVERAGE_AMOUNT_MISMATCH: {
    title: 'Coverage amount mismatch',
    explanation:
      'Recorded coverage amount does not match the return obligation principal or import cap.',
    category: 'Coverage',
  },
  COVERAGE_WRONG_LOSS: {
    title: 'Coverage does not match this loss',
    explanation:
      'Coverage is attached to an obligation type that does not cover this economic loss.',
    category: 'Coverage',
  },
  COVERAGE_DUPLICATE_SEMANTIC: {
    title: 'Duplicate coverage',
    explanation:
      'Duplicate return-obligation coverage references exist for the same loss.',
    category: 'Coverage',
  },
  COVERAGE_EXCEEDS_COMPENSABLE: {
    title: 'Coverage exceeds compensable loss',
    explanation:
      'Recorded coverage exceeds the compensable amount of the economic loss.',
    category: 'Coverage',
  },
  SUBJECT_MATCH_UNKNOWN: {
    title: 'Loss subject match is unknown',
    explanation:
      'An executable exception obligation has an unknown subject match to the economic loss.',
    category: 'Coverage',
  },
  EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE: {
    title: 'Duplicate active exception exposure',
    explanation:
      'More than one executable exception obligation remains on the same economic loss without successor linkage.',
    category: 'Potential overlap',
  },
  SUCCESSOR_REVIEW_REQUIRED: {
    title: 'Successor review required',
    explanation:
      'A finalized parent liability has a finalized successor. Original and successor remain separate.',
    category: 'Successor / Adjustment',
  },
  SUCCESSOR_BRANCH_DETECTED: {
    title: 'Multiple successors detected',
    explanation:
      'More than one finalized successor exists for the same parent liability.',
    category: 'Successor / Adjustment',
  },
  SUCCESSOR_CYCLE_DETECTED: {
    title: 'Successor cycle detected',
    explanation: 'A cycle was detected in the liability successor graph.',
    category: 'Successor / Adjustment',
  },
};

export const RELATION_LABELS: Record<ReconciliationRelation, string> = {
  SUCCESSOR: 'Successor of',
  SUCCESSOR_OF: 'Has successor',
  COLLECTION_TRANSFERRED_TO_RETURN: 'Collection transferred to return',
  ECONOMIC_LOSS_COVERED_BY_RETURN: 'Economic loss covered by return',
  POTENTIAL_OVERLAP: 'Potential overlap',
};

export const PARTY_LABELS = {
  CUSTOMER: 'Customer',
  MERCHANT: 'Merchant',
  RIDER: 'Rider',
} as const;

export const FINANCIAL_STATE_LABELS = {
  UNPAID: 'Unpaid',
  PARTIALLY_SETTLED: 'Partially settled',
  SETTLED: 'Settled',
} as const;

export function isFinancialReconciliationAdmin(
  userType: string | undefined | null,
): boolean {
  return userType === 'admin';
}

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  IN_REVIEW: 'In review',
  WAITING_ON_PARTY: 'Waiting on party',
  ESCALATED_ENGINEERING: 'Escalated to engineering',
  CLOSED_CONDITION_CLEARED: 'Closed — condition cleared',
  CLOSED_REVIEW_ONLY: 'Closed — review only',
  CLOSED_DUPLICATE: 'Closed — duplicate',
};

export const REVIEW_ROUTE_LABELS: Record<string, string> = {
  ENGINEERING: 'Engineering',
  WAITING_ON_PARTY: 'Waiting on party',
  STAGE12_REVIEW: 'Stage 12 review',
  REVIEW_ONLY: 'Review only',
};

export function reviewStatusLabel(status: string): string {
  return REVIEW_STATUS_LABELS[status] ?? status;
}

export function reviewRouteLabel(route: string): string {
  return REVIEW_ROUTE_LABELS[route] ?? route;
}

export function railLabel(rail: string): string {
  return RAIL_LABELS[rail as FinancialRailId] ?? rail;
}

export function stateLabel(state: string): string {
  return STATE_LABELS[state as ReconciliationState] ?? state;
}

export function findingTitle(code: string): string {
  return FINDING_DISPLAY[code as ReconciliationFindingCode]?.title ?? code;
}

export function findingExplanation(code: string): string {
  return FINDING_DISPLAY[code as ReconciliationFindingCode]?.explanation ?? '';
}

export function relationLabel(relation: string): string {
  return RELATION_LABELS[relation as ReconciliationRelation] ?? relation;
}

export function partyLabel(type: string): string {
  return PARTY_LABELS[type as keyof typeof PARTY_LABELS] ?? type;
}

export function financialStateLabel(state: string): string {
  return (
    FINANCIAL_STATE_LABELS[state as keyof typeof FINANCIAL_STATE_LABELS] ??
    state
  );
}

export type AttentionBadge = { label: string };

export function attentionBadges(item: {
  hasOutstanding: boolean;
  hasDispute: boolean;
  hasReconciliationIssue: boolean;
}): AttentionBadge[] {
  const badges: AttentionBadge[] = [];
  if (item.hasReconciliationIssue) badges.push({ label: 'Needs review' });
  if (item.hasOutstanding) badges.push({ label: 'Outstanding' });
  if (item.hasDispute) badges.push({ label: 'Disputed' });
  if (badges.length === 0) {
    badges.push({ label: 'No detected reconciliation issue' });
  }
  return badges;
}

export function queueFindingTitles(
  codes: string[],
  maxVisible = 2,
): { titles: string[]; extra: number } {
  const titles = codes.slice(0, maxVisible).map(findingTitle);
  return { titles, extra: Math.max(0, codes.length - maxVisible) };
}

const QUEUE_MONEY_KEYS = [
  'principal',
  'originalPrincipal',
  'settled',
  'settledAmount',
  'remaining',
  'remainingAmount',
  'collectible',
  'collectibleRemaining',
  'currency',
  'orderBalance',
] as const;

export function queueCardView(item: QueueSearchItem) {
  const findings = queueFindingTitles(item.findingCodes);
  return {
    wkOrderId: item.wkOrderId,
    railLabels: item.rails.map(railLabel),
    badges: attentionBadges(item),
    findingTitles: findings.titles,
    extraFindings: findings.extra,
    sourceActivityAt: item.sourceActivityAt,
    itemCount: item.itemCount,
  };
}

export function queueCardHasMoneyFields(
  card: ReturnType<typeof queueCardView>,
): boolean {
  return QUEUE_MONEY_KEYS.some((key) => key in card);
}

export function formatSourceActivity(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleString();
}

/** Presentation-only grouping of integer digits. Does not change the decimal. */
export function formatMoneyAmount(raw: string): string {
  const match = raw.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return raw;
  const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return match[3] != null
    ? `${match[1]}${grouped}.${match[3]}`
    : `${match[1]}${grouped}`;
}

export function formatMoneyDisplay(amount: string, currency: string): string {
  return `${formatMoneyAmount(amount)} ${currency}`.trim();
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function endOfLocalDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

export function addLocalDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
}

export function parseLocalDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function inclusiveLocalDayCount(from: Date, to: Date): number {
  const start = startOfLocalDay(from);
  const end = startOfLocalDay(to);
  if (end.getTime() < start.getTime()) return -1;
  let days = 1;
  let cursor = start;
  while (cursor.getTime() < end.getTime()) {
    cursor = addLocalDays(cursor, 1);
    days += 1;
  }
  return days;
}

export const SEARCH_MAX_INCLUSIVE_DAYS = 30;

export type DateWindowResult =
  | { ok: true; since: string; until: string }
  | { ok: false; message: string };

export function serializeDateWindow(
  preset: PeriodPreset,
  customFrom: string,
  customTo: string,
  now: Date,
): DateWindowResult {
  let start: Date;
  let end: Date;
  if (preset === 'custom') {
    const from = parseLocalDateInput(customFrom);
    const to = parseLocalDateInput(customTo);
    if (!from || !to) {
      return { ok: false, message: 'Enter a valid custom date range.' };
    }
    start = startOfLocalDay(from);
    end = endOfLocalDay(to);
    if (start.getTime() > end.getTime()) {
      return { ok: false, message: 'Start date must be on or before end date.' };
    }
    const today = startOfLocalDay(now);
    if (startOfLocalDay(to).getTime() > today.getTime()) {
      return { ok: false, message: 'End date cannot be in the future.' };
    }
    if (start.getTime() > today.getTime()) {
      return { ok: false, message: 'Start date cannot be in the future.' };
    }
    if (inclusiveLocalDayCount(from, to) > SEARCH_MAX_INCLUSIVE_DAYS) {
      return { ok: false, message: 'Custom range cannot exceed 30 days.' };
    }
    if (now.getTime() - start.getTime() > SEARCH_MAX_LOOKBACK_MS) {
      return {
        ok: false,
        message: 'Start date cannot be more than 30 days before today.',
      };
    }
  } else if (preset === 'today') {
    start = startOfLocalDay(now);
    end = endOfLocalDay(now);
  } else {
    const days = preset === '7d' ? 6 : preset === '14d' ? 13 : 29;
    start = startOfLocalDay(addLocalDays(now, -days));
    end = endOfLocalDay(now);
  }
  return { ok: true, since: start.toISOString(), until: end.toISOString() };
}

export function nextGeneration(current: number): number {
  return current + 1;
}

export function isCurrentGeneration(
  activeGeneration: number,
  responseGeneration: number,
): boolean {
  return activeGeneration === responseGeneration;
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  );
}

export type QueueAuthoritySnapshot = {
  generation: number;
  items: Array<{ wkOrderId: number }>;
  nextCursor: string | null;
  exhausted: boolean;
  scanned: number | null;
  lastBatchCount: number;
  loading: boolean;
  continuing: boolean;
  inlineError: string | null;
  loadError: string | null;
};

export function beginQueueGeneration(
  state: QueueAuthoritySnapshot,
  mode: 'replace' | 'append',
): QueueAuthoritySnapshot {
  const generation = nextGeneration(state.generation);
  if (mode === 'replace') {
    return {
      ...state,
      generation,
      loading: true,
      continuing: false,
      loadError: null,
    };
  }
  return {
    ...state,
    generation,
    continuing: true,
  };
}

export function applyQueueSuccess(
  state: QueueAuthoritySnapshot,
  generation: number,
  payload: {
    mode: 'replace' | 'append';
    items: Array<{ wkOrderId: number }>;
    nextCursor: string | null;
    exhausted: boolean;
    scanned: number;
  },
): QueueAuthoritySnapshot {
  if (!isCurrentGeneration(state.generation, generation)) return state;
  return {
    ...state,
    items:
      payload.mode === 'append'
        ? appendUniqueOrders(state.items, payload.items).items
        : payload.items,
    nextCursor: payload.nextCursor,
    exhausted: payload.exhausted,
    scanned: payload.scanned,
    lastBatchCount: payload.items.length,
    loading: false,
    continuing: false,
    loadError: null,
    inlineError: null,
  };
}

export function applyQueueFailure(
  state: QueueAuthoritySnapshot,
  generation: number,
  error: {
    inlineError?: string | null;
    loadError?: string | null;
    resetCursor?: boolean;
  },
): QueueAuthoritySnapshot {
  if (!isCurrentGeneration(state.generation, generation)) return state;
  return {
    ...state,
    loading: false,
    continuing: false,
    inlineError:
      error.inlineError === undefined ? state.inlineError : error.inlineError,
    loadError: error.loadError === undefined ? state.loadError : error.loadError,
    ...(error.resetCursor ? { items: [], nextCursor: null } : {}),
  };
}

export type DetailAuthoritySnapshot<T> = {
  generation: number;
  detail: T | null;
  error: string | null;
  loading: boolean;
  updatedAt: string | null;
};

export function beginDetailGeneration<T>(
  state: DetailAuthoritySnapshot<T>,
): DetailAuthoritySnapshot<T> {
  return {
    ...state,
    generation: nextGeneration(state.generation),
    loading: true,
    error: null,
  };
}

export function applyDetailSuccess<T>(
  state: DetailAuthoritySnapshot<T>,
  generation: number,
  detail: T,
  updatedAt: string,
): DetailAuthoritySnapshot<T> {
  if (!isCurrentGeneration(state.generation, generation)) return state;
  return {
    ...state,
    detail,
    error: null,
    loading: false,
    updatedAt,
  };
}

export function applyDetailFailure<T>(
  state: DetailAuthoritySnapshot<T>,
  generation: number,
  error: string,
): DetailAuthoritySnapshot<T> {
  if (!isCurrentGeneration(state.generation, generation)) return state;
  return {
    ...state,
    error,
    loading: false,
  };
}

export type QueueFilterState = {
  period: PeriodPreset;
  customFrom: string;
  customTo: string;
  rail: string;
  reviewStatus: 'all' | 'needs' | 'none';
  outstanding: 'any' | 'yes' | 'no';
  disputed: 'any' | 'yes' | 'no';
  findingCode: string;
  reconciliationState: string;
  wkOrderId: string;
  obligationId: string;
};

export const DEFAULT_QUEUE_FILTERS: QueueFilterState = {
  period: '7d',
  customFrom: '',
  customTo: '',
  rail: '',
  reviewStatus: 'all',
  outstanding: 'any',
  disputed: 'any',
  findingCode: '',
  reconciliationState: '',
  wkOrderId: '',
  obligationId: '',
};

export type SearchQueryMap = Record<string, string>;

export type SerializeFiltersResult =
  | { ok: true; query: SearchQueryMap }
  | { ok: false; message: string };

function optionalBool(value: 'any' | 'yes' | 'no'): string | undefined {
  if (value === 'yes') return 'true';
  if (value === 'no') return 'false';
  return undefined;
}

export function serializeQueueFilters(
  filters: QueueFilterState,
  now: Date,
): SerializeFiltersResult {
  const window = serializeDateWindow(
    filters.period,
    filters.customFrom,
    filters.customTo,
    now,
  );
  if (!window.ok) return window;

  const wkOrderId = filters.wkOrderId.trim();
  const obligationId = filters.obligationId.trim();
  const rail = filters.rail.trim();

  if (obligationId && !rail) {
    return {
      ok: false,
      message: 'Obligation lookup requires a rail.',
    };
  }
  if (wkOrderId && !/^\d+$/.test(wkOrderId)) {
    return { ok: false, message: 'Order ID must be a number.' };
  }

  const query: SearchQueryMap = {
    since: window.since,
    until: window.until,
    limit: '20',
  };
  if (wkOrderId) query.wkOrderId = wkOrderId;
  if (rail) query.rail = rail;
  if (obligationId && rail) query.obligationId = obligationId;
  const outstanding = optionalBool(filters.outstanding);
  if (outstanding) query.hasOutstanding = outstanding;
  const disputed = optionalBool(filters.disputed);
  if (disputed) query.hasDispute = disputed;
  if (filters.reviewStatus === 'needs') query.hasReconciliationIssue = 'true';
  if (filters.reviewStatus === 'none') query.hasReconciliationIssue = 'false';
  if (filters.findingCode) query.findingCode = filters.findingCode;
  if (filters.reconciliationState) {
    query.reconciliationState = filters.reconciliationState;
  }
  return { ok: true, query };
}

export function searchParamsFromQuery(
  query: SearchQueryMap,
  cursor?: string | null,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  if (cursor) params.set('cursor', cursor);
  return params;
}

export function filterFingerprint(query: SearchQueryMap): string {
  return JSON.stringify(
    Object.keys(query)
      .sort()
      .map((key) => [key, query[key]]),
  );
}

export type QueueEmptyKind = 'none' | 'period' | 'batch' | 'filtered';

export function queueEmptyKind(input: {
  accumulatedCount: number;
  lastBatchCount: number;
  nextCursor: string | null;
  exhausted: boolean;
  hasDerivedFilters: boolean;
}): QueueEmptyKind {
  if (input.accumulatedCount > 0) return 'none';
  if (input.lastBatchCount === 0 && input.nextCursor) return 'batch';
  if (input.exhausted) {
    return input.hasDerivedFilters ? 'filtered' : 'period';
  }
  return 'none';
}

export function queueEmptyCopy(kind: QueueEmptyKind): string | null {
  if (kind === 'period') {
    return 'No financial reconciliation cases were found for this period.';
  }
  if (kind === 'batch') {
    return 'No matching cases in this batch.';
  }
  if (kind === 'filtered') {
    return 'No matching reconciliation cases were found.';
  }
  return null;
}

export function hasDerivedQueueFilters(filters: QueueFilterState): boolean {
  return (
    filters.rail !== '' ||
    filters.reviewStatus !== 'all' ||
    filters.outstanding !== 'any' ||
    filters.disputed !== 'any' ||
    filters.findingCode !== '' ||
    filters.reconciliationState !== '' ||
    filters.wkOrderId.trim() !== '' ||
    filters.obligationId.trim() !== ''
  );
}

export function appendUniqueOrders<T extends { wkOrderId: number }>(
  existing: T[],
  incoming: T[],
): { items: T[]; added: number; duplicatesSkipped: number } {
  const seen = new Set(existing.map((item) => item.wkOrderId));
  const next = existing.slice();
  let added = 0;
  let duplicatesSkipped = 0;
  for (const item of incoming) {
    if (seen.has(item.wkOrderId)) {
      duplicatesSkipped += 1;
      continue;
    }
    seen.add(item.wkOrderId);
    next.push(item);
    added += 1;
  }
  return { items: next, added, duplicatesSkipped };
}

export function obligationAnchorId(obligationId: string): string {
  return `obligation-${obligationId}`;
}

export function directionLabel(debtorType: string, creditorType: string): string {
  return `${partyLabel(debtorType)} → ${partyLabel(creditorType)}`;
}

export const KNOWN_SEARCH_ERROR_CODES = [
  'SEARCH_BOUNDS_REQUIRED',
  'INVALID_RAIL',
  'INVALID_FINDING_CODE',
  'INVALID_RECONCILIATION_STATE',
  'INVALID_DATE',
  'INVALID_EXACT_KEY',
  'INVALID_CURSOR',
  'CURSOR_FILTER_MISMATCH',
] as const;

export type PublicApiError = {
  status: number;
  code?: string;
  message: string;
  inlinePeriod: boolean;
  resetCursor: boolean;
};

export function mapPublicApiError(
  status: number,
  body: { code?: unknown; message?: unknown } | null,
): PublicApiError {
  const code = typeof body?.code === 'string' ? body.code : undefined;
  if (status === 401) {
    return {
      status,
      code,
      message: 'Sign in required.',
      inlinePeriod: false,
      resetCursor: false,
    };
  }
  if (status === 403) {
    return {
      status,
      code,
      message: 'Access denied. System admin only.',
      inlinePeriod: false,
      resetCursor: false,
    };
  }
  const rawMessage = typeof body?.message === 'string' ? body.message : '';
  const known = KNOWN_SEARCH_ERROR_CODES.includes(
    code as (typeof KNOWN_SEARCH_ERROR_CODES)[number],
  );
  const inlinePeriod =
    code === 'SEARCH_BOUNDS_REQUIRED' ||
    code === 'INVALID_DATE' ||
    code === 'INVALID_EXACT_KEY';
  const resetCursor =
    code === 'INVALID_CURSOR' || code === 'CURSOR_FILTER_MISMATCH';
  let message = 'Unable to load financial reconciliation.';
  if (status === 403) message = 'Access denied. System admin only.';
  if (known && rawMessage) {
    message = rawMessage.includes(':')
      ? rawMessage.slice(rawMessage.indexOf(':') + 1).trim() || rawMessage
      : rawMessage;
  } else if (code === 'SEARCH_BOUNDS_REQUIRED') {
    message = 'A date range or exact order lookup is required.';
  } else if (resetCursor) {
    message = 'Search continuation was reset. Loading the first results.';
  }
  if (!known && rawMessage && rawMessage.length < 180 && !/sourceRefs|evidence|token|Bearer/i.test(rawMessage)) {
    message = rawMessage;
  }
  return { status, code, message, inlinePeriod, resetCursor };
}
