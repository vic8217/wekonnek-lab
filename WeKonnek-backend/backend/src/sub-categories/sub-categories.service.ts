import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubCategoryDto } from './dto/create-sub-category.dto';
import { UpdateSubCategoryDto } from './dto/update-sub-category.dto';

@Injectable()
export class SubCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createSubCategoryDto: CreateSubCategoryDto) {
    return await this.prisma.subCategory.create({ data: createSubCategoryDto });
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
