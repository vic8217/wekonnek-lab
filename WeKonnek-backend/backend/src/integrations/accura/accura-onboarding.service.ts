import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ACCURA_DOCUMENT_MAX_BYTES,
  ACCURA_DOCUMENT_TYPES,
  ACCURA_PLATFORM_CLIENTS_PATH,
  accuraExternalClientReference,
  accountStatusLabel,
  detectAllowedDocumentMime,
  DOCUMENT_TYPE_LABELS,
  mapWeKonnekTaxToAccura,
  merchantFacingAccuraError,
  reviewStatusLabel,
  SECTION_LABELS,
  type AccuraDocumentType,
  type AccuraRegisteredBranch,
  type AccuraTaxClassification,
} from './accura-onboarding.types';
import {
  accuraErrorCode,
  accuraPlatformRequest,
  readPlatformConfig,
  type AccuraOnboardingFetch,
  type AccuraPlatformConfig,
} from './accura-onboarding.http';

type SessionUser = {
  id: string;
  role?: string;
  portal?: string;
};

type Prefill = {
  legalName: string;
  tradeName: string;
  contactEmail: string;
  contactPhone: string;
  registeredAddressLine1: string;
  tin: string;
  classification: AccuraTaxClassification | '';
};

@Injectable()
export class AccuraOnboardingService {
  private readonly logger = new Logger(AccuraOnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fetchImpl: AccuraOnboardingFetch = (url, init) =>
      globalThis.fetch(url, init),
  ) {}

  async getSetup(user: SessionUser) {
    const merchant = await this.requireMerchant(user);
    return this.loadSetup(merchant, user, true);
  }

  async saveProfile(
    user: SessionUser,
    body: {
      legalName?: string;
      tradeName?: string | null;
      contactEmail?: string | null;
      contactPhone?: string | null;
      registeredAddressLine1?: string;
      tin?: string;
      classification?: AccuraTaxClassification;
    },
  ) {
    const merchant = await this.requireMerchant(user);
    const reference = accuraExternalClientReference(merchant.id);
    await this.ensureProvisioned(merchant, user);
    const payload: Record<string, unknown> = {};
    if (body.legalName != null) payload.legalName = body.legalName;
    if (body.tradeName !== undefined) payload.tradeName = body.tradeName;
    if (body.contactEmail !== undefined) payload.contactEmail = body.contactEmail;
    if (body.contactPhone !== undefined) payload.contactPhone = body.contactPhone;
    if (body.registeredAddressLine1 !== undefined) {
      payload.registeredAddress = { line1: body.registeredAddressLine1 };
    }
    if (body.tin != null) payload.tin = body.tin;
    if (body.classification != null) payload.classification = body.classification;
    const result = await this.platformJson(
      'PATCH',
      `${ACCURA_PLATFORM_CLIENTS_PATH}/${encodeURIComponent(reference)}/profile`,
      payload,
    );
    this.assertOk(result.status, result.body, [200]);
    await this.audit(merchant.id, user.id, 'PROFILE_SAVE', 'ok');
    return this.loadSetup(merchant, user, false);
  }

  async getReadiness(user: SessionUser) {
    const merchant = await this.requireMerchant(user);
    const setup = await this.loadSetup(merchant, user, true);
    return setup.readiness;
  }

  async listBranches(user: SessionUser) {
    const setup = await this.getSetup(user);
    return { items: setup.registeredBranches, shops: setup.shops };
  }

  async createBranch(
    user: SessionUser,
    body: { code: string; name: string; addressLine1?: string },
  ) {
    const merchant = await this.requireMerchant(user);
    const reference = accuraExternalClientReference(merchant.id);
    await this.ensureProvisioned(merchant, user);
    const result = await this.platformJson(
      'POST',
      `${ACCURA_PLATFORM_CLIENTS_PATH}/${encodeURIComponent(reference)}/branches`,
      {
        code: body.code,
        name: body.name,
        address: body.addressLine1 ? { line1: body.addressLine1 } : undefined,
      },
    );
    this.assertOk(result.status, result.body, [200, 201]);
    await this.audit(merchant.id, user.id, 'BRANCH_CREATE', 'ok');
    return this.loadSetup(merchant, user, false);
  }

