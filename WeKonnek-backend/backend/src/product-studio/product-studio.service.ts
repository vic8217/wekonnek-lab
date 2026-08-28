import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type CreateGenerationInput = { productId: number; categoryId: number; originalMediaId: string; style: string };

@Injectable()
export class ProductStudioService {
  constructor(private readonly prisma: PrismaService) {}

  async create(merchantId: number, input: CreateGenerationInput) {
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, merchantId, categoryId: input.categoryId },
      select: { id: true },
    });
    if (!product) throw new ForbiddenException('Product category does not belong to this merchant product');

    const media = await this.prisma.mediaAsset.findFirst({
      where: { id: input.originalMediaId, ownerType: 'product', ownerId: String(product.id), status: 'active', deletedAt: null },
      select: { id: true, url: true },
    });
    if (!media) throw new ForbiddenException('Original image is not available for this product');

    const generation = await this.prisma.productStudioGeneration.create({
      data: { merchantId, productId: product.id, categoryId: input.categoryId, originalMediaId: media.id, style: input.style },
      include: { product: { select: { name: true } }, category: { select: { name: true } } },
    });
    return { ...generation, originalImageUrl: media.url, generatedImageUrl: media.url };
  }

  async findMine(merchantId: number) {
    const generations = await this.prisma.productStudioGeneration.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      include: { product: { select: { name: true } }, category: { select: { name: true } } },
    });
    const mediaIds = [...new Set(generations.flatMap((item) => [item.originalMediaId, item.generatedMediaId].filter(Boolean) as string[]))];
    const media = await this.prisma.mediaAsset.findMany({ where: { id: { in: mediaIds }, deletedAt: null }, select: { id: true, url: true } });
    const urls = new Map(media.map((item) => [item.id, item.url]));
    return generations.map((item) => ({ ...item, originalImageUrl: urls.get(item.originalMediaId) || '', generatedImageUrl: urls.get(item.generatedMediaId || '') || urls.get(item.originalMediaId) || '' }));
  }

  async approve(merchantId: number, id: string) {
    const generation = await this.prisma.productStudioGeneration.findFirst({ where: { id, merchantId }, select: { id: true } });
    if (!generation) throw new NotFoundException('Product Studio image not found');
    return this.prisma.productStudioGeneration.update({ where: { id }, data: { status: 'approved' } });
  }
}
