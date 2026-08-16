import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { productTypesForCategory } from './product-types';
import { operationState } from '../branches/branch-operation';
import { MediaService } from '../modules/media/media.service';

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
    product_type: product.productType,
    base_sku: product.baseSku,
    cost_price: product.costPrice,
    selling_price: product.sellingPrice,
    discount_price: product.discountPrice,
    has_variants: product.hasVariants,
    track_inventory: product.trackInventory,
    availability_status: product.availabilityStatus,
    created_at: product.createdAt,
    updated_at: product.updatedAt,
  } as T;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService) {}

  private async assertCategoryAccess(merchantId: number, categoryId?: number | null, subCategoryId?: number | null) {
    if (!categoryId) {
      if (subCategoryId) throw new BadRequestException('A category is required when selecting a subcategory');
      return;
    }
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, isActive: true, ownerMerchantId: merchantId },
      select: { id: true },
    });
    if (!category) throw new ForbiddenException('This category is not available to your merchant');
    if (subCategoryId) {
      const subCategory = await this.prisma.subCategory.findFirst({
        where: { id: subCategoryId, categoryId, isActive: true, ownerMerchantId: merchantId },
        select: { id: true },
      });
      if (!subCategory) throw new ForbiddenException('This subcategory is not available in the selected category');
    }
  }

  async resolveCategoryIds(categoryName?: string, subcategoryName?: string) {
    if (!categoryName) return {};
    const category = await this.prisma.category.findFirst({
      where: { name: { equals: categoryName, mode: 'insensitive' } },
    });
    if (!category) throw new BadRequestException(`Category "${categoryName}" was not found`);
    const subCategory = subcategoryName
      ? await this.prisma.subCategory.findFirst({
          where: { categoryId: category.id, name: { equals: subcategoryName, mode: 'insensitive' } },
        })
      : null;
    if (subcategoryName && !subCategory) throw new BadRequestException(`Subcategory "${subcategoryName}" was not found in ${category.name}`);
    return { categoryId: category.id, subCategoryId: subCategory?.id };
  }

  async create(createProductDto: CreateProductDto, merchantId: number) {
    await this.assertCategoryAccess(merchantId, createProductDto.categoryId, createProductDto.subCategoryId);
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { taxClassification: true, category: { select: { slug: true, name: true } } },
    });
    if (!merchant?.taxClassification?.trim()) {
      throw new BadRequestException(
        'Choose a business tax classification in your merchant profile before adding products.',
      );
    }
    const allowedTypes = productTypesForCategory(merchant.category?.slug);
    if (createProductDto.productType && !allowedTypes.includes(createProductDto.productType)) {
      throw new BadRequestException(
        `${createProductDto.productType} is not available for ${merchant.category?.name || 'this merchant category'}`,
      );
    }
    const { options, variants, quantity: _legacyQuantity, lowStockThreshold: _legacyThreshold, ...input } = createProductDto;
    const sellingPrice = Number(input.sellingPrice ?? input.price ?? 0);
    const baseSku = input.baseSku || input.sku || input.productCode || null;
    const availabilityStatus = input.availabilityStatus || (input.isAvailable === false ? 'Unavailable' : 'Available');
    const product = await this.prisma.product.create({
      data: {
        ...input,
        merchantId,
        baseSku,
        sku: baseSku,
        productCode: input.productCode || baseSku,
        sellingPrice,
        price: sellingPrice,
        availabilityStatus,
        isAvailable: availabilityStatus === 'Available',
        quantity: 0,
        lowStockThreshold: 0,
      } as any,
    });
    if (product.hasVariants) await this.replaceVariants(product.id, options || [], variants || []);
    return this.findOne(product.id, merchantId);
  }

  async findAll(merchantId?: number, availableOnly = false, filters: Record<string, string | undefined> = {}) {
    const where: any = {};
    if (merchantId) where.merchantId = merchantId;
    if (availableOnly) where.availabilityStatus = 'Available';
    if (filters.productType) where.productType = filters.productType;
    if (filters.categoryId) where.categoryId = Number(filters.categoryId);
    if (filters.brand) where.brand = { equals: filters.brand, mode: 'insensitive' };
    if (filters.hasVariants) where.hasVariants = filters.hasVariants === 'true';
    if (filters.trackInventory) where.trackInventory = filters.trackInventory === 'true';
    if (filters.availabilityStatus) where.availabilityStatus = filters.availabilityStatus;
    if (filters.search) where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { baseSku: { contains: filters.search, mode: 'insensitive' } },
      { barcode: { contains: filters.search, mode: 'insensitive' } },
      { brand: { contains: filters.search, mode: 'insensitive' } },
      { category: { name: { contains: filters.search, mode: 'insensitive' } } },
      { variants: { some: { OR: [
        { sku: { contains: filters.search, mode: 'insensitive' } },
        { barcode: { contains: filters.search, mode: 'insensitive' } },
      ] } } },
    ];
    const products = await this.prisma.product.findMany({
      where,
      include: {
        merchant: { include: { category: true } },
        category: true,
        subCategory: true,
        options: { include: { values: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } },
        variants: { include: { optionValues: { include: { optionValue: { include: { option: true } } } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const thumbnails = await this.media.thumbnailMap(products.map(product => product.imageUrl));
    return products.map(product => ({ ...serializeProduct(product), thumbnailUrl: product.imageUrl ? thumbnails.get(product.imageUrl) || product.imageUrl : null }));
  }

  async findForShop(merchantId: number, shopId: number) {
    const shop = await this.prisma.branch.findFirst({ where: { id: shopId, merchantId, isActive: true } });
    if (!shop) throw new NotFoundException('Shop not found');
    const shopIsOpen = operationState(shop).is_open;
    const assignments = await this.prisma.shopProduct.findMany({
      where: { merchantId, shopId, isEnabled: true, isOnMenu: true, menuVisible: true },
      include: {
        product: {
          include: {
            merchant: { include: { category: true } }, category: true, subCategory: true,
            options: { include: { values: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } },
            variants: { where: { isActive: true }, include: { optionValues: { include: { optionValue: { include: { option: true } } } } } },
          },
        },
      },
      orderBy: [{ menuCategoryOrder: 'asc' }, { menuDisplayOrder: 'asc' }],
    });
    const balances = await this.prisma.shopInventory.findMany({ where: { merchantId, shopId } });
    return assignments
      .filter(assignment => !['Draft', 'Archived'].includes(assignment.product.availabilityStatus))
      .map(assignment => {
        const productBalances = balances.filter(balance => balance.productId === assignment.productId);
        const inStock = !assignment.product.trackInventory || productBalances.some(balance => balance.quantity - balance.reservedQuantity > 0);
        const customerStatus = !shopIsOpen
          ? 'Shop Closed'
          : assignment.product.availabilityStatus !== 'Available'
          ? 'Temporarily Unavailable'
          : inStock ? 'Available' : 'Out of Stock';
        const { quantity: _legacyQuantity, lowStockThreshold: _legacyThreshold, costPrice: _internalCost, ...publicProduct } = assignment.product;
        const publicVariants = assignment.product.variants.map(variant => {
          const variantBalance = productBalances.find(balance => balance.variantId === variant.id);
          return {
            ...variant,
            availabilityStatus: assignment.product.trackInventory
              ? variantBalance && variantBalance.quantity - variantBalance.reservedQuantity > 0 ? 'Available' : 'Out of Stock'
              : 'Available',
          };
        });
        return serializeProduct({
          ...publicProduct,
          variants: publicVariants,
          price: assignment.priceOverride ?? assignment.product.discountPrice ?? assignment.product.sellingPrice ?? assignment.product.price,
          sellingPrice: assignment.priceOverride ?? assignment.product.sellingPrice,
          availabilityStatus: customerStatus,
          isAvailable: customerStatus === 'Available',
          description: assignment.menuDescription || publicProduct.description,
          menuBadge: assignment.menuBadge,
          menuFeatured: assignment.menuFeatured,
          menuCategory: assignment.menuCategory || assignment.product.subCategory?.name || assignment.product.category?.name,
          menuDisplayOrder: assignment.menuDisplayOrder,
          shopId,
        });
      });
  }

  async findOne(id: number, merchantId?: number) {
    const where: any = { id };
    if (merchantId) {
      where.merchantId = merchantId;
    }

    const product = await this.prisma.product.findFirst({
      where,
      include: {
        merchant: { include: { category: true } },
        category: true,
        subCategory: true,
        options: { include: { values: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } },
        variants: { include: { optionValues: { include: { optionValue: { include: { option: true } } } } } },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID ${id} not found`);
    }

    const thumbnails = await this.media.thumbnailMap([product.imageUrl]);
    return { ...serializeProduct(product), thumbnailUrl: product.imageUrl ? thumbnails.get(product.imageUrl) || product.imageUrl : null };
  }

  async update(id: number, updateProductDto: UpdateProductDto, merchantId: number) {
    const product = await this.findOne(id, merchantId);

    if (product.merchantId !== merchantId) {
      throw new ForbiddenException('You do not have permission to update this product');
    }
    await this.assertCategoryAccess(
      merchantId,
      updateProductDto.categoryId === undefined ? product.categoryId : updateProductDto.categoryId,
      updateProductDto.subCategoryId === undefined ? product.subCategoryId : updateProductDto.subCategoryId,
    );
    if (updateProductDto.productType) {
      const allowedTypes = productTypesForCategory(product.merchant?.category?.slug);
      if (!allowedTypes.includes(updateProductDto.productType)) {
        throw new BadRequestException(
          `${updateProductDto.productType} is not available for ${product.merchant?.category?.name || 'this merchant category'}`,
        );
      }
    }

    const { options, variants, quantity: _legacyQuantity, lowStockThreshold: _legacyThreshold, ...input } = updateProductDto;
    const data: any = { ...input };
    if (input.sellingPrice !== undefined || input.price !== undefined) {
      data.sellingPrice = Number(input.sellingPrice ?? input.price);
      data.price = data.sellingPrice;
    }
    if (input.baseSku !== undefined || input.sku !== undefined || input.productCode !== undefined) {
      data.baseSku = input.baseSku || input.sku || input.productCode || null;
      data.sku = data.baseSku;
      data.productCode = input.productCode || data.baseSku;
    }
    if (input.availabilityStatus !== undefined) data.isAvailable = input.availabilityStatus === 'Available';
    const updated = await this.prisma.product.update({
      where: { id },
      data,
    });
    if (options !== undefined || variants !== undefined) {
      await this.replaceVariants(id, options || [], variants || []);
    }
    return this.findOne(updated.id, merchantId);
  }

  private async replaceVariants(productId: number, options: any[], variants: any[]) {
    await this.prisma.$transaction(async tx => {
      const existingVariants = await tx.productVariant.findMany({ where: { productId }, select: { id: true, sku: true } });
      const requestedSkus = new Set(variants.map(variant => variant.sku.trim()));
      const removedIds = existingVariants.filter(variant => !requestedSkus.has(variant.sku)).map(variant => variant.id);
      if (removedIds.length) {
        const used = await tx.shopInventory.count({ where: { variantId: { in: removedIds } } });
        if (used) throw new BadRequestException('A variant with shop inventory cannot be removed; deactivate it instead');
        await tx.productVariant.deleteMany({ where: { id: { in: removedIds } } });
      }
      await tx.productOption.deleteMany({ where: { productId } });
      const valueIds = new Map<string, number>();
      for (let optionPosition = 0; optionPosition < options.length; optionPosition++) {
        const option = options[optionPosition];
        const createdOption = await tx.productOption.create({
          data: { productId, name: option.name.trim(), position: optionPosition },
        });
        for (let valuePosition = 0; valuePosition < option.values.length; valuePosition++) {
          const value = String(option.values[valuePosition]).trim();
          if (!value) continue;
          const createdValue = await tx.productOptionValue.create({
            data: { optionId: createdOption.id, value, position: valuePosition },
          });
          valueIds.set(`${option.name}:${value}`, createdValue.id);
        }
      }
      const activeVariantIds: number[] = [];
      for (const variant of variants) {
        const current = existingVariants.find(item => item.sku === variant.sku.trim());
        const variantData = {
            productId,
            sku: variant.sku.trim(),
            barcode: variant.barcode || null,
            price: variant.price ?? null,
            imageUrl: variant.imageUrl || null,
            isActive: variant.isActive ?? true,
        };
        const createdVariant = current
          ? await tx.productVariant.update({ where: { id: current.id }, data: variantData })
          : await tx.productVariant.create({ data: variantData });
        activeVariantIds.push(createdVariant.id);
        const ids = Object.entries(variant.optionValues || {})
          .map(([name, value]) => valueIds.get(`${name}:${value}`))
          .filter((value): value is number => value !== undefined);
        if (ids.length) await tx.productVariantOptionValue.createMany({
          data: ids.map(optionValueId => ({ variantId: createdVariant.id, optionValueId })),
          skipDuplicates: true,
        });
      }
      const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { trackInventory: true, hasVariants: true } });
      if (product.trackInventory) {
        const shops = await tx.shopProduct.findMany({ where: { productId }, select: { merchantId: true, shopId: true } });
        const inventoryVariantIds: Array<number | null> = product.hasVariants ? activeVariantIds : [null];
        for (const shop of shops) for (const variantId of inventoryVariantIds) {
          const existing = await tx.shopInventory.findFirst({ where: { shopId: shop.shopId, productId, variantId } });
          if (!existing) await tx.shopInventory.create({ data: { merchantId: shop.merchantId, shopId: shop.shopId, productId, variantId } });
        }
      }
    });
  }

  async findLowStock(merchantId: number, shopId: number) {
    const balances = await this.prisma.shopInventory.findMany({
      where: { merchantId, shopId },
      include: { product: true, variant: true },
      orderBy: { quantity: 'asc' },
    });
    return balances.filter(balance => balance.quantity - balance.reservedQuantity <= balance.reorderLevel);
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
