import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommerceDomain, Prisma } from '@prisma/client';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { UpdateMerchantDto } from './dto/update-merchant.dto';
import { SearchMerchantsDto } from './dto/search-merchants.dto';
import { randomBytes } from 'crypto';
import { operationState } from '../branches/branch-operation';
import {
  addOnQuantity,
  computeDailySubscriptionFee,
  dailySubscriptionReference,
  philippineBillingDay,
} from './philippine-billing-day';
import { WalletLedgerService } from '../modules/wallet/wallet-ledger.service';
import { moneyNumber } from '../modules/wallet/wallet-money';

/**
 * The merchant/admin portals read snake_case fields while the customer
 * storefront uses the typed camelCase client. We return both so every
 * consumer works without touching the frontend.
 */
function legacyUploadReference(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    // Old rows were written with the local development origin. Return the
    // portable path instead; browser clients resolve it through their
    // configured backend proxy and native clients can prepend their API URL.
    if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return value;
    return /^\/(?:api\/)?uploads\/.+/.test(url.pathname)
      ? `${url.pathname}${url.search}`
      : value;
  } catch {
    return value;
  }
}

function serializeMerchant<T extends Record<string, any> | null>(merchant: T): T {
  if (!merchant) return merchant;
  const logoUrl = legacyUploadReference(merchant.logoUrl);
  const coverImageUrl = legacyUploadReference(merchant.coverImageUrl);
  return {
    ...merchant,
    merchant_code: merchant.merchantCode,
    store_id: merchant.merchantCode,
    storeId: merchant.merchantCode,
    is_active: merchant.isActive,
    is_verified: merchant.isVerified,
    category_id: merchant.categoryId,
    sub_category_id: merchant.subCategoryId,
    logoUrl,
    coverImageUrl,
    logo_url: logoUrl,
    cover_image_url: coverImageUrl,
    zip_code: merchant.zipCode,
    council_district: merchant.councilDistrict,
    geographic_area: merchant.geographicArea,
    subscription_tier: merchant.subscriptionTier,
    subscription_plan: merchant.subscriptionPlan,
    subscription_amount: merchant.subscriptionAmount,
    subscription_status: merchant.subscriptionStatus,
    subscription_started_at: merchant.subscriptionStartedAt,
    subscription_expires_at: merchant.subscriptionExpiresAt,
    auto_renew: merchant.autoRenew,
    payment_method: merchant.paymentMethod,
    tax_classification: merchant.taxClassification,
    registered_business_name: merchant.registeredBusinessName,
    suspension_reason: merchant.suspensionReason,
    suspension_duration: merchant.suspensionDuration,
    suspended_until: merchant.suspendedUntil,
    total_reviews: merchant.totalReviews,
    business_type: merchant.businessType,
    created_at: merchant.createdAt,
    updated_at: merchant.updatedAt,
  } as T;
}

/** Convert snake_case input keys from the frontend to Prisma camelCase fields. */
function normalizeMerchantInput(input: Record<string, any>): Record<string, any> {
  const map: Record<string, string> = {
    is_active: 'isActive',
    is_verified: 'isVerified',
    category_id: 'categoryId',
    sub_category_id: 'subCategoryId',
    logo_url: 'logoUrl',
    cover_image_url: 'coverImageUrl',
    zip_code: 'zipCode',
    subscription_tier: 'subscriptionTier',
    subscription_plan: 'subscriptionPlan',
    subscription_amount: 'subscriptionAmount',
    payment_method: 'paymentMethod',
    tax_classification: 'taxClassification',
    registered_business_name: 'registeredBusinessName',
    suspension_reason: 'suspensionReason',
    suspension_duration: 'suspensionDuration',
    suspended_until: 'suspendedUntil',
    business_type: 'businessType',
  };
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    const target = map[key] || key;
    out[target] = value;
  }
  // Never allow updating identity/relation primary keys through this path
  delete out.id;
  delete out.userId;
  delete out.user_id;
  delete out.createdAt;
  delete out.created_at;
  delete out.updatedAt;
  delete out.updated_at;
  if (out.suspended_until) {
    out.suspendedUntil = new Date(out.suspended_until);
    delete out.suspended_until;
  }
  return out;
}

