import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MerchantCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private slugify(value: string) {
    return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  private isUniqueConstraintError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  async create(input: { name: string; description?: string; icon?: string }) {
    const name = input.name?.trim();
    if (!name) throw new ConflictException('Category name is required');
    const duplicate = await this.prisma.merchantCategory.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (duplicate) throw new ConflictException('A merchant category with this name already exists');
    const highest = await this.prisma.merchantCategory.aggregate({ _max: { displayOrder: true } });
    const baseSlug = this.slugify(name) || 'category';
    const slugExists = await this.prisma.merchantCategory.findUnique({ where: { slug: baseSlug }, select: { id: true } });
    if (slugExists) throw new ConflictException('A merchant category with the same or a very similar name already exists');
    try {
      return await this.prisma.merchantCategory.create({
        data: {
          name,
          slug: baseSlug,
          description: input.description?.trim() || null,
          icon: input.icon?.trim() || null,
          displayOrder: (highest._max.displayOrder ?? -1) + 1,
        },
        include: { subCategories: true },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new ConflictException('A merchant category with the same or a very similar name already exists');
      throw error;
    }
  }

  async createSubCategory(categoryId: number, input: { name: string; groupName?: string }) {
    const name = input.name?.trim();
    if (!name) throw new ConflictException('Subcategory name is required');
    const category = await this.prisma.merchantCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!category) throw new NotFoundException('Merchant category not found');
    const duplicate = await this.prisma.merchantSubCategory.findFirst({
      where: { categoryId, name: { equals: name, mode: 'insensitive' } },
    });
    if (duplicate) throw new ConflictException('This subcategory already exists in the selected category');
    const highest = await this.prisma.merchantSubCategory.aggregate({ where: { categoryId }, _max: { displayOrder: true } });
    const baseSlug = this.slugify(name) || 'subcategory';
    const slugExists = await this.prisma.merchantSubCategory.findUnique({
      where: { categoryId_slug: { categoryId, slug: baseSlug } }, select: { id: true },
    });
    if (slugExists) throw new ConflictException('This subcategory or a similarly named subcategory already exists in the selected category');
    try {
      return await this.prisma.merchantSubCategory.create({
        data: {
          categoryId,
          name,
          slug: baseSlug,
          groupName: input.groupName?.trim() || null,
          displayOrder: (highest._max.displayOrder ?? -1) + 1,
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw new ConflictException('This subcategory or a similarly named subcategory already exists in the selected category');
      throw error;
    }
  }

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
