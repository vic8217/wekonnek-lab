/**
 * Stage14A operational review policy. Workflow metadata only.
 * Does not detect findings or mutate financial rails.
 */
import { createHash } from 'crypto';
import {
  RECONCILIATION_FINDING_CODES,
  type ReconciliationFinding,
  type ReconciliationFindingCode,
  type ReconciliationRelatedItem,
} from '../financial-reconciliation/financial-reconciliation.types';
import { relatedItemKey } from '../financial-reconciliation/financial-reconciliation.policy';

export const REVIEW_NOTE_MAX_CHARS = 2000;
export const REVIEW_REASON_MAX_CHARS = 500;
export const REVIEW_LIST_LIMIT_DEFAULT = 20;
export const REVIEW_LIST_LIMIT_MAX = 50;
export const REVIEW_SEARCH_MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export const OPEN_REVIEW_STATUSES = [
  'OPEN',
  'IN_REVIEW',
  'WAITING_ON_PARTY',
  'ESCALATED_ENGINEERING',
] as const;

export const TERMINAL_REVIEW_STATUSES = [
  'CLOSED_CONDITION_CLEARED',
  'CLOSED_REVIEW_ONLY',
  'CLOSED_DUPLICATE',
] as const;

export const REVIEW_ONLY_CLOSE_CODES: readonly ReconciliationFindingCode[] = [
  RECONCILIATION_FINDING_CODES.SUCCESSOR_REVIEW_REQUIRED,
  RECONCILIATION_FINDING_CODES.SUBJECT_MATCH_UNKNOWN,
];

export const REVIEW_ROUTE_VALUES = [
  'ENGINEERING',
  'WAITING_ON_PARTY',
  'STAGE12_REVIEW',
  'REVIEW_ONLY',
] as const;

export type ReviewRouteClassification = (typeof REVIEW_ROUTE_VALUES)[number];

export const WAITING_PARTY_VALUES = ['CUSTOMER', 'MERCHANT', 'RIDER'] as const;
export type ReviewWaitingParty = (typeof WAITING_PARTY_VALUES)[number];

const REVIEW_ONLY_SET = new Set<string>(REVIEW_ONLY_CLOSE_CODES);

const STAGE12_ROUTE_CODES = new Set<string>([
  RECONCILIATION_FINDING_CODES.STAGE9_COVERAGE_MISSING,
  RECONCILIATION_FINDING_CODES.STAGE9_COVERAGE_AMOUNT_MISMATCH,
  RECONCILIATION_FINDING_CODES.EXCEPTION_DUPLICATE_ACTIVE_EXPOSURE,
  RECONCILIATION_FINDING_CODES.COVERAGE_WRONG_LOSS,
  RECONCILIATION_FINDING_CODES.SUBJECT_MATCH_UNKNOWN,
  RECONCILIATION_FINDING_CODES.SUCCESSOR_REVIEW_REQUIRED,
]);

const WAITING_PARTY_ROUTE_CODES = new Set<string>([
  RECONCILIATION_FINDING_CODES.RA_RETURN_DOUBLE_COLLECTIBLE,
  RECONCILIATION_FINDING_CODES.RA_RETURN_RESTRICTION_MISSING,
]);

export function isOpenReviewStatus(status: string): boolean {
  return (OPEN_REVIEW_STATUSES as readonly string[]).includes(status);
}

export function isTerminalReviewStatus(status: string): boolean {
  return (TERMINAL_REVIEW_STATUSES as readonly string[]).includes(status);
}

export function isReviewOnlyCloseCode(code: string): boolean {
  return REVIEW_ONLY_SET.has(code);
}

export function allowedRouteClassifications(
  findingCode: string,
): ReviewRouteClassification[] {
  const allowed: ReviewRouteClassification[] = ['ENGINEERING'];
  if (STAGE12_ROUTE_CODES.has(findingCode)) allowed.push('STAGE12_REVIEW');
  if (WAITING_PARTY_ROUTE_CODES.has(findingCode)) {
    allowed.push('WAITING_ON_PARTY');
  }
  if (REVIEW_ONLY_SET.has(findingCode)) allowed.push('REVIEW_ONLY');
  return allowed;
}

