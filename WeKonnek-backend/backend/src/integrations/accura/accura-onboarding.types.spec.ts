import {
  ACCURA_DOCUMENT_TYPES,
  ACCURA_PLATFORM_CLIENTS_PATH,
  accuraExternalClientReference,
  detectAllowedDocumentMime,
  mapWeKonnekTaxToAccura,
  merchantFacingAccuraError,
  REVIEW_STATUS_LABELS,
  reviewStatusLabel,
} from './accura-onboarding.types';
import { readPlatformConfig } from './accura-onboarding.http';

describe('ACCURA onboarding contract helpers', () => {
  it('uses the delegated platform path and merchant-scoped reference', () => {
    expect(ACCURA_PLATFORM_CLIENTS_PATH).toBe(
      '/api/v1/integrations/platform/clients',
    );
    expect(accuraExternalClientReference(11)).toBe('merchant-11');
    expect(ACCURA_DOCUMENT_TYPES).toEqual([
      'BIR_CERTIFICATE_OF_REGISTRATION',
      'OTHER_TAX_REGISTRATION_DOCUMENT',
    ]);
  });

  it('maps WeKonnek tax types only when ACCURA has an equivalent', () => {
    expect(mapWeKonnekTaxToAccura('vat_registered')).toBe('VAT');
    expect(mapWeKonnekTaxToAccura('non_vat_percentage_tax')).toBe('NON_VAT');
    expect(mapWeKonnekTaxToAccura('vat_exempt')).toBe('VAT_EXEMPT');
    expect(mapWeKonnekTaxToAccura('percentage_tax')).toBe('');
  });

  it('detects allowed document magic bytes and rejects others', () => {
    expect(detectAllowedDocumentMime(Buffer.from('%PDF-1.4 demo'))).toBe(
      'application/pdf',
    );
    expect(detectAllowedDocumentMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'image/jpeg',
    );
    expect(
      detectAllowedDocumentMime(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe('image/png');
    expect(detectAllowedDocumentMime(Buffer.from('MZ executable'))).toBeNull();
  });

  it('translates ACCURA errors without BIR wording', () => {
    expect(merchantFacingAccuraError('PROFILE_INCOMPLETE')).toBe(
      'Please complete the required information.',
    );
    expect(merchantFacingAccuraError('CLIENT_ACCOUNT_SUSPENDED')).toBe(
      'ACCURA E-Receipt Account Suspended',
    );
    expect(reviewStatusLabel('APPROVED')).toBe(
      'Approved for ACCURA E-Receipt Setup',
    );
    expect(REVIEW_STATUS_LABELS.APPROVED).not.toMatch(/BIR Approved/i);
    expect(merchantFacingAccuraError('NETWORK')).not.toMatch(/stack/i);
  });

  it('reads only platform machine credentials', () => {
    const env: Record<string, string> = {
      ACCURA_API_BASE_URL: 'https://accura.test',
      ACCURA_INTEGRATION_CLIENT_ID: 'invoice-id',
      ACCURA_INTEGRATION_CLIENT_SECRET: 'invoice-secret',
    };
    expect(readPlatformConfig((key) => env[key])).toBeNull();
    env.ACCURA_PLATFORM_CLIENT_ID = 'platform-id';
    env.ACCURA_PLATFORM_CLIENT_SECRET = 'platform-secret';
    expect(readPlatformConfig((key) => env[key])).toEqual({
      baseUrl: 'https://accura.test',
      clientId: 'platform-id',
      clientSecret: 'platform-secret',
      timeoutMs: 10_000,
    });
  });
});
