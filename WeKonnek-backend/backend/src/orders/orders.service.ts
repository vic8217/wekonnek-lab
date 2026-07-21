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
import { WalletPaymentGateway, NotificationType } from '@prisma/client';

interface OrderItemInput {
  product_id?: number;
  productId?: number;
  product_name?: string;
  productName?: string;
  quantity: number;
  price: number;
  subtotal?: number;
}

interface CreateOrderInput {
  merchant_id?: number;
  merchantId?: number;
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
    product_name: it.productName,
    productName: it.productName,
    quantity: it.quantity,
    price: it.price,
    subtotal: it.subtotal,
  }));
  const merchant = order.merchant
    ? {
        ...order.merchant,
        is_active: order.merchant.isActive,
        category_id: order.merchant.categoryId,
        logo_url: order.merchant.logoUrl,
      }
    : undefined;
  return {
    id: order.id,
    order_code: order.orderCode,
    orderCode: order.orderCode,
    user_id: order.userId,
    userId: order.userId,
    merchant_id: order.merchantId,
    merchantId: order.merchantId,
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
    created_at: order.createdAt,
    createdAt: order.createdAt,
    updated_at: order.updatedAt,
    // Nested relations, exposed under both names the frontend looks for
    merchant,
    merchants: merchant,
    order_items: items,
    orderItems: items,
    items,
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

    const items = input.items.map((it) => {
      const quantity = Number(it.quantity) || 1;
      const price = Number(it.price) || 0;
      const subtotal = it.subtotal != null ? Number(it.subtotal) : price * quantity;
      return {
        productId: it.product_id ?? it.productId ?? null,
        productName: it.product_name ?? it.productName ?? 'Item',
        quantity,
        price,
        subtotal,
      };
    });

    const itemsSubtotal = items.reduce((s, it) => s + it.subtotal, 0);
    const deliveryFee = Number(input.delivery_fee) || 0;
    const totalAmount =
      input.total_amount != null
        ? Number(input.total_amount)
        : itemsSubtotal + deliveryFee;

    const paymentMethod = (input.payment_method || 'cod').toLowerCase();
    const isOnline = ONLINE_METHODS.has(paymentMethod);

    const created = await this.prisma.wkOrder.create({
      data: {
        orderCode: this.generateOrderCode(),
        userId,
        merchantId: Number(merchantId),
        status: 'pending',
        orderType: input.order_type ?? input.orderType ?? 'delivery',
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
            quantity: it.quantity,
            price: it.price,
            subtotal: it.subtotal,
          })),
        },
      },
      include: {
        orderItems: true,
        merchant: { include: { category: true } },
      },
    });

    // Decrement stock for tracked products, then raise low/out-of-stock
    // alerts for the merchant when a product crosses its threshold.
    // Entirely best-effort — inventory alerting must never break checkout.
    try {
      const tracked = items.filter(
        (it): it is typeof it & { productId: number } => it.productId != null,
      );

      if (tracked.length > 0) {
        const ids = tracked.map((it) => it.productId);

        // Snapshot quantities before decrementing so we can detect crossings.
        const before = await this.prisma.product.findMany({
          where: { id: { in: ids } },
          select: { id: true, quantity: true },
        });
        const prevQty = new Map(before.map((p) => [p.id, p.quantity]));

        await Promise.all(
          tracked.map((it) =>
            this.prisma.product
              .updateMany({
                where: { id: it.productId, quantity: { gte: it.quantity } },
                data: { quantity: { decrement: it.quantity } },
              })
              .catch(() => undefined),
          ),
        );

        // Re-read authoritative quantities after the decrement.
        const after = await this.prisma.product.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, quantity: true, lowStockThreshold: true },
        });

        const ownerUserId = merchant.userId;
        if (ownerUserId) {
          for (const prod of after) {
            const old = prevQty.get(prod.id);
            if (old == null) continue;
            const threshold = prod.lowStockThreshold ?? 10;

            // Only alert on the transition (not on every subsequent order).
            const crossedToOut = old > 0 && prod.quantity === 0;
            const crossedToLow =
              old > threshold && prod.quantity > 0 && prod.quantity <= threshold;

            if (crossedToOut) {
              await this.notifications
                .notify({
                  userId: ownerUserId,
                  title: 'Out of stock',
                  body: `${prod.name} is now out of stock. Restock to keep selling it.`,
                  type: NotificationType.inventory_alert,
                  data: {
                    kind: 'out_of_stock',
                    productId: String(prod.id),
                    productName: prod.name,
                  },
                })
                .catch(() => undefined);
            } else if (crossedToLow) {
              await this.notifications
                .notify({
                  userId: ownerUserId,
                  title: 'Low stock alert',
                  body: `${prod.name} is running low — ${prod.quantity} left (alert at ${threshold}).`,
                  type: NotificationType.inventory_alert,
                  data: {
                    kind: 'low_stock',
                    productId: String(prod.id),
                    productName: prod.name,
                    quantity: String(prod.quantity),
                  },
                })
                .catch(() => undefined);
            }
          }
        }
      }
    } catch {
      // swallow — inventory alerts are non-critical to order creation
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
            },
            orderId: String(created.id),
          })
          .catch(() => undefined);
      }
    } catch {
      // swallow — merchant alerts are non-critical to order creation
    }

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
        orderItems: true,
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
    });
    if (!existing) throw new NotFoundException('Order not found');

    // When a COD order is completed/delivered, mark it as paid.
    const data: any = { status };
    if (
      ['completed', 'delivered'].includes(status) &&
      existing.paymentMethod === 'cod' &&
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

  /** Called by payment webhooks to mark an order paid/failed by metadata.orderId. */
  async markPaidByGateway(orderId: string, status: 'completed' | 'failed') {
    if (!orderId) return;
    const id = Number(orderId);
    if (Number.isNaN(id)) return;
    await this.prisma.wkOrder
      .update({
        where: { id },
        data: {
          paymentStatus: status === 'completed' ? 'paid' : 'failed',
          ...(status === 'completed' ? { status: 'processing' } : {}),
        },
      })
      .catch(() => undefined);
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