@Injectable()
export class MerchantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletLedger: WalletLedgerService,
  ) {}

  async create(createMerchantDto: CreateMerchantDto) {
    const merchant = await this.prisma.merchant.create({
      data: createMerchantDto as any,
    });
    return serializeMerchant(merchant);
  }

  async findByUserId(userId: string) {
    const merchant = await this.prisma.merchant.findFirst({
      where: { userId },
      include: { category: true, subCategory: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!merchant) {
      throw new NotFoundException('No merchant profile found for this account');
    }
    const coverage = await this.getSubscriptionCoverage(userId);
    return {
      ...serializeMerchant(merchant),
      ...coverage,
    };
  }

  async getSubscriptionCoverage(userId: string) {
    const merchant = await this.prisma.merchant.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!merchant) {
      throw new NotFoundException('No merchant profile found for this account');
    }

    const [wallet, application] = await Promise.all([
      this.prisma.wallet.findUnique({ where: { userId } }),
      merchant.merchantCode
        ? this.prisma.merchantApplication.findUnique({
            where: { merchantCode: merchant.merchantCode },
          })
        : null,
    ]);
    const addOns = application?.selectedAddOnIds.length
      ? await this.prisma.subscriptionAddOnPackage.findMany({
          where: { id: { in: application.selectedAddOnIds } },
          select: { id: true, amount: true },
        })
      : [];
    const planFee = Number(application?.subscriptionAmount ?? merchant.subscriptionAmount);
    const { addOnFee, dailySubscriptionFee } = computeDailySubscriptionFee(
      planFee,
      addOns,
      application?.selectedAddOnQuantities,
    );
    const isDailyPlan = merchant.subscriptionPlan.toLowerCase() === 'daily';
    const billingDay = philippineBillingDay();
    const chargeReference = dailySubscriptionReference(merchant.id, billingDay.key);
    const currentCharge = isDailyPlan
      ? await this.prisma.walletTransaction.findUnique({
          where: { referenceNumber: chargeReference },
          select: { id: true },
        })
      : null;
    const walletBalance = moneyNumber(wallet?.balance || 0);
    const fundedDays = dailySubscriptionFee > 0
      ? Math.floor(walletBalance / dailySubscriptionFee)
      : 0;
    const paidToday = Boolean(currentCharge);
    const activeThrough = paidToday
      ? new Date(billingDay.periodEnd.getTime() + fundedDays * 24 * 60 * 60 * 1000)
      : null;
    const accountActive = !isDailyPlan || dailySubscriptionFee <= 0 || paidToday;

    return {
      wallet_balance: walletBalance,
      plan_fee: planFee,
      add_on_fee: addOnFee,
      daily_subscription_fee: dailySubscriptionFee,
      funded_days: fundedDays,
      active_through: activeThrough,
      account_active: accountActive,
    };
  }

  async findAll(status?: string) {
    const where: Prisma.MerchantWhereInput = {};
    if (status && status !== 'all') {
      where.status = status;
    } else {
      // Default public listing excludes inactive merchants
      where.isActive = { not: false };
    }
    const merchants = await this.prisma.merchant.findMany({
      where,
      include: { category: true, subCategory: true },
      orderBy: { name: 'asc' },
    });
    return merchants.map(serializeMerchant);
  }

  async findAllForAdmin(status?: string) {
    const where: Prisma.MerchantWhereInput = status && status !== 'all' ? { status } : {};
    const merchants = await this.prisma.merchant.findMany({
      where,
      include: { category: true, subCategory: true },
      orderBy: { name: 'asc' },
    });
    const codes = merchants.flatMap(merchant => merchant.merchantCode ? [merchant.merchantCode] : []);
    const applications = codes.length ? await this.prisma.merchantApplication.findMany({
      where: { merchantCode: { in: codes }, status: 'approved' },
      select: { merchantCode: true, temporaryPassword: true, recoveryKey: true, subscriptionAmount: true, selectedAddOnIds: true, selectedAddOnQuantities: true },
    }) : [];
    const addOnIds = [...new Set(applications.flatMap(application => application.selectedAddOnIds))];
    const addOns = addOnIds.length ? await this.prisma.subscriptionAddOnPackage.findMany({
      where: { id: { in: addOnIds } },
      select: { id: true, amount: true },
    }) : [];
    const merchantIds = merchants.map(merchant => merchant.id);
    const merchantUserIds = merchants.flatMap(merchant => merchant.userId ? [merchant.userId] : []);
    const wallets = merchantUserIds.length ? await this.prisma.wallet.findMany({
      where: { userId: { in: merchantUserIds } },
      select: { userId: true, balance: true },
    }) : [];
    const paidPayments = merchantIds.length ? await this.prisma.subscriptionPayment.groupBy({
      by: ['merchantId'],
      where: { merchantId: { in: merchantIds }, status: 'paid' },
      _sum: { amount: true },
    }) : [];
    const addOnAmounts = new Map(addOns.map(addOn => [addOn.id, Number(addOn.amount)]));
    const paidByMerchant = new Map(paidPayments.map(payment => [payment.merchantId, Number(payment._sum.amount || 0)]));
    const walletByUser = new Map(wallets.map(wallet => [wallet.userId, moneyNumber(wallet.balance || 0)]));
    const credentials = new Map(applications.map(application => [application.merchantCode, application]));
    return merchants.map(merchant => {
      const application = merchant.merchantCode ? credentials.get(merchant.merchantCode) : undefined;
      const totalSubscriptionFee = Number(application?.subscriptionAmount ?? merchant.subscriptionAmount)
        + (application?.selectedAddOnIds || []).reduce(
          (sum, addOnId) =>
            sum +
            (addOnAmounts.get(addOnId) || 0) *
              addOnQuantity(application?.selectedAddOnQuantities, addOnId),
          0,
        );
      const paid = paidByMerchant.get(merchant.id) || 0;
      return {
        ...serializeMerchant(merchant),
        temporary_password: application?.temporaryPassword ?? null,
        recovery_key: application?.recoveryKey ?? null,
        total_subscription_fee: totalSubscriptionFee,
        total_fee: totalSubscriptionFee,
        wallet_balance: merchant.userId ? walletByUser.get(merchant.userId) || 0 : 0,
        ledger_unpaid: Math.max(totalSubscriptionFee - paid, 0),
      };
    });
  }

  async getAdminDetails(id: number) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      include: {
        branches: {
          where: { isActive: true },
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
          select: { id: true, name: true, isDefault: true, operatingHours: true },
        },
      },
    });
    if (!merchant) throw new NotFoundException('Merchant not found');
    const application = merchant.merchantCode
      ? await this.prisma.merchantApplication.findUnique({ where: { merchantCode: merchant.merchantCode } })
      : null;
    const addOns = application?.selectedAddOnIds.length
      ? await this.prisma.subscriptionAddOnPackage.findMany({
          where: { id: { in: application.selectedAddOnIds } },
          orderBy: { name: 'asc' },
        })
      : [];
    const planFee = Number(application?.subscriptionAmount ?? merchant.subscriptionAmount);
    const addOnFee = addOns.reduce(
      (sum, addOn) =>
        sum + Number(addOn.amount) * addOnQuantity(application?.selectedAddOnQuantities, addOn.id),
      0,
    );
    return {
      ...serializeMerchant(merchant),
      temporary_password: application?.temporaryPassword ?? null,
      recovery_key: application?.recoveryKey ?? null,
      fee_breakdown: {
        plan: {
          name: application?.subscriptionTier ?? merchant.subscriptionTier,
          amount: planFee,
          billing_unit: application?.subscriptionPlan ?? merchant.subscriptionPlan,
        },
        add_ons: addOns.map(addOn => ({
          id: addOn.id,
          name: addOn.name,
          amount: Number(addOn.amount),
          quantity: addOnQuantity(application?.selectedAddOnQuantities, addOn.id),
          subtotal:
            Number(addOn.amount) *
            addOnQuantity(application?.selectedAddOnQuantities, addOn.id),
          billing_unit: addOn.billingUnit,
          amount_basis: addOn.amountBasis,
        })),
        add_on_fee: addOnFee,
        total_fee: planFee + addOnFee,
      },
    };
  }

  async getSubscriptionLedger(id: number) {
    const details = await this.getAdminDetails(id);
    const payments = await this.prisma.subscriptionPayment.findMany({
      where: { merchantId: id },
      orderBy: { createdAt: 'desc' },
    });
    const totalBilled = details.fee_breakdown.total_fee;
    const totalPaid = payments
      .filter(payment => payment.status === 'paid')
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    return {
      merchant: { id: details.id, name: details.name, merchant_code: details.merchantCode },
      fee_breakdown: details.fee_breakdown,
      balance: {
        total_billed: totalBilled,
        total_paid: totalPaid,
        unpaid: Math.max(totalBilled - totalPaid, 0),
      },
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
    };
  }

  async generateRecoveryKey(id: number) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id } });
    if (!merchant?.merchantCode) throw new NotFoundException('Approved merchant account not found');
    const application = await this.prisma.merchantApplication.findUnique({
      where: { merchantCode: merchant.merchantCode },
    });
    if (!application?.userId || application.status !== 'approved') {
      throw new NotFoundException('Approved merchant application not found');
    }
    const recoveryKey = `WKR-${randomBytes(18).toString('base64url')}`;
    await this.prisma.merchantApplication.update({
      where: { id: application.id },
      data: { recoveryKey },
    });
    return { recovery_key: recoveryKey, merchant_code: merchant.merchantCode };
  }

  async addDemoWalletCredit(id: number, amount: number, adminUserId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      select: { id: true, name: true, userId: true },
    });
    if (!merchant) throw new NotFoundException('Merchant not found');
    if (!merchant.userId) throw new NotFoundException('Merchant owner account not found');

    const wallet = await this.prisma.wallet.upsert({
      where: { userId: merchant.userId },
      update: {},
      create: { userId: merchant.userId, balance: 0, isActive: true },
    });
    const referenceNumber = `DEMO-${merchant.id}-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`;
    const result = await this.walletLedger.adjustWallet({
      walletId: wallet.id,
      amount,
      direction: 'credit',
      reason: 'Demo wallet credit (UAT)',
      actorUserId: adminUserId,
      reference: referenceNumber,
    });
    return {
      merchant_id: merchant.id,
      amount,
      wallet_balance: result.wallet_balance,
      reference_number: result.reference,
    };
  }

  async search(searchDto: SearchMerchantsDto) {
    const {
      search: searchParam,
      q,
      categoryId,
      subCategoryId,
      city,
      latitude,
      longitude,
      radius = 10,
      page = 1,
      limit = 20,
    } = searchDto;
    const search = searchParam || q;

    if (latitude && longitude && radius) {
      return this.searchWithLocation(searchDto);
    }

    const where: Prisma.MerchantWhereInput = {
      isActive: { not: false },
    };

    if (search) {
      where.AND = [
        {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (subCategoryId) {
      where.subCategoryId = subCategoryId;
    }

    if (city) {
      where.city = { contains: city, mode: 'insensitive' };
    }

    const skip = (page - 1) * limit;

    const [merchants, total] = await Promise.all([
      this.prisma.merchant.findMany({
        where,
        include: { category: true, subCategory: true },
        orderBy: { name: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.merchant.count({ where }),
    ]);

    return {
      // Keep search results consistent with merchant profiles: historical
      // localhost upload URLs must never reach public browser clients.
      data: merchants.map(serializeMerchant),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async searchWithLocation(searchDto: SearchMerchantsDto) {
    const {
      search: searchParam,
      q,
      categoryId,
      subCategoryId,
      city,
      latitude,
      longitude,
      radius = 10,
      page = 1,
      limit = 20,
    } = searchDto;
    const search = searchParam || q;

    const skip = (page - 1) * limit;
    const earthRadiusKm = 6371;

    const conditions: string[] = [
      `(m.is_active = true OR m.is_active IS NULL)`,
      `m.latitude IS NOT NULL`,
      `m.longitude IS NOT NULL`,
    ];
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(m.name ILIKE $${paramIndex} OR m.description ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (categoryId) {
      conditions.push(`m.category_id = $${paramIndex}`);
      params.push(categoryId);
      paramIndex++;
    }

    if (subCategoryId) {
      conditions.push(`m.sub_category_id = $${paramIndex}`);
      params.push(subCategoryId);
      paramIndex++;
    }

    if (city) {
      conditions.push(`m.city ILIKE $${paramIndex}`);
      params.push(`%${city}%`);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const distanceExpr = `(${earthRadiusKm} * acos(
      cos(radians(${latitude})) * cos(radians(m.latitude))
      * cos(radians(m.longitude) - radians(${longitude}))
      + sin(radians(${latitude})) * sin(radians(m.latitude))
    ))`;

    const countQuery = `
      SELECT COUNT(*)::int as total FROM merchants m
      WHERE ${whereClause} AND ${distanceExpr} <= ${radius}
    `;

    const dataQuery = `
      SELECT m.*, ${distanceExpr} as distance
      FROM merchants m
      WHERE ${whereClause} AND ${distanceExpr} <= ${radius}
      ORDER BY distance ASC
      LIMIT ${limit} OFFSET ${skip}
    `;

    const [countResult, merchants] = await Promise.all([
      this.prisma.$queryRawUnsafe<[{ total: number }]>(countQuery, ...params),
      this.prisma.$queryRawUnsafe<any[]>(dataQuery, ...params),
    ]);

    const total = countResult[0]?.total ?? 0;

    return {
      // Raw location-query results bypass Prisma's normal serialization.
      // Normalize them before returning the public listing response.
      data: merchants.map(serializeMerchant),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id },
      include: { category: true, subCategory: true, branches: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true, name: true, address: true, city: true, isDefault: true, isActive: true, operatingHours: true, manualOpenOverride: true, manualOverrideUpdatedAt: true } } },
    });

    if (!merchant) {
      throw new NotFoundException(`Merchant with ID ${id} not found`);
    }

    return serializeMerchant({
      ...merchant,
      branches: merchant.branches.map(branch => ({ ...branch, ...operationState(branch) })),
    });
  }

  async findBySlug(slug: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { slug },
      include: { category: true, subCategory: true, branches: { where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], select: { id: true, name: true, address: true, city: true, isDefault: true, isActive: true, operatingHours: true, manualOpenOverride: true, manualOverrideUpdatedAt: true } } },
    });

    if (!merchant) {
      throw new NotFoundException(`Merchant with slug ${slug} not found`);
    }

    return serializeMerchant({
      ...merchant,
      branches: merchant.branches.map(branch => ({ ...branch, ...operationState(branch) })),
    });
  }

  /**
   * Resolve a merchant by a route param that may be either a numeric ID
   * (e.g. "42") or a slug (e.g. "aling-nena-sari-sari"). Keeps the public
   * `GET /merchants/:id` endpoint tolerant of both so callers never hit a
   * "numeric string is expected" validation error.
   */
  async findByIdOrSlug(idOrSlug: string) {
    if (/^\d+$/.test(idOrSlug)) {
      return this.findOne(Number(idOrSlug));
    }
    return this.findBySlug(idOrSlug);
  }

  async update(id: number, updateMerchantDto: UpdateMerchantDto) {
    await this.findOne(id);
    const data = normalizeMerchantInput(updateMerchantDto as any);
    const merchant = await this.prisma.merchant.update({
      where: { id },
      data: data as any,
      include: { category: true, subCategory: true },
    });
    await this.prisma.branch.updateMany({
      where: { merchantId: id, isDefault: true },
      data: {
        name: merchant.name,
        phone: merchant.phone,
        tin: merchant.tin,
        registeredBusinessName: merchant.registeredBusinessName || merchant.name,
        taxClassification: merchant.taxClassification,
      },
    });
    return serializeMerchant(merchant);
  }

  async setCommerceDomain(id: number, commerceDomain: CommerceDomain | null) {
    if (commerceDomain !== null && !Object.values(CommerceDomain).includes(commerceDomain)) throw new BadRequestException('Invalid commerce domain');
    await this.findOne(id);
    return this.prisma.merchant.update({ where: { id }, data: { commerceDomain } });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.merchant.delete({ where: { id } });
  }
}
