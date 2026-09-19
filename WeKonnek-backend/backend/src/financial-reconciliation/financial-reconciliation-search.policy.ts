/**
 * Stage13B-3B search parse / cursor / fingerprint / card mapping.
 * Pure. Not financial authority. Never writes.
 */
import { createHash } from 'crypto';
import {
  FINANCIAL_RAIL_IDS,
  FinancialRailId,
  OrderFinancialReconciliation,
  RECONCILIATION_FINDING_CODES,
  ReconciliationFindingCode,
  ReconciliationState,
} from './financial-reconciliation.types';
import { FinancialReconciliationSearchResultDto } from './financial-reconciliation-search.dto';

export const SEARCH_RESULT_LIMIT_DEFAULT = 20;
export const SEARCH_RESULT_LIMIT_MAX = 20;
/** Hard server cap: forOrder evaluations per HTTP request. Not a query param. */
export const CANDIDATE_SCAN_MAX = 50;
export const SEARCH_MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
export const SEARCH_CURSOR_VERSION = 1;

export const FROZEN_RECONCILIATION_STATES: readonly ReconciliationState[] = [
  'CLEAR',
  'SUCCESSOR_REVIEW_REQUIRED',
  'OVERLAP_REVIEW_REQUIRED',
  'COVERAGE_REVIEW_REQUIRED',
  'SOURCE_INCONSISTENCY',
  'REVIEW_REQUIRED',
];

const FINDING_CODE_SET = new Set<string>(
  Object.values(RECONCILIATION_FINDING_CODES),
);
const STATE_SET = new Set<string>(FROZEN_RECONCILIATION_STATES);
const RAIL_SET = new Set<string>(FINANCIAL_RAIL_IDS);

export type SearchErrorCode =
  | 'SEARCH_BOUNDS_REQUIRED'
  | 'INVALID_RAIL'
  | 'INVALID_FINDING_CODE'
  | 'INVALID_RECONCILIATION_STATE'
  | 'INVALID_DATE'
  | 'INVALID_EXACT_KEY'
  | 'INVALID_CURSOR'
  | 'CURSOR_FILTER_MISMATCH';

export type SourceCandidate = {
  wkOrderId: number;
  sourceActivityAt: Date;
};

export type NormalizedSearchFilters = {
  since: Date | null;
  until: Date | null;
  wkOrderId: number | null;
  rail: FinancialRailId | null;
  obligationId: string | null;
  hasOutstanding: boolean | null;
  hasDispute: boolean | null;
  hasReconciliationIssue: boolean | null;
  findingCode: ReconciliationFindingCode | null;
  reconciliationState: ReconciliationState | null;
  limit: number;
};

export type ParsedSearchQuery = {
  filters: NormalizedSearchFilters;
  cursor: SearchCursor | null;
  fingerprint: string;
};

export type SearchCursor = {
  v: number;
  a: string;
  i: number;
  f: string;
};

export type SearchParseResult =
  | { ok: true; value: ParsedSearchQuery }
  | { ok: false; code: SearchErrorCode; message: string };

export type SearchQueryInput = {
  since?: string;
  until?: string;
  wkOrderId?: string;
  rail?: string;
  obligationId?: string;
  hasOutstanding?: string;
  hasDispute?: string;
  hasReconciliationIssue?: string;
  findingCode?: string;
  reconciliationState?: string;
  limit?: string;
  cursor?: string;
};

function parseIsoDate(raw: string | undefined, label: string): Date | null | (SearchParseResult & { ok: false }) {
  if (raw == null || raw.trim() === '') return null;
  const trimmed = raw.trim();
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) {
    return {
      ok: false,
      code: 'INVALID_DATE',
      message: `INVALID_DATE: ${label}`,
    };
  }
  return new Date(ms);
}

function parseOptionalBool(
  raw: string | undefined,
  label: string,
): boolean | null | (SearchParseResult & { ok: false }) {
  if (raw == null || raw.trim() === '') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return {
    ok: false,
    code: 'INVALID_EXACT_KEY',
    message: `INVALID_EXACT_KEY: ${label} must be true or false`,
  };
}

function parseOptionalInt(
  raw: string | undefined,
): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return Number.NaN;
  return n;
}

function isSearchError(
  v: unknown,
): v is SearchParseResult & { ok: false } {
  return typeof v === 'object' && v != null && (v as { ok?: boolean }).ok === false;
}

export function canonicalFilterFingerprint(
  filters: NormalizedSearchFilters,
): string {
  const payload = {
    since: filters.since ? filters.since.toISOString() : null,
    until: filters.until ? filters.until.toISOString() : null,
    rail: filters.rail,
    wkOrderId: filters.wkOrderId,
    obligationId: filters.obligationId,
    hasOutstanding: filters.hasOutstanding,
    hasDispute: filters.hasDispute,
    hasReconciliationIssue: filters.hasReconciliationIssue,
    findingCode: filters.findingCode,
    reconciliationState: filters.reconciliationState,
    limit: filters.limit,
  };
  const hash = createHash('sha256');
  hash.write(JSON.stringify(payload));
  hash.end();
  return hash.digest('hex');
}

