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

  private parseCsv(text: string) {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = '';
    let quoted = false;
    const input = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      if (char === '"') {
        if (quoted && input[i + 1] === '"') { value += '"'; i += 1; }
        else quoted = !quoted;
      } else if (char === ',' && !quoted) {
        row.push(value.trim()); value = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && input[i + 1] === '\n') i += 1;
        row.push(value.trim()); value = '';
        if (row.some(cell => cell.length > 0)) rows.push(row);
        row = [];
      } else value += char;
    }
    row.push(value.trim());
    if (row.some(cell => cell.length > 0)) rows.push(row);
    if (quoted) throw new ConflictException('CSV contains an unclosed quoted value');
    return rows;
  }

  async importCsv(csv: string) {
    const rows = this.parseCsv(csv);
    if (rows.length < 2) throw new ConflictException('CSV must contain a header and at least one data row');
    const headers = rows[0].map(header => header.trim().toLowerCase().replace(/[ _-]/g, ''));
    const indexOf = (name: string) => headers.indexOf(name.toLowerCase());
    const categoryIndex = indexOf('category');
    if (categoryIndex < 0) throw new ConflictException('Missing required "category" column');
    const descriptionIndex = indexOf('categorydescription');
    const subcategoryIndex = indexOf('subcategory');
    const groupIndex = indexOf('groupname');
    const result = { categoriesCreated: 0, subcategoriesCreated: 0, skipped: 0, errors: [] as string[] };
    const categoryCache = new Map<string, { id: number }>();

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      const categoryName = row[categoryIndex]?.trim();
      const subcategoryName = subcategoryIndex >= 0 ? row[subcategoryIndex]?.trim() : '';
      if (!categoryName) { result.errors.push(`Row ${rowIndex + 1}: category is required`); continue; }
      try {
        const key = categoryName.toLowerCase();
        let category = categoryCache.get(key) || await this.prisma.merchantCategory.findFirst({
          where: { name: { equals: categoryName, mode: 'insensitive' } }, select: { id: true },
        });
        let changed = false;
        if (!category) {
          category = await this.create({ name: categoryName, description: descriptionIndex >= 0 ? row[descriptionIndex] : undefined });
          result.categoriesCreated += 1; changed = true;
        }
        categoryCache.set(key, category);
        if (subcategoryName) {
          const existing = await this.prisma.merchantSubCategory.findFirst({
            where: { categoryId: category.id, name: { equals: subcategoryName, mode: 'insensitive' } }, select: { id: true },
          });
          if (!existing) {
            await this.createSubCategory(category.id, { name: subcategoryName, groupName: groupIndex >= 0 ? row[groupIndex] : undefined });
            result.subcategoriesCreated += 1; changed = true;
          }
        }
        if (!changed) result.skipped += 1;
      } catch (error) {
        result.errors.push(`Row ${rowIndex + 1}: ${error instanceof Error ? error.message : 'Unable to import row'}`);
      }
    }
    return result;
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
