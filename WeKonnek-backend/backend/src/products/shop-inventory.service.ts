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

  async shopProducts(merchantId: number, shopId: number) {
    await this.assertShop(merchantId, shopId);
    const [products, assignments] = await Promise.all([
      this.prisma.product.findMany({ where: { merchantId }, include: { category: true, variants: true }, orderBy: { name: 'asc' } }),
      this.prisma.shopProduct.findMany({ where: { merchantId, shopId } }),
    ]);
    const byProduct = new Map(assignments.map(assignment => [assignment.productId, assignment]));
    return products.map(product => ({ product, assignment: byProduct.get(product.id) || null }));
  }

  async assign(merchantId: number, shopId: number, productId: number, isEnabled: boolean, priceOverride?: number | null) {
    await this.assertShop(merchantId, shopId);
    const product = await this.assertProduct(merchantId, productId);
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

  async move(merchantId: number, shopId: number, input: { productId: number; variantId?: number | null; type: string; quantity: number; reference?: string; notes?: string; reason?: string; unitCost?: number; referenceType?: string; referenceId?: string }, createdBy?: string) {
    await this.assertShop(merchantId, shopId);
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
      const movement = await tx.inventoryMovement.create({ data: { merchantId, shopId, productId: input.productId, variantId: input.variantId ?? null, type: input.type, quantityChange: delta, balanceAfter: next, reference: input.reference, referenceType: input.referenceType, referenceId: input.referenceId, reason: input.reason, unitCost: input.unitCost, createdBy, notes: input.notes } });
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

  async movements(merchantId: number, shopId: number, productId?: number) {
    await this.assertShop(merchantId, shopId);
    const movements = await this.prisma.inventoryMovement.findMany({ where: { merchantId, shopId, ...(productId ? { productId } : {}) }, include: { product: true, variant: { include: { optionValues: { include: { optionValue: { include: { option: true } } } } } } }, orderBy: { createdAt: 'desc' }, take: 500 });
    const userIds = [...new Set(movements.flatMap(movement => movement.createdBy ? [movement.createdBy] : []))];
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [];
    const byId = new Map(users.map(user => [user.id, user]));
    return movements.map(movement => ({ ...movement, createdByUser: movement.createdBy ? byId.get(movement.createdBy) || null : null }));
  }
}