export function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeSearchCursor(raw: string): SearchCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (parsed == null || typeof parsed !== 'object') return null;
    const rec = parsed as Record<string, unknown>;
    if (rec.v !== SEARCH_CURSOR_VERSION) return null;
    if (typeof rec.a !== 'string' || rec.a.trim() === '') return null;
    if (typeof rec.i !== 'number' || !Number.isInteger(rec.i) || rec.i <= 0) {
      return null;
    }
    if (typeof rec.f !== 'string' || rec.f.length < 16) return null;
    if (Number.isNaN(Date.parse(rec.a))) return null;
    return { v: SEARCH_CURSOR_VERSION, a: rec.a, i: rec.i, f: rec.f };
  } catch {
    return null;
  }
}

export function parseSearchQuery(input: SearchQueryInput): SearchParseResult {
  const sinceOrErr = parseIsoDate(input.since, 'since');
  if (isSearchError(sinceOrErr)) return sinceOrErr;
  const untilOrErr = parseIsoDate(input.until, 'until');
  if (isSearchError(untilOrErr)) return untilOrErr;
  const since = sinceOrErr;
  const until = untilOrErr;

  const wkOrderId = parseOptionalInt(input.wkOrderId);
  if (wkOrderId !== null && Number.isNaN(wkOrderId)) {
    return { ok: false, code: 'INVALID_EXACT_KEY', message: 'INVALID_EXACT_KEY: wkOrderId' };
  }

  let rail: FinancialRailId | null = null;
  if (input.rail != null && input.rail.trim() !== '') {
    if (!RAIL_SET.has(input.rail)) {
      return { ok: false, code: 'INVALID_RAIL', message: 'INVALID_RAIL' };
    }
    rail = input.rail as FinancialRailId;
  }

  const obligationId =
    input.obligationId != null && input.obligationId.trim() !== ''
      ? input.obligationId.trim()
      : null;
  if (obligationId != null && rail == null) {
    return {
      ok: false,
      code: 'INVALID_EXACT_KEY',
      message: 'INVALID_EXACT_KEY: obligationId requires rail',
    };
  }

  const hasOutstanding = parseOptionalBool(input.hasOutstanding, 'hasOutstanding');
  if (isSearchError(hasOutstanding)) return hasOutstanding;
  const hasDispute = parseOptionalBool(input.hasDispute, 'hasDispute');
  if (isSearchError(hasDispute)) return hasDispute;
  const hasReconciliationIssue = parseOptionalBool(
    input.hasReconciliationIssue,
    'hasReconciliationIssue',
  );
  if (isSearchError(hasReconciliationIssue)) return hasReconciliationIssue;

  let findingCode: ReconciliationFindingCode | null = null;
  if (input.findingCode != null && input.findingCode.trim() !== '') {
    if (!FINDING_CODE_SET.has(input.findingCode)) {
      return {
        ok: false,
        code: 'INVALID_FINDING_CODE',
        message: 'INVALID_FINDING_CODE',
      };
    }
    findingCode = input.findingCode as ReconciliationFindingCode;
  }

  let reconciliationState: ReconciliationState | null = null;
  if (
    input.reconciliationState != null &&
    input.reconciliationState.trim() !== ''
  ) {
    if (!STATE_SET.has(input.reconciliationState)) {
      return {
        ok: false,
        code: 'INVALID_RECONCILIATION_STATE',
        message: 'INVALID_RECONCILIATION_STATE',
      };
    }
    reconciliationState = input.reconciliationState as ReconciliationState;
  }

  let limit = SEARCH_RESULT_LIMIT_DEFAULT;
  if (input.limit != null && input.limit.trim() !== '') {
    const parsedLimit = Number(input.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      return { ok: false, code: 'INVALID_EXACT_KEY', message: 'INVALID_EXACT_KEY: limit' };
    }
    limit = Math.min(parsedLimit, SEARCH_RESULT_LIMIT_MAX);
  }

  const exactOrder = wkOrderId != null;
  const exactObligation = obligationId != null && rail != null;
  if (!exactOrder && !exactObligation && since == null) {
    return {
      ok: false,
      code: 'SEARCH_BOUNDS_REQUIRED',
      message: 'SEARCH_BOUNDS_REQUIRED',
    };
  }

  if (since != null) {
    const now = Date.now();
    if (now - since.getTime() > SEARCH_MAX_LOOKBACK_MS) {
      return {
        ok: false,
        code: 'INVALID_DATE',
        message: 'INVALID_DATE: since exceeds 30-day lookback',
      };
    }
  }
  if (since != null && until != null && until.getTime() < since.getTime()) {
    return {
      ok: false,
      code: 'INVALID_DATE',
      message: 'INVALID_DATE: until must be >= since',
    };
  }

  const filters: NormalizedSearchFilters = {
    since,
    until,
    wkOrderId,
    rail,
    obligationId,
    hasOutstanding,
    hasDispute,
    hasReconciliationIssue,
    findingCode,
    reconciliationState,
    limit,
  };
  const fingerprint = canonicalFilterFingerprint(filters);

  let cursor: SearchCursor | null = null;
  if (input.cursor != null && input.cursor.trim() !== '') {
    cursor = decodeSearchCursor(input.cursor.trim());
    if (cursor == null) {
      return { ok: false, code: 'INVALID_CURSOR', message: 'INVALID_CURSOR' };
    }
    if (cursor.f !== fingerprint) {
      return {
        ok: false,
        code: 'CURSOR_FILTER_MISMATCH',
        message: 'CURSOR_FILTER_MISMATCH',
      };
    }
  }

  return { ok: true, value: { filters, cursor, fingerprint } };
}

