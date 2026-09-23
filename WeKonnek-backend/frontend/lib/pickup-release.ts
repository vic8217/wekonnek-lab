/**
 * Merchant rider-pickup release presentation.
 * BRANCH-SCOPED RELEASE AUTHORIZATION NOT CURRENTLY ENFORCED.
 * The UI shows the pickup location and does not invent a branch restriction.
 * Customer self-pickup is a different flow and is not handled here.
 *
 * Frozen Stage 3 validate/confirm remain authoritative. Missing preview
 * fields (pickup, items, itemCount) degrade to empty/unknown display.
 */

export type PickupReleaseItem = {
  productName: string;
  quantity: number;
};

export type PickupReleasePreview = {
  orderCode?: string;
  rider?: { displayName?: string; id?: string };
  merchant?: { name?: string; id?: number };
  pickup?: { name?: string | null; address?: string | null };
  items?: { productName?: string; quantity?: number; price?: unknown }[];
  itemCount?: number;
  tokenId?: string;
  wkOrderId?: number;
};

export type PublicChecklist = {
  orderCode: string;
  riderName: string;
  merchantName: string;
  pickupName: string | null;
  pickupAddress: string | null;
  items: PickupReleaseItem[];
  itemCount: number;
};

export type FailureGroup =
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'unauthorized'
  | 'assignment'
  | 'unavailable'
  | 'consumed'
  | 'advance'
  | 'unknown';

export type FailurePresentation = {
  group: FailureGroup;
  title: string;
  body: string;
};

const INVALID_CODES = new Set([
  'EMPTY_PAYLOAD',
  'MALFORMED_PAYLOAD',
  'UNSUPPORTED_VERSION',
  'MALFORMED_TOKEN_ID',
  'MALFORMED_SECRET',
  'TOKEN_INVALID',
  'PURPOSE_INVALID',
]);

export function visibleAddress(address: string | null | undefined): string | null {
  if (typeof address !== 'string') return null;
  const trimmed = address.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  return trimmed;
}

export function publicChecklist(preview: PickupReleasePreview): PublicChecklist {
  const items = (preview.items ?? [])
    .filter((item) => typeof item.productName === 'string')
    .map((item) => ({
      productName: item.productName as string,
      quantity: typeof item.quantity === 'number' ? item.quantity : 0,
    }));
  const summed = items.reduce((sum, item) => sum + item.quantity, 0);
  return {
    orderCode: preview.orderCode?.trim() || 'Unknown order',
    riderName: preview.rider?.displayName?.trim() || 'Assigned rider',
    merchantName: preview.merchant?.name?.trim() || 'Merchant',
    pickupName: preview.pickup?.name?.trim() || null,
    pickupAddress: visibleAddress(preview.pickup?.address),
    items,
    itemCount: typeof preview.itemCount === 'number' ? preview.itemCount : summed,
  };
}

export function quantityLabel(count: number): string {
  return count === 1 ? '1 item' : `${count} items`;
}

