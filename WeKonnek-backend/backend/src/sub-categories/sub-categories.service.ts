import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubCategoryDto } from './dto/create-sub-category.dto';
import { UpdateSubCategoryDto } from './dto/update-sub-category.dto';

@Injectable()
export class SubCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createSubCategoryDto: CreateSubCategoryDto) {
    return await this.prisma.subCategory.create({ data: createSubCategoryDto });
  }

  async createForMerchant(merchantId: number, categoryId: number, name: string) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, ownerMerchantId: merchantId },
    });
    if (!category) throw new ForbiddenException('This category is not available to your merchant');
    const cleanName = name?.trim();
    if (!cleanName) throw new ConflictException('Subcategory name is required');
    const duplicate = await this.prisma.subCategory.findFirst({
      where: { categoryId, ownerMerchantId: merchantId, name: { equals: cleanName, mode: 'insensitive' } },
    });
    if (duplicate) throw new ConflictException('You already have a subcategory with this name');
    const base = cleanName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'subcategory';
    return this.prisma.subCategory.create({
      data: { categoryId, name: cleanName, slug: `${base}-${Date.now().toString(36)}`, ownerMerchantId: merchantId },
    });
  }

  async findForMerchantCategory(merchantId: number, categoryId: number) {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, ownerMerchantId: merchantId }, select: { id: true },
    });
    if (!category) throw new ForbiddenException('This category is not available to your merchant');
    return this.prisma.subCategory.findMany({
      where: { categoryId, isActive: true, ownerMerchantId: merchantId },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findAll(includeInactive = false) {
    return await this.prisma.subCategory.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: { category: true },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async findByCategory(categoryId: number, includeInactive = false) {
    return await this.prisma.subCategory.findMany({
      where: {
        categoryId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { displayOrder: 'asc' },
    });
  }

  async findOne(id: number) {
    const subCategory = await this.prisma.subCategory.findUnique({
      where: { id },
      include: { category: true },
    });

    if (!subCategory) {
      throw new NotFoundException(`Sub-category with ID ${id} not found`);
    }

    return subCategory;
  }

  async update(id: number, updateSubCategoryDto: UpdateSubCategoryDto) {
    await this.findOne(id);
    return await this.prisma.subCategory.update({
      where: { id },
      data: updateSubCategoryDto,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    await this.prisma.subCategory.delete({ where: { id } });
  }
}
