import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { UpdateMerchantDto } from './dto/update-merchant.dto';
import { SearchMerchantsDto } from './dto/search-merchants.dto';
import { Prisma } from '@prisma/client';

/**
 * The merchant/admin portals read snake_case fields while the customer
 * storefront uses the typed camelCase client. We return both so every
 * consumer works without touching the frontend.
 */
function serializeMerchant<T extends Record<string, any> | null>(merchant: T): T {
  if (!merchant) return merchant;
  return {
    ...merchant,
    is_active: merchant.isActive,
    is_verified: merchant.isVerified,
    category_id: merchant.categoryId,
    sub_category_id: merchant.subCategoryId,
    logo_url: merchant.logoUrl,
    cover_image_url: merchant.coverImageUrl,
    zip_code: merchant.zipCode,
    subscription_tier: merchant.subscriptionTier,
    subscription_plan: merchant.subscriptionPlan,
    subscription_amount: merchant.subscriptionAmount,
    subscription_status: merchant.subscriptionStatus,
    subscription_started_at: merchant.subscriptionStartedAt,
    subscription_expires_at: merchant.subscriptionExpiresAt,
    auto_renew: merchant.autoRenew,
    payment_method: merchant.paymentMethod,
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
  constructor(private readonly prisma: PrismaService) {}

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
    return serializeMerchant(merchant);
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
      data: merchants,
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
      data: merchants,
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
      include: { category: true, subCategory: true },
    });

    if (!merchant) {
      throw new NotFoundException(`Merchant with ID ${id} not found`);
    }

    return serializeMerchant(merchant);
  }

  async findBySlug(slug: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { slug },
      include: { category: true, subCategory: true },
    });

    if (!merchant) {
      throw new NotFoundException(`Merchant with slug ${slug} not found`);
    }

    return serializeMerchant(merchant);
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
    return serializeMerchant(merchant);
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.merchant.delete({ where: { id } });
  }
}