export function assertRouteAllowed(
  findingCode: string,
  route: string,
): { ok: true; route: ReviewRouteClassification } | { ok: false; code: string; message: string } {
  if (!(REVIEW_ROUTE_VALUES as readonly string[]).includes(route)) {
    return {
      ok: false,
      code: 'INVALID_ROUTE_CLASSIFICATION',
      message: 'INVALID_ROUTE_CLASSIFICATION',
    };
  }
  const typed = route as ReviewRouteClassification;
  if (!allowedRouteClassifications(findingCode).includes(typed)) {
    return {
      ok: false,
      code: 'ROUTE_NOT_ALLOWED_FOR_FINDING',
      message: 'ROUTE_NOT_ALLOWED_FOR_FINDING',
    };
  }
  return { ok: true, route: typed };
}

export function buildDetectorFingerprint(input: {
  findings: Array<Pick<ReconciliationFinding, 'findingKey'>>;
  relatedItems: ReconciliationRelatedItem[];
}): string {
  const findingKeys = [...input.findings.map((f) => f.findingKey)].sort((a, b) =>
    a.localeCompare(b),
  );
  const relatedKeys = [
    ...new Set(input.relatedItems.map((item) => relatedItemKey(item))),
  ].sort((a, b) => a.localeCompare(b));
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ findingKeys, relatedKeys }));
  return hash.digest('hex');
}

export function locateLiveFinding(
  findings: ReconciliationFinding[],
  requestedKey: string,
): ReconciliationFinding | null {
  const key = requestedKey.trim();
  if (!key) return null;
  return findings.find((finding) => finding.findingKey === key) ?? null;
}

const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

export function validateNoteBody(
  raw: unknown,
): { ok: true; body: string } | { ok: false; code: string; message: string } {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'INVALID_NOTE', message: 'INVALID_NOTE' };
  }
  const body = raw.trim();
  if (!body) {
    return { ok: false, code: 'INVALID_NOTE', message: 'Note cannot be empty.' };
  }
  if (body.length > REVIEW_NOTE_MAX_CHARS) {
    return {
      ok: false,
      code: 'INVALID_NOTE',
      message: `Note cannot exceed ${REVIEW_NOTE_MAX_CHARS} characters.`,
    };
  }
  if (CONTROL_CHAR_RE.test(body)) {
    return {
      ok: false,
      code: 'INVALID_NOTE',
      message: 'Note contains disallowed control characters.',
    };
  }
  return { ok: true, body };
}

export function validateReason(
  raw: unknown,
): { ok: true; reason: string } | { ok: false; code: string; message: string } {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'INVALID_REASON', message: 'INVALID_REASON' };
  }
  const reason = raw.trim();
  if (!reason) {
    return { ok: false, code: 'INVALID_REASON', message: 'Reason is required.' };
  }
  if (reason.length > REVIEW_REASON_MAX_CHARS) {
    return {
      ok: false,
      code: 'INVALID_REASON',
      message: `Reason cannot exceed ${REVIEW_REASON_MAX_CHARS} characters.`,
    };
  }
  if (CONTROL_CHAR_RE.test(reason)) {
    return {
      ok: false,
      code: 'INVALID_REASON',
      message: 'Reason contains disallowed control characters.',
    };
  }
  return { ok: true, reason };
}

export function validateIdempotencyKey(
  raw: unknown,
): { ok: true; key: string } | { ok: false; code: string; message: string } {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return {
      ok: false,
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'INVALID_IDEMPOTENCY_KEY',
    };
  }
  const key = raw.trim();
  if (key.length > 64) {
    return {
      ok: false,
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'INVALID_IDEMPOTENCY_KEY',
    };
  }
  return { ok: true, key };
}

export function parseExpectedVersion(
  raw: unknown,
): { ok: true; version: number } | { ok: false; code: string; message: string } {
  const version = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      code: 'INVALID_REVIEW_VERSION',
      message: 'INVALID_REVIEW_VERSION',
    };
  }
  return { ok: true, version };
}