  async updateBranch(
    user: SessionUser,
    branchId: string,
    body: { name?: string; addressLine1?: string; active?: boolean },
  ) {
    const merchant = await this.requireMerchant(user);
    const reference = accuraExternalClientReference(merchant.id);
    const payload: Record<string, unknown> = {};
    if (body.name != null) payload.name = body.name;
    if (body.addressLine1 !== undefined) {
      payload.address = { line1: body.addressLine1 };
    }
    if (body.active != null) payload.active = body.active;
    const result = await this.platformJson(
      'PATCH',
      `${ACCURA_PLATFORM_CLIENTS_PATH}/${encodeURIComponent(reference)}/branches/${encodeURIComponent(branchId)}`,
      payload,
    );
    this.assertOk(result.status, result.body, [200]);
    await this.audit(merchant.id, user.id, 'BRANCH_UPDATE', 'ok');
    return this.loadSetup(merchant, user, false);
  }

  async mapShop(
    user: SessionUser,
    input: { shopId: number; accuraBranchId: string | null },
  ) {
    const merchant = await this.requireMerchant(user);
    const shop = await this.prisma.branch.findUnique({
      where: { id: input.shopId },
    });
    if (!shop || shop.merchantId !== merchant.id) {
      throw new ForbiddenException('That shop does not belong to this merchant');
    }
    if (input.accuraBranchId) {
      const setup = await this.loadSetup(merchant, user, false);
      const allowed = setup.registeredBranches.some(
        (branch) => branch.id === input.accuraBranchId,
      );
      if (!allowed) {
        throw new ForbiddenException(
          'That registered branch does not belong to this merchant',
        );
      }
      await this.prisma.shopAccuraBranchMapping.upsert({
        where: { shopId: shop.id },
        create: {
          merchantId: merchant.id,
          shopId: shop.id,
          accuraBranchId: input.accuraBranchId,
        },
        update: { accuraBranchId: input.accuraBranchId },
      });
    } else {
      await this.prisma.shopAccuraBranchMapping.deleteMany({
        where: { shopId: shop.id, merchantId: merchant.id },
      });
    }
    await this.audit(merchant.id, user.id, 'SHOP_BRANCH_MAP', 'ok');
    return this.loadSetup(merchant, user, false);
  }

