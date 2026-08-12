import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ShopInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async assertShop(merchantId: number, shopId: number) {
    const shop = await this.prisma.branch.findFirst({ where: { id: shopId, merchantId } });
    if (!shop) throw new ForbiddenException('Shop does not belong to this merchant');
    return shop;
  }

  private async assertDigitalMenuAccess(merchantId: number) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { subscriptionTier: true } });
    if (merchant?.subscriptionTier.toLowerCase() !== 'platinum') throw new ForbiddenException('The In-store Digital Menu requires the Platinum merchant tier');
  }

  private async assertProduct(merchantId: number, productId: number, variantId?: number | null) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, merchantId },
      include: { variants: { where: variantId == null ? { id: -1 } : { id: variantId } } },
    });
    if (!product) throw new NotFoundException('Product not found in the merchant catalogue');
    if (variantId != null && !product.variants.length) throw new BadRequestException('Variant does not belong to this product');
    if (product.hasVariants && variantId == null) throw new BadRequestException('variantId is required for products with variants');
    if (!product.hasVariants && variantId != null) throw new BadRequestException('variantId is not valid for a standard product');
    return product;
  }

  async list(merchantId: number, shopId: number) {
    await this.assertShop(merchantId, shopId);
    const assignments = await this.prisma.shopProduct.findMany({
      where: { merchantId, shopId, product: { trackInventory: true } },
      include: {
        product: {
          include: {
            category: true,
            subCategory: true,
            variants: { include: { optionValues: { include: { optionValue: { include: { option: true } } } } } },
          },
        },
      },
      orderBy: { product: { name: 'asc' } },
    });
    const balances = await this.prisma.shopInventory.findMany({ where: { merchantId, shopId } });
    const byProduct = new Map<number, typeof balances>();
    for (const balance of balances) byProduct.set(balance.productId, [...(byProduct.get(balance.productId) || []), balance]);
    return assignments.map(assignment => ({
      ...assignment,
      effectivePrice: assignment.priceOverride ?? assignment.product.discountPrice ?? assignment.product.sellingPrice ?? assignment.product.price,
      inventory: (byProduct.get(assignment.productId) || []).map(balance => ({
        ...balance,
        availableQuantity: Math.max(0, balance.quantity - balance.reservedQuantity),
        stockStatus: balance.quantity - balance.reservedQuantity <= 0 ? 'Out of Stock' : balance.quantity - balance.reservedQuantity <= balance.reorderLevel ? 'Low Stock' : 'In Stock',
      })),
    }));
  }

  async merchantSummary(merchantId: number) {
    const [shops, balances] = await Promise.all([
      this.prisma.branch.findMany({ where: { merchantId }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
      this.prisma.shopInventory.findMany({
        where: { merchantId },
        include: {
          product: { include: { category: true, variants: { include: { optionValues: { include: { optionValue: true } } } } } },
        },
        orderBy: [{ shopId: 'asc' }, { product: { name: 'asc' } }],
      }),
    ]);
    const rows = balances.map(balance => {
      const availableQuantity = Math.max(0, balance.quantity - balance.reservedQuantity);
      const stockStatus = availableQuantity <= 0 ? 'Out of Stock' : availableQuantity <= balance.reorderLevel ? 'Low Stock' : 'In Stock';
      const variant = balance.variantId ? balance.product.variants.find(item => item.id === balance.variantId) : null;
      return {
        id: balance.id, shopId: balance.shopId, productId: balance.productId, variantId: balance.variantId,
        productName: balance.product.name,
        variantName: variant?.optionValues.map(link => link.optionValue.value).join(' / ') || (variant ? variant.sku : 'Standard'),
        sku: variant?.sku || balance.product.baseSku || balance.product.sku,
        unit: balance.product.unit,
        categoryName: balance.product.category?.name,
        quantity: balance.quantity, reservedQuantity: balance.reservedQuantity, availableQuantity,
        reorderLevel: balance.reorderLevel, stockStatus,
        unitCost: Number(balance.product.costPrice || 0), inventoryValue: balance.quantity * Number(balance.product.costPrice || 0),
      };
    });
    const shopSummaries = shops.map(shop => {
      const inventory = rows.filter(row => row.shopId === shop.id);
      return {
        id: shop.id, name: shop.name, shopId: shop.shopId, isActive: shop.isActive, isDefault: shop.isDefault,
        itemCount: inventory.length, totalQuantity: inventory.reduce((sum, row) => sum + row.quantity, 0),
        inventoryValue: inventory.reduce((sum, row) => sum + row.inventoryValue, 0),
        lowStockCount: inventory.filter(row => row.stockStatus === 'Low Stock').length,
        outOfStockCount: inventory.filter(row => row.stockStatus === 'Out of Stock').length,
        inventory,
      };
    });
    return {
      totals: {
        shops: shopSummaries.length, items: rows.length,
        quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
        reserved: rows.reduce((sum, row) => sum + row.reservedQuantity, 0),
        available: rows.reduce((sum, row) => sum + row.availableQuantity, 0),
        inventoryValue: rows.reduce((sum, row) => sum + row.inventoryValue, 0),
        lowStockItems: rows.filter(row => row.stockStatus === 'Low Stock').length,
        outOfStockItems: rows.filter(row => row.stockStatus === 'Out of Stock').length,
        shopsNeedingRestock: shopSummaries.filter(shop => shop.lowStockCount + shop.outOfStockCount > 0).length,
      },
      shops: shopSummaries,
    };
  }

  async shopProducts(merchantId: number, shopId: number) {
    await this.assertShop(merchantId, shopId);
    const [products, assignments] = await Promise.all([
      this.prisma.product.findMany({ where: { merchantId }, include: { category: true, variants: true }, orderBy: { name: 'asc' } }),
      this.prisma.shopProduct.findMany({ where: { merchantId, shopId } }),
    ]);
    const byProduct = new Map(assignments.map(assignment => [assignment.productId, assignment]));
    return products.map(product => ({ product, assignment: byProduct.get(product.id) || null }));
  }

  async digitalMenu(merchantId: number, shopId: number) {
    await this.assertDigitalMenuAccess(merchantId);
    const shop = await this.assertShop(merchantId, shopId);
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { name: true, slug: true } });
    const assignments = await this.prisma.shopProduct.findMany({
      where: { merchantId, shopId },
      include: {
        product: { include: { category: true, subCategory: true, variants: { where: { isActive: true }, include: { optionValues: { include: { optionValue: true } } } } } },
      },
      orderBy: [{ menuCategoryOrder: 'asc' }, { menuDisplayOrder: 'asc' }, { product: { name: 'asc' } }],
    });
    const balances = await this.prisma.shopInventory.findMany({ where: { merchantId, shopId } });
    const availability = new Map<number, number>();
    for (const balance of balances) availability.set(balance.productId, (availability.get(balance.productId) || 0) + Math.max(0, balance.quantity - balance.reservedQuantity));
    return {
      merchant, shop: { id: shop.id, name: shop.name, isDefault: shop.isDefault },
      items: assignments.map(assignment => ({
        ...assignment,
        effectivePrice: assignment.priceOverride ?? assignment.product.discountPrice ?? assignment.product.sellingPrice ?? assignment.product.price,
        availableQuantity: availability.get(assignment.productId) ?? null,
        soldOut: assignment.product.trackInventory ? (availability.get(assignment.productId) || 0) <= 0 : assignment.product.availabilityStatus !== 'Available',
      })),
    };
  }

  async updateDigitalMenuItem(merchantId: number, shopId: number, productId: number, input: any) {
    await this.assertDigitalMenuAccess(merchantId);
    await this.assertShop(merchantId, shopId);
    const product = await this.prisma.product.findFirst({ where: { id: productId, merchantId }, select: { id: true, category: { select: { name: true } } } });
    if (!product) throw new NotFoundException('Product not found in the merchant catalogue');
    const badge = input.menuBadge ? String(input.menuBadge).toUpperCase() : null;
    if (badge && !['BESTSELLER', 'NEW', 'PROMO', 'FEATURED'].includes(badge)) throw new BadRequestException('Choose a valid menu badge');
    const existing = await this.prisma.shopProduct.findUnique({ where: { shopId_productId: { shopId, productId } } });
    const data = {
      isOnMenu: input.isOnMenu === undefined ? true : Boolean(input.isOnMenu),
      menuVisible: input.menuVisible === undefined ? (existing?.menuVisible ?? true) : Boolean(input.menuVisible),
      menuDescription: input.menuDescription === undefined ? existing?.menuDescription : String(input.menuDescription).trim().slice(0, 300) || null,
      menuBadge: input.menuBadge === undefined ? existing?.menuBadge : badge,
      menuFeatured: input.menuFeatured === undefined ? existing?.menuFeatured : Boolean(input.menuFeatured),
      menuCategory: input.menuCategory === undefined ? existing?.menuCategory : String(input.menuCategory).trim().slice(0, 120) || product.category?.name || 'Menu',
      menuDisplayOrder: input.menuDisplayOrder === undefined ? (existing?.menuDisplayOrder ?? 0) : Math.max(0, Number(input.menuDisplayOrder) || 0),
      menuCategoryOrder: input.menuCategoryOrder === undefined ? (existing?.menuCategoryOrder ?? 0) : Math.max(0, Number(input.menuCategoryOrder) || 0),
    };
    return this.prisma.shopProduct.upsert({
      where: { shopId_productId: { shopId, productId } },
      create: { merchantId, shopId, productId, isEnabled: true, ...data }, update: data,
    });
  }

  async reorderDigitalMenu(merchantId: number, shopId: number, input: any) {
    await this.assertDigitalMenuAccess(merchantId);
    await this.assertShop(merchantId, shopId);
    if (!Array.isArray(input.items)) throw new BadRequestException('Menu item order is required');
    const productIds = input.items.map((item: any) => Number(item.productId));
    if (new Set(productIds).size !== productIds.length) throw new BadRequestException('Menu item order contains duplicates');
    const owned = await this.prisma.shopProduct.count({ where: { merchantId, shopId, productId: { in: productIds }, isOnMenu: true } });
    if (owned !== productIds.length) throw new ForbiddenException('Every reordered item must belong to this shop menu');
    await this.prisma.$transaction(input.items.map((item: any) => this.prisma.shopProduct.update({
      where: { shopId_productId: { shopId, productId: Number(item.productId) } },
      data: { menuCategory: String(item.menuCategory || 'Menu').trim().slice(0, 120), menuCategoryOrder: Math.max(0, Number(item.menuCategoryOrder) || 0), menuDisplayOrder: Math.max(0, Number(item.menuDisplayOrder) || 0) },
    })));
    return { updated: productIds.length };
  }

  async assign(merchantId: number, shopId: number, productId: number, isEnabled: boolean, priceOverride?: number | null) {
    await this.assertShop(merchantId, shopId);
    // A shop assignment enables the complete product and all its variants.
    // Variant selection is required only for variant-level stock operations.
    const product = await this.prisma.product.findFirst({ where: { id: productId, merchantId } });
    if (!product) throw new NotFoundException('Product not found in the merchant catalogue');
    const assignment = await this.prisma.shopProduct.upsert({
      where: { shopId_productId: { shopId, productId } },
      create: { merchantId, shopId, productId, isEnabled, priceOverride },
      update: { isEnabled, priceOverride },
    });
    if (product.trackInventory) {
      const variantIds = product.hasVariants
        ? (await this.prisma.productVariant.findMany({ where: { productId }, select: { id: true } })).map(item => item.id)
        : [null];
      for (const variantId of variantIds) await this.ensureBalance(merchantId, shopId, productId, variantId);
    }
    return assignment;
  }

  private async ensureBalance(merchantId: number, shopId: number, productId: number, variantId?: number | null, tx: any = this.prisma) {
    const existing = await tx.shopInventory.findFirst({ where: { merchantId, shopId, productId, variantId: variantId ?? null } });
    return existing || tx.shopInventory.create({ data: { merchantId, shopId, productId, variantId: variantId ?? null } });
  }

  async setReorderLevel(merchantId: number, shopId: number, input: { productId: number; variantId?: number | null; reorderLevel: number }) {
    await this.assertShop(merchantId, shopId);
    await this.assertProduct(merchantId, input.productId, input.variantId);
    const balance = await this.ensureBalance(merchantId, shopId, input.productId, input.variantId);
    return this.prisma.shopInventory.update({ where: { id: balance.id }, data: { reorderLevel: input.reorderLevel } });
  }

  async move(merchantId: number, shopId: number, input: { productId: number; variantId?: number | null; type: string; quantity: number; reference?: string; notes?: string; reason?: string; unitCost?: number; referenceType?: string; referenceId?: string; deliveryDate?: string; deliveredBy?: string; receivedAt?: string }, createdBy?: string) {
    await this.assertShop(merchantId, shopId);
    if (input.type === 'receipt' && !input.reference?.trim()) throw new BadRequestException('DR reference is required when receiving inventory');
    const product = await this.assertProduct(merchantId, input.productId, input.variantId);
    if (!product.trackInventory) throw new BadRequestException('Inventory tracking is disabled for this product');
    const assignment = await this.prisma.shopProduct.findUnique({ where: { shopId_productId: { shopId, productId: input.productId } } });
    if (!assignment) throw new BadRequestException('Assign this product to the shop before recording inventory');
    const delta = input.type === 'sale' ? -Math.abs(input.quantity) : input.type === 'adjustment' ? input.quantity : Math.abs(input.quantity);
    if (delta === 0) throw new BadRequestException('Quantity change cannot be zero');
    return this.prisma.$transaction(async tx => {
      const balance = await this.ensureBalance(merchantId, shopId, input.productId, input.variantId, tx);
      const next = balance.quantity + delta;
      if (next < balance.reservedQuantity) throw new BadRequestException('Adjustment would reduce stock below the reserved quantity');
      const updated = await tx.shopInventory.update({ where: { id: balance.id }, data: { quantity: next } });
      const movement = await tx.inventoryMovement.create({ data: { merchantId, shopId, productId: input.productId, variantId: input.variantId ?? null, type: input.type, quantityChange: delta, balanceAfter: next, reference: input.reference?.trim(), referenceType: input.referenceType, referenceId: input.referenceId, reason: input.reason, unitCost: input.unitCost, deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : null, deliveredBy: input.deliveredBy?.trim().slice(0, 150) || null, receivedAt: input.receivedAt ? new Date(input.receivedAt) : null, createdBy, notes: input.notes } });
      return { balance: updated, movement };
    });
  }

  async transfer(merchantId: number, sourceShopId: number, input: { destinationShopId: number; productId: number; variantId?: number | null; quantity: number; reference?: string; notes?: string }, createdBy?: string) {
    if (sourceShopId === input.destinationShopId) throw new BadRequestException('Source and destination shops must be different');
    await Promise.all([this.assertShop(merchantId, sourceShopId), this.assertShop(merchantId, input.destinationShopId)]);
    const product = await this.assertProduct(merchantId, input.productId, input.variantId);
    if (!product.trackInventory) throw new BadRequestException('Inventory tracking is disabled for this product');
    const assignments = await this.prisma.shopProduct.count({ where: { productId: input.productId, shopId: { in: [sourceShopId, input.destinationShopId] } } });
    if (assignments !== 2) throw new BadRequestException('The product must be assigned to both shops before it can be transferred');
    return this.prisma.$transaction(async tx => {
      const source = await this.ensureBalance(merchantId, sourceShopId, input.productId, input.variantId, tx);
      if (source.quantity - source.reservedQuantity < input.quantity) throw new BadRequestException('Insufficient available stock in the source shop');
      const destination = await this.ensureBalance(merchantId, input.destinationShopId, input.productId, input.variantId, tx);
      const sourceAfter = source.quantity - input.quantity;
      const destinationAfter = destination.quantity + input.quantity;
      await tx.shopInventory.update({ where: { id: source.id }, data: { quantity: sourceAfter } });
      await tx.shopInventory.update({ where: { id: destination.id }, data: { quantity: destinationAfter } });
      await tx.inventoryMovement.createMany({ data: [
        { merchantId, shopId: sourceShopId, productId: input.productId, variantId: input.variantId ?? null, type: 'transfer_out', quantityChange: -input.quantity, balanceAfter: sourceAfter, transferShopId: input.destinationShopId, reference: input.reference, createdBy, notes: input.notes },
        { merchantId, shopId: input.destinationShopId, productId: input.productId, variantId: input.variantId ?? null, type: 'transfer_in', quantityChange: input.quantity, balanceAfter: destinationAfter, transferShopId: sourceShopId, reference: input.reference, createdBy, notes: input.notes },
      ] });
      return { sourceBalance: sourceAfter, destinationBalance: destinationAfter };
    });
  }

  async transferDestinations(merchantId: number, sourceShopId: number) {
    await this.assertShop(merchantId, sourceShopId);
    return this.prisma.branch.findMany({ where: { merchantId, id: { not: sourceShopId }, isActive: true }, select: { id: true, name: true, city: true }, orderBy: { name: 'asc' } });
  }

  async closeDay(merchantId: number, shopId: number, input: { productId: number; variantId?: number | null; businessDate: string; endingBalance: number; notes?: string }, countedBy?: string) {
    await this.assertShop(merchantId, shopId);
    await this.assertProduct(merchantId, input.productId, input.variantId);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.businessDate) ? input.businessDate : '';
    if (!date) throw new BadRequestException('Choose a valid business date');
    const start = new Date(`${date}T00:00:00+08:00`), end = new Date(new Date(`${date}T00:00:00+08:00`).getTime() + 86_400_000);
    const balance = await this.ensureBalance(merchantId, shopId, input.productId, input.variantId);
    const movements = await this.prisma.inventoryMovement.aggregate({ where: { merchantId, shopId, productId: input.productId, variantId: input.variantId ?? null, createdAt: { gte: start, lt: end } }, _sum: { quantityChange: true } });
    const expectedEnding = balance.quantity;
    const beginningBalance = expectedEnding - Number(movements._sum.quantityChange || 0);
    const variance = input.endingBalance - expectedEnding;
    return this.prisma.$transaction(async tx => {
      const count = await tx.inventoryDailyCount.upsert({
        where: { shopId_productId_variantKey_businessDate: { shopId, productId: input.productId, variantKey: input.variantId ?? 0, businessDate: new Date(`${date}T00:00:00Z`) } },
        create: { merchantId, shopId, productId: input.productId, variantId: input.variantId ?? null, variantKey: input.variantId ?? 0, businessDate: new Date(`${date}T00:00:00Z`), beginningBalance, expectedEnding, endingBalance: input.endingBalance, variance, countedBy, notes: input.notes?.trim() || null },
        update: { beginningBalance, expectedEnding, endingBalance: input.endingBalance, variance, countedBy, notes: input.notes?.trim() || null },
      });
      if (variance) {
        await tx.shopInventory.update({ where: { id: balance.id }, data: { quantity: input.endingBalance } });
        await tx.inventoryMovement.create({ data: { merchantId, shopId, productId: input.productId, variantId: input.variantId ?? null, type: 'adjustment', quantityChange: variance, balanceAfter: input.endingBalance, reference: `EOD-${date}`, referenceType: 'daily_count', referenceId: String(count.id), reason: 'Physical Count', createdBy: countedBy, notes: input.notes?.trim() || null } });
      }
      return count;
    });
  }

  async dailyCounts(merchantId: number, shopId: number) {
    await this.assertShop(merchantId, shopId);
    return this.prisma.inventoryDailyCount.findMany({ where: { merchantId, shopId }, include: { product: { select: { name: true } }, variant: { include: { optionValues: { include: { optionValue: true } } } } }, orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }], take: 500 });
  }

  async movements(merchantId: number, shopId: number, productId?: number) {
    await this.assertShop(merchantId, shopId);
    const movements = await this.prisma.inventoryMovement.findMany({ where: { merchantId, shopId, ...(productId ? { productId } : {}) }, include: { product: true, variant: { include: { optionValues: { include: { optionValue: { include: { option: true } } } } } } }, orderBy: { createdAt: 'desc' }, take: 500 });
    const userIds = [...new Set(movements.flatMap(movement => movement.createdBy ? [movement.createdBy] : []))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [];
    const byId = new Map(users.map(user => [user.id, user]));
    return movements.map(movement => ({ ...movement, createdByUser: movement.createdBy ? byId.get(movement.createdBy) || null : null }));
  }
}