export function parseReviewListQuery(input: {
  status?: string;
  assignedTo?: string;
  assignedAdminUserId?: string;
  wkOrderId?: string;
  findingCode?: string;
  findingKey?: string;
  since?: string;
  until?: string;
  limit?: string;
  cursor?: string;
}):
  | {
      ok: true;
      value: {
        status: string | null;
        assignedTo: 'me' | 'unassigned' | 'all' | null;
        assignedAdminUserId: string | null;
        wkOrderId: number | null;
        findingCode: string | null;
        findingKey: string | null;
        since: Date;
        until: Date;
        limit: number;
        cursor: { createdAt: string; id: string } | null;
      };
    }
  | { ok: false; code: string; message: string } {
  const now = new Date();
  let since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  let until = now;
  if (input.since != null && input.since.trim() !== '') {
    const parsed = Date.parse(input.since);
    if (Number.isNaN(parsed)) {
      return { ok: false, code: 'INVALID_DATE', message: 'INVALID_DATE: since' };
    }
    since = new Date(parsed);
  }
  if (input.until != null && input.until.trim() !== '') {
    const parsed = Date.parse(input.until);
    if (Number.isNaN(parsed)) {
      return { ok: false, code: 'INVALID_DATE', message: 'INVALID_DATE: until' };
    }
    until = new Date(parsed);
  }
  if (until.getTime() < since.getTime()) {
    return {
      ok: false,
      code: 'INVALID_DATE',
      message: 'INVALID_DATE: until must be >= since',
    };
  }
  if (until.getTime() - since.getTime() > REVIEW_SEARCH_MAX_LOOKBACK_MS) {
    return {
      ok: false,
      code: 'INVALID_DATE',
      message: 'INVALID_DATE: created window exceeds 30 days',
    };
  }

  let status: string | null = null;
  if (input.status != null && input.status.trim() !== '') {
    const candidate = input.status.trim();
    if (
      !(OPEN_REVIEW_STATUSES as readonly string[]).includes(candidate) &&
      !(TERMINAL_REVIEW_STATUSES as readonly string[]).includes(candidate)
    ) {
      return { ok: false, code: 'INVALID_STATUS', message: 'INVALID_STATUS' };
    }
    status = candidate;
  }

  let assignedTo: 'me' | 'unassigned' | 'all' | null = null;
  if (input.assignedTo != null && input.assignedTo.trim() !== '') {
    const candidate = input.assignedTo.trim();
    if (candidate !== 'me' && candidate !== 'unassigned' && candidate !== 'all') {
      return { ok: false, code: 'INVALID_ASSIGNED_TO', message: 'INVALID_ASSIGNED_TO' };
    }
    assignedTo = candidate;
  }

  const assignedAdminUserId =
    input.assignedAdminUserId != null && input.assignedAdminUserId.trim() !== ''
      ? input.assignedAdminUserId.trim()
      : null;

  let wkOrderId: number | null = null;
  if (input.wkOrderId != null && input.wkOrderId.trim() !== '') {
    const parsed = Number(input.wkOrderId);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return { ok: false, code: 'INVALID_EXACT_KEY', message: 'INVALID_EXACT_KEY: wkOrderId' };
    }
    wkOrderId = parsed;
  }

  const findingCode =
    input.findingCode != null && input.findingCode.trim() !== ''
      ? input.findingCode.trim()
      : null;
  if (findingCode && !(Object.values(RECONCILIATION_FINDING_CODES) as string[]).includes(findingCode)) {
    return { ok: false, code: 'INVALID_FINDING_CODE', message: 'INVALID_FINDING_CODE' };
  }

  const findingKey =
    input.findingKey != null && input.findingKey.trim() !== ''
      ? input.findingKey.trim()
      : null;

  let limit = REVIEW_LIST_LIMIT_DEFAULT;
  if (input.limit != null && input.limit.trim() !== '') {
    const parsed = Number(input.limit);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return { ok: false, code: 'INVALID_EXACT_KEY', message: 'INVALID_EXACT_KEY: limit' };
    }
    limit = Math.min(parsed, REVIEW_LIST_LIMIT_MAX);
  }

  let cursor: { createdAt: string; id: string } | null = null;
  if (input.cursor != null && input.cursor.trim() !== '') {
    try {
      const json = Buffer.from(input.cursor, 'base64url').toString('utf8');
      const parsed = JSON.parse(json) as { createdAt?: unknown; id?: unknown };
      if (
        typeof parsed.createdAt !== 'string' ||
        typeof parsed.id !== 'string' ||
        Number.isNaN(Date.parse(parsed.createdAt))
      ) {
        return { ok: false, code: 'INVALID_CURSOR', message: 'INVALID_CURSOR' };
      }
      cursor = { createdAt: parsed.createdAt, id: parsed.id };
    } catch {
      return { ok: false, code: 'INVALID_CURSOR', message: 'INVALID_CURSOR' };
    }
  }

  return {
    ok: true,
    value: {
      status,
      assignedTo,
      assignedAdminUserId,
      wkOrderId,
      findingCode,
      findingKey,
      since,
      until,
      limit,
      cursor,
    },
  };
}

export function encodeReviewCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id }),
    'utf8',
  ).toString('base64url');
}
