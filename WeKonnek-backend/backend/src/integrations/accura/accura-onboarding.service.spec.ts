/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import {
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { AccuraOnboardingService } from './accura-onboarding.service';
import { accuraBasicAuthorization } from './accura-client.types';

const PLATFORM_ID = 'acc_platform';
const PLATFORM_SECRET = 'platform-secret-value';
const INVOICE_ID = 'acc_invoice';
const INVOICE_SECRET = 'invoice-secret-must-not-be-used';
const MERCHANT_A = {
  id: 11,
  userId: 'user-a',
  name: "Vic's Café",
  email: 'vic@test.invalid',
  phone: '+639170000011',
  address: 'SM North',
  tin: '123-456-789-000',
  registeredBusinessName: 'ABC FOOD CORPORATION',
  taxClassification: 'vat_registered',
};
const MERCHANT_B = {
  ...MERCHANT_A,
  id: 22,
  userId: 'user-b',
  name: 'Other Merchant',
  registeredBusinessName: 'OTHER CORP',
};

type StoredClient = {
  legalName: string;
  tradeName: string;
  contactEmail: string;
  contactPhone: string;
  registeredAddress: { line1: string };
  tin: string;
  classification: string;
  reviewStatus: string;
  companyAccountStatus: string;
  correctionNotes: string | null;
  branches: Array<{
    id: string;
    code: string;
    name: string;
    address: { line1: string };
    active: boolean;
  }>;
  documents: Array<Record<string, unknown>>;
  complete: boolean;
};

function jsonResult(status: number, body: unknown) {
  return {
    status,
    json: async () => body,
    headers: new Headers(),
  };
}

function createAccura(options?: { down?: boolean; rejectAuth?: boolean }) {
  const clients = new Map<string, StoredClient>();
  const calls: Array<{ method: string; url: string; auth?: string | null; body?: unknown }> = [];
  const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
    if (options?.down) throw new Error('ECONNREFUSED');
    const method = String(init?.method || 'GET').toUpperCase();
    const auth = new Headers(init?.headers).get('Authorization');
    if (options?.rejectAuth || auth !== accuraBasicAuthorization(PLATFORM_ID, PLATFORM_SECRET)) {
      calls.push({ method, url, auth });
      return jsonResult(401, { error: 'UNAUTHORIZED_CLIENT' });
    }
    const parsed = new URL(url);
    const path = parsed.pathname;
    let parsedBody: unknown = null;
    if (typeof init?.body === 'string') parsedBody = JSON.parse(init.body);
    calls.push({ method, url, auth, body: parsedBody });
    if (path === '/api/v1/integrations/platform/clients' && method === 'POST') {
      const body = parsedBody as {
        externalClientReference: string;
        companyId?: string;
        initialProfile?: Record<string, string | { line1: string }>;
      };
      if (body.companyId) {
        return jsonResult(403, { error: 'COMPANY_NOT_ALLOWED' });
      }
      const existing = clients.get(body.externalClientReference);
      if (existing) {
        return jsonResult(200, { externalClientReference: body.externalClientReference, idempotent: true });
      }
      const initial = body.initialProfile || {};
      const address = (initial.registeredAddress as { line1?: string } | undefined) || {};
      clients.set(body.externalClientReference, {
        legalName: String(initial.legalName || ''),
        tradeName: String(initial.tradeName || ''),
        contactEmail: String(initial.contactEmail || ''),
        contactPhone: String(initial.contactPhone || ''),
        registeredAddress: { line1: String(address.line1 || '') },
        tin: String(initial.tin || ''),
        classification: String(initial.classification || ''),
        reviewStatus: 'INCOMPLETE',
        companyAccountStatus: 'PENDING_REVIEW',
        correctionNotes: null,
        branches: [],
        documents: [],
        complete: false,
      });
      return jsonResult(201, { externalClientReference: body.externalClientReference });
    }
    const match = path.match(
      /^\/api\/v1\/integrations\/platform\/clients\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/,
    );
    if (!match) return jsonResult(404, { error: 'NOT_FOUND' });
    const reference = decodeURIComponent(match[1]);
    const leaf = match[2];
    const extra = match[3];
    const client = clients.get(reference);
    if (!client) return jsonResult(404, { error: 'DELEGATION_NOT_FOUND' });
    if (!leaf && method === 'GET') {
      return jsonResult(200, { externalClientReference: reference });
    }
    if (leaf === 'profile' && method === 'GET') {
      return jsonResult(200, profileBody(client));
    }
    if (leaf === 'profile' && method === 'PATCH') {
      const body = parsedBody as Record<string, unknown>;
      if (typeof body.legalName === 'string') client.legalName = body.legalName;
      if (body.tradeName !== undefined) client.tradeName = String(body.tradeName || '');
      if (body.contactEmail !== undefined) client.contactEmail = String(body.contactEmail || '');
      if (body.contactPhone !== undefined) client.contactPhone = String(body.contactPhone || '');
      if (body.tin !== undefined) client.tin = String(body.tin);
      if (body.classification !== undefined) client.classification = String(body.classification);
      const address = body.registeredAddress as { line1?: string } | undefined;
      if (address?.line1 !== undefined) client.registeredAddress.line1 = address.line1;
      client.reviewStatus = 'INCOMPLETE';
      return jsonResult(200, profileBody(client));
    }
    if (leaf === 'readiness' && method === 'GET') {
      return jsonResult(200, readinessBody(client));
    }
    if (leaf === 'branches' && method === 'GET' && !extra) {
      return jsonResult(200, { items: client.branches });
    }
    if (leaf === 'branches' && method === 'POST' && !extra) {
      const body = parsedBody as { code: string; name: string; address?: { line1?: string } };
      const branch = {
        id: `br-${client.branches.length + 1}`,
        code: body.code,
        name: body.name,
        address: { line1: body.address?.line1 || '' },
        active: true,
      };
      client.branches.push(branch);
      return jsonResult(201, branch);
    }
    if (leaf === 'branches' && extra && method === 'PATCH') {
      const branch = client.branches.find((row) => row.id === extra);
      if (!branch) return jsonResult(404, { error: 'NOT_FOUND' });
      const body = parsedBody as { name?: string; address?: { line1?: string }; active?: boolean };
      if (body.name) branch.name = body.name;
      if (body.address?.line1 !== undefined) branch.address.line1 = body.address.line1;
      if (body.active != null) branch.active = body.active;
      return jsonResult(200, branch);
    }
    if (leaf === 'documents' && method === 'GET') {
      return jsonResult(200, { items: client.documents });
    }
    if (leaf === 'documents' && method === 'POST') {
      if (!(init?.body instanceof FormData)) {
        return jsonResult(400, { error: 'VALIDATION_ERROR' });
      }
      const documentType = String(init.body.get('documentType') || '');
      const file = init.body.get('file');
      client.documents.push({
        id: `doc-${client.documents.length + 1}`,
        documentType,
        originalFilename: file instanceof File ? file.name : 'document',
        mimeType: file instanceof File ? file.type : 'application/pdf',
        size: 12,
        status: 'PROVIDED',
        statusLabel: 'Provided',
        uploadedAt: '2026-09-02T01:00:00.000Z',
        reviewNotes: null,
      });
      return jsonResult(201, { ok: true });
    }
    if (leaf === 'submit' && method === 'POST') {
      if (!client.complete) {
        return jsonResult(400, {
          error: 'PROFILE_INCOMPLETE',
          details: { missing: ['supportingDocument'] },
        });
      }
      if (client.companyAccountStatus === 'SUSPENDED') {
        return jsonResult(403, { error: 'CLIENT_ACCOUNT_SUSPENDED' });
      }
      if (client.reviewStatus === 'APPROVED') {
        return jsonResult(409, { error: 'ONBOARDING_ALREADY_SUBMITTED' });
      }
      client.reviewStatus = 'SUBMITTED';
      return jsonResult(200, { reviewStatus: 'SUBMITTED' });
    }
    return jsonResult(404, { error: 'NOT_FOUND' });
  });
  return { fetchImpl, clients, calls };
}

