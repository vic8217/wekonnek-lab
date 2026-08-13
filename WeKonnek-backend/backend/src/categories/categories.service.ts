import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCategoryDto: CreateCategoryDto) {
    return await this.prisma.category.create({ data: createCategoryDto });
  }

  async findForMerchant(merchantId: number) {
    return this.prisma.category.findMany({
      where: { isActive: true, ownerMerchantId: merchantId },
      include: { subCategories: { where: { isActive: true, ownerMerchantId: merchantId }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] } },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createForMerchant(merchantId: number, name: string) {
    const cleanName = name?.trim();
    if (!cleanName) throw new ConflictException('Category name is required');
    const duplicate = await this.prisma.category.findFirst({
      where: { ownerMerchantId: merchantId, name: { equals: cleanName, mode: 'insensitive' } },
    });
    if (duplicate) throw new ConflictException('You already have a category with this name');
    const base = cleanName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'category';
    return this.prisma.category.create({
      data: { name: cleanName, slug: `merchant-${merchantId}-${base}-${Date.now().toString(36)}`, ownerMerchantId: merchantId },
    });
  }

  async findAll(includeInactive = false) {
    return await this.prisma.category.findMany({
      // The public category catalogue contains platform-owned categories only.
      // Merchant menu categories are available through findForMerchant().
      where: includeInactive
        ? {}
        : { isActive: true, ownerMerchantId: null },
      include: {
        subCategories: includeInactive
          ? { orderBy: { displayOrder: 'asc' } }
          : {
              where: { isActive: true, ownerMerchantId: null },
              orderBy: { displayOrder: 'asc' },
            },
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: number) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { subCategories: true },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    return category;
  }

  async findBySlug(slug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      include: { subCategories: true },
    });

    if (!category) {
      throw new NotFoundException(`Category with slug ${slug} not found`);
    }

    return category;
  }

  async update(id: number, updateCategoryDto: UpdateCategoryDto) {
    await this.findOne(id);
    return await this.prisma.category.update({
      where: { id },
      data: updateCategoryDto,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.category.delete({ where: { id } });
  }
}
