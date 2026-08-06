import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MerchantCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.merchantCategory.findMany({
      where: { isActive: true },
      include: { subCategories: { where: { isActive: true }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] } },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findBySlug(slug: string) {
    const category = await this.prisma.merchantCategory.findFirst({
      where: { slug, isActive: true },
      include: { subCategories: { where: { isActive: true }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] } },
    });
    if (!category) throw new NotFoundException('Merchant category not found');
    return category;
  }

  async findSubCategories(categoryId: number) {
    const category = await this.prisma.merchantCategory.findFirst({ where: { id: categoryId, isActive: true }, select: { id: true } });
    if (!category) throw new NotFoundException('Merchant category not found');
    return this.prisma.merchantSubCategory.findMany({
      where: { categoryId, isActive: true }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }
}
