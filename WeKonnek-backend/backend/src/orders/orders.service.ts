import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentGatewayService,
} from '../modules/wallet/payment-gateway.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { VouchersService } from '../modules/vouchers/vouchers.service';
import { InvoicesService } from '../modules/invoices/invoices.service';
import { DineInSyncService } from '../dine-in-crew/dine-in-sync.service';
import { WalletPaymentGateway, NotificationType } from '@prisma/client';
import { CoordinatorApplicationsService } from '../coordinator-applications/coordinator-applications.service';
import { merchantOrderNotificationUrl } from '../modules/notifications/notification-routes';

interface OrderItemInput {
  product_id?: number;
  productId?: number;
  product_name?: string;
  productName?: string;
  variant_id?: number;
  variantId?: number;
  quantity: number;
  price: number;
  subtotal?: number;
}

interface CreateOrderInput {
  merchant_id?: number;
  merchantId?: number;
  shop_id?: number;
  shopId?: number;
  order_type?: string;
  orderType?: string;
  total_amount?: number;
  totalAmount?: number;
  delivery_address?: string;
  delivery_fee?: number;
  delivery_zone_name?: string;
  customer_barangay?: string;
  table_number?: string;
  notes?: string;
  payment_method?: string;
  gateway?: string;
  items: OrderItemInput[];
}

export type CrewOrderInput = CreateOrderInput;

/** Online payment methods that require a gateway checkout. */
const ONLINE_METHODS = new Set(['gcash', 'grab_pay', 'card', 'maya', 'xendit']);

