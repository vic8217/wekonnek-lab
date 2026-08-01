import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

/** Add snake_case aliases so the storefront and merchant inventory read consistently. */
function serializeProduct<T extends Record<string, any> | null>(product: T): T {
  if (!product) return product;
  return {
    ...product,
    merchant_id: product.merchantId,
    category_id: product.categoryId,
    sub_category_id: product.subCategoryId,
    product_code: product.productCode,
    image_url: product.imageUrl,
    is_available: product.isAvailable,
    low_stock_threshold: product.lowStockThreshold,
    created_at: product.createdAt,
    updated_at: product.updatedAt,
  } as T;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProductDto: CreateProductDto, merchantId: number) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { taxClassification: true },
    });
    if (!merchant?.taxClassification?.trim()) {
      throw new BadRequestException(
        'Choose a business tax classification in your merchant profile before adding products.',
      );
    }
    const product = await this.prisma.product.create({
      data: { ...createProductDto, merchantId } as any,
    });
    return serializeProduct(product);
  }

  async findAll(merchantId?: number, availableOnly = false) {
    const where: any = {};
    if (merchantId) where.merchantId = merchantId;
    if (availableOnly) where.isAvailable = true;
    const products = await this.prisma.product.findMany({
      where,
      include: { merchant: true, category: true, subCategory: true },
      orderBy: { createdAt: 'desc' },
    });
    return products.map(serializeProduct);
  }

  async findOne(id: number, merchantId?: number) {
    const where: any = { id };
    if (merchantId) {
      where.merchantId = merchantId;
    }

    const product = await this.prisma.product.findFirst({
      where,
      include: { merchant: true, category: true, subCategory: true },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    return serializeProduct(product);
  }

  async update(id: number, updateProductDto: UpdateProductDto, merchantId: number) {
    const product = await this.findOne(id, merchantId);

    if (product.merchantId !== merchantId) {
      throw new ForbiddenException('You do not have permission to update this product');
    }

    return await this.prisma.product.update({
      where: { id },
      data: updateProductDto as any,
    });
  }

  async findLowStock(merchantId: number) {
    const products = await this.prisma.product.findMany({
      where: {
        merchantId,
        quantity: { gt: 0 },
      },
      include: { category: true, subCategory: true },
      orderBy: { quantity: 'asc' },
    });

    const lowStock = products.filter(
      (p) => p.quantity <= (p.lowStockThreshold ?? 10),
    );
    return lowStock.map(serializeProduct);
  }

  async remove(id: number, merchantId: number) {
    const product = await this.findOne(id, merchantId);

    if (product.merchantId !== merchantId) {
      throw new ForbiddenException('You do not have permission to delete this product');
    }

    await this.prisma.product.delete({ where: { id } });
  }

  // ─── Multi-category assignments (product_categories junction) ───

  async getCategories(productId: number) {
    return this.prisma.productCategory.findMany({
      where: { productId },
      orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
    });
  }

  async syncCategories(
    productId: number,
    merchantId: number,
    assignments: Array<{
      categoryId: number;
      subCategoryId?: number | null;
      isPrimary?: boolean;
    }>,
  ) {
    // Ownership check — findOne throws 404 if the product isn't the merchant's.
    const product = await this.findOne(productId, merchantId);
    if (product.merchantId !== merchantId) {
      throw new ForbiddenException(
        'You do not have permission to modify this product',
      );
    }

    // Normalize + dedupe by (categoryId, subCategoryId) to respect the
    // unique constraint on the junction table.
    const seen = new Set<string>();
    const cleaned = (assignments || [])
      .filter((a) => a && a.categoryId != null)
      .map((a) => ({
        productId,
        categoryId: Number(a.categoryId),
        subCategoryId: a.subCategoryId != null ? Number(a.subCategoryId) : null,
        isPrimary: !!a.isPrimary,
      }))
      .filter((a) => {
        const key = `${a.categoryId}:${a.subCategoryId ?? 'null'}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    await this.prisma.$transaction([
      this.prisma.productCategory.deleteMany({ where: { productId } }),
      ...(cleaned.length
        ? [
            this.prisma.productCategory.createMany({
              data: cleaned,
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);

    return this.getCategories(productId);
  }
}