  async uploadDocument(
    user: SessionUser,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    documentType: string,
  ) {
    const merchant = await this.requireMerchant(user);
    if (!ACCURA_DOCUMENT_TYPES.includes(documentType as AccuraDocumentType)) {
      throw new HttpException(
        merchantFacingAccuraError('DOCUMENT_TYPE_NOT_ALLOWED'),
        HttpStatus.BAD_REQUEST,
      );
    }
    if (file.size > ACCURA_DOCUMENT_MAX_BYTES || file.buffer.length > ACCURA_DOCUMENT_MAX_BYTES) {
      throw new HttpException(
        merchantFacingAccuraError('DOCUMENT_TOO_LARGE'),
        HttpStatus.BAD_REQUEST,
      );
    }
    const mime = detectAllowedDocumentMime(file.buffer);
    if (!mime) {
      throw new HttpException(
        merchantFacingAccuraError('DOCUMENT_TYPE_NOT_ALLOWED'),
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.audit(merchant.id, user.id, 'DOCUMENT_UPLOAD', 'attempted');
    const machine = this.machine();
    const reference = accuraExternalClientReference(merchant.id);
    await this.ensureProvisioned(merchant, user);
    const form = new FormData();
    form.set('documentType', documentType);
    form.set(
      'file',
      new Blob([new Uint8Array(file.buffer)], { type: mime }),
      file.originalname || 'document',
    );
    const result = await accuraPlatformRequest(
      this.fetchImpl,
      machine,
      `${ACCURA_PLATFORM_CLIENTS_PATH}/${encodeURIComponent(reference)}/documents`,
      { method: 'POST', body: form },
    );
    this.assertOk(result.status, result.body, [200, 201]);
    await this.audit(merchant.id, user.id, 'DOCUMENT_UPLOAD', 'ok');
    return this.loadSetup(merchant, user, false);
  }

  async submit(user: SessionUser) {
    const merchant = await this.requireMerchant(user);
    const reference = accuraExternalClientReference(merchant.id);
    await this.ensureProvisioned(merchant, user);
    const result = await this.platformJson(
      'POST',
      `${ACCURA_PLATFORM_CLIENTS_PATH}/${encodeURIComponent(reference)}/submit`,
    );
    this.assertOk(result.status, result.body, [200]);
    await this.audit(merchant.id, user.id, 'SUBMIT', 'ok');
    return this.loadSetup(merchant, user, false);
  }

  private async loadSetup(
    merchant: {
      id: number;
      name: string;
      email: string | null;
      phone: string | null;
      address: string | null;
      tin: string | null;
      registeredBusinessName: string | null;
      taxClassification: string;
    },
    user: SessionUser,
    provisionIfMissing: boolean,
  ) {
    const machine = this.tryMachine();
    const prefill = this.prefillFrom(merchant);
    const shops = await this.shopsFor(merchant.id);
    if (!machine) {
      return this.unavailablePayload(merchant, prefill, shops, 'NOT_CONFIGURED');
    }
    try {
      if (provisionIfMissing) await this.ensureProvisioned(merchant, user);
      const reference = accuraExternalClientReference(merchant.id);
      const [profileRes, readinessRes, documentsRes, branchesRes] =
        await Promise.all([
          this.platformJson(
            'GET',
            `${ACCURA_PLATFORM_CLIENTS_PATH}/${encodeURIComponent(reference)}/profile`,
          ),
          this.platformJson(
            'GET',
            `${ACCURA_PLATFORM_CLIENTS_PATH}/${encodeURIComponent(reference)}/readiness`,
          ),
          this.platformJson(
            'GET',
            `${ACCURA_PLATFORM_CLIENTS_PATH}/${encodeURIComponent(reference)}/documents`,
          ),
          this.platformJson(
            'GET',
            `${ACCURA_PLATFORM_CLIENTS_PATH}/${encodeURIComponent(reference)}/branches`,
          ),
        ]);
      if (profileRes.status === 404) {
        return this.unavailablePayload(merchant, prefill, shops, 'DELEGATION_NOT_FOUND');
      }
      this.assertOk(profileRes.status, profileRes.body, [200]);
      this.assertOk(readinessRes.status, readinessRes.body, [200]);
      this.assertOk(documentsRes.status, documentsRes.body, [200]);
      this.assertOk(branchesRes.status, branchesRes.body, [200]);
      const profile = asRecord(profileRes.body) ?? {};
      const readiness = asRecord(readinessRes.body) ?? {};
      const documentsBody = asRecord(documentsRes.body);
      const branchesBody = asRecord(branchesRes.body);
      const documents = Array.isArray(documentsBody?.items)
        ? documentsBody.items
        : Array.isArray(profile.documents)
          ? profile.documents
          : [];
      const branches = Array.isArray(branchesBody?.items)
        ? branchesBody.items
        : Array.isArray(profile.branches)
          ? profile.branches
          : [];
      await this.rememberStatus(merchant.id, {
        reviewStatus: String(readiness.reviewStatus || profile.reviewStatus || ''),
        accountStatus: String(
          readiness.companyAccountStatus || profile.companyAccountStatus || '',
        ),
      });
      const registeredAddress = asRecord(profile.registeredAddress);
      const taxProfile = asRecord(profile.taxProfile);
      return {
        unavailable: false,
        merchantId: merchant.id,
        wekonnekDisplayName: merchant.name,
        prefill,
        profile: {
          legalName: String(profile.legalName || ''),
          tradeName: profile.tradeName == null ? '' : String(profile.tradeName),
          contactEmail:
            profile.contactEmail == null ? '' : String(profile.contactEmail),
          contactPhone:
            profile.contactPhone == null ? '' : String(profile.contactPhone),
          registeredAddressLine1: String(registeredAddress?.line1 || ''),
          tin: taxProfile?.tin == null ? '' : String(taxProfile.tin),
          classification:
            taxProfile?.classification == null
              ? ''
              : String(taxProfile.classification),
          code: profile.code == null ? '' : String(profile.code),
        },
        status: this.statusView(profile, readiness),
        readiness: this.readinessView(readiness),
        registeredBranches: branches.map((row) => this.branchView(row)),
        documents: documents.map((row) => this.documentView(row)),
        shops,
        notice: String(
          readiness.notice ||
            profile.notice ||
            'ACCURA review accepts client-provided tax registration for ACCURA setup. It is not BIR Approved, BIR Certified, BIR Accredited, or BIR Verified.',
        ),
      };
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        throw error;
      }
      this.logger.warn(
        `accura_onboarding_unavailable merchantId=${merchant.id} reason=network`,
      );
      await this.audit(merchant.id, user.id, 'PROFILE_LOAD', 'unavailable');
      return this.unavailablePayload(merchant, prefill, shops, 'NETWORK');
    }
  }

  private async ensureProvisioned(
    merchant: {
      id: number;
      name: string;
      email: string | null;
      phone: string | null;
      address: string | null;
      tin: string | null;
      registeredBusinessName: string | null;
      taxClassification: string;
    },
    user: SessionUser,
  ) {
    const machine = this.tryMachine();
    if (!machine) return;
    const reference = accuraExternalClientReference(merchant.id);
    const existing = await this.platformJson(
      'GET',
      `${ACCURA_PLATFORM_CLIENTS_PATH}/${encodeURIComponent(reference)}`,
    );
    if (existing.status === 200) {
      await this.upsertLink(merchant.id, reference);
      return;
    }
    if (existing.status && existing.status !== 404) {
      this.assertOk(existing.status, existing.body, [200]);
    }
    const prefill = this.prefillFrom(merchant);
    const initialProfile: Record<string, unknown> = {};
    if (prefill.legalName) initialProfile.legalName = prefill.legalName;
    if (prefill.tradeName) initialProfile.tradeName = prefill.tradeName;
    if (prefill.contactEmail) initialProfile.contactEmail = prefill.contactEmail;
    if (prefill.contactPhone) initialProfile.contactPhone = prefill.contactPhone;
    if (prefill.tin) initialProfile.tin = prefill.tin;
    if (prefill.classification) initialProfile.classification = prefill.classification;
    if (prefill.registeredAddressLine1) {
      initialProfile.registeredAddress = { line1: prefill.registeredAddressLine1 };
    }
    const created = await this.platformJson(
      'POST',
      ACCURA_PLATFORM_CLIENTS_PATH,
      { externalClientReference: reference, initialProfile },
    );
    this.assertOk(created.status, created.body, [200, 201]);
    await this.upsertLink(merchant.id, reference);
    await this.audit(merchant.id, user.id, 'PROVISION', 'ok');
  }

  private async shopsFor(merchantId: number) {
    const shops = await this.prisma.branch.findMany({
      where: { merchantId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        address: true,
        accuraBranchMapping: { select: { accuraBranchId: true } },
      },
    });
    return shops.map((shop) => ({
      shopId: shop.id,
      name: shop.name,
      address: shop.address,
      accuraBranchId: shop.accuraBranchMapping?.accuraBranchId ?? null,
    }));
  }

  private prefillFrom(merchant: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    tin: string | null;
    registeredBusinessName: string | null;
    taxClassification: string;
  }): Prefill {
    return {
      legalName: merchant.registeredBusinessName?.trim() || '',
      tradeName: merchant.name?.trim() || '',
      contactEmail: merchant.email?.trim() || '',
      contactPhone: merchant.phone?.trim() || '',
      registeredAddressLine1: merchant.address?.trim() || '',
      tin: merchant.tin?.trim() || '',
      classification: mapWeKonnekTaxToAccura(merchant.taxClassification),
    };
  }

