import {
  customerSelfPreview,
  normalizeRecipientDisplayName,
  parseRecipientAuthorization,
  recipientPayloadHash,
} from './delivery-recipient';

describe('UCE-4 delivery recipient', () => {
  it('accepts the two product categories and rejects others', () => {
    expect(
      parseRecipientAuthorization({
        recipientDisplayName: 'Ana Cruz',
        recipientCategory: 'HOUSEHOLD_MEMBER',
        idempotencyKey: 'k1',
      }).ok,
    ).toBe(true);
    expect(
      parseRecipientAuthorization({
        recipientDisplayName: 'Ana Cruz',
        recipientCategory: 'AUTHORIZED_PERSON',
        idempotencyKey: 'k1',
      }).ok,
    ).toBe(true);
    const rejected = parseRecipientAuthorization({
      recipientDisplayName: 'Ana Cruz',
      recipientCategory: 'CUSTOMER',
      idempotencyKey: 'k1',
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.code).toBe('RECIPIENT_CATEGORY_INVALID');
  });

  it('trims display names and enforces the 80 character boundary', () => {
    expect(normalizeRecipientDisplayName('  Ana  ').ok && normalizeRecipientDisplayName('  Ana  ')).toEqual({
      ok: true,
      value: 'Ana',
    });
    expect(normalizeRecipientDisplayName('   ').ok).toBe(false);
    const boundary = 'a'.repeat(80);
    expect(normalizeRecipientDisplayName(boundary)).toEqual({
      ok: true,
      value: boundary,
    });
    const tooLong = normalizeRecipientDisplayName('a'.repeat(81));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.code).toBe('RECIPIENT_NAME_TOO_LONG');
  });

  it('hashes the normalized name and category, not the raw input', () => {
    const parsed = parseRecipientAuthorization({
      recipientDisplayName: '  Ana Cruz  ',
      recipientCategory: 'HOUSEHOLD_MEMBER',
      idempotencyKey: 'k1',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.payloadHash).toBe(
      recipientPayloadHash({
        recipientDisplayName: 'Ana Cruz',
        recipientCategory: 'HOUSEHOLD_MEMBER',
      }),
    );
    expect(parsed.value.payloadHash).not.toBe(
      recipientPayloadHash({
        recipientDisplayName: '  Ana Cruz  ',
        recipientCategory: 'HOUSEHOLD_MEMBER',
      }),
    );
    expect(parsed.value.payloadHash).toHaveLength(64);
  });

  it('represents customer-self as the absence of an authorization', () => {
    expect(customerSelfPreview()).toEqual({
      receiverType: 'CUSTOMER',
      recipientDisplayName: null,
      recipientCategory: null,
      status: 'NONE',
    });
  });
});
