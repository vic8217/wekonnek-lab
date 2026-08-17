import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeExpiry } from '../subscriptions/subscription-plans';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from '../modules/notifications/notifications.service';

function serializeApplication(a: any) {
  if (!a) return a;
  return {
    id: a.id,
    user_id: a.userId,
    userId: a.userId,
    business_name: a.businessName,
    businessName: a.businessName,
    merchant_code: a.merchantCode,
    merchantCode: a.merchantCode,
    store_id: a.merchantCode,
    storeId: a.merchantCode,
    email: a.email,
    phone: a.phone,
    address: a.address,
    contact_name: a.contactName,
    category_name: a.categoryName,
    sub_category_name: a.subCategoryName,
    city_municipality: a.cityMunicipality,
    barangay: a.barangay,
    council_district: a.councilDistrict,
    geographic_area: a.geographicArea,
    latitude: a.latitude,
    longitude: a.longitude,
    business_description: a.businessDescription,
    has_branches: a.hasBranches,
    branch_count: a.branchCount,
    product_count: a.productCount,
    source: a.source,
    assigned_coordinator_id: a.assignedCoordinatorId,
    assignment_status: a.assignedCoordinatorId ? 'assigned' : 'unassigned',
    assigned_at: a.assignedAt,
    subscription_tier: a.subscriptionTier,
    subscriptionTier: a.subscriptionTier,
    subscription_plan: a.subscriptionPlan,
    subscriptionPlan: a.subscriptionPlan,
    subscription_amount: a.subscriptionAmount,
    subscriptionAmount: a.subscriptionAmount,
    selected_add_on_ids: a.selectedAddOnIds,
    selectedAddOnIds: a.selectedAddOnIds,
    selected_add_on_quantities: a.selectedAddOnQuantities || {},
    selectedAddOnQuantities: a.selectedAddOnQuantities || {},
    temporary_password: a.temporaryPassword,
    recovery_key: a.recoveryKey,
    payment_method: a.paymentMethod,
    payment_proof_url: a.paymentProofUrl,
    business_permit_url: a.businessPermitUrl,
    dti_permit_url: a.dtiPermitUrl,
    valid_id_url: a.validIdUrl,
    establishment_photo_url: a.establishmentPhotoUrl,
    authorized_person_photo_url: a.authorizedPersonPhotoUrl,
    business_documents_urls: a.businessDocumentsUrls,
    status: a.status,
    reviewed_by: a.reviewedBy,
    reviewed_at: a.reviewedAt,
    coordinator_notes: a.coordinatorNotes,
    rejection_reason: a.rejectionReason,
    submitted_at: a.submittedAt,
    submittedAt: a.submittedAt,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

function addOnQuantity(
  quantities: unknown,
  addOnId: string,
): number {
  if (!quantities || typeof quantities !== 'object' || Array.isArray(quantities)) return 1;
  const value = Number((quantities as Record<string, unknown>)[addOnId]);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

function normalizePlace(value: string | null | undefined) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\(city\)/g, '').replace(/^city of\s+/, '').replace(/\bcity$/, '')
    .replace(/\s+/g, ' ').trim();
}

function normalizeDistrict(value: string | null | undefined) {
  const normalized = normalizePlace(value)
    .replace(/\b(congressional|council)\b/g, '')
    .replace(/\bdistrict\b/g, '')
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, '$1')
    .replace(/\s+/g, ' ').trim();
  return normalized.match(/\d+/)?.[0] || normalized;
}

function coverageMatchesApplication(
  coverage: { cityMunicipalityName: string; congressionalDistrict: string; areas: unknown },
  application: { cityMunicipality: string | null; councilDistrict: string | null; geographicArea: string | null; barangay: string | null },
) {
  const areas = Array.isArray(coverage.areas)
    ? coverage.areas.flatMap(area => area && typeof area === 'object' && 'name' in area ? [normalizePlace(String(area.name))] : [])
    : [];
  const applicationArea = normalizePlace(application.geographicArea || application.barangay);
  return normalizePlace(coverage.cityMunicipalityName) === normalizePlace(application.cityMunicipality)
    && (!application.councilDistrict || normalizeDistrict(coverage.congressionalDistrict) === normalizeDistrict(application.councilDistrict))
    && (!areas.length || Boolean(applicationArea && areas.includes(applicationArea)));
}

@Injectable()
export class MerchantApplicationsService {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  private async approvedCoordinator(user: { id: string; email?: string | null }) {
    const coordinator = await this.prisma.coordinatorApplication.findFirst({
      where: {
        OR: [{ userId: user.id }, { email: { equals: user.email ?? '', mode: 'insensitive' } }],
        status: 'approved',
      },
      include: { managementZone: { include: { coverages: true } } },
      orderBy: { submittedAt: 'desc' },
    });
    if (!coordinator?.managementZone) throw new ForbiddenException('No approved coordinator zone is assigned to this account');
    return coordinator;
  }

