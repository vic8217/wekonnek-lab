import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { MEDIA_CONFIG } from './media.config';
import type { MediaConfig } from './media.config';
import type { MediaAssetResult, MediaOwner, MediaPolicy, MediaType } from './media.types';
import { STORAGE_PROVIDER } from './storage/storage.interface';
import type { StorageProvider } from './storage/storage.interface';

const MB = 1024 * 1024;
const POLICIES: Record<Exclude<MediaType, 'document'>, MediaPolicy> = {
  'merchant-product': { maxBytes: 10 * MB, maxWidth: 1600, maxHeight: 1600, quality: 80, thumbnail: { width: 400, height: 400, quality: 74 } },
  'menu-item': { maxBytes: 10 * MB, maxWidth: 1600, maxHeight: 1600, quality: 80, thumbnail: { width: 400, height: 400, quality: 74 } },
  'merchant-logo': { maxBytes: 8 * MB, maxWidth: 1000, maxHeight: 1000, quality: 82, thumbnail: { width: 300, height: 300, quality: 74 } },
  'merchant-banner': { maxBytes: 10 * MB, maxWidth: 2400, maxHeight: 1200, quality: 82, thumbnail: { width: 800, height: 400, quality: 74 } },
  'customer-review': { maxBytes: 10 * MB, maxWidth: 1600, maxHeight: 1600, quality: 78, thumbnail: { width: 400, height: 400, quality: 72 } },
  bazaar: { maxBytes: 10 * MB, maxWidth: 1600, maxHeight: 1600, quality: 80, thumbnail: { width: 400, height: 400, quality: 74 } },
  property: { maxBytes: 10 * MB, maxWidth: 2000, maxHeight: 1500, quality: 82, thumbnail: { width: 500, height: 375, quality: 74 } },
  profile: { maxBytes: 8 * MB, maxWidth: 800, maxHeight: 800, quality: 80, thumbnail: { width: 200, height: 200, quality: 74 } },
  category: { maxBytes: 8 * MB, maxWidth: 1200, maxHeight: 1200, quality: 80, thumbnail: { width: 300, height: 300, quality: 74 } },
  onboarding: { maxBytes: 10 * MB, maxWidth: 1600, maxHeight: 1600, quality: 80, thumbnail: { width: 400, height: 400, quality: 74 } },
};

