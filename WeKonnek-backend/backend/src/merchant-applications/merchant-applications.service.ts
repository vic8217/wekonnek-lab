import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { computeExpiry } from '../subscriptions/subscription-plans';
import { randomBytes } from 'crypto';

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
    email: a.email,
    phone: a.phone,
    address: a.address,
    contact_name: a.contactName,
    category_name: a.categoryName,
    city_municipality: a.cityMunicipality,
    barangay: a.barangay,
    latitude: a.latitude,
    longitude: a.longitude,
    business_description: a.businessDescription,
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
    rejection_reason: a.rejectionReason,
    submitted_at: a.submittedAt,
    submittedAt: a.submittedAt,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
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

@Injectable()
export class MerchantApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

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
        cityMunicipality: input.city_municipality ?? input.cityMunicipality ?? null,
        barangay: input.barangay ?? null,
        latitude: input.latitude !== undefined && input.latitude !== '' ? Number(input.latitude) : null,
        longitude: input.longitude !== undefined && input.longitude !== '' ? Number(input.longitude) : null,
        businessDescription: input.business_description ?? input.businessDescription ?? null,
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
    return apps.map(serializeApplication);
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
      where: { email: { equals: user.email ?? '', mode: 'insensitive' }, status: 'approved' },
      include: { managementZone: { include: { coverages: true } } },
      orderBy: { submittedAt: 'desc' },
    });
    if (!isAdmin && (!coordinator || !coordinator.managementZone)) throw new ForbiddenException('No coordinator zone is assigned to this account');
    const coverageRules = coordinator?.managementZone?.coverages.map(item => {
      const areas = Array.isArray(item.areas)
        ? item.areas.flatMap(area => area && typeof area === 'object' && 'name' in area ? [String(area.name)] : [])
        : [];
      return {
        cityMunicipality: { equals: item.cityMunicipalityName, mode: 'insensitive' as const },
        ...(areas.length ? { barangay: { in: areas, mode: 'insensitive' as const } } : {}),
      };
    }) ?? [];
    if (!isAdmin && coverageRules.length === 0) throw new ForbiddenException('Your coordinator zone has no city or municipality coverage');
    const applications = await this.prisma.merchantApplication.findMany({
      where: {
        source: 'website_callback',
        ...(coordinator ? { OR: coverageRules } : {}),
        AND: [{ OR: [{ assignedCoordinatorId: null }, { assignedCoordinatorId: user.id }] }],
      },
      orderBy: { submittedAt: 'desc' },
    });
    return applications.map(serializeApplication);
  }

  async claimLead(id: number, user: { id: string; email?: string | null; role?: string }) {
    const leads = await this.findCoordinatorLeads(user);
    const lead = leads.find(item => item.id === id);
    if (!lead) throw new ForbiddenException('This merchant is outside your approved coverage area');
    if (lead.assigned_coordinator_id && lead.assigned_coordinator_id !== user.id) throw new BadRequestException('Merchant is already assigned');
    const updated = await this.prisma.merchantApplication.update({ where: { id }, data: { assignedCoordinatorId: user.id, assignedAt: new Date() } });
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

    const merchantCode = status === 'approved'
      ? application.merchantCode ?? await this.generateMerchantCode()
      : application.merchantCode;
    const updated = await this.prisma.merchantApplication.update({
      where: { id: Number(id) },
      data: {
        status,
        reviewedBy: opts.reviewerId ?? null,
        reviewedAt: new Date(),
        rejectionReason: status === 'rejected' ? opts.rejectionReason ?? null : null,
        merchantCode,
      },
    });

    // On approval, create the live Merchant record + promote the owner.
    if (status === 'approved') {
      await this.provisionMerchant({ ...application, merchantCode });
    }

    return serializeApplication(updated);
  }

  private async provisionMerchant(application: any) {
    // Avoid duplicates if approved twice.
    if (application.userId) {
      const existing = await this.prisma.merchant.findFirst({
        where: { userId: application.userId },
      });
      if (existing) {
        return existing.merchantCode
          ? existing
          : this.prisma.merchant.update({
              where: { id: existing.id },
              data: { merchantCode: application.merchantCode },
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
        email: application.email,
        phone: application.phone,
        address: application.address,
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

    // Record the initial subscription payment for billing history.
    await this.prisma.subscriptionPayment
      .create({
        data: {
          merchantId: merchant.id,
          tier: application.subscriptionTier,
          plan: application.subscriptionPlan,
          amount: application.subscriptionAmount,
          paymentMethod: 'manual',
          status: 'paid',
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

  private async generateMerchantCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = `WKM-${randomBytes(4).toString('hex').toUpperCase()}`;
      const [merchant, application] = await Promise.all([
        this.prisma.merchant.findUnique({ where: { merchantCode: code } }),
        this.prisma.merchantApplication.findUnique({ where: { merchantCode: code } }),
      ]);
      if (!merchant && !application) return code;
    }
    throw new BadRequestException('Unable to generate a unique merchant code. Please try again.');
  }
}