export function failurePresentation(code: string | undefined): FailurePresentation {
  if (code && INVALID_CODES.has(code)) {
    return {
      group: 'invalid',
      title: 'INVALID PICKUP QR',
      body: 'This QR cannot be verified as a valid WeKonnek rider pickup.',
    };
  }
  if (code === 'TOKEN_EXPIRED') {
    return {
      group: 'expired',
      title: 'PICKUP QR EXPIRED',
      body: 'Ask the rider to generate a new pickup QR.',
    };
  }
  if (code === 'TOKEN_REVOKED') {
    return {
      group: 'revoked',
      title: 'PICKUP QR NO LONGER VALID',
      body: 'Ask the rider to generate a new QR.',
    };
  }
  if (
    code === 'MERCHANT_SCOPE_MISMATCH' ||
    code === 'MERCHANT_UNAUTHORIZED' ||
    code === 'ORDER_SCOPE_MISMATCH'
  ) {
    return {
      group: 'unauthorized',
      title: 'PICKUP NOT AUTHORIZED',
      body: 'This pickup cannot be released by your merchant account.',
    };
  }
  if (code === 'ASSIGNMENT_CHANGED' || code === 'ASSIGNMENT_VERSION_MISMATCH') {
    return {
      group: 'assignment',
      title: 'RIDER ASSIGNMENT CHANGED',
      body: 'Ask the rider to refresh their delivery and generate a new pickup QR.',
    };
  }
  if (
    code === 'FULFILLMENT_NOT_PICKUP_ELIGIBLE' ||
    code === 'ORDER_TERMINAL' ||
    code === 'FULFILLMENT_MISSING'
  ) {
    return {
      group: 'unavailable',
      title: 'PICKUP NOT AVAILABLE',
      body: 'This order is no longer eligible for rider pickup.',
    };
  }
  if (code === 'TOKEN_CONSUMED') {
    return {
      group: 'consumed',
      title: 'PICKUP QR ALREADY USED',
      body: 'Do not create another release.',
    };
  }
  if (code === 'RIDER_ADVANCE_VENDOR_ACK_REQUIRED') {
    return {
      group: 'advance',
      title: 'RELEASE BLOCKED',
      body: 'Rider Advance requires vendor acknowledgment before this pickup can be released.',
    };
  }
  return {
    group: 'unknown',
    title: 'PICKUP NOT AVAILABLE',
    body: 'This pickup could not be verified. Scan the rider QR again.',
  };
}

type HttpInput = {
  transportFailed: boolean;
  status: number | null;
  body: unknown;
};

function readOk(body: unknown): { ok: boolean; code?: string; preview?: PickupReleasePreview; idempotent?: boolean } | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record.ok !== 'boolean') return null;
  return {
    ok: record.ok,
    code: typeof record.code === 'string' ? record.code : undefined,
    preview:
      record.preview && typeof record.preview === 'object'
        ? (record.preview as PickupReleasePreview)
        : undefined,
    idempotent: record.idempotent === true,
  };
}

export type ValidateInterpretation =
  | { outcome: 'accepted'; checklist: PublicChecklist }
  | { outcome: 'denied'; failure: FailurePresentation }
  | { outcome: 'network' }
  | { outcome: 'session' };

export function interpretValidateResponse(input: HttpInput): ValidateInterpretation {
  if (input.transportFailed) return { outcome: 'network' };
  if (input.status === 401 || input.status === 403) return { outcome: 'session' };
  const parsed = readOk(input.body);
  if (!parsed) return { outcome: 'network' };
  if (parsed.ok) {
    return { outcome: 'accepted', checklist: publicChecklist(parsed.preview ?? {}) };
  }
  return { outcome: 'denied', failure: failurePresentation(parsed.code) };
}

export type ConfirmInterpretation =
  | { outcome: 'released'; idempotent: boolean }
  | { outcome: 'denied'; failure: FailurePresentation }
  | { outcome: 'unknown' }
  | { outcome: 'session' };

export function interpretConfirmResponse(input: HttpInput): ConfirmInterpretation {
  if (input.transportFailed) return { outcome: 'unknown' };
  if (input.status === 401 || input.status === 403) return { outcome: 'session' };
  if (input.status !== null && input.status >= 500) return { outcome: 'unknown' };
  const parsed = readOk(input.body);
  if (!parsed) return { outcome: 'unknown' };
  if (parsed.ok) return { outcome: 'released', idempotent: parsed.idempotent === true };
  return { outcome: 'denied', failure: failurePresentation(parsed.code) };
}

export function pickupHandoffUrl(apiOrigin: string, action: 'validate' | 'confirm'): string {
  return `${apiOrigin.replace(/\/$/, '')}/api/pickup-handoffs/${action}`;
}

export function pickupHandoffBody(qrPayload: string): { qrPayload: string } {
  return { qrPayload };
}

export type ReleasePhase =
  | 'scan'
  | 'validating'
  | 'review'
  | 'confirm-dialog'
  | 'confirming'
  | 'checking'
  | 'released'
  | 'failure'
  | 'network'
  | 'session'
  | 'advance-blocked';

export function retainPickupPayload(phase: ReleasePhase): boolean {
  return (
    phase === 'validating' ||
    phase === 'review' ||
    phase === 'confirm-dialog' ||
    phase === 'confirming' ||
    phase === 'checking'
  );
}