function serializeOrder(order: any) {
  if (!order) return order;
  const items = (order.orderItems || []).map((it: any) => ({
    id: it.id,
    order_id: it.orderId,
    orderId: it.orderId,
    product_id: it.productId,
    productId: it.productId,
    variant_id: it.variantId,
    variantId: it.variantId,
    variant_name: it.variant?.optionValues?.map((link: any) => link.optionValue?.value).filter(Boolean).join(' / ') || null,
    variantName: it.variant?.optionValues?.map((link: any) => link.optionValue?.value).filter(Boolean).join(' / ') || null,
    image_url: it.variant?.imageUrl || it.product?.imageUrl || null,
    imageUrl: it.variant?.imageUrl || it.product?.imageUrl || null,
    product_name: it.productName,
    productName: it.productName,
    quantity: it.quantity,
    price: it.price,
    subtotal: it.subtotal,
    status: it.status,
  }));
  const merchant = order.merchant
    ? {
        ...order.merchant,
        is_active: order.merchant.isActive,
        category_id: order.merchant.categoryId,
        logo_url: order.merchant.logoUrl,
      }
    : undefined;
  const serviceRequests = (order.serviceRequests || []).map((request: any) => ({
    id: request.id, order_id: request.orderId, type: request.type, details: request.details,
    status: request.status, assigned_staff_id: request.assignedStaffId,
    assigned_staff_name: request.assignedStaff?.displayName || null,
    assigned_at: request.assignedAt, completed_at: request.completedAt, created_at: request.createdAt,
  }));
  return {
    id: order.id,
    order_code: order.orderCode,
    orderCode: order.orderCode,
    user_id: order.userId,
    userId: order.userId,
    merchant_id: order.merchantId,
    merchantId: order.merchantId,
    shop_id: order.shopId,
    shopId: order.shopId,
    status: order.status,
    order_type: order.orderType,
    orderType: order.orderType,
    total_amount: order.totalAmount,
    totalAmount: order.totalAmount,
    delivery_address: order.deliveryAddress,
    delivery_fee: order.deliveryFee,
    delivery_zone_name: order.deliveryZoneName,
    customer_barangay: order.customerBarangay,
    table_number: order.tableNumber,
    notes: order.notes,
    payment_method: order.paymentMethod,
    payment_status: order.paymentStatus,
    payment_ref: order.paymentRef,
    payment_url: order.paymentUrl,
    discount_type: order.discountType,
    discount_amount: order.discountAmount,
    discount_details: order.discountDetails,
    voucher_id: order.voucherId,
    created_at: order.createdAt,
    createdAt: order.createdAt,
    updated_at: order.updatedAt,
    // Nested relations, exposed under both names the frontend looks for
    merchant,
    merchants: merchant,
    order_items: items,
    orderItems: items,
    items,
    service_requests: serviceRequests,
    serviceRequests,
    customer: order.user
      ? {
          id: order.user.id,
          first_name: order.user.firstName,
          last_name: order.user.lastName,
          phone: order.user.phone,
          email: order.user.email,
        }
      : undefined,
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGateway: PaymentGatewayService,
    private readonly notifications: NotificationsService,
    private readonly vouchers: VouchersService,
    private readonly invoices: InvoicesService,
    private readonly dineInSync: DineInSyncService,
    private readonly coordinatorApplications: CoordinatorApplicationsService,
  ) {}

  private generateOrderCode(): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rand = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0');
    return `WK-${ts}-${rand}`;
  }

  async create(userId: string, input: CreateOrderInput) {
    const merchantId = input.merchant_id ?? input.merchantId;
    if (!merchantId) {
      throw new BadRequestException('merchant_id is required');
    }
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new BadRequestException('At least one order item is required');
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: Number(merchantId) },
    });
    if (!merchant) {
      throw new NotFoundException('Merchant not found');
    }
    const requestedShopId = input.shop_id ?? input.shopId;
    if (!requestedShopId) throw new BadRequestException('shop_id is required so availability and inventory are scoped to a shop');
    const shop = await this.prisma.branch.findFirst({ where: { id: Number(requestedShopId), merchantId: Number(merchantId), isActive: true } });
    if (!shop) throw new BadRequestException('The selected shop is unavailable');

    const items = await Promise.all(input.items.map(async (it) => {
      const quantity = Number(it.quantity) || 1;
      const productId = it.product_id ?? it.productId ?? null;
      const variantId = it.variant_id ?? it.variantId ?? null;
      const product = productId ? await this.prisma.product.findFirst({
        where: { id: Number(productId), merchantId: Number(merchantId) },
        include: { variants: { where: { id: variantId ? Number(variantId) : -1, isActive: true } } },
      }) : null;
      if (productId && !product) throw new BadRequestException('A selected product is unavailable');
      if (product?.hasVariants && !variantId) throw new BadRequestException(`Select a variant for ${product.name}`);
      const variant = variantId ? product?.variants?.[0] : undefined;
      if (variantId && !variant) throw new BadRequestException(`The selected variant for ${product?.name || 'this product'} is unavailable`);
      const price = product
        ? Number(variant?.price ?? product.discountPrice ?? product.sellingPrice ?? product.price)
        : Number(it.price) || 0;
      const subtotal = price * quantity;
      return {
        productId,
        productName: product?.name ?? it.product_name ?? it.productName ?? 'Item',
        variantId,
        quantity,
        price,
        subtotal,
      };
    }));

    const itemsSubtotal = items.reduce((s, it) => s + it.subtotal, 0);
    const deliveryFee = Number(input.delivery_fee) || 0;
    const totalAmount =
      input.total_amount != null
        ? Number(input.total_amount)
        : itemsSubtotal + deliveryFee;

    const paymentMethod = (input.payment_method || 'cod').toLowerCase();
    const isOnline = ONLINE_METHODS.has(paymentMethod);
    const orderType = input.order_type ?? input.orderType ?? 'delivery';

    const created = await this.prisma.wkOrder.create({
      data: {
        orderCode: this.generateOrderCode(),
        userId,
        merchantId: Number(merchantId),
        shopId: shop.id,
        status: 'pending',
        orderType,
        totalAmount,
        deliveryAddress: input.delivery_address ?? null,
        deliveryFee,
        deliveryZoneName: input.delivery_zone_name ?? null,
        customerBarangay: input.customer_barangay ?? null,
        tableNumber: input.table_number ?? null,
        notes: input.notes ?? null,
        paymentMethod,
        paymentStatus: 'pending',
        orderItems: {
          create: items.map((it) => ({
            productId: it.productId,
            productName: it.productName,
            variantId: it.variantId,
            quantity: it.quantity,
            price: it.price,
            subtotal: it.subtotal,
            status: ['dine_in', 'in_store'].includes(orderType) ? 'preparing' : null,
          })),
        },
      },
      include: {
        orderItems: true,
        serviceRequests: { include: { assignedStaff: true }, orderBy: { createdAt: 'desc' } },
        merchant: { include: { category: true } },
      },
    });

    // Sales affect only the selected shop and variant. A tracked product can
    // never fall back to the legacy merchant-wide Product.quantity field.
    try {
      const tracked = items.filter(
        (it): it is typeof it & { productId: number } => it.productId != null,
      );

      if (tracked.length > 0) {
        const ids = tracked.map((it) => it.productId);
        const products = await this.prisma.product.findMany({ where: { id: { in: ids }, merchantId: Number(merchantId) } });
        const byId = new Map(products.map(product => [product.id, product]));
        const assignments = await this.prisma.shopProduct.findMany({ where: { shopId: shop.id, productId: { in: ids }, isEnabled: true } });
        const assignedIds = new Set(assignments.map(assignment => assignment.productId));
        await this.prisma.$transaction(async tx => {
          for (const item of tracked) {
            const product = byId.get(item.productId);
            if (!product || !assignedIds.has(item.productId)) throw new BadRequestException(`${item.productName} is not sold by the selected shop`);
            if (!product.trackInventory) continue;
            if (product.hasVariants && item.variantId == null) throw new BadRequestException(`Select a variant for ${item.productName}`);
            const balance = await tx.shopInventory.findFirst({ where: { merchantId: Number(merchantId), shopId: shop.id, productId: item.productId, variantId: item.variantId } });
            if (!balance) throw new BadRequestException(`${item.productName} is out of stock at the selected shop`);
            if (balance.quantity - balance.reservedQuantity < item.quantity) throw new BadRequestException(`${item.productName} is out of stock at the selected shop`);
            const changed = await tx.shopInventory.updateMany({ where: { id: balance.id, reservedQuantity: balance.reservedQuantity }, data: { reservedQuantity: { increment: item.quantity } } });
            if (changed.count !== 1) throw new BadRequestException(`${item.productName} is out of stock at the selected shop`);
            const updated = await tx.shopInventory.findUniqueOrThrow({ where: { id: balance.id } });
            await tx.inventoryMovement.create({ data: { merchantId: Number(merchantId), shopId: shop.id, productId: item.productId, variantId: item.variantId, type: 'reservation', quantityChange: item.quantity, balanceAfter: updated.quantity, reference: created.orderCode, referenceType: 'order', referenceId: String(created.id), createdBy: userId } });
          }
        });

        const ownerUserId = merchant.userId;
        if (ownerUserId) {
          const low = await this.prisma.shopInventory.findMany({ where: { merchantId: Number(merchantId), shopId: shop.id, productId: { in: ids } }, include: { product: true } });
          for (const balance of low.filter(item => item.quantity - item.reservedQuantity <= item.reorderLevel)) {
            const available = balance.quantity - balance.reservedQuantity;
            await this.notifications.notify({ userId: ownerUserId, title: available === 0 ? 'Out of stock' : 'Low stock alert', body: `${balance.product.name} has ${available} available at ${shop.name}.`, type: NotificationType.inventory_alert, data: { kind: available === 0 ? 'out_of_stock' : 'low_stock', productId: String(balance.productId), shopId: String(shop.id) } }).catch(() => undefined);
          }
        }
      }
    } catch (error) {
      await this.prisma.wkOrder.delete({ where: { id: created.id } }).catch(() => undefined);
      throw error;
    }

    // Notify the merchant of the incoming order (best-effort).
    try {
      if (merchant.userId) {
        const itemCount = items.reduce((n, it) => n + it.quantity, 0);
        await this.notifications
          .notify({
            userId: merchant.userId,
            title: 'New order received',
            body: `Order ${created.orderCode} • ${itemCount} item${itemCount !== 1 ? 's' : ''} • ₱${totalAmount.toFixed(2)}`,
            type: NotificationType.order_update,
            data: {
              kind: 'new_order',
              orderId: String(created.id),
              orderCode: created.orderCode,
              shopId: String(shop.id),
              orderType: created.orderType,
              url: merchantOrderNotificationUrl({ orderId: created.id, shopId: shop.id, orderType: created.orderType }),
            },
            orderId: String(created.id),
          })
          .catch(() => undefined);
      }
    } catch {
      // swallow — merchant alerts are non-critical to order creation
    }
    // Publish every order type to the branch's operational stream. The shop
    // counter uses this for live delivery/pickup badges as well as dine-in.
    await this.dineInSync.recordOrder(created.id, 'ORDER_CREATED');

    // Online payment → create a gateway checkout and attach the redirect URL.
    if (isOnline) {
      try {
        const gateway = this.resolveGateway(input.gateway, paymentMethod);
        const appUrl = process.env.APP_BASE_URL || 'http://localhost:3001';
        const result = await this.paymentGateway.createPayment({
          gateway,
          amount: totalAmount,
          description: `WeKonnek Order ${created.orderCode}`,
          paymentMethod: paymentMethod === 'maya' || paymentMethod === 'xendit'
            ? 'gcash'
            : paymentMethod,
          redirectSuccess: `${appUrl}/customer/orders/${created.id}?paid=1`,
          redirectFailed: `${appUrl}/customer/orders/${created.id}?paid=0`,
          metadata: { orderId: String(created.id), orderCode: created.orderCode },
        });
        const updated = await this.prisma.wkOrder.update({
          where: { id: created.id },
          data: {
            paymentRef: result.gatewayTransactionId,
            paymentUrl: result.paymentUrl,
          },
          include: {
            orderItems: true,
            merchant: { include: { category: true } },
          },
        });
        return serializeOrder(updated);
      } catch (err: any) {
        // Payment init failed — keep the order as COD-pending so it isn't lost.
        const fallback = await this.prisma.wkOrder.findUnique({
          where: { id: created.id },
          include: {
            orderItems: true,
            merchant: { include: { category: true } },
          },
        });
        const serialized = serializeOrder(fallback);
        return {
          ...serialized,
          payment_error:
            err?.message || 'Online payment could not be initialized',
        };
      }
    }

    return serializeOrder(created);
  }

  private resolveGateway(
    requested: string | undefined,
    paymentMethod: string,
  ): WalletPaymentGateway {
    const g = (requested || '').toLowerCase();
    if (g === 'maya' || paymentMethod === 'maya') return WalletPaymentGateway.maya;
    if (g === 'xendit') return WalletPaymentGateway.xendit;
    if (g === 'paymongo') return WalletPaymentGateway.paymongo;
    // Default online gateway
    return WalletPaymentGateway.xendit;
  }

  async findAll(opts: {
    merchantId?: number;
    userId?: string;
    isAdmin?: boolean;
    status?: string;
  }) {
    const where: any = {};
    if (opts.merchantId) where.merchantId = Number(opts.merchantId);
    else if (!opts.isAdmin && opts.userId) where.userId = opts.userId;
    if (opts.status && opts.status !== 'all') where.status = opts.status;

    const orders = await this.prisma.wkOrder.findMany({
      where,
      include: {
        orderItems: true,
        serviceRequests: { include: { assignedStaff: true }, orderBy: { createdAt: 'desc' } },
        merchant: { include: { category: true } },
        // customer info is useful for merchant/admin views
        ...(opts.merchantId || opts.isAdmin ? {} : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    // Attach customer for merchant/admin contexts
    if (opts.merchantId || opts.isAdmin) {
      const userIds = [...new Set(orders.map((o) => o.userId))];
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true, phone: true, email: true },
      });
      const byId = new Map(users.map((u) => [u.id, u]));
      return orders.map((o) => serializeOrder({ ...o, user: byId.get(o.userId) }));
    }

    return orders.map((o) => serializeOrder(o));
  }

  async findById(id: number) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: Number(id) },
      include: {
        orderItems: {
          include: {
            product: { select: { imageUrl: true } },
            variant: {
              include: { optionValues: { include: { optionValue: true } } },
            },
          },
        },
        serviceRequests: { include: { assignedStaff: true }, orderBy: { createdAt: 'desc' } },
        merchant: { include: { category: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const user = await this.prisma.user.findUnique({
      where: { id: order.userId },
      select: { id: true, firstName: true, lastName: true, phone: true, email: true },
    });
    return serializeOrder({ ...order, user });
  }

  async findItems(id: number) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: Number(id) },
      include: { orderItems: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return serializeOrder(order).order_items;
  }

  async updateStatus(id: number, status: string) {
    if (!status) throw new BadRequestException('status is required');
    const existing = await this.prisma.wkOrder.findUnique({
      where: { id: Number(id) },
      include: { orderItems: true },
    });
    if (!existing) throw new NotFoundException('Order not found');

    const wasFinalized = ['completed', 'delivered'].includes(existing.status);
    const willFinalize = ['completed', 'delivered'].includes(status);
    const willCancel = status === 'cancelled' && existing.status !== 'cancelled' && !wasFinalized;
    if (existing.shopId && ((!wasFinalized && willFinalize) || willCancel)) {
      await this.prisma.$transaction(async tx => {
        for (const item of existing.orderItems.filter(item => item.productId != null)) {
          const product = await tx.product.findUnique({ where: { id: item.productId! }, select: { trackInventory: true } });
          if (!product?.trackInventory) continue;
          const balance = await tx.shopInventory.findFirst({ where: { merchantId: existing.merchantId, shopId: existing.shopId!, productId: item.productId!, variantId: item.variantId } });
          if (!balance || balance.reservedQuantity < item.quantity) throw new BadRequestException(`Reserved inventory is missing for ${item.productName}`);
          if (willCancel) {
            const updated = await tx.shopInventory.update({ where: { id: balance.id }, data: { reservedQuantity: { decrement: item.quantity } } });
            await tx.inventoryMovement.create({ data: { merchantId: existing.merchantId, shopId: existing.shopId!, productId: item.productId!, variantId: item.variantId, type: 'reservation_release', quantityChange: -item.quantity, balanceAfter: updated.quantity, reference: existing.orderCode, referenceType: 'order', referenceId: String(existing.id) } });
          } else {
            const updated = await tx.shopInventory.update({ where: { id: balance.id }, data: { reservedQuantity: { decrement: item.quantity }, quantity: { decrement: item.quantity } } });
            await tx.inventoryMovement.create({ data: { merchantId: existing.merchantId, shopId: existing.shopId!, productId: item.productId!, variantId: item.variantId, type: 'sale', quantityChange: -item.quantity, balanceAfter: updated.quantity, reference: existing.orderCode, referenceType: 'order', referenceId: String(existing.id) } });
          }
        }
      });
    }

    // When a COD order is completed/delivered, mark it as paid.
    const data: any = { status };
    if (
      ['completed', 'delivered'].includes(status) &&
      ['cod', 'cash'].includes(existing.paymentMethod) &&
      existing.paymentStatus !== 'paid'
    ) {
      data.paymentStatus = 'paid';
    }

    const order = await this.prisma.wkOrder.update({
      where: { id: Number(id) },
      data,
      include: {
        orderItems: true,
        merchant: { include: { category: true } },
      },
    });
    if (!wasFinalized && willFinalize) {
      await this.coordinatorApplications.creditOrderCommission(order.id);
    }
    if (willFinalize && ['dine_in', 'in_store'].includes(existing.orderType)) {
      await this.invoices.generateFromDineInOrder(Number(id));
      if (existing.shopId && existing.tableNumber) {
        const siblings = await this.prisma.wkOrder.findMany({ where: { id: { not: Number(id) }, shopId: existing.shopId, tableNumber: { equals: existing.tableNumber, mode: 'insensitive' }, orderType: { in: ['dine_in', 'in_store'] }, status: { notIn: ['completed', 'cancelled', 'delivered'] } }, select: { id: true } });
        for (const sibling of siblings) await this.updateStatus(sibling.id, 'cancelled');
      }
    }
    if (['dine_in', 'in_store'].includes(existing.orderType)) await this.dineInSync.recordOrder(Number(id), status === 'completed' ? 'ORDER_COMPLETED' : 'ORDER_STATUS_CHANGED');
    if (existing.userId && existing.status !== status) {
      const customerStates: Record<string, { title: string; body: string }> = {
        accepted: { title: 'Order accepted', body: `Order ${existing.orderCode} was accepted.` },
        confirmed: { title: 'Order accepted', body: `Order ${existing.orderCode} was accepted.` },
        preparing: { title: 'Order preparing', body: `Order ${existing.orderCode} is being prepared.` },
        ready: { title: 'Order ready', body: `Order ${existing.orderCode} is ready.` },
        cancelled: { title: 'Order cancelled', body: `Order ${existing.orderCode} was cancelled.` },
      };
      const message = customerStates[status];
      if (message) await this.notifications.notify({ userId: existing.userId, ...message, type: NotificationType.order_update, orderId: String(existing.id), data: { kind: `order_${status}`, orderId: String(existing.id), url: `/customer/orders/${existing.id}` } }).catch(() => undefined);
    }
    return serializeOrder(order);
  }

  async updatePayment(id: number, paymentStatus: string, paymentRef?: string) {
    const order = await this.prisma.wkOrder.update({
      where: { id: Number(id) },
      data: { paymentStatus, ...(paymentRef ? { paymentRef } : {}) },
      include: {
        orderItems: true,
        merchant: { include: { category: true } },
      },
    });
    return serializeOrder(order);
  }

  async updateItemStatus(orderId: number, itemId: number, status: string) {
    if (!['preparing', 'served'].includes(status)) throw new BadRequestException('Item status must be preparing or served');
    const item = await this.prisma.orderItem.findFirst({
      where: { id: itemId, orderId },
      include: { order: true },
    });
    if (!item) throw new NotFoundException('Order item not found');
    if (!['dine_in', 'in_store'].includes(item.order.orderType)) throw new BadRequestException('Item status is available only for dine-in orders');

    await this.prisma.orderItem.update({ where: { id: itemId }, data: { status } });
    const remaining = await this.prisma.orderItem.count({ where: { orderId, status: { not: 'served' } } });
    await this.prisma.wkOrder.update({
      where: { id: orderId },
      data: { status: remaining === 0 ? 'ready' : 'preparing' },
    });
    await this.dineInSync.recordOrder(orderId, status === 'served' ? 'ITEM_SERVED' : 'ITEM_PREPARING');
    return this.findById(orderId);
  }

  async requestBillOut(
    id: number,
    userId: string,
    input: {
      discountType?: 'none' | 'sc_pwd' | 'voucher';
      totalDiners?: number;
      eligibleDiners?: number;
      cards?: Array<{ type: 'sc' | 'pwd'; reference: string; name: string; address: string; idPhoto?: string }>;
      voucherCode?: string;
    },
  ) {
    const existing = await this.prisma.wkOrder.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw new NotFoundException('Order not found');
    if (existing.orderType !== 'dine_in') throw new BadRequestException('Bill-out is available only for dine-in orders');
    if (existing.status === 'bill_out') throw new BadRequestException('Bill-out has already been requested');
    if (!['ready', 'bill_out'].includes(existing.status)) {
      throw new BadRequestException('Bill-out is available after the order has been served');
    }

    const discountType = input.discountType || 'none';
    const gross = Number(existing.totalAmount);
    let discountAmount = 0;
    let discountDetails: Record<string, unknown> | null = null;
    let voucherId: string | null = null;

    if (discountType === 'sc_pwd') {
      const totalDiners = Number(input.totalDiners);
      const eligibleDiners = Number(input.eligibleDiners);
      const cards = input.cards || [];
      if (!Number.isInteger(totalDiners) || totalDiners < 1) throw new BadRequestException('Enter the total number of diners');
      if (!Number.isInteger(eligibleDiners) || eligibleDiners < 1 || eligibleDiners > totalDiners) throw new BadRequestException('Enter a valid number of SC/PWD diners');
      if (cards.length !== eligibleDiners || cards.some(card => !card.reference?.trim() || !card.name?.trim() || !card.address?.trim() || !['sc', 'pwd'].includes(card.type))) {
        throw new BadRequestException('Complete all card details for every SC/PWD diner');
      }
      const eligibleShare = gross * (eligibleDiners / totalDiners);
      const vatExclusiveShare = eligibleShare / 1.12;
      const vatExemption = Math.round((eligibleShare - vatExclusiveShare) * 100) / 100;
      const scPwdDiscount = Math.round((vatExclusiveShare * 0.2) * 100) / 100;
      discountAmount = Math.round((vatExemption + scPwdDiscount) * 100) / 100;
      discountDetails = {
        totalDiners,
        eligibleDiners,
        cards: cards.map(card => ({
          type: card.type,
          reference: card.reference.trim(),
          name: card.name.trim(),
          address: card.address.trim(),
          ...(card.idPhoto ? { idPhoto: card.idPhoto } : {}),
        })),
        vatExemption,
        scPwdDiscount,
      };
    } else if (discountType === 'voucher') {
      if (!input.voucherCode?.trim()) throw new BadRequestException('Select a voucher from your wallet');
      const validation = await this.vouchers.validate(input.voucherCode, userId, gross, 'dine_in');
      if (!validation.valid || !validation.voucher) throw new BadRequestException(validation.reason || 'Voucher is not valid');
      discountAmount = Number(validation.discountAmount || 0);
      voucherId = validation.voucher.id;
      discountDetails = { code: validation.voucher.code, title: validation.voucher.title };
    } else if (discountType !== 'none') {
      throw new BadRequestException('Only one supported discount may be selected');
    }

    const updated = await this.prisma.wkOrder.update({
      where: { id },
      data: {
        status: 'bill_out',
        discountType: discountType === 'none' ? null : discountType,
        discountAmount,
        discountDetails: discountDetails as any,
        voucherId,
        totalAmount: Math.max(0, gross - discountAmount),
      },
      include: { orderItems: true, merchant: { include: { category: true } } },
    });

    if (voucherId) await this.vouchers.redeem(voucherId, userId, String(id), discountAmount);
    await this.dineInSync.recordOrder(id, 'BILL_REQUESTED');
    const billOutMerchant = await this.prisma.merchant.findUnique({ where: { id: existing.merchantId }, select: { userId: true } });
    if (billOutMerchant?.userId) await this.notifications.notify({ userId: billOutMerchant.userId, title: 'Bill-out requested', body: `Order ${existing.orderCode} requested bill-out.`, type: NotificationType.order_update, orderId: String(id), data: { kind: 'bill_out_requested', orderId: String(id), ...(existing.shopId ? { shopId: String(existing.shopId), url: merchantOrderNotificationUrl({ orderId: id, shopId: existing.shopId, orderType: existing.orderType }) } : { url: '/merchant/orders?tab=in_store' }) } }).catch(() => undefined);
    return serializeOrder(updated);
  }

  async saveBillOutDraft(id: number, userId: string, input: any) {
    const existing = await this.prisma.wkOrder.findFirst({ where: { id, userId } });
    if (!existing || existing.orderType !== 'dine_in') throw new NotFoundException('Dine-in order not found');
    if (!['ready', 'bill_out'].includes(existing.status)) throw new BadRequestException('Bill-out details can be edited only after all items are served');
    const discountType = String(input.discountType || 'none');
    if (!['none', 'sc_pwd', 'voucher'].includes(discountType)) throw new BadRequestException('Invalid discount type');
    const details = discountType === 'sc_pwd' ? {
      draft: true,
      totalDiners: Math.max(1, Number(input.totalDiners || 1)),
      eligibleDiners: Math.max(1, Number(input.eligibleDiners || 1)),
      cards: Array.isArray(input.cards) ? input.cards.map((card: any) => ({ type: card.type === 'pwd' ? 'pwd' : 'sc', reference: String(card.reference || '').slice(0, 100), name: String(card.name || '').slice(0, 150), address: String(card.address || '').slice(0, 250), idPhoto: String(card.idPhoto || '').slice(0, 1000) })) : [],
    } : discountType === 'voucher' ? { draft: true, code: String(input.voucherCode || '').slice(0, 80) } : null;
    const updated = await this.prisma.wkOrder.update({ where: { id }, data: { discountType: discountType === 'none' ? null : discountType, discountDetails: details as any, discountAmount: 0 }, include: { orderItems: true, merchant: { include: { category: true } }, serviceRequests: { include: { assignedStaff: true }, orderBy: { createdAt: 'desc' } } } });
    await this.dineInSync.recordOrder(id, 'BILL_OUT_DRAFT_UPDATED');
    return serializeOrder(updated);
  }

  async confirmBillOut(id: number, userId: string, role?: string) {
    const existing = await this.prisma.wkOrder.findUnique({
      where: { id },
      include: { merchant: { select: { userId: true } } },
    });
    if (!existing) throw new NotFoundException('Order not found');
    if (existing.merchant.userId !== userId && !['admin', 'staff'].includes(String(role))) {
      throw new ForbiddenException('This ticket belongs to another merchant');
    }
    if (existing.status !== 'bill_out') throw new BadRequestException('The customer has not requested bill-out');
    const order = await this.prisma.wkOrder.update({
      where: { id },
      data: { status: 'payment_pending', paymentMethod: 'pending_selection', paymentStatus: 'pending' },
      include: { orderItems: true, merchant: { include: { category: true } } },
    });
    await this.dineInSync.recordOrder(id, 'BILL_OUT_CONFIRMED');
    return serializeOrder(order);
  }

  async checkoutPayment(id: number, userId: string, method: 'manual' | 'gcash' | 'maya' | 'card') {
    const existing = await this.prisma.wkOrder.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw new NotFoundException('Order not found');
    if (existing.status !== 'payment_pending') throw new BadRequestException('Wait for the merchant to confirm bill-out');
    if (method === 'manual') {
      const updated = await this.prisma.wkOrder.update({ where: { id }, data: { paymentMethod: 'cash', paymentStatus: 'pending' }, include: { orderItems: true, merchant: { include: { category: true } } } });
      await this.dineInSync.recordOrder(id, 'PAYMENT_METHOD_SELECTED');
      return serializeOrder(updated);
    }
    if (!['gcash', 'maya', 'card'].includes(method)) throw new BadRequestException('Unsupported payment method');
    const gateway = this.resolveGateway(undefined, method);
    const appUrl = process.env.APP_BASE_URL || 'http://localhost:3001';
    const result = await this.paymentGateway.createPayment({
      gateway,
      amount: Number(existing.totalAmount),
      description: `WeKonnek Bill-Out ${existing.orderCode}`,
      paymentMethod: method === 'maya' ? 'gcash' : method,
      redirectSuccess: `${appUrl}/customer/orders/${id}?paid=1`,
      redirectFailed: `${appUrl}/customer/orders/${id}?paid=0`,
      metadata: { orderId: String(id), orderCode: existing.orderCode },
    });
    const updated = await this.prisma.wkOrder.update({ where: { id }, data: { paymentMethod: method, paymentRef: result.gatewayTransactionId, paymentUrl: result.paymentUrl }, include: { orderItems: true, merchant: { include: { category: true } } } });
    await this.dineInSync.recordOrder(id, 'PAYMENT_METHOD_SELECTED');
    return serializeOrder(updated);
  }

  /** Called by payment webhooks to mark an order paid/failed by metadata.orderId. */
  async markPaidByGateway(orderId: string, status: 'completed' | 'failed') {
    if (!orderId) return;
    const id = Number(orderId);
    if (Number.isNaN(id)) return;
    const existing = await this.prisma.wkOrder.findUnique({ where: { id } }).catch(() => null);
    if (!existing) return;
    if (status === 'completed' && existing.status === 'payment_pending') {
      await this.updateStatus(id, 'completed');
      await this.prisma.wkOrder.update({ where: { id }, data: { paymentStatus: 'paid' } });
      return;
    }
    await this.prisma.wkOrder.update({
      where: { id },
      data: {
        paymentStatus: status === 'completed' ? 'paid' : 'failed',
        ...(status === 'completed' ? { status: 'processing' } : {}),
      },
    });
  }

  async createServiceRequest(orderId: number, userId: string, input: { type?: string; details?: string }) {
    const allowed = new Set(['spoon_fork', 'water_cold', 'water_hot', 'condiments', 'plates_saucers', 'other']);
    const type = String(input.type || '').trim().toLowerCase();
    const details = String(input.details || '').trim().slice(0, 250) || null;
    if (!allowed.has(type)) throw new BadRequestException('Select a valid service request');
    if (type === 'other' && !details) throw new BadRequestException('Describe what you need');
    const order = await this.prisma.wkOrder.findFirst({ where: { id: orderId, userId } });
    if (!order || order.orderType !== 'dine_in' || !order.shopId) throw new NotFoundException('Active dine-in order not found');
    if (['bill_out', 'payment_pending', 'completed', 'cancelled'].includes(order.status)) throw new BadRequestException('Service requests are closed for this ticket');
    const request = await this.prisma.dineInServiceRequest.create({ data: { orderId, shopId: order.shopId, requestedByUserId: userId, type, details } });
    await this.dineInSync.record(order.shopId, 'SERVICE_REQUEST_CREATED', request.id, { serviceRequest: this.serializeServiceRequest(request), orderId });
    const requestMerchant = await this.prisma.merchant.findUnique({ where: { id: order.merchantId }, select: { userId: true } });
    if (requestMerchant?.userId) await this.notifications.notify({ userId: requestMerchant.userId, title: 'Table assistance requested', body: `Order ${order.orderCode} requested table assistance.`, type: NotificationType.order_update, orderId: String(orderId), data: { kind: 'table_assistance', orderId: String(orderId), requestId: String(request.id), shopId: String(order.shopId), url: merchantOrderNotificationUrl({ orderId, shopId: order.shopId, orderType: order.orderType }) } }).catch(() => undefined);
    return this.serializeServiceRequest(request);
  }

  async updateServiceRequest(orderId: number, requestId: number, actorUserId: string, input: { assignedStaffId?: number | null; status?: string }) {
    const request = await this.prisma.dineInServiceRequest.findFirst({ where: { id: requestId, orderId }, include: { order: true } });
    if (!request) throw new NotFoundException('Service request not found');
    const owner = await this.prisma.merchant.findFirst({ where: { id: request.order.merchantId, userId: actorUserId } });
    const staffActor = owner ? null : await this.prisma.merchantStaff.findFirst({ where: { merchantId: request.order.merchantId, userId: actorUserId, isActive: true } });
    if (!owner && !staffActor) throw new ForbiddenException('Shop access is required');
    const status = input.status ? String(input.status).toLowerCase() : undefined;
    if (status && !['pending', 'assigned', 'completed'].includes(status)) throw new BadRequestException('Invalid request status');
    const assignedStaffId = input.assignedStaffId === null ? null : input.assignedStaffId ? Number(input.assignedStaffId) : undefined;
    if (assignedStaffId) {
      const assigned = await this.prisma.merchantStaff.findFirst({ where: { id: assignedStaffId, merchantId: request.order.merchantId, isActive: true, OR: [{ branchId: request.shopId }, { branchId: null }] } });
      if (!assigned) throw new BadRequestException('Select an active crew member for this shop');
    }
    const nextStatus = status || (assignedStaffId ? 'assigned' : request.status);
    const updated = await this.prisma.dineInServiceRequest.update({ where: { id: requestId }, data: { ...(assignedStaffId !== undefined ? { assignedStaffId, assignedAt: assignedStaffId ? new Date() : null } : {}), status: nextStatus, completedAt: nextStatus === 'completed' ? new Date() : null }, include: { assignedStaff: true } });
    await this.dineInSync.record(request.shopId, 'SERVICE_REQUEST_UPDATED', updated.id, { serviceRequest: this.serializeServiceRequest(updated), orderId });
    return this.serializeServiceRequest(updated);
  }

  private serializeServiceRequest(request: any) {
    return { id: request.id, order_id: request.orderId, type: request.type, details: request.details, status: request.status, assigned_staff_id: request.assignedStaffId, assigned_staff_name: request.assignedStaff?.displayName || null, assigned_at: request.assignedAt, completed_at: request.completedAt, created_at: request.createdAt };
  }

  async getStats(merchantId?: number) {
    const where: any = merchantId ? { merchantId: Number(merchantId) } : {};
    const [total, pending, completed] = await Promise.all([
      this.prisma.wkOrder.count({ where }),
      this.prisma.wkOrder.count({ where: { ...where, status: 'pending' } }),
      this.prisma.wkOrder.count({ where: { ...where, status: 'completed' } }),
    ]);
    return { totalOrders: total, pendingOrders: pending, completedOrders: completed };
  }
}
