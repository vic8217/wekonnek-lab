import { accuraBasicAuthorization } from './accura-client.types';

export {
  accuraExternalClientReference,
  getAccuraExternalClientReference,
} from './accura-client.types';

export const ACCURA_PLATFORM_CLIENTS_PATH =
  '/api/v1/integrations/platform/clients';
export const ACCURA_DOCUMENT_MAX_BYTES = 10_485_760;
export const ACCURA_DOCUMENT_TYPES = [
  'BIR_CERTIFICATE_OF_REGISTRATION',
  'OTHER_TAX_REGISTRATION_DOCUMENT',
] as const;
export const ACCURA_TAX_CLASSIFICATIONS = [
  'VAT',
  'NON_VAT',
  'VAT_EXEMPT',
] as const;

export type AccuraTaxClassification =
  (typeof ACCURA_TAX_CLASSIFICATIONS)[number];
export type AccuraDocumentType = (typeof ACCURA_DOCUMENT_TYPES)[number];

/** Mapped ACCURA Company Branch used by WeKonnek setup/mapping. */
export type AccuraRegisteredBranch = {
  id: string;
  code: string;
  name: string;
  addressLine1: string;
  active: boolean;
};

export function mapWeKonnekTaxToAccura(
  value: string | null | undefined,
): AccuraTaxClassification | '' {
  const raw = String(value || '').toLowerCase();
  if (raw === 'vat_registered') return 'VAT';
  if (raw === 'non_vat_percentage_tax') return 'NON_VAT';
  if (raw === 'vat_exempt') return 'VAT_EXEMPT';
  return '';
}

export function merchantFacingAccuraError(code: string | undefined): string {
  switch (code) {
    case 'PROFILE_INCOMPLETE':
      return 'Please complete the required information.';
    case 'NEEDS_CORRECTION':
      return 'ACCURA requested corrections before this setup can be submitted.';
    case 'CLIENT_ACCOUNT_SUSPENDED':
      return 'ACCURA E-Receipt Account Suspended';
    case 'CLIENT_ACCOUNT_TERMINATED':
      return 'This ACCURA e-receipt account is no longer active.';
    case 'ONBOARDING_ALREADY_SUBMITTED':
      return 'This setup is already submitted for ACCURA review.';
    case 'DOCUMENT_TYPE_NOT_ALLOWED':
      return 'That document type is not accepted. Upload a PDF, JPG, or PNG.';
    case 'DOCUMENT_TOO_LARGE':
      return 'That file is too large. The maximum size is 10 MB.';
    case 'DOCUMENT_STORAGE_PROVIDER_REQUIRED':
      return 'E-Receipt document storage is not available yet.';
    case 'DUPLICATE_CLIENT_TIN':
      return 'This TIN is already registered with ACCURA.';
    case 'EXISTING_TAXPAYER_REVIEW_REQUIRED':
      return 'An existing ACCURA taxpayer needs System Admin review before this merchant can be linked.';
    case 'DELEGATED_CLIENT_CONFLICT':
      return 'Saved merchant details conflict with the existing ACCURA setup.';
    case 'DELEGATION_REVOKED':
      return 'ACCURA access for this merchant has been revoked.';
    case 'DELEGATION_NOT_FOUND':
      return 'ACCURA e-receipt setup has not been created yet.';
    case 'RATE_LIMIT_EXCEEDED':
      return 'E-Receipt service is busy. Please try again in a moment.';
    case 'UNAUTHORIZED_CLIENT':
    case 'SCOPE_REQUIRED':
    case 'PLATFORM_AUTHORITY_REQUIRED':
      return 'E-Receipt service is not configured for this environment.';
    default:
      return 'E-Receipt service is temporarily unavailable. Your saved WeKonnek merchant data has not been lost.';
  }
}

export function detectAllowedDocumentMime(buffer: Buffer): string | null {
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF') {
    return 'application/pdf';
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  return null;
}

export function platformAuthorization(
  clientId: string,
  clientSecret: string,
): string {
  return accuraBasicAuthorization(clientId, clientSecret);
}

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  INCOMPLETE: 'Incomplete',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  NEEDS_CORRECTION: 'Needs Correction',
  APPROVED: 'Approved for ACCURA E-Receipt Setup',
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  BIR_CERTIFICATE_OF_REGISTRATION: 'Certificate of Registration',
  OTHER_TAX_REGISTRATION_DOCUMENT: 'Other tax registration document',
};

export function reviewStatusLabel(status: string | null | undefined): string {
  if (!status) return '';
  return REVIEW_STATUS_LABELS[status] || status.replaceAll('_', ' ');
}

export const SECTION_LABELS: Record<string, string> = {
  taxpayerIdentity: 'Registered business information',
  taxProfile: 'Tax configuration',
  branches: 'Registered branches',
  invoiceSetup: 'Invoice numbering (ACCURA)',
  documents: 'Registration document',
};

export function accountStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'PENDING_REVIEW':
      return 'Pending Review';
    case 'ACTIVE':
      return 'Active';
    case 'SUSPENDED':
      return 'Suspended';
    case 'TERMINATED':
      return 'Terminated';
    default:
      return status || '';
  }
}
