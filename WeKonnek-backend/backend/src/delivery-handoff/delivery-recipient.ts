import { createHash } from 'crypto';

export const RECIPIENT_NAME_MAX = 80;
export const RECIPIENT_IDEMPOTENCY_KEY_MAX = 64;

export const RECIPIENT_CATEGORIES = [
  'HOUSEHOLD_MEMBER',
  'AUTHORIZED_PERSON',
] as const;

export type RecipientCategory = (typeof RECIPIENT_CATEGORIES)[number];

export type RecipientAuthorizationInput = {
  recipientDisplayName?: unknown;
  recipientCategory?: unknown;
  idempotencyKey?: unknown;
};

export type ParsedRecipientAuthorization = {
  recipientDisplayName: string;
  recipientCategory: RecipientCategory;
  idempotencyKey: string;
  payloadHash: string;
};

export type RecipientPreview = {
  receiverType: 'CUSTOMER' | 'AUTHORIZED_RECIPIENT';
  recipientDisplayName: string | null;
  recipientCategory: RecipientCategory | null;
  status: 'NONE' | 'ACTIVE' | 'REVOKED' | 'CONSUMED';
};

export function customerSelfPreview(): RecipientPreview {
  return {
    receiverType: 'CUSTOMER',
    recipientDisplayName: null,
    recipientCategory: null,
    status: 'NONE',
  };
}

export function normalizeRecipientDisplayName(
  value: unknown,
): { ok: true; value: string } | { ok: false; code: string; message: string } {
  if (typeof value !== 'string') {
    return {
      ok: false,
      code: 'RECIPIENT_NAME_REQUIRED',
      message: 'Recipient display name is required',
    };
  }
  const name = value.trim();
  if (!name) {
    return {
      ok: false,
      code: 'RECIPIENT_NAME_REQUIRED',
      message: 'Recipient display name is required',
    };
  }
  if (name.length > RECIPIENT_NAME_MAX) {
    return {
      ok: false,
      code: 'RECIPIENT_NAME_TOO_LONG',
      message: 'Recipient display name is too long',
    };
  }
  return { ok: true, value: name };
}

export function recipientPayloadHash(input: {
  recipientDisplayName: string;
  recipientCategory: string;
}): string {
  const canonical = JSON.stringify({
    recipientCategory: input.recipientCategory,
    recipientDisplayName: input.recipientDisplayName,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function parseRecipientAuthorization(
  body: RecipientAuthorizationInput,
):
  | { ok: true; value: ParsedRecipientAuthorization }
  | { ok: false; code: string; message: string } {
  const name = normalizeRecipientDisplayName(body.recipientDisplayName);
  if (!name.ok) return name;
  const category =
    typeof body.recipientCategory === 'string'
      ? body.recipientCategory.trim()
      : '';
  if (!RECIPIENT_CATEGORIES.includes(category as RecipientCategory)) {
    return {
      ok: false,
      code: 'RECIPIENT_CATEGORY_INVALID',
      message: 'Recipient category is not allowed',
    };
  }
  const idempotencyKey =
    typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
  if (!idempotencyKey || idempotencyKey.length > RECIPIENT_IDEMPOTENCY_KEY_MAX) {
    return {
      ok: false,
      code: 'IDEMPOTENCY_KEY_INVALID',
      message: 'Idempotency key is required',
    };
  }
  return {
    ok: true,
    value: {
      recipientDisplayName: name.value,
      recipientCategory: category as RecipientCategory,
      idempotencyKey,
      payloadHash: recipientPayloadHash({
        recipientDisplayName: name.value,
        recipientCategory: category,
      }),
    },
  };
}