export function mergeSourceCandidates(
  streams: SourceCandidate[][],
): SourceCandidate[] {
  const map = new Map<number, Date>();
  for (const stream of streams) {
    for (const row of stream) {
      const prev = map.get(row.wkOrderId);
      if (!prev || row.sourceActivityAt.getTime() > prev.getTime()) {
        map.set(row.wkOrderId, row.sourceActivityAt);
      }
    }
  }
  return [...map.entries()]
    .map(([wkOrderId, sourceActivityAt]) => ({ wkOrderId, sourceActivityAt }))
    .sort((a, b) => {
      const dt = b.sourceActivityAt.getTime() - a.sourceActivityAt.getTime();
      if (dt !== 0) return dt;
      return b.wkOrderId - a.wkOrderId;
    });
}

export function applyCursor(
  candidates: SourceCandidate[],
  cursor: SearchCursor | null,
): SourceCandidate[] {
  if (cursor == null) return candidates;
  const cursorMs = Date.parse(cursor.a);
  return candidates.filter((row) => {
    const ms = row.sourceActivityAt.getTime();
    if (ms < cursorMs) return true;
    if (ms > cursorMs) return false;
    return row.wkOrderId < cursor.i;
  });
}

export function matchesDerivedFilters(
  view: OrderFinancialReconciliation,
  filters: NormalizedSearchFilters,
): boolean {
  if (view.items.length === 0) return false;
  if (
    filters.hasOutstanding != null &&
    view.hasOutstanding !== filters.hasOutstanding
  ) {
    return false;
  }
  if (filters.hasDispute != null && view.hasDispute !== filters.hasDispute) {
    return false;
  }
  if (
    filters.hasReconciliationIssue != null &&
    view.hasReconciliationIssue !== filters.hasReconciliationIssue
  ) {
    return false;
  }
  if (filters.findingCode != null) {
    if (!view.findings.some((f) => f.code === filters.findingCode)) return false;
  }
  if (filters.reconciliationState != null) {
    const hitItem = view.items.some(
      (i) => i.reconciliationState === filters.reconciliationState,
    );
    const hitFinding = view.findings.some(
      (f) => f.reconciliationState === filters.reconciliationState,
    );
    if (!hitItem && !hitFinding) return false;
  }
  if (filters.rail != null) {
    if (!view.items.some((i) => i.rail === filters.rail)) return false;
  }
  return true;
}

/**
 * Maps frozen forOrder output to a discovery card.
 * sourceActivityAt is the Phase-1 discovery clock, not lastFinancialActivityAt.
 */
export function mapSearchCard(
  view: OrderFinancialReconciliation,
  sourceActivityAt: Date,
): FinancialReconciliationSearchResultDto | null {
  if (view.items.length === 0) return null;
  const railSet = new Set(view.items.map((i) => i.rail));
  const rails = FINANCIAL_RAIL_IDS.filter((r) => railSet.has(r));
  const stateSet = new Set<ReconciliationState>();
  for (const item of view.items) stateSet.add(item.reconciliationState);
  for (const finding of view.findings) stateSet.add(finding.reconciliationState);
  const findingCodes = [...new Set(view.findings.map((f) => f.code))].sort();
  const reconciliationStates = FROZEN_RECONCILIATION_STATES.filter((s) =>
    stateSet.has(s),
  );
  return {
    wkOrderId: view.wkOrderId,
    rails: [...rails],
    hasOutstanding: view.hasOutstanding,
    hasDispute: view.hasDispute,
    hasReconciliationIssue: view.hasReconciliationIssue,
    reconciliationStates,
    findingCodes,
    itemCount: view.items.length,
    sourceActivityAt: sourceActivityAt.toISOString(),
  };
}

export function nextCursorFor(
  last: SourceCandidate,
  fingerprint: string,
): string {
  return encodeSearchCursor({
    v: SEARCH_CURSOR_VERSION,
    a: last.sourceActivityAt.toISOString(),
    i: last.wkOrderId,
    f: fingerprint,
  });
}
