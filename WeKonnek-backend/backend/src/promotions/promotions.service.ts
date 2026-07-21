import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function serializeCustomerPromotion(p: any) {
  if (!p) return p;
  return {
    id: p.id,
    user_id: p.userId,
    userId: p.userId,
    ad_type: p.adType,
    adType: p.adType,
    title: p.title,
    description: p.description,
    category_id: p.categoryId,
    categoryId: p.categoryId,
    sub_category_id: p.subCategoryId,
    subCategoryId: p.subCategoryId,
    min_price: p.minPrice,
    minPrice: p.minPrice,
    max_price: p.maxPrice,
    maxPrice: p.maxPrice,
    barangay: p.barangay,
    city: p.city,
    preferred_date: p.preferredDate,
    contact_method: p.contactMethod,
    attachment_urls: p.attachmentUrls,
    status: p.status,
    responses_count: p.responsesCount,
    responsesCount: p.responsesCount,
    posted_date: p.postedDate,
    postedDate: p.postedDate,
    expires_date: p.expiresDate,
    expiresDate: p.expiresDate,
    created_at: p.createdAt,
    createdAt: p.createdAt,
    updated_at: p.updatedAt,
    updatedAt: p.updatedAt,
    category: p.category,
    sub_category: p.subCategory,
  };
}

function serializeMerchantPromotion(p: any) {
  if (!p) return p;
  return {
    id: p.id,
    merchant_id: p.merchantId,
    merchantId: p.merchantId,
    title: p.title,
    description: p.description,
    discount_type: p.discountType,
    discountType: p.discountType,
    discount_value: p.discountValue,
    discountValue: p.discountValue,
    start_date: p.startDate,
    startDate: p.startDate,
    end_date: p.endDate,
    endDate: p.endDate,
    is_active: p.isActive,
    isActive: p.isActive,
    created_at: p.createdAt,
    createdAt: p.createdAt,
    updated_at: p.updatedAt,
    updatedAt: p.updatedAt,
  };
}

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Customer Promotions ──────────────────────────────

  async createCustomerPromotion(userId: string, input: any) {
    const title = input.title;
    if (!title) throw new BadRequestException('title is required');

    const data: any = {
      userId,
      adType: input.ad_type || input.adType || 'items',
      title,
      description: input.description || '',
      city: input.city || 'Iloilo City',
      status: 'pending',
    };

    if (input.category_id || input.categoryId)
      data.categoryId = Number(input.category_id || input.categoryId);
    if (input.sub_category_id || input.subCategoryId)
      data.subCategoryId = Number(input.sub_category_id || input.subCategoryId);
    if (input.min_price || input.minPrice)
      data.minPrice = Number(input.min_price || input.minPrice);
    if (input.max_price || input.maxPrice)
      data.maxPrice = Number(input.max_price || input.maxPrice);
    if (input.barangay) data.barangay = input.barangay;
    if (input.preferred_date || input.preferredDate)
      data.preferredDate = new Date(input.preferred_date || input.preferredDate);
    if (input.contact_method || input.contactMethod)
      data.contactMethod = input.contact_method || input.contactMethod;
    if (input.attachment_urls || input.attachmentUrls)
      data.attachmentUrls = input.attachment_urls || input.attachmentUrls;

    const promo = await this.prisma.customerPromotion.create({
      data,
      include: { category: true, subCategory: true },
    });
    return serializeCustomerPromotion(promo);
  }

  async findCustomerPromotions(userId: string, status?: string) {
    const where: any = { userId };
    if (status && status !== 'all') {
      where.status = status;
    }

    const promotions = await this.prisma.customerPromotion.findMany({
      where,
      include: { category: true, subCategory: true },
      orderBy: { createdAt: 'desc' },
    });
    return promotions.map(serializeCustomerPromotion);
  }

  async findCustomerPromotionById(id: number) {
    const promo = await this.prisma.customerPromotion.findUnique({
      where: { id: Number(id) },
      include: { category: true, subCategory: true },
    });
    if (!promo) throw new NotFoundException('Promotion not found');
    return serializeCustomerPromotion(promo);
  }

  // ─── Merchant Promotions ──────────────────────────────

  async createMerchantPromotion(userId: string, input: any) {
    const merchant = await this.prisma.merchant.findFirst({
      where: { userId },
    });
    if (!merchant)
      throw new NotFoundException('No merchant profile found for this account');

    const title = input.title;
    if (!title) throw new BadRequestException('title is required');

    const data: any = {
      merchantId: merchant.id,
      title,
      description: input.description || null,
      discountType: input.discount_type || input.discountType || 'percentage',
      discountValue: Number(input.discount_value || input.discountValue || 0),
      isActive: true,
    };

    if (input.start_date || input.startDate)
      data.startDate = new Date(input.start_date || input.startDate);
    if (input.end_date || input.endDate)
      data.endDate = new Date(input.end_date || input.endDate);

    const promo = await this.prisma.promotion.create({ data });
    return serializeMerchantPromotion(promo);
  }

  async findMerchantPromotions(userId: string, filter?: string) {
    const merchant = await this.prisma.merchant.findFirst({
      where: { userId },
    });
    if (!merchant) return [];

    const where: any = { merchantId: merchant.id };
    const now = new Date();

    if (filter === 'active') {
      where.isActive = true;
      where.OR = [
        { endDate: null },
        { endDate: { gte: now } },
      ];
    } else if (filter === 'scheduled') {
      where.startDate = { gt: now };
    }

    const promotions = await this.prisma.promotion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return promotions.map(serializeMerchantPromotion);
  }

  async updateMerchantPromotion(id: number, input: any) {
    const existing = await this.prisma.promotion.findUnique({
      where: { id: Number(id) },
    });
    if (!existing) throw new NotFoundException('Promotion not found');

    const data: any = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.discount_type || input.discountType)
      data.discountType = input.discount_type || input.discountType;
    if (input.discount_value !== undefined || input.discountValue !== undefined)
      data.discountValue = Number(input.discount_value ?? input.discountValue);
    if (input.start_date || input.startDate)
      data.startDate = new Date(input.start_date || input.startDate);
    if (input.end_date || input.endDate)
      data.endDate = new Date(input.end_date || input.endDate);
    if (input.is_active !== undefined || input.isActive !== undefined)
      data.isActive = input.is_active ?? input.isActive;

    const promo = await this.prisma.promotion.update({
      where: { id: Number(id) },
      data,
    });
    return serializeMerchantPromotion(promo);
  }

  async deleteMerchantPromotion(id: number) {
    const existing = await this.prisma.promotion.findUnique({
      where: { id: Number(id) },
    });
    if (!existing) throw new NotFoundException('Promotion not found');

    await this.prisma.promotion.delete({ where: { id: Number(id) } });
    return { message: 'Promotion deleted' };
  }
}