  private statusView(
    profile: Record<string, unknown>,
    readiness: Record<string, unknown>,
  ) {
    const reviewStatus = String(
      readiness.reviewStatus || profile.reviewStatus || 'INCOMPLETE',
    );
    const accountStatus = String(
      readiness.companyAccountStatus ||
        profile.companyAccountStatus ||
        'PENDING_REVIEW',
    );
    return {
      reviewStatus,
      reviewStatusLabel: String(
        readiness.reviewStatusLabel ||
          profile.reviewStatusLabel ||
          reviewStatusLabel(reviewStatus),
      ),
      companyAccountStatus: accountStatus,
      companyAccountStatusLabel: accountStatusLabel(accountStatus),
      issuanceActive: accountStatus === 'ACTIVE',
      suspended: accountStatus === 'SUSPENDED',
      correctionRequired: Boolean(
        readiness.correctionRequired || profile.correctionRequired,
      ),
      correctionNotes:
        typeof readiness.correctionNotes === 'string'
          ? readiness.correctionNotes
          : typeof profile.correctionNotes === 'string'
            ? profile.correctionNotes
            : null,
      approvedForAccuraSetup: reviewStatus === 'APPROVED',
    };
  }

  private readinessView(readiness: Record<string, unknown>) {
    const sections = asRecord(readiness.sections) ?? {};
    const missing = Array.isArray(readiness.missing)
      ? readiness.missing.map((item) => String(item))
      : [];
    const complete = Boolean(readiness.complete);
    const namedSections = Object.entries(sections).map(([key, value]) => {
      const row = asRecord(value) ?? {};
      return {
        key,
        label: SECTION_LABELS[key] || key,
        complete: Boolean(row.complete),
        missing: Array.isArray(row.missing)
          ? row.missing.map((item) => String(item))
          : [],
      };
    });
    const total = namedSections.length;
    const done = namedSections.filter((section) => section.complete).length;
    return {
      complete,
      percent: total
        ? Math.round((done / total) * 100)
        : complete
          ? 100
          : 0,
      missing,
      sections: namedSections,
      canSubmit: complete,
    };
  }