function profileBody(client: StoredClient) {
  return {
    legalName: client.legalName,
    tradeName: client.tradeName,
    contactEmail: client.contactEmail,
    contactPhone: client.contactPhone,
    registeredAddress: client.registeredAddress,
    taxProfile: { tin: client.tin, classification: client.classification },
    reviewStatus: client.reviewStatus,
    companyAccountStatus: client.companyAccountStatus,
    correctionRequired: client.reviewStatus === 'NEEDS_CORRECTION',
    correctionNotes: client.correctionNotes,
    notice:
      'ACCURA review accepts client-provided tax registration for ACCURA setup. It is not BIR Approved, BIR Certified, BIR Accredited, or BIR Verified.',
  };
}

function readinessBody(client: StoredClient) {
  const sections = {
    taxpayerIdentity: { complete: Boolean(client.legalName), missing: client.legalName ? [] : ['legalName'] },
    taxProfile: {
      complete: Boolean(client.tin && client.classification),
      missing: [!client.tin && 'tin', !client.classification && 'classification'].filter(Boolean),
    },
    branches: { complete: client.branches.length > 0, missing: client.branches.length ? [] : ['branch'] },
    invoiceSetup: { complete: true, missing: [] },
    documents: {
      complete: client.documents.length > 0,
      missing: client.documents.length ? [] : ['supportingDocument'],
    },
  };
  client.complete = Object.values(sections).every((section) => section.complete);
  return {
    reviewStatus: client.reviewStatus,
    reviewStatusLabel:
      client.reviewStatus === 'APPROVED'
        ? 'Approved for ACCURA Setup'
        : client.reviewStatus.replaceAll('_', ' '),
    companyAccountStatus: client.companyAccountStatus,
    complete: client.complete,
    missing: Object.values(sections).flatMap((section) => section.missing as string[]),
    sections,
    correctionRequired: client.reviewStatus === 'NEEDS_CORRECTION',
    correctionNotes: client.correctionNotes,
    notice:
      'ACCURA review accepts client-provided tax registration for ACCURA setup. It is not BIR Approved, BIR Certified, BIR Accredited, or BIR Verified.',
  };
}