  async coordinatorCoverageOptions(user: { id: string; email?: string | null }) {
    const coordinator = await this.approvedCoordinator(user);
    type Area = { code: string; name: string };
    type District = { name: string; localCouncilDistrict: string; areas: Area[] };
    const cities = new Map<string, { code: string; name: string; districts: District[] }>();
    coordinator.managementZone!.coverages.forEach(item => {
      const city = cities.get(item.cityMunicipalityCode) || { code: item.cityMunicipalityCode, name: item.cityMunicipalityName, districts: [] };
      let district = city.districts.find(entry => entry.name === item.congressionalDistrict);
      if (!district) { district = { name: item.congressionalDistrict, localCouncilDistrict: item.congressionalDistrict, areas: [] }; city.districts.push(district); }
      if (Array.isArray(item.areas)) item.areas.forEach(value => {
        if (!value || typeof value !== 'object' || !('code' in value) || !('name' in value)) return;
        const area = { code: String(value.code), name: String(value.name) };
        if (!district!.areas.some(entry => entry.code === area.code)) district!.areas.push(area);
      });
      cities.set(item.cityMunicipalityCode, city);
    });
    return Array.from(cities.values());
  }

  async createByCoordinator(input: Record<string, unknown>, user: { id: string; email?: string | null }) {
    const required = ['contact_name', 'business_name', 'phone', 'email', 'category_name', 'sub_category_name', 'address', 'city_municipality', 'council_district', 'geographic_area', 'has_branches', 'latitude', 'longitude'];
    for (const field of required) {
      if (input[field] === undefined || input[field] === null || String(input[field]).trim() === '') {
        throw new BadRequestException(`${field.replaceAll('_', ' ')} is required`);
      }
    }
    const coordinator = await this.approvedCoordinator(user);
    const candidate = {
      cityMunicipality: String(input.city_municipality),
      councilDistrict: String(input.council_district),
      geographicArea: String(input.geographic_area),
      barangay: String(input.geographic_area),
    };
    if (!coordinator.managementZone!.coverages.some(coverage => coverageMatchesApplication(coverage, candidate))) {
      throw new ForbiddenException('The merchant address must be inside your approved coverage zone');
    }
    const email = String(input.email).trim().toLowerCase();
    const duplicate = await this.prisma.merchantApplication.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, status: { in: ['pending', 'reviewing', 'for_approval'] } },
      select: { id: true },
    });
    if (duplicate) throw new BadRequestException('An active merchant application already uses this email address');
    const application = await this.prisma.merchantApplication.create({
      data: {
        businessName: String(input.business_name).trim(), contactName: String(input.contact_name).trim(),
        phone: String(input.phone).trim(), email, categoryName: String(input.category_name).trim(), subCategoryName: String(input.sub_category_name).trim(),
        address: String(input.address).trim(), cityMunicipality: candidate.cityMunicipality,
        councilDistrict: candidate.councilDistrict, geographicArea: candidate.geographicArea, barangay: candidate.geographicArea,
        hasBranches: String(input.has_branches) === 'yes' || input.has_branches === true,
        latitude: Number(input.latitude), longitude: Number(input.longitude),
        businessDescription: input.business_description ? String(input.business_description).trim() : null,
        source: 'coordinator_created', assignedCoordinatorId: user.id, assignedAt: new Date(),
        subscriptionAmount: 0, businessDocumentsUrls: [], status: 'pending',
      },
    });
    return serializeApplication(application);
  }

  async create(input: any, userId?: string) {
    if (!input.business_name && !input.businessName) {
      throw new BadRequestException('business_name is required');
    }
    const application = await this.prisma.merchantApplication.create({
      data: {
        userId: input.user_id ?? input.userId ?? userId ?? null,
        businessName: input.business_name ?? input.businessName,
        email: input.email,
        phone: input.phone ?? null,
        address: input.address ?? null,
        contactName: input.contact_name ?? input.contactName ?? null,
        categoryName: input.category_name ?? input.categoryName ?? null,
        subCategoryName: input.sub_category_name ?? input.subCategoryName ?? null,
        cityMunicipality: input.city_municipality ?? input.cityMunicipality ?? null,
        barangay: input.barangay ?? null,
        councilDistrict: input.council_district ?? input.councilDistrict ?? null,
        geographicArea: input.geographic_area ?? input.geographicArea ?? null,
        latitude: input.latitude !== undefined && input.latitude !== '' ? Number(input.latitude) : null,
        longitude: input.longitude !== undefined && input.longitude !== '' ? Number(input.longitude) : null,
        businessDescription: input.business_description ?? input.businessDescription ?? null,
        hasBranches: input.has_branches === 'yes' || input.has_branches === true
          ? true
          : input.has_branches === 'no' || input.has_branches === false
            ? false
            : null,
        branchCount: input.branch_count !== undefined && input.branch_count !== ''
          ? Number(input.branch_count)
          : null,
        productCount: input.product_count !== undefined && input.product_count !== ''
          ? Number(input.product_count)
          : null,
        source: input.source ?? 'merchant_application',
        subscriptionTier: input.subscription_tier ?? input.subscriptionTier ?? 'basic',
        subscriptionPlan: input.subscription_plan ?? input.subscriptionPlan ?? 'weekly',
        subscriptionAmount: Number(
          input.subscription_amount ?? input.subscriptionAmount ?? 0,
        ),
        paymentMethod: input.payment_method ?? input.paymentMethod ?? null,
        paymentProofUrl: input.payment_proof_url ?? null,
        businessPermitUrl: input.business_permit_url ?? null,
        dtiPermitUrl: input.dti_permit_url ?? null,
        validIdUrl: input.valid_id_url ?? null,
        establishmentPhotoUrl: input.establishment_photo_url ?? null,
        authorizedPersonPhotoUrl: input.authorized_person_photo_url ?? null,
        businessDocumentsUrls:
          input.business_documents_urls ?? input.businessDocumentsUrls ?? [],
        status: 'pending',
      },
    });
    return serializeApplication(application);
  }

  async findAll(status?: string) {
    const where: any = {};
    if (status && status !== 'all') where.status = status;
    const apps = await this.prisma.merchantApplication.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
    });
    const reviewerIds = [...new Set(apps.map(app => app.reviewedBy).filter(Boolean))] as string[];
    const coordinatorIds = [...new Set(apps.map(app => app.assignedCoordinatorId).filter(Boolean))] as string[];
    const addOnIds = [...new Set(apps.flatMap(app => app.selectedAddOnIds))];
    const [reviewers, coordinators, addOns]: [
      Array<{ id: string; firstName: string | null; lastName: string | null; email: string | null }>,
      Array<{ userId: string | null; fullName: string; email: string; mobileNumber: string; coordinatorCode: string | null; managementZone: { name: string } | null }>,
      Array<{ id: string; name: string; amount: unknown; billingUnit: string; amountBasis: string | null }>,
    ] = await Promise.all([
      reviewerIds.length ? this.prisma.user.findMany({
        where: { id: { in: reviewerIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      }) : [],
      coordinatorIds.length ? this.prisma.coordinatorApplication.findMany({
        where: { userId: { in: coordinatorIds } },
        select: { userId: true, fullName: true, email: true, mobileNumber: true, coordinatorCode: true, managementZone: { select: { name: true } } },
      }) : [],
      addOnIds.length ? this.prisma.subscriptionAddOnPackage.findMany({
        where: { id: { in: addOnIds } },
        select: { id: true, name: true, amount: true, billingUnit: true, amountBasis: true },
      }) : [],
    ]);
    const reviewerById = new Map<string, string>();
    reviewers.forEach(user => reviewerById.set(
      user.id,
      [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'Admin staff',
    ));
    const coordinatorById = new Map(coordinators.flatMap(coordinator => coordinator.userId ? [[coordinator.userId, coordinator] as const] : []));
    const addOnById = new Map<string, (typeof addOns)[number]>();
    addOns.forEach(addOn => addOnById.set(addOn.id, addOn));
    return apps.map(app => {
      const coordinator = app.assignedCoordinatorId ? coordinatorById.get(app.assignedCoordinatorId) : undefined;
      const selectedAddOns = app.selectedAddOnIds.flatMap(id => {
        const addOn = addOnById.get(id);
        const quantity = addOnQuantity(app.selectedAddOnQuantities, id);
        return addOn ? [{ ...addOn, quantity, subtotal: Number(addOn.amount) * quantity }] : [];
      });
      return {
        ...serializeApplication(app),
        selected_add_ons: selectedAddOns,
        total_fee: Number(app.subscriptionAmount) + selectedAddOns.reduce((sum, addOn) => sum + addOn.subtotal, 0),
        reviewed_by_name: app.reviewedBy ? reviewerById.get(app.reviewedBy) || 'Admin staff' : null,
        onboarding_coordinator: coordinator ? {
          user_id: coordinator.userId,
          full_name: coordinator.fullName,
          email: coordinator.email,
          mobile_number: coordinator.mobileNumber,
          coordinator_code: coordinator.coordinatorCode,
          zone_name: coordinator.managementZone?.name ?? null,
        } : null,
      };
    });
  }

  async coverageOptions() {
    const coverages = await this.prisma.managementZoneCoverage.findMany({
      where: { zone: { isActive: true } },
      select: { regionName: true, provinceName: true, cityMunicipalityCode: true, cityMunicipalityName: true, congressionalDistrict: true, areas: true },
      orderBy: [{ cityMunicipalityName: 'asc' }, { congressionalDistrict: 'asc' }],
    });
    type Area = { code: string; name: string };
    type District = { name: string; localCouncilDistrict: string; areas: Area[] };
    const cities = new Map<string, { code: string; name: string; regionName: string; provinceName: string | null; districts: District[] }>();
    coverages.forEach(item => {
      const city = cities.get(item.cityMunicipalityCode) || { code: item.cityMunicipalityCode, name: item.cityMunicipalityName, regionName: item.regionName, provinceName: item.provinceName, districts: [] };
      let district = city.districts.find(entry => entry.name === item.congressionalDistrict);
      if (!district) {
        district = { name: item.congressionalDistrict, localCouncilDistrict: item.congressionalDistrict, areas: [] };
        city.districts.push(district);
      }
      if (Array.isArray(item.areas)) {
        item.areas.forEach(value => {
          if (!value || typeof value !== 'object' || !('code' in value) || !('name' in value)) return;
          const area = { code: String(value.code), name: String(value.name) };
          if (!district!.areas.some(entry => entry.code === area.code)) district!.areas.push(area);
        });
      }
      cities.set(item.cityMunicipalityCode, city);
    });
    return Array.from(cities.values());
  }

  async findById(id: number) {
    const a = await this.prisma.merchantApplication.findUnique({
      where: { id: Number(id) },
    });
    if (!a) throw new NotFoundException('Application not found');
    return serializeApplication(a);
  }

  async findCoordinatorLeads(user: { id: string; email?: string | null; role?: string }) {
    const isAdmin = user.role === 'admin';
    const coordinator = isAdmin ? null : await this.prisma.coordinatorApplication.findFirst({
      where: {
        OR: [{ userId: user.id }, { email: { equals: user.email ?? '', mode: 'insensitive' } }],
        status: 'approved',
      },
      include: { managementZone: { include: { coverages: true } } },
      orderBy: { submittedAt: 'desc' },
    });
    if (!isAdmin && (!coordinator || !coordinator.managementZone)) throw new ForbiddenException('No coordinator zone is assigned to this account');
    const coverageRules = coordinator?.managementZone?.coverages.map(item => {
      const areas = Array.isArray(item.areas)
        ? item.areas.flatMap(area => area && typeof area === 'object' && 'name' in area ? [String(area.name)] : [])
        : [];
      return {
        city: normalizePlace(item.cityMunicipalityName),
        district: normalizeDistrict(item.congressionalDistrict),
        areas: areas.map(normalizePlace),
      };
    }) ?? [];
    if (!isAdmin && coverageRules.length === 0) throw new ForbiddenException('Your coordinator zone has no city or municipality coverage');
    const applications = await this.prisma.merchantApplication.findMany({
      where: {
        OR: [
          {
            source: 'website_callback',
            status: { in: ['pending', 'reviewing'] },
            assignedCoordinatorId: null,
          },
          {
            assignedCoordinatorId: user.id,
            status: { in: ['pending', 'reviewing', 'for_approval', 'approved', 'rejected'] },
          },
        ],
      },
      orderBy: { submittedAt: 'desc' },
    });
    const visible = isAdmin ? applications : applications.filter(application => {
      if (application.assignedCoordinatorId === user.id) return true;
      const applicationCity = normalizePlace(application.cityMunicipality);
      const applicationDistrict = normalizeDistrict(application.councilDistrict);
      const applicationArea = normalizePlace(application.geographicArea || application.barangay);
      return coverageRules.some(rule => {
        const cityMatches = rule.city === applicationCity;
        const districtMatches = !applicationDistrict || !rule.district || rule.district === applicationDistrict;
        const areaMatches = !rule.areas.length || Boolean(applicationArea && rule.areas.includes(applicationArea));
        return cityMatches && districtMatches && areaMatches;
      });
    });
    return visible.map(serializeApplication);
  }

  async findAssignedCoordinatorLead(id: number, user: { id: string }) {
    const application = await this.prisma.merchantApplication.findFirst({
      where: {
        id,
        assignedCoordinatorId: user.id,
      },
    });
    if (!application) throw new ForbiddenException('This application is not assigned to your coordinator account');
    const serialized = serializeApplication(application);
    if (application.status !== 'approved' || !application.merchantCode) return serialized;

    const [merchant, reviewer] = await Promise.all([
      this.prisma.merchant.findUnique({ where: { merchantCode: application.merchantCode } }),
      application.reviewedBy
        ? this.prisma.user.findUnique({
            where: { id: application.reviewedBy },
            select: { firstName: true, lastName: true, email: true },
          })
        : null,
    ]);
    if (!merchant) return serialized;

    const [wallet, addOns, payments] = await Promise.all([
      merchant.userId
        ? this.prisma.wallet.findUnique({ where: { userId: merchant.userId } })
        : null,
      this.prisma.subscriptionAddOnPackage.findMany({
        where: { id: { in: application.selectedAddOnIds } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.subscriptionPayment.findMany({
        where: { merchantId: merchant.id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const planFee = Number(application.subscriptionAmount);
    const addOnFee = addOns.reduce(
      (sum, addOn) =>
        sum + Number(addOn.amount) * addOnQuantity(application.selectedAddOnQuantities, addOn.id),
      0,
    );
    const totalFee = planFee + addOnFee;
    const totalPaid = payments
      .filter(payment => payment.status === 'paid')
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const walletBalance = Number(wallet?.balance || 0);
    const hasDailyCoverage = application.subscriptionPlan !== 'daily' || walletBalance >= totalFee;
    const accountStatus = hasDailyCoverage
      ? merchant.status === 'inactive' ? 'active' : merchant.status
      : merchant.status === 'active' ? 'inactive' : merchant.status;
    if (
      merchant.isActive !== (hasDailyCoverage && accountStatus === 'active')
      || merchant.status !== accountStatus
      || merchant.subscriptionStatus !== (hasDailyCoverage ? 'active' : 'inactive')
    ) {
      await this.prisma.merchant.update({
        where: { id: merchant.id },
        data: {
          isActive: hasDailyCoverage && accountStatus === 'active',
          status: accountStatus,
          subscriptionStatus: hasDailyCoverage ? 'active' : 'inactive',
        },
      });
    }
    const reviewerName = reviewer
      ? [reviewer.firstName, reviewer.lastName].filter(Boolean).join(' ') || reviewer.email
      : null;

    return {
      ...serialized,
      merchant_account: {
        id: merchant.id,
        merchant_code: application.merchantCode,
        temporary_password: application.temporaryPassword,
        recovery_key: application.recoveryKey,
        status: accountStatus,
        joined_at: merchant.createdAt,
        approved_at: application.reviewedAt,
        approved_by_name: reviewerName,
        wallet_balance: walletBalance,
        fee_breakdown: {
          plan: {
            name: application.subscriptionTier,
            amount: planFee,
            billing_unit: application.subscriptionPlan,
          },
          add_ons: addOns.map(addOn => ({
            id: addOn.id,
            name: addOn.name,
            amount: Number(addOn.amount),
            quantity: addOnQuantity(application.selectedAddOnQuantities, addOn.id),
            subtotal:
              Number(addOn.amount) *
              addOnQuantity(application.selectedAddOnQuantities, addOn.id),
            billing_unit: addOn.billingUnit,
            amount_basis: addOn.amountBasis,
          })),
          add_on_fee: addOnFee,
          total_fee: totalFee,
        },
        ledger: {
          total_billed: totalFee,
          total_paid: totalPaid,
          unpaid: Math.max(totalFee - totalPaid, 0),
          payments: payments.map(payment => ({
            id: payment.id,
            tier: payment.tier,
            plan: payment.plan,
            amount: Number(payment.amount),
            payment_method: payment.paymentMethod,
            gateway: payment.gateway,
            status: payment.status,
            payment_ref: payment.paymentRef,
            period_start: payment.periodStart,
            period_end: payment.periodEnd,
            created_at: payment.createdAt,
          })),
        },
      },
    };
  }

  async generateCoordinatorMerchantRecoveryKey(id: number, user: { id: string }) {
    const application = await this.prisma.merchantApplication.findFirst({
      where: {
        id,
        assignedCoordinatorId: user.id,
        status: 'approved',
        userId: { not: null },
      },
    });
    if (!application?.merchantCode) {
      throw new ForbiddenException('This approved merchant is not assigned to your coordinator account');
    }
    const recoveryKey = `WKR-${randomBytes(18).toString('base64url')}`;
    await this.prisma.merchantApplication.update({
      where: { id },
      data: { recoveryKey },
    });
    return { recovery_key: recoveryKey, merchant_code: application.merchantCode };
  }

  async updateCoordinatorReview(
    id: number,
    user: { id: string },
    input: {
      coordinator_notes?: string | null;
      payment_proof_url?: string | null;
      business_permit_url?: string | null;
      dti_permit_url?: string | null;
      valid_id_url?: string | null;
      establishment_photo_url?: string | null;
      authorized_person_photo_url?: string | null;
      business_documents_urls?: string[];
      subscription_tier?: string;
      selected_add_on_ids?: string[];
      selected_add_on_quantities?: Record<string, number>;
    },
  ) {
    const application = await this.prisma.merchantApplication.findFirst({
      where: { id, assignedCoordinatorId: user.id, status: { in: ['pending', 'reviewing', 'for_approval', 'approved'] } },
    });
    if (!application) throw new ForbiddenException('This application is not assigned to your coordinator account');

    const selectedTier = String(input.subscription_tier || '').trim().toLowerCase();
    if (!selectedTier) throw new BadRequestException('Select one merchant plan');
    const plan = await this.prisma.subscriptionPlanDefinition.findFirst({
      where: { audience: 'merchant', tier: selectedTier, isActive: true },
    });
    if (!plan) throw new BadRequestException('The selected merchant plan is unavailable');

    const selectedAddOnIds = [...new Set(input.selected_add_on_ids || [])];
    const validAddOns = selectedAddOnIds.length
      ? await this.prisma.subscriptionAddOnPackage.findMany({
          where: { id: { in: selectedAddOnIds }, audience: 'merchant', isActive: true },
          select: { id: true, amount: true },
        })
      : [];
    if (validAddOns.length !== selectedAddOnIds.length) {
      throw new BadRequestException('One or more selected add-ons are unavailable');
    }
    const selectedAddOnQuantities = Object.fromEntries(
      selectedAddOnIds.map(id => {
        const quantity = Number(input.selected_add_on_quantities?.[id] ?? 1);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
          throw new BadRequestException('Add-on quantity must be a whole number greater than zero');
        }
        return [id, quantity];
      }),
    );

    const missingDocumentUpdates = {
      paymentProofUrl: application.paymentProofUrl ? undefined : input.payment_proof_url || undefined,
      businessPermitUrl: application.businessPermitUrl ? undefined : input.business_permit_url || undefined,
      dtiPermitUrl: application.dtiPermitUrl ? undefined : input.dti_permit_url || undefined,
      validIdUrl: application.validIdUrl ? undefined : input.valid_id_url || undefined,
      establishmentPhotoUrl: application.establishmentPhotoUrl ? undefined : input.establishment_photo_url || undefined,
      authorizedPersonPhotoUrl: application.authorizedPersonPhotoUrl ? undefined : input.authorized_person_photo_url || undefined,
    };
    const additionalDocuments = (input.business_documents_urls || []).filter(Boolean);
    const updated = await this.prisma.merchantApplication.update({
      where: { id },
      data: {
        ...missingDocumentUpdates,
        coordinatorNotes: input.coordinator_notes?.trim() || null,
        subscriptionTier: plan.tier,
        subscriptionPlan: 'daily',
        subscriptionAmount: plan.fixedAmount,
        selectedAddOnIds,
        selectedAddOnQuantities,
        businessDocumentsUrls: additionalDocuments.length
          ? [...application.businessDocumentsUrls, ...additionalDocuments]
          : undefined,
        // A completed coordinator review is ready for the administrator's
        // final decision. Approved applications retain their status when a
        // coordinator later updates only the subscription configuration.
        status: application.status === 'approved' ? 'approved' : 'for_approval',
      },
    });
    if (application.status === 'approved' && application.merchantCode) {
      const merchant = await this.prisma.merchant.update({
        where: { merchantCode: application.merchantCode },
        data: {
          subscriptionTier: plan.tier,
          subscriptionPlan: 'daily',
          subscriptionAmount: plan.fixedAmount,
        },
      });
      const pendingPayment = await this.prisma.subscriptionPayment.findFirst({
        where: { merchantId: merchant.id, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      });
      if (pendingPayment) {
        const updatedFee = Number(plan.fixedAmount)
          + validAddOns.reduce(
            (sum, addOn) =>
              sum + Number(addOn.amount) * addOnQuantity(selectedAddOnQuantities, addOn.id),
            0,
          );
        await this.prisma.subscriptionPayment.update({
          where: { id: pendingPayment.id },
          data: {
            tier: plan.tier,
            plan: 'daily',
            amount: updatedFee,
          },
        });
      }
    }
    return this.findAssignedCoordinatorLead(id, user);
  }

  async eligibleCoordinators(id: number) {
    const application = await this.prisma.merchantApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundException('Application not found');
    const coordinators = await this.prisma.coordinatorApplication.findMany({
      where: { status: 'approved', userId: { not: null }, managementZoneId: { not: null } },
      include: { managementZone: { include: { coverages: true } } },
      orderBy: { fullName: 'asc' },
    });
    return coordinators
      .filter(coordinator => coordinator.managementZone?.coverages.some(coverage => coverageMatchesApplication(coverage, application)))
      .map(coordinator => ({
        id: coordinator.id,
        user_id: coordinator.userId,
        full_name: coordinator.fullName,
        email: coordinator.email,
        coordinator_code: coordinator.coordinatorCode,
        zone_name: coordinator.managementZone?.name,
      }));
  }

  async assignCoordinator(id: number, coordinatorUserId: string) {
    const application = await this.prisma.merchantApplication.findUnique({ where: { id } });
    if (!application) throw new NotFoundException('Application not found');
    if (application.status === 'approved' || application.status === 'rejected') {
      throw new BadRequestException('This application can no longer be assigned');
    }
    const eligible = await this.eligibleCoordinators(id);
    if (!eligible.some(coordinator => coordinator.user_id === coordinatorUserId)) {
      throw new BadRequestException('The selected coordinator is not assigned to the merchant area');
    }
    const updated = await this.prisma.merchantApplication.update({
      where: { id },
      data: {
        assignedCoordinatorId: coordinatorUserId,
        assignedAt: new Date(),
        status: 'reviewing',
      },
    });
    await this.notifications.notify({ userId: coordinatorUserId, title: 'Merchant application assigned', body: `${application.businessName} is ready for onboarding review.`, type: NotificationType.system, data: { kind: 'merchant_application_assigned', applicationId: String(id), url: `/coordinator/applications/${id}` } }).catch(() => undefined);
    return serializeApplication(updated);
  }

  async claimLead(id: number, user: { id: string; email?: string | null; role?: string }) {
    const leads = await this.findCoordinatorLeads(user);
    const lead = leads.find(item => item.id === id);
    if (!lead) throw new ForbiddenException('This merchant is outside your approved coverage area');
    if (lead.assigned_coordinator_id && lead.assigned_coordinator_id !== user.id) throw new BadRequestException('Merchant is already assigned');
    const updated = await this.prisma.merchantApplication.update({ where: { id }, data: { assignedCoordinatorId: user.id, assignedAt: new Date() } });
    await this.notifications.notify({ userId: user.id, title: 'Merchant application claimed', body: `${updated.businessName} was added to your onboarding queue.`, type: NotificationType.system, data: { kind: 'merchant_application_claimed', applicationId: String(id), url: `/coordinator/applications/${id}` } }).catch(() => undefined);
    return serializeApplication(updated);
  }

  async updateStatus(
    id: number,
    status: string,
    opts: { reviewerId?: string; rejectionReason?: string } = {},
  ) {
    const application = await this.prisma.merchantApplication.findUnique({
      where: { id: Number(id) },
    });
    if (!application) throw new NotFoundException('Application not found');
    if (status === 'approved' && application.status !== 'for_approval') {
      throw new BadRequestException('The coordinator must complete the review before this application can be approved');
    }

    const merchantCode = status === 'approved'
      ? application.merchantCode ?? await this.generateMerchantCode(application)
      : application.merchantCode;
    const temporaryPassword = status === 'approved' && !application.temporaryPassword
      ? `Wk!${randomBytes(9).toString('base64url')}`
      : application.temporaryPassword;
    const recoveryKey = status === 'approved'
      ? application.recoveryKey ?? `WKR-${randomBytes(18).toString('base64url')}`
      : application.recoveryKey;
    let merchantUserId = application.userId;
    if (status === 'approved' && temporaryPassword) {
      const password = await bcrypt.hash(temporaryPassword, 10);
      const names = (application.contactName || application.businessName).trim().split(/\s+/);
      const firstName = names.shift() || 'Merchant';
      const lastName = names.join(' ') || null;
      const matchingUser = merchantUserId
        ? await this.prisma.user.findUnique({ where: { id: merchantUserId } })
        : await this.prisma.user.findFirst({ where: { OR: [{ email: application.email }, { phone: application.phone || '' }] } });
      const user = matchingUser
        ? await this.prisma.user.update({ where: { id: matchingUser.id }, data: { firstName, lastName, email: application.email, phone: application.phone || matchingUser.phone, password, mustChangePassword: true, role: 'merchant', isActive: true, isVerified: true, status: 'active' } })
        : await this.prisma.user.create({ data: { firstName, lastName, email: application.email, phone: application.phone || `merchant-${application.id}`, password, mustChangePassword: true, role: 'merchant', isActive: true, isVerified: true, status: 'active' } });
      merchantUserId = user.id;
    }
    const updated = await this.prisma.merchantApplication.update({
      where: { id: Number(id) },
      data: {
        status,
        reviewedBy: opts.reviewerId ?? null,
        reviewedAt: new Date(),
        rejectionReason: status === 'rejected' ? opts.rejectionReason ?? null : null,
        merchantCode,
        userId: merchantUserId,
        temporaryPassword,
        recoveryKey,
      },
    });

    // On approval, create the live Merchant record + promote the owner.
    if (status === 'approved') {
      await this.provisionMerchant({ ...application, merchantCode, userId: merchantUserId, recoveryKey });
    }

    return serializeApplication(updated);
  }

  async resetMerchantPassword(merchantId: string, recoveryKey: string, newPassword: string) {
    const normalizedMerchantId = String(merchantId || '')
      .trim()
      .replace(/\s+/g, '')
      .toUpperCase();
    const normalizedRecoveryKey = String(recoveryKey || '')
      .trim()
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/\s+/g, '');
    if (!normalizedMerchantId || !normalizedRecoveryKey || newPassword.length < 8) {
      throw new BadRequestException('A valid Merchant ID, recovery key, and password of at least 8 characters are required');
    }
    const application = await this.prisma.merchantApplication.findFirst({
      where: {
        merchantCode: { equals: normalizedMerchantId, mode: 'insensitive' },
        recoveryKey: { equals: normalizedRecoveryKey, mode: 'insensitive' },
        userId: { not: null },
        status: 'approved',
      },
    });
    if (!application?.userId) throw new BadRequestException('Merchant ID or recovery key is invalid');
    await this.prisma.user.update({
      where: { id: application.userId },
      data: { password: await bcrypt.hash(newPassword, 10), mustChangePassword: false },
    });
    return { message: 'Password changed successfully' };
  }

  private async provisionMerchant(application: any) {
    const activeCoverages = await this.prisma.managementZoneCoverage.findMany({
      where: { zone: { isActive: true } },
      select: { regionName: true, cityMunicipalityName: true, congressionalDistrict: true, areas: true },
    });
    const applicationCoverage = activeCoverages.find(coverage => coverageMatchesApplication(coverage, application));
    const applicationCategory = String(application.categoryName || '').trim();
    const category = applicationCategory
      ? await this.prisma.merchantCategory.findFirst({
          where: {
            isActive: true,
            OR: [
              { name: { equals: applicationCategory, mode: 'insensitive' } },
              { name: { startsWith: `${applicationCategory} `, mode: 'insensitive' } },
            ],
          },
          orderBy: { id: 'asc' },
          select: { id: true },
        })
      : null;
    const applicationSubCategory = String(application.subCategoryName || '').trim();
    const subCategory = category && applicationSubCategory
      ? await this.prisma.merchantSubCategory.findFirst({
          where: { categoryId: category.id, isActive: true, name: { equals: applicationSubCategory, mode: 'insensitive' } },
          select: { id: true },
        })
      : null;

    // Avoid duplicates if approved twice.
    if (application.userId) {
      const existing = await this.prisma.merchant.findFirst({
        where: { userId: application.userId },
      });
      if (existing) {
        return this.prisma.merchant.update({
          where: { id: existing.id },
          data: {
            merchantCode: application.merchantCode,
            categoryId: category?.id ?? existing.categoryId,
            subCategoryId: subCategory?.id ?? existing.subCategoryId,
          },
        });
      }
    }

    let baseSlug = slugify(application.businessName) || `merchant-${application.id}`;
    let slug = baseSlug;
    let attempt = 1;
    // Ensure unique slug
    while (await this.prisma.merchant.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${attempt++}`;
    }

    const subscriptionStart = new Date();
    const subscriptionEnd = computeExpiry(
      application.subscriptionPlan,
      subscriptionStart,
    );

    const merchant = await this.prisma.merchant.create({
      data: {
        merchantCode: application.merchantCode,
        userId: application.userId ?? null,
        name: application.businessName,
        slug,
        categoryId: category?.id ?? null,
        subCategoryId: subCategory?.id ?? null,
        email: application.email,
        phone: application.phone,
        address: application.address,
        region: applicationCoverage?.regionName ?? null,
        city: applicationCoverage?.cityMunicipalityName ?? application.cityMunicipality ?? null,
        councilDistrict: applicationCoverage?.congressionalDistrict ?? application.councilDistrict ?? null,
        geographicArea: application.geographicArea ?? application.barangay ?? null,
        businessType: 'storefront',
        subscriptionTier: application.subscriptionTier,
        subscriptionPlan: application.subscriptionPlan,
        subscriptionAmount: application.subscriptionAmount,
        subscriptionStatus: 'active',
        subscriptionStartedAt: subscriptionStart,
        subscriptionExpiresAt: subscriptionEnd,
        paymentMethod: application.paymentMethod,
        logoUrl: application.establishmentPhotoUrl,
        status: 'active',
        isActive: true,
        isVerified: true,
      },
    });

    const selectedAddOns = application.selectedAddOnIds?.length
      ? await this.prisma.subscriptionAddOnPackage.findMany({
          where: { id: { in: application.selectedAddOnIds } },
          select: { id: true, amount: true },
        })
      : [];
    const initialAmount = Number(application.subscriptionAmount)
      + selectedAddOns.reduce(
        (sum, addOn) =>
          sum + Number(addOn.amount) * addOnQuantity(application.selectedAddOnQuantities, addOn.id),
        0,
      );
    if (application.subscriptionPlan === 'daily' && application.userId) {
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId: application.userId },
        select: { balance: true },
      });
      if (Number(wallet?.balance || 0) < initialAmount) {
        await this.prisma.merchant.update({
          where: { id: merchant.id },
          data: {
            isActive: false,
            status: 'inactive',
            subscriptionStatus: 'inactive',
          },
        });
      }
    }

    // Approval creates the bill; payment remains pending until it is actually received.
    await this.prisma.subscriptionPayment
      .create({
        data: {
          merchantId: merchant.id,
          tier: application.subscriptionTier,
          plan: application.subscriptionPlan,
          amount: initialAmount,
          paymentMethod: 'manual',
          status: 'pending',
          paymentProofUrl: application.paymentProofUrl,
          periodStart: subscriptionStart,
          periodEnd: subscriptionEnd,
        },
      })
      .catch(() => undefined);

    // Promote the applicant to the merchant role so they get portal access.
    if (application.userId) {
      await this.prisma.user
        .update({
          where: { id: application.userId },
          data: { role: 'merchant' as any },
        })
        .catch(() => undefined);
    }

    return merchant;
  }

  private async generateMerchantCode(application: {
    geographicArea?: string | null;
    barangay?: string | null;
    cityMunicipality?: string | null;
    address?: string | null;
  }): Promise<string> {
    const addressPart = (
      application.geographicArea
      || application.barangay
      || application.cityMunicipality
      || application.address
      || 'STORE'
    )
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 8) || 'STORE';
    for (let attempt = 0; attempt < 10; attempt++) {
      // Address makes the ID recognizable; the random suffix guarantees that
      // two stores at the same address still receive distinct IDs.
      const code = `WKM-${addressPart}-${randomBytes(3).toString('hex').toUpperCase()}`;
      const [merchant, application] = await Promise.all([
        this.prisma.merchant.findUnique({ where: { merchantCode: code } }),
        this.prisma.merchantApplication.findUnique({ where: { merchantCode: code } }),
      ]);
      if (!merchant && !application) return code;
    }
    throw new BadRequestException('Unable to generate a unique merchant code. Please try again.');
  }
}