  private branchView(row: unknown): AccuraRegisteredBranch {
    const branch = asRecord(row) ?? {};
    const address = asRecord(branch.address);
    return {
      id: String(branch.id || ''),
      code: String(branch.code || ''),
      name: String(branch.name || ''),
      addressLine1: address ? String(address.line1 || '') : '',
      active: branch.active !== false,
    };
  }

  private documentView(row: unknown) {
    const doc = asRecord(row) ?? {};
    return {
      id: String(doc.id || ''),
      documentType: String(doc.documentType || ''),
      label: String(
        doc.label ||
          DOCUMENT_TYPE_LABELS[String(doc.documentType || '')] ||
          doc.documentType ||
          'Document',
      ),
      originalFilename: String(doc.originalFilename || ''),
      mimeType: String(doc.mimeType || ''),
      size: typeof doc.size === 'number' ? doc.size : null,
      status: String(doc.status || ''),
      statusLabel: String(doc.statusLabel || doc.status || ''),
      uploadedAt: doc.uploadedAt ? String(doc.uploadedAt) : null,
      reviewNotes:
        typeof doc.reviewNotes === 'string' ? doc.reviewNotes : null,
    };
  }

  private async unavailablePayload(
    merchant: { id: number; name?: string },
    prefill: Prefill,
    shops: Awaited<ReturnType<AccuraOnboardingService['shopsFor']>>,
    category: string,
  ) {
    const link = await this.prisma.accuraMerchantLink.findUnique({
      where: { merchantId: merchant.id },
    });
    const registeredBranches: AccuraRegisteredBranch[] = [];
    return {
      unavailable: true,
      unavailableMessage: merchantFacingAccuraError(category),
      merchantId: merchant.id,
      wekonnekDisplayName: (merchant as { name?: string }).name || '',
      prefill,
      profile: {
        legalName: prefill.legalName,
        tradeName: prefill.tradeName,
        contactEmail: prefill.contactEmail,
        contactPhone: prefill.contactPhone,
        registeredAddressLine1: prefill.registeredAddressLine1,
        tin: prefill.tin,
        classification: prefill.classification,
        code: '',
      },
      status: {
        reviewStatus: link?.lastReviewStatus || null,
        reviewStatusLabel:
          reviewStatusLabel(link?.lastReviewStatus) ||
          'ACCURA status temporarily unavailable',
        companyAccountStatus: link?.lastAccountStatus || null,
        companyAccountStatusLabel: accountStatusLabel(link?.lastAccountStatus),
        issuanceActive: false,
        suspended: link?.lastAccountStatus === 'SUSPENDED',
        correctionRequired: false,
        correctionNotes: null,
        approvedForAccuraSetup: false,
        lastKnown: Boolean(link?.lastReviewStatus),
      },
      readiness: {
        complete: false,
        percent: 0,
        missing: [],
        sections: [],
        canSubmit: false,
      },
      registeredBranches,
      documents: [],
      shops,
      notice:
        'ACCURA status temporarily unavailable. Your saved WeKonnek merchant data has not been lost.',
    };
  }