function prismaFor(merchants: typeof MERCHANT_A[], shops: Array<{ id: number; merchantId: number; name: string; address: string | null; accuraBranchId?: string | null }>) {
  const links = new Map<number, Record<string, unknown>>();
  const mappings = new Map<number, { merchantId: number; shopId: number; accuraBranchId: string }>();
  const audits: unknown[] = [];
  for (const shop of shops) {
    if (shop.accuraBranchId) {
      mappings.set(shop.id, {
        merchantId: shop.merchantId,
        shopId: shop.id,
        accuraBranchId: shop.accuraBranchId,
      });
    }
  }
  return {
    audits,
    links,
    mappings,
    merchant: {
      findFirst: jest.fn(async ({ where }: { where: { userId: string } }) =>
        merchants.find((row) => row.userId === where.userId) || null,
      ),
    },
    branch: {
      findUnique: jest.fn(async ({ where }: { where: { id: number } }) =>
        shops.find((row) => row.id === where.id) || null,
      ),
      findMany: jest.fn(async ({ where }: { where: { merchantId: number } }) =>
        shops
          .filter((row) => row.merchantId === where.merchantId)
          .map((row) => ({
            id: row.id,
            name: row.name,
            address: row.address,
            accuraBranchMapping: mappings.has(row.id)
              ? { accuraBranchId: mappings.get(row.id)!.accuraBranchId }
              : null,
          })),
      ),
    },
    shopAccuraBranchMapping: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        mappings.set(where.shopId, { ...create, ...update });
        return mappings.get(where.shopId);
      }),
      deleteMany: jest.fn(async ({ where }: { where: { shopId: number } }) => {
        mappings.delete(where.shopId);
        return { count: 1 };
      }),
    },
    accuraMerchantLink: {
      findUnique: jest.fn(async ({ where }: { where: { merchantId: number } }) =>
        links.get(where.merchantId) || null,
      ),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const current = links.get(where.merchantId) || {};
        const next = { ...current, ...create, ...update };
        links.set(where.merchantId, next);
        return next;
      }),
    },
    accuraOnboardingAuditEvent: {
      create: jest.fn(async ({ data }: { data: unknown }) => {
        audits.push(data);
        return data;
      }),
    },
  };
}

function createService(
  prisma: ReturnType<typeof prismaFor>,
  fetchImpl: jest.Mock,
  extraEnv: Record<string, string> = {},
) {
  const config = {
    get: (key: string) =>
      ({
        ACCURA_API_BASE_URL: 'https://accura-sandbox.example.test',
        ACCURA_PLATFORM_CLIENT_ID: PLATFORM_ID,
        ACCURA_PLATFORM_CLIENT_SECRET: PLATFORM_SECRET,
        ACCURA_INTEGRATION_CLIENT_ID: INVOICE_ID,
        ACCURA_INTEGRATION_CLIENT_SECRET: INVOICE_SECRET,
        ...extraEnv,
      })[key],
  };
  return new AccuraOnboardingService(
    prisma as never,
    config as unknown as ConfigService,
    fetchImpl,
  );
}

