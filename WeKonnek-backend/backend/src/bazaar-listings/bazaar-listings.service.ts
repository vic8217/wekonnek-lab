import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { PaymentGatewayService } from '../modules/wallet/payment-gateway.service';
import { WalletPaymentGateway } from '@prisma/client';
import { randomUUID } from 'crypto';
import { MediaService } from '../modules/media/media.service';

@Injectable()
export class BazaarListingsService {
  constructor(private readonly prisma: PrismaService, private readonly payments: PaymentGatewayService, private readonly media: MediaService) {}

  async createDraft(userId: string, body: any) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.isActive) throw new ForbiddenException('An active account is required to sell on Bazaar');
    const subcategory = await this.prisma.merchantSubCategory.findFirst({ where: { id: Number(body.subCategoryId), isActive: true, category: { slug: 'bazaar', isActive: true } } });
    if (!subcategory) throw new BadRequestException('Select a valid active Bazaar subcategory');
    const images = Array.isArray(body.imageUrls) ? body.imageUrls.filter((url: unknown) => typeof url === 'string').slice(0, 5) : [];
    await this.media.assertUserOwnedUrls(userId, images);
    if (!images.length) throw new BadRequestException('At least one product photo is required');
    const price = Number(body.price);
    if (!body.title?.trim() || !body.description?.trim() || !Number.isFinite(price) || price < 0) throw new BadRequestException('Complete all listing details');
    return this.prisma.bazaarListing.create({ data: { id: randomUUID(), sellerId: userId, subCategoryId: subcategory.id, title: body.title.trim(), description: body.description.trim(), price, imageUrls: images } });
  }

  async mine(userId: string) {
    await this.expire();
    const rows = await this.prisma.bazaarListing.findMany({ where: { sellerId: userId }, orderBy: { updatedAt: 'desc' } });
    return this.withSubcategories(rows);
  }

  async ownedDetail(userId: string, id: string) {
    const listing = await this.owned(userId, id);
    const [row] = await this.withSubcategories([listing]);
    return row;
  }

  async publicDetail(id: string) {
    await this.expire();
    const listing = await this.prisma.bazaarListing.findFirst({ where: { id, status: 'active' } });
    if (!listing) throw new NotFoundException('Bazaar listing not found');
    const [row] = await this.withSubcategories([listing]);
    return row;
  }

  async update(userId: string, id: string, body: any) {
    const listing = await this.owned(userId, id);
    if (!['draft', 'payment_failed'].includes(listing.status)) throw new BadRequestException('Only unpaid draft listings can be edited');
    const subcategory = await this.prisma.merchantSubCategory.findFirst({ where: { id: Number(body.subCategoryId), isActive: true, category: { slug: 'bazaar', isActive: true } } });
    if (!subcategory) throw new BadRequestException('Select a valid active Bazaar subcategory');
    const images = Array.isArray(body.imageUrls) ? body.imageUrls.filter((url: unknown) => typeof url === 'string').slice(0, 5) : [];
    await this.media.assertUserOwnedUrls(userId, images);
    const price = Number(body.price);
    if (!images.length) throw new BadRequestException('At least one product photo is required');
    if (!body.title?.trim() || !body.description?.trim() || !Number.isFinite(price) || price < 0) throw new BadRequestException('Complete all listing details');
    return this.prisma.bazaarListing.update({ where: { id }, data: { subCategoryId: subcategory.id, title: body.title.trim(), description: body.description.trim(), price, imageUrls: images } });
  }

  async startCheckout(userId: string, id: string, body: any) {
    const listing = await this.owned(userId, id);
    if (!['draft', 'payment_failed'].includes(listing.status)) throw new BadRequestException('This listing is already awaiting or has completed payment');
    const gateway = String(body.gateway || 'paymongo') as WalletPaymentGateway;
    if (gateway === WalletPaymentGateway.internal || !Object.values(WalletPaymentGateway).includes(gateway)) throw new BadRequestException('Unsupported payment gateway');
    const method = String(body.paymentMethod || 'gcash');
    const appUrl = process.env.APP_BASE_URL || 'http://localhost:3001';
    const result = await this.payments.createPayment({ gateway, amount: 15, description: `WEKONNEK Bazaar listing: ${listing.title}`, paymentMethod: method, redirectSuccess: `${appUrl}/bazaar/post?payment=success&listing=${id}`, redirectFailed: `${appUrl}/bazaar/post?payment=cancelled&listing=${id}`, metadata: { bazaarListingId: id, sellerId: userId } });
    const updated = await this.prisma.bazaarListing.update({ where: { id }, data: { status: 'payment_pending', paymentGateway: gateway, paymentMethod: method, paymentRef: result.gatewayTransactionId, paymentUrl: result.paymentUrl } });
    return { id: updated.id, status: updated.status, paymentUrl: updated.paymentUrl };
  }

  async settle(id: string, status: 'completed' | 'failed') {
    const listing = await this.prisma.bazaarListing.findUnique({ where: { id } });
    if (!listing) return;
    await this.prisma.bazaarListing.update({ where: { id }, data: status === 'completed' ? { status: 'active', publishedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400000) } : { status: 'payment_failed' } });
  }

  async adminList(query: { status?: string; paymentStatus?: string; search?: string; page?: string; limit?: string }) {
    const now = new Date();
    await this.prisma.bazaarListing.updateMany({ where: { status: 'active', expiresAt: { lte: now } }, data: { status: 'expired' } });
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
    const where: any = {};
    if (query.status && query.status !== 'all') where.status = query.status;
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { seller: { OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ] } },
      ];
    }
    if (query.paymentStatus && query.paymentStatus !== 'all') {
      let paymentWhere: any[] = [];
      if (query.paymentStatus === 'paid') paymentWhere = [{ status: { in: ['active', 'expired'] } }, { status: 'suspended', statusBeforeSuspension: { in: ['active', 'expired'] } }];
      if (query.paymentStatus === 'pending') paymentWhere = [{ status: 'payment_pending' }, { status: 'suspended', statusBeforeSuspension: 'payment_pending' }];
      if (query.paymentStatus === 'failed') paymentWhere = [{ status: 'payment_failed' }, { status: 'suspended', statusBeforeSuspension: 'payment_failed' }];
      if (query.paymentStatus === 'unpaid') paymentWhere = [{ status: 'draft' }, { status: 'suspended', statusBeforeSuspension: 'draft' }];
      if (paymentWhere.length) where.AND = [...(where.AND || []), { OR: paymentWhere }];
    }
    const [rows, total, statusGroups] = await Promise.all([
      this.prisma.bazaarListing.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
        include: { seller: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, isActive: true } } },
      }),
      this.prisma.bazaarListing.count({ where }),
      this.prisma.bazaarListing.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const categoryIds = [...new Set(rows.map(row => row.subCategoryId))];
    const categories = await this.prisma.merchantSubCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } });
    const categoryMap = new Map(categories.map(item => [item.id, item.name]));
    return {
      items: rows.map(row => ({ ...row, subCategoryName: categoryMap.get(row.subCategoryId) || 'Unknown', paymentStatus: this.paymentStatus(row.status === 'suspended' ? row.statusBeforeSuspension || row.status : row.status) })),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
      counts: Object.fromEntries(statusGroups.map(group => [group.status, group._count._all])),
    };
  }

  async suspend(adminUserId: string, id: string, reasonInput: string) {
    const reason = reasonInput?.trim();
    if (!reason || reason.length < 5) throw new BadRequestException('Provide a clear policy violation reason');
    const listing = await this.prisma.bazaarListing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('Bazaar listing not found');
    if (listing.status !== 'active') throw new BadRequestException('Only active listings can be suspended');
    return this.prisma.bazaarListing.update({ where: { id }, data: {
      statusBeforeSuspension: listing.status, status: 'suspended', suspendedAt: new Date(), suspendedBy: adminUserId, suspensionReason: reason,
    } });
  }

  async reinstate(id: string) {
    const listing = await this.prisma.bazaarListing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('Bazaar listing not found');
    if (listing.status !== 'suspended') throw new BadRequestException('Only suspended listings can be reinstated');
    const restored = listing.expiresAt && listing.expiresAt <= new Date() ? 'expired' : listing.statusBeforeSuspension || 'draft';
    return this.prisma.bazaarListing.update({ where: { id }, data: { status: restored, suspendedAt: null, suspendedBy: null, suspensionReason: null, statusBeforeSuspension: null } });
  }

  private paymentStatus(status: string) {
    if (['active', 'expired', 'suspended'].includes(status)) return 'paid';
    if (status === 'payment_pending') return 'pending';
    if (status === 'payment_failed') return 'failed';
    return 'unpaid';
  }

  private async expire() {
    await this.prisma.bazaarListing.updateMany({ where: { status: 'active', expiresAt: { lte: new Date() } }, data: { status: 'expired' } });
  }

  private async withSubcategories<T extends { subCategoryId: number }>(rows: T[]) {
    const ids = [...new Set(rows.map(row => row.subCategoryId))];
    const categories = await this.prisma.merchantSubCategory.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const names = new Map(categories.map(item => [item.id, item.name]));
    const urls = rows.flatMap(row => Array.isArray((row as any).imageUrls) ? (row as any).imageUrls.filter((url: unknown): url is string => typeof url === 'string') : []);
    const thumbnails = await this.media.thumbnailMap(urls);
    return rows.map(row => ({ ...row, subCategoryName: names.get(row.subCategoryId) || 'Unknown', thumbnailUrls: Array.isArray((row as any).imageUrls) ? (row as any).imageUrls.map((url: string) => thumbnails.get(url) || url) : [] }));
  }

  private async owned(userId: string, id: string) {
    const listing = await this.prisma.bazaarListing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('Bazaar listing not found');
    if (listing.sellerId !== userId) throw new ForbiddenException('This listing belongs to another user');
    return listing;
  }
}