const TYPE_ALIASES: Record<string, MediaType> = {
  establishment: 'onboarding', 'authorized-person': 'onboarding', review: 'customer-review',
  product: 'merchant-product', 'merchant-product': 'merchant-product', menu: 'menu-item',
  logo: 'merchant-logo', banner: 'merchant-banner', bazaar: 'bazaar', property: 'property',
  profile: 'profile', avatar: 'profile', category: 'category', document: 'document',
};

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(MEDIA_CONFIG) private readonly config: MediaConfig,
  ) {}

  normalizeType(value?: string): MediaType {
    const type = TYPE_ALIASES[String(value || '').trim().toLowerCase()];
    if (!type) throw new BadRequestException('Unsupported media type');
    return type;
  }

  async resolveOwner(user: { id: string; role?: string; merchantId?: number }, mediaType: MediaType, resourceId?: string): Promise<MediaOwner> {
    if (mediaType === 'category') {
      if (!['admin', 'staff'].includes(String(user.role))) throw new ForbiddenException('Category media requires administrator access');
      return { ownerType: 'system', ownerId: 'catalog', keyOwner: 'catalog' };
    }
    if (['merchant-product', 'menu-item', 'merchant-logo', 'merchant-banner'].includes(mediaType)) {
      const merchant = user.merchantId
        ? await this.prisma.merchant.findUnique({ where: { id: user.merchantId }, select: { id: true } })
        : await this.prisma.merchant.findFirst({
            where: { OR: [{ userId: user.id }, { merchantStaff: { some: { userId: user.id, isActive: true } } }] },
            select: { id: true },
          });
      if (!merchant) throw new ForbiddenException('No merchant access is linked to this account');
      if (resourceId && ['merchant-product', 'menu-item'].includes(mediaType)) {
        const product = await this.prisma.product.findFirst({ where: { id: Number(resourceId), merchantId: merchant.id }, select: { id: true } });
        if (!product) throw new NotFoundException('Product not found for this merchant');
        return { ownerType: 'product', ownerId: String(product.id), keyOwner: `merchant-${merchant.id}/product-${product.id}` };
      }
      return { ownerType: 'merchant', ownerId: String(merchant.id), keyOwner: `merchant-${merchant.id}` };
    }
    if (mediaType === 'bazaar' && resourceId) {
      const listing = await this.prisma.bazaarListing.findFirst({ where: { id: resourceId, sellerId: user.id }, select: { id: true } });
      if (!listing) throw new NotFoundException('Bazaar listing not found for this user');
      return { ownerType: 'bazaar-listing', ownerId: listing.id, keyOwner: `listing-${listing.id}` };
    }
    if (mediaType === 'property' && resourceId) {
      const listing = await this.prisma.propertyListing.findFirst({ where: { id: resourceId, ownerId: user.id }, select: { id: true } });
      if (!listing) throw new NotFoundException('Property listing not found for this user');
      return { ownerType: 'property-listing', ownerId: listing.id, keyOwner: `listing-${listing.id}` };
    }
    return { ownerType: 'user', ownerId: user.id, keyOwner: `user-${user.id}` };
  }

  async uploadImage(file: Express.Multer.File, mediaType: Exclude<MediaType, 'document'>, owner: MediaOwner, createdById: string): Promise<MediaAssetResult> {
    if (!file?.buffer?.length) throw new BadRequestException('No image uploaded');
    const policy = POLICIES[mediaType];
    if (file.size > policy.maxBytes || file.size > this.config.maxUploadBytes) throw new BadRequestException('Image exceeds the upload size limit');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw new BadRequestException('Only JPEG, PNG, and WebP images are supported');

    let metadata: sharp.Metadata;
    try { metadata = await sharp(file.buffer, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata(); }
    catch { throw new BadRequestException('Uploaded file is not a valid supported image'); }
    if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format || '')) throw new BadRequestException('Uploaded file is not a valid supported image');
    if (metadata.width * metadata.height > 40_000_000) throw new BadRequestException('Image dimensions are too large');

    let full: Awaited<ReturnType<sharp.Sharp['toBuffer']>> & { data: Buffer; info: sharp.OutputInfo };
    let thumb: { data: Buffer; info: sharp.OutputInfo } | null;
    try {
      const source = () => sharp(file.buffer, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate();
      full = await source().resize({ width: policy.maxWidth, height: policy.maxHeight, fit: 'inside', withoutEnlargement: true }).webp({ quality: policy.quality, effort: 4 }).toBuffer({ resolveWithObject: true });
      thumb = policy.thumbnail
        ? await source().resize({ width: policy.thumbnail.width, height: policy.thumbnail.height, fit: 'cover', withoutEnlargement: true }).webp({ quality: policy.thumbnail.quality, effort: 4 }).toBuffer({ resolveWithObject: true })
        : null;
    } catch { throw new BadRequestException('Unable to process the uploaded image'); }
    const now = new Date();
    const id = randomUUID();
    const prefix = `${this.config.environment}/${mediaType}/${owner.keyOwner}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const objectKey = `${prefix}/${id}.webp`;
    const thumbnailKey = thumb ? `${prefix}/${id}-thumb.webp` : null;
    const uploaded: string[] = [];
    try {
      const stored = await this.storage.upload({ key: objectKey, body: full.data, contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' });
      uploaded.push(objectKey);
      const storedThumb = thumb && thumbnailKey ? await this.storage.upload({ key: thumbnailKey, body: thumb.data, contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' }) : null;
      if (thumbnailKey) uploaded.push(thumbnailKey);
      const asset = await this.prisma.mediaAsset.create({ data: {
        mediaType, ownerType: owner.ownerType, ownerId: owner.ownerId, objectKey, thumbnailKey,
        url: stored.url, thumbnailUrl: storedThumb?.url, mimeType: 'image/webp',
        width: full.info.width, height: full.info.height, sizeBytes: full.data.length,
        thumbnailWidth: thumb?.info.width, thumbnailHeight: thumb?.info.height, thumbnailSizeBytes: thumb?.data.length,
        createdById,
      } });
      this.logger.log(`media_upload mediaType=${mediaType} ownerType=${owner.ownerType} ownerId=${owner.ownerId} key=${objectKey} size=${full.data.length} thumbnailSize=${thumb?.data.length || 0}`);
      return asset;
    } catch (error) {
      await Promise.allSettled(uploaded.map(key => this.storage.delete(key)));
      throw error;
    }
  }

  async uploadDocument(file: Express.Multer.File, owner: MediaOwner, createdById: string): Promise<MediaAssetResult> {
    if (!file?.buffer?.length || file.size > Math.min(10 * MB, this.config.maxUploadBytes)) throw new BadRequestException('Document is missing or too large');
    const now = new Date(); const id = randomUUID();
    const prefix = `${this.config.environment}/documents/${owner.keyOwner}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    let body: Buffer;
    let mimeType: string;
    let extension: 'pdf' | 'webp';
    let width: number | null = null;
    let height: number | null = null;

    if (file.mimetype === 'application/pdf') {
      const eofOffset = file.buffer.lastIndexOf(Buffer.from('%%EOF'));
      if (file.buffer.subarray(0, 5).toString() !== '%PDF-' || eofOffset < 5) throw new BadRequestException('Uploaded file is not a valid PDF document');
      body = file.buffer;
      mimeType = 'application/pdf';
      extension = 'pdf';
    } else if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      try {
        const source = sharp(file.buffer, { limitInputPixels: 40_000_000, failOn: 'error' });
        const metadata = await source.metadata();
        if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format || '')) throw new Error('unsupported image');
        if (metadata.width * metadata.height > 40_000_000) throw new Error('image dimensions are too large');
        const processed = await sharp(file.buffer, { limitInputPixels: 40_000_000, failOn: 'error' })
          .rotate()
          .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82, effort: 4 })
          .toBuffer({ resolveWithObject: true });
        body = processed.data;
        width = processed.info.width;
        height = processed.info.height;
        mimeType = 'image/webp';
        extension = 'webp';
      } catch {
        throw new BadRequestException('Uploaded file is not a valid supported document image');
      }
    } else {
      throw new BadRequestException('Only PDF, JPEG, PNG, and WebP documents are supported');
    }

    const objectKey = `${prefix}/${id}.${extension}`;
    try {
      const stored = await this.storage.upload({ key: objectKey, body, contentType: mimeType, cacheControl: 'private, max-age=3600' });
      return await this.prisma.mediaAsset.create({ data: { mediaType: 'document', ownerType: owner.ownerType, ownerId: owner.ownerId, objectKey, url: stored.url, mimeType, width, height, sizeBytes: body.length, createdById } });
    } catch (error) { await this.storage.delete(objectKey).catch(() => undefined); throw error; }
  }

  getPublicUrl(value: string) {
    if (/^(?:https?:)?\/\//i.test(value) || value.startsWith('/uploads/') || value.startsWith('/api/uploads/')) return value;
    return this.storage.getPublicUrl(value);
  }

  async thumbnailMap(urls: Array<string | null | undefined>) {
    const values = [...new Set(urls.filter((value): value is string => Boolean(value)))];
    if (!values.length) return new Map<string, string>();
    const assets = await this.prisma.mediaAsset.findMany({ where: { url: { in: values }, status: 'active', deletedAt: null, thumbnailUrl: { not: null } }, select: { url: true, thumbnailUrl: true } });
    return new Map(assets.map(asset => [asset.url, asset.thumbnailUrl! ]));
  }

  async assertUserOwnedUrls(userId: string, urls: Array<string | null | undefined>) {
    const values = [...new Set(urls.filter((value): value is string => Boolean(value)))];
    if (!values.length) return;
    const count = await this.prisma.mediaAsset.count({ where: { url: { in: values }, createdById: userId, status: 'active', deletedAt: null } });
    if (count !== values.length) throw new ForbiddenException('Every image must be an active asset uploaded by your account');
  }

  async assertMerchantOwnedUrls(merchantId: number, urls: Array<string | null | undefined>) {
    const values = [...new Set(urls.filter((value): value is string => Boolean(value)))];
    if (!values.length) return;
    const productIds = (await this.prisma.product.findMany({ where: { merchantId }, select: { id: true } })).map((product) => String(product.id));
    const count = await this.prisma.mediaAsset.count({ where: { url: { in: values }, status: 'active', deletedAt: null, OR: [{ ownerType: 'merchant', ownerId: String(merchantId) }, { ownerType: 'product', ownerId: { in: productIds } }] } });
    if (count !== values.length) throw new ForbiddenException('Every image must be an active asset uploaded for this merchant');
  }

  async softDeleteMedia(id: string, userId: string) {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, createdById: userId, deletedAt: null } });
    if (!asset) throw new NotFoundException('Media asset not found');
    return this.prisma.mediaAsset.update({ where: { id }, data: { status: 'deleted', deletedAt: new Date() } });
  }

  async replaceImage(previousMediaId: string, file: Express.Multer.File, mediaType: Exclude<MediaType, 'document'>, owner: MediaOwner, userId: string) {
    const previous = await this.prisma.mediaAsset.findFirst({ where: { id: previousMediaId, createdById: userId, deletedAt: null } });
    if (!previous) throw new NotFoundException('Previous media asset not found');
    const replacement = await this.uploadImage(file, mediaType, owner, userId);
    await this.prisma.mediaAsset.update({ where: { id: previous.id }, data: { status: 'deleted', deletedAt: new Date() } });
    return replacement;
  }
}