describe('AccuraOnboardingService', () => {
  const merchantUser = { id: 'user-a', role: UserRole.merchant };

  it('loads and prefills from WeKonnek without treating shops as BIR branches', async () => {
    const accura = createAccura();
    const prisma = prismaFor([MERCHANT_A], [
      { id: 7, merchantId: 11, name: 'SM North', address: 'North Ave' },
    ]);
    const service = createService(prisma, accura.fetchImpl);
    const setup = await service.getSetup(merchantUser);
    expect(setup.unavailable).toBe(false);
    expect(setup.profile.legalName).toBe('ABC FOOD CORPORATION');
    expect(setup.prefill.tradeName).toBe("Vic's Café");
    expect(setup.wekonnekDisplayName).toBe("Vic's Café");
    expect(setup.shops).toEqual([
      { shopId: 7, name: 'SM North', address: 'North Ave', accuraBranchId: null },
    ]);
    expect(setup.registeredBranches).toEqual([]);
    expect(setup.readiness.complete).toBe(false);
    expect(accura.calls.some((call) => call.body && (call.body as any).companyId)).toBe(false);
    expect(accura.calls[0].auth).toBe(
      accuraBasicAuthorization(PLATFORM_ID, PLATFORM_SECRET),
    );
    expect(accura.calls[0].auth).not.toBe(
      accuraBasicAuthorization(INVOICE_ID, INVOICE_SECRET),
    );
  });

  it('saves a draft to ACCURA and refetches authoritative profile', async () => {
    const accura = createAccura();
    const prisma = prismaFor([MERCHANT_A], []);
    const service = createService(prisma, accura.fetchImpl);
    await service.getSetup(merchantUser);
    accura.clients.get('merchant-11')!.legalName = 'STALE NAME';
    const setup = await service.saveProfile(merchantUser, {
      legalName: 'ABC FOOD CORPORATION',
      tin: '123456789000',
      classification: 'VAT',
      registeredAddressLine1: '1 Ayala Ave',
    });
    expect(setup.profile.legalName).toBe('ABC FOOD CORPORATION');
    expect(setup.profile.tin).toBe('123456789000');
    expect(setup.status.reviewStatus).toBe('INCOMPLETE');
    expect(prisma.audits.some((row: any) => row.action === 'PROFILE_SAVE')).toBe(true);
  });

  it('uploads a document by proxy without retaining WeKonnek storage keys', async () => {
    const accura = createAccura();
    const prisma = prismaFor([MERCHANT_A], []);
    const service = createService(prisma, accura.fetchImpl);
    const setup = await service.uploadDocument(
      merchantUser,
      {
        buffer: Buffer.from('%PDF-1.4 test'),
        originalname: 'cor.pdf',
        mimetype: 'application/octet-stream',
        size: 12,
      },
      'BIR_CERTIFICATE_OF_REGISTRATION',
    );
    expect(setup.documents[0].originalFilename).toBe('cor.pdf');
    expect(JSON.stringify(setup.documents)).not.toMatch(/storageKey/);
    expect(prisma.audits.some((row: any) => row.action === 'DOCUMENT_UPLOAD')).toBe(true);
  });

  it('submits only when ACCURA reports complete and shows submitted status', async () => {
    const accura = createAccura();
    const prisma = prismaFor([MERCHANT_A], []);
    const service = createService(prisma, accura.fetchImpl);
    await expect(service.submit(merchantUser)).rejects.toBeInstanceOf(HttpException);
    await service.saveProfile(merchantUser, {
      legalName: 'ABC FOOD CORPORATION',
      tin: '123456789000',
      classification: 'VAT',
      registeredAddressLine1: '1 Ayala Ave',
    });
    await service.createBranch(merchantUser, {
      code: 'MAIN',
      name: 'Head Office',
      addressLine1: '1 Ayala Ave',
    });
    await service.uploadDocument(
      merchantUser,
      {
        buffer: Buffer.from('%PDF-1.4 test'),
        originalname: 'cor.pdf',
        mimetype: 'application/pdf',
        size: 12,
      },
      'BIR_CERTIFICATE_OF_REGISTRATION',
    );
    const submitted = await service.submit(merchantUser);
    expect(submitted.status.reviewStatus).toBe('SUBMITTED');
    expect(submitted.readiness.complete).toBe(true);
  });

  it('surfaces needs correction, approved, and suspended ACCURA states', async () => {
    const accura = createAccura();
    const prisma = prismaFor([MERCHANT_A], []);
    const service = createService(prisma, accura.fetchImpl);
    await service.getSetup(merchantUser);
    const client = accura.clients.get('merchant-11')!;
    client.reviewStatus = 'NEEDS_CORRECTION';
    client.correctionNotes = 'Please upload a clearer Certificate of Registration.';
    const correction = await service.getSetup(merchantUser);
    expect(correction.status.correctionRequired).toBe(true);
    expect(correction.status.correctionNotes).toMatch(/Certificate of Registration/);
    client.reviewStatus = 'APPROVED';
    client.companyAccountStatus = 'ACTIVE';
    const approved = await service.getSetup(merchantUser);
    expect(approved.status.approvedForAccuraSetup).toBe(true);
    expect(approved.status.reviewStatusLabel).toMatch(/Approved for ACCURA/);
    expect(approved.status.reviewStatusLabel).not.toMatch(/BIR Approved/i);
    expect(approved.status.issuanceActive).toBe(true);
    client.companyAccountStatus = 'SUSPENDED';
    const suspended = await service.getSetup(merchantUser);
    expect(suspended.status.suspended).toBe(true);
  });

  it('returns last-known status when ACCURA is unavailable and does not fabricate APPROVED', async () => {
    const accura = createAccura();
    const prisma = prismaFor([MERCHANT_A], []);
    const service = createService(prisma, accura.fetchImpl);
    await service.getSetup(merchantUser);
    accura.clients.get('merchant-11')!.reviewStatus = 'UNDER_REVIEW';
    await service.getSetup(merchantUser);
    const down = createAccura({ down: true });
    const unavailable = await createService(prisma, down.fetchImpl).getSetup(merchantUser);
    expect(unavailable.unavailable).toBe(true);
    expect(unavailable.status.approvedForAccuraSetup).toBe(false);
    expect(unavailable.status.reviewStatus).toBe('UNDER_REVIEW');
    expect(unavailable.notice).toMatch(/has not been lost/);
  });

  it('rejects customers, coordinators, shop portal, and cross-merchant shop mapping', async () => {
    const accura = createAccura();
    const prisma = prismaFor(
      [MERCHANT_A, MERCHANT_B],
      [
        { id: 7, merchantId: 11, name: 'SM North', address: null },
        { id: 9, merchantId: 22, name: 'Other Shop', address: null },
      ],
    );
    const service = createService(prisma, accura.fetchImpl);
    await service.createBranch(merchantUser, { code: 'MAIN', name: 'Head Office' });
    await expect(
      service.getSetup({ id: 'cust-1', role: UserRole.customer }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.getSetup({ id: 'coord-1', role: UserRole.coordinator }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.getSetup({ id: 'user-a', role: UserRole.merchant, portal: 'shop' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.mapShop(merchantUser, { shopId: 9, accuraBranchId: 'br-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const mapped = await service.mapShop(merchantUser, {
      shopId: 7,
      accuraBranchId: 'br-1',
    });
    expect(mapped.shops[0].accuraBranchId).toBe('br-1');
    const secondShopPrisma = prismaFor(
      [MERCHANT_A],
      [
        { id: 7, merchantId: 11, name: 'SM North', address: null, accuraBranchId: 'br-1' },
        { id: 8, merchantId: 11, name: 'SM South', address: null },
      ],
    );
    const both = await createService(secondShopPrisma, accura.fetchImpl).mapShop(
      merchantUser,
      { shopId: 8, accuraBranchId: 'br-1' },
    );
    expect(both.shops.map((shop) => shop.accuraBranchId)).toEqual(['br-1', 'br-1']);
  });

  it('does not fall back to invoice credentials', async () => {
    const accura = createAccura();
    const prisma = prismaFor([MERCHANT_A], []);
    const service = createService(prisma, accura.fetchImpl, {
      ACCURA_PLATFORM_CLIENT_ID: '',
      ACCURA_PLATFORM_CLIENT_SECRET: '',
    });
    const setup = await service.getSetup(merchantUser);
    expect(setup.unavailable).toBe(true);
    expect(accura.fetchImpl).not.toHaveBeenCalled();
  });
});