  private async requireMerchant(user: SessionUser) {
    if (user.portal === 'shop') {
      throw new ForbiddenException('E-Receipt setup is available in Merchant Admin');
    }
    if (user.role !== UserRole.merchant) {
      throw new ForbiddenException('Merchant access is required');
    }
    const merchant = await this.prisma.merchant.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!merchant) {
      throw new NotFoundException('No merchant profile found for this account');
    }
    return merchant;
  }

  private machine(): AccuraPlatformConfig {
    const config = this.tryMachine();
    if (!config) {
      throw new HttpException(
        merchantFacingAccuraError('UNAUTHORIZED_CLIENT'),
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return config;
  }

  private tryMachine(): AccuraPlatformConfig | null {
    return readPlatformConfig((key) => this.config.get<string>(key));
  }

  private async platformJson(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ) {
    const machine = this.machine();
    try {
      return await accuraPlatformRequest(this.fetchImpl, machine, path, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      const aborted =
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError');
      throw new HttpException(
        merchantFacingAccuraError(aborted ? 'TIMEOUT' : 'NETWORK'),
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private assertOk(status: number, body: unknown, allowed: number[]) {
    if (allowed.includes(status)) return;
    const code = accuraErrorCode(body);
    if (status === 401 || status === 403) {
      throw new HttpException(
        merchantFacingAccuraError(code || 'UNAUTHORIZED_CLIENT'),
        status,
      );
    }
    if (status >= 500) {
      throw new HttpException(
        merchantFacingAccuraError(code),
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    throw new HttpException(
      {
        statusCode: status,
        message: merchantFacingAccuraError(code),
        error: code || 'ACCURA_ERROR',
      },
      status,
    );
  }

  private async upsertLink(merchantId: number, reference: string) {
    await this.prisma.accuraMerchantLink.upsert({
      where: { merchantId },
      create: { merchantId, externalClientReference: reference },
      update: { externalClientReference: reference },
    });
  }

  private async rememberStatus(
    merchantId: number,
    input: { reviewStatus: string; accountStatus: string },
  ) {
    const reference = accuraExternalClientReference(merchantId);
    await this.prisma.accuraMerchantLink.upsert({
      where: { merchantId },
      create: {
        merchantId,
        externalClientReference: reference,
        lastReviewStatus: input.reviewStatus || null,
        lastAccountStatus: input.accountStatus || null,
        lastSyncedAt: new Date(),
      },
      update: {
        lastReviewStatus: input.reviewStatus || null,
        lastAccountStatus: input.accountStatus || null,
        lastSyncedAt: new Date(),
      },
    });
  }

  private async audit(
    merchantId: number,
    actorUserId: string | undefined,
    action: string,
    result: string,
    errorCategory?: string,
  ) {
    await this.prisma.accuraOnboardingAuditEvent.create({
      data: {
        merchantId,
        actorUserId: actorUserId || null,
        action,
        result,
        errorCategory: errorCategory || null,
      },
    });
    this.logger.log(
      `accura_onboarding action=${action} result=${result} merchantId=${merchantId}`,
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
