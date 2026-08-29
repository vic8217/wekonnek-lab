import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CommerceDomain,
  Prisma,
  QuotationStatus,
  RfqStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { RfqService } from './rfq.service';

jest.setTimeout(30_000);

type Fixture = Awaited<ReturnType<typeof createFixture>>;
const prisma = new PrismaService();
const effects = { calls: 0 };
const paymentGateway = {
  createPayment: jest.fn().mockResolvedValue({
    gatewayTransactionId: 'stage2-test-payment',
    paymentUrl: 'https://example.invalid/payment',
  }),
};
const orders = new OrdersService(
  prisma,
  paymentGateway as never,
  { notify: jest.fn() } as never,
  {} as never,
  {} as never,
  { recordOrder: jest.fn().mockResolvedValue(undefined) } as never,
  {} as never,
  { ensureForWkOrder: jest.fn().mockResolvedValue(undefined) } as never,
);
const rfqs = new RfqService(prisma, orders);

async function createFixture(
  options: {
    merchantDomain?: CommerceDomain | null;
    productDomain?: CommerceDomain | null;
    quantity?: number;
    stock?: number;
    unitPrice?: number;
    validUntil?: Date;
  } = {},
) {
  const token = randomUUID();
  const buyer = await prisma.user.create({
    data: {
      phone: `+63${Date.now()}${Math.floor(Math.random() * 1000)}`,
      email: `stage2-buyer-${token}@test.invalid`,
    },
  });
  const otherBuyer = await prisma.user.create({
    data: {
      phone: `+63${Date.now()}${Math.floor(Math.random() * 1000)}1`,
      email: `stage2-other-${token}@test.invalid`,
    },
  });
  const merchantUser = await prisma.user.create({
    data: {
      phone: `+63${Date.now()}${Math.floor(Math.random() * 1000)}2`,
      email: `stage2-merchant-${token}@test.invalid`,
      role: 'merchant',
    },
  });
  const merchant = await prisma.merchant.create({
    data: {
      userId: merchantUser.id,
      name: `Stage 2 ${token}`,
      slug: `stage-2-${token}`,
      commerceDomain:
        options.merchantDomain === undefined
          ? CommerceDomain.NON_FOOD
          : options.merchantDomain,
    },
  });
  const shop = await prisma.branch.create({
    data: { merchantId: merchant.id, name: `Shop ${token}` },
  });
  const product = await prisma.product.create({
    data: {
      merchantId: merchant.id,
      name: `Product ${token}`,
      price: 1000,
      sellingPrice: 1000,
      trackInventory: true,
      commerceDomain:
        options.productDomain === undefined
          ? CommerceDomain.NON_FOOD
          : options.productDomain,
    },
  });
  await prisma.shopProduct.create({
    data: { merchantId: merchant.id, shopId: shop.id, productId: product.id },
  });
  const inventory = await prisma.shopInventory.create({
    data: {
      merchantId: merchant.id,
      shopId: shop.id,
      productId: product.id,
      quantity: options.stock ?? 10,
    },
  });
  const quantity = options.quantity ?? 1;
  const unitPrice = options.unitPrice ?? 850;
  const rfq = await prisma.requestForQuotation.create({
    data: {
      rfqNumber: `RFQ-${token}`,
      buyerId: buyer.id,
      merchantId: merchant.id,
      shopId: shop.id,
      productId: product.id,
      quantity,
      snapshot: { token },
      status: RfqStatus.QUOTED,
      submittedAt: new Date(),
    },
  });
  const quotation = await prisma.merchantQuotation.create({
    data: {
      quotationNumber: `QT-${token}`,
      rfqId: rfq.id,
      merchantId: merchant.id,
      shopId: shop.id,
      buyerId: buyer.id,
      version: 1,
      status: QuotationStatus.SENT,
      unitPrice,
      subtotal: unitPrice * quantity,
      total: unitPrice * quantity,
      validUntil: options.validUntil ?? new Date(Date.now() + 60_000),
      sentAt: new Date(),
    },
  });
  return {
    buyer,
    otherBuyer,
    merchantUser,
    merchant,
    shop,
    product,
    inventory,
    rfq,
    quotation,
    async cleanup() {
      await prisma.merchantQuotation.deleteMany({ where: { rfqId: rfq.id } });
      await prisma.requestForQuotation.deleteMany({ where: { id: rfq.id } });
      await prisma.inventoryMovement.deleteMany({
        where: { merchantId: merchant.id },
      });
      await prisma.wkOrder.deleteMany({ where: { userId: buyer.id } });
      await prisma.shopInventory.deleteMany({ where: { id: inventory.id } });
      await prisma.shopProduct.deleteMany({
        where: { shopId: shop.id, productId: product.id },
      });
      await prisma.product.deleteMany({ where: { id: product.id } });
      await prisma.branch.deleteMany({ where: { id: shop.id } });
      await prisma.merchant.deleteMany({ where: { id: merchant.id } });
      await prisma.user.deleteMany({
        where: { id: { in: [buyer.id, otherBuyer.id, merchantUser.id] } },
      });
    },
  };
}

describe('RfqService PostgreSQL acceptance gate', () => {
  let fixture: Fixture | undefined;

  beforeAll(async () => {
    await prisma.$connect();
    const target = await prisma.$queryRaw<Array<{ database: string }>>(
      Prisma.sql`SELECT current_database() AS database`,
    );
    if (target[0]?.database !== 'wekonnek_stage2_test')
      throw new Error('Stage 2 tests require wekonnek_stage2_test');
    jest
      .spyOn(orders, 'runOrderCreatedPostCommitEffects')
      .mockImplementation(() => {
        effects.calls += 1;
        return Promise.resolve();
      });
  });
  afterEach(async () => {
    if (fixture) await fixture.cleanup();
    fixture = undefined;
    effects.calls = 0;
    paymentGateway.createPayment.mockClear();
  });
  afterAll(async () => prisma.$disconnect());

  it('converts an accepted quote atomically, links one order, and reserves inventory once', async () => {
    fixture = await createFixture();
    const result = await rfqs.acceptQuotationAndCreateOrder(
      fixture.buyer.id,
      fixture.quotation.id,
    );
    const quote = await prisma.merchantQuotation.findUniqueOrThrow({
      where: { id: fixture.quotation.id },
      include: { wkOrder: { include: { orderItems: true } } },
    });
    const inventory = await prisma.shopInventory.findUniqueOrThrow({
      where: { id: fixture.inventory.id },
    });
    const rfq = await prisma.requestForQuotation.findUniqueOrThrow({
      where: { id: fixture.rfq.id },
    });
    expect(result.createdNow).toBe(true);
    expect(quote.wkOrderId).not.toBeNull();
    expect(quote.wkOrder?.orderItems).toHaveLength(1);
    expect(Number(quote.wkOrder?.totalAmount)).toBe(850);
    expect(quote.status).toBe(QuotationStatus.CONVERTED_TO_ORDER);
    expect(rfq.status).toBe(RfqStatus.CONVERTED_TO_ORDER);
    expect(inventory.reservedQuantity).toBe(1);
    expect(quote.acceptedSnapshot).toBeTruthy();
    expect(effects.calls).toBe(1);
  });

  it('freezes quote price while a direct order continues to use the live product price', async () => {
    fixture = await createFixture();
    await prisma.product.update({
      where: { id: fixture.product.id },
      data: { sellingPrice: 1100, price: 1100 },
    });
    await rfqs.acceptQuotationAndCreateOrder(
      fixture.buyer.id,
      fixture.quotation.id,
    );
    await orders.create(fixture.buyer.id, {
      merchantId: fixture.merchant.id,
      shopId: fixture.shop.id,
      items: [{ productId: fixture.product.id, quantity: 1, price: 0 }],
    });
    const convertedQuote = await prisma.merchantQuotation.findUniqueOrThrow({
      where: { id: fixture.quotation.id },
    });
    const [frozen, current] = await Promise.all([
      prisma.wkOrder.findUniqueOrThrow({
        where: { id: convertedQuote.wkOrderId ?? -1 },
        include: { orderItems: true },
      }),
      prisma.wkOrder.findFirstOrThrow({
        where: {
          userId: fixture.buyer.id,
          id: { not: convertedQuote.wkOrderId ?? -1 },
        },
        include: { orderItems: true },
      }),
    ]);
    expect(Number(frozen.orderItems[0].price)).toBe(850);
    expect(Number(frozen.totalAmount)).toBe(850);
    expect(Number(current.orderItems[0].price)).toBe(1100);
    expect(Number(current.totalAmount)).toBe(1100);
  });

  it('rolls back order, linkage, and inventory when stock is insufficient', async () => {
    fixture = await createFixture({ quantity: 2, stock: 1 });
    await expect(
      rfqs.acceptQuotationAndCreateOrder(
        fixture.buyer.id,
        fixture.quotation.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const [quote, rfq, inventory, ordersCount] = await Promise.all([
      prisma.merchantQuotation.findUniqueOrThrow({
        where: { id: fixture.quotation.id },
      }),
      prisma.requestForQuotation.findUniqueOrThrow({
        where: { id: fixture.rfq.id },
      }),
      prisma.shopInventory.findUniqueOrThrow({
        where: { id: fixture.inventory.id },
      }),
      prisma.wkOrder.count({ where: { userId: fixture.buyer.id } }),
    ]);
    expect(quote.wkOrderId).toBeNull();
    expect(quote.status).toBe(QuotationStatus.SENT);
    expect(rfq.status).toBe(RfqStatus.QUOTED);
    expect(inventory.reservedQuantity).toBe(0);
    expect(ordersCount).toBe(0);
    expect(effects.calls).toBe(0);
  });

  it('rolls back the quotation claim when order creation fails inside the transaction', async () => {
    fixture = await createFixture();
    const failure = jest
      .spyOn(orders, 'createFromAcceptedQuotation')
      .mockRejectedValueOnce(new Error('test-only transaction failure'));
    await expect(
      rfqs.acceptQuotationAndCreateOrder(
        fixture.buyer.id,
        fixture.quotation.id,
      ),
    ).rejects.toThrow('test-only transaction failure');
    const [quote, rfq, inventory, orderCount] = await Promise.all([
      prisma.merchantQuotation.findUniqueOrThrow({
        where: { id: fixture.quotation.id },
      }),
      prisma.requestForQuotation.findUniqueOrThrow({
        where: { id: fixture.rfq.id },
      }),
      prisma.shopInventory.findUniqueOrThrow({
        where: { id: fixture.inventory.id },
      }),
      prisma.wkOrder.count({ where: { userId: fixture.buyer.id } }),
    ]);
    expect(quote.status).toBe(QuotationStatus.SENT);
    expect(quote.wkOrderId).toBeNull();
    expect(rfq.status).toBe(RfqStatus.QUOTED);
    expect(inventory.reservedQuantity).toBe(0);
    expect(orderCount).toBe(0);
    expect(effects.calls).toBe(0);
    failure.mockRestore();
  });

  it('is sequentially idempotent and does not repeat post-commit effects', async () => {
    fixture = await createFixture();
    await rfqs.acceptQuotationAndCreateOrder(
      fixture.buyer.id,
      fixture.quotation.id,
    );
    const second = await rfqs.acceptQuotationAndCreateOrder(
      fixture.buyer.id,
      fixture.quotation.id,
    );
    const inventory = await prisma.shopInventory.findUniqueOrThrow({
      where: { id: fixture.inventory.id },
    });
    expect(second.createdNow).toBe(false);
    const quote = await prisma.merchantQuotation.findUniqueOrThrow({
      where: { id: fixture.quotation.id },
    });
    expect(quote.wkOrderId).not.toBeNull();
    expect(
      await prisma.wkOrder.count({ where: { userId: fixture.buyer.id } }),
    ).toBe(1);
    expect(inventory.reservedQuantity).toBe(1);
    expect(effects.calls).toBe(1);
  });

  it('rejects expired, superseded, and another buyer acceptance attempts', async () => {
    fixture = await createFixture({ validUntil: new Date(Date.now() - 1_000) });
    await expect(
      rfqs.acceptQuotationAndCreateOrder(
        fixture.buyer.id,
        fixture.quotation.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await prisma.merchantQuotation.update({
      where: { id: fixture.quotation.id },
      data: {
        validUntil: new Date(Date.now() + 60_000),
        status: QuotationStatus.REVISED,
      },
    });
    const v2 = await prisma.merchantQuotation.create({
      data: {
        quotationNumber: `QT2-${randomUUID()}`,
        rfqId: fixture.rfq.id,
        merchantId: fixture.merchant.id,
        shopId: fixture.shop.id,
        buyerId: fixture.buyer.id,
        version: 2,
        status: QuotationStatus.SENT,
        unitPrice: 850,
        subtotal: 850,
        total: 850,
        validUntil: new Date(Date.now() + 60_000),
        sentAt: new Date(),
      },
    });
    await expect(
      rfqs.acceptQuotationAndCreateOrder(
        fixture.buyer.id,
        fixture.quotation.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      rfqs.acceptQuotationAndCreateOrder(fixture.otherBuyer.id, v2.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      rfqs.acceptQuotationAndCreateOrder(fixture.buyer.id, v2.id),
    ).resolves.toMatchObject({ createdNow: true });
  });

  it('enforces persisted commerce eligibility', async () => {
    for (const [merchantDomain, productDomain, allowed] of [
      [CommerceDomain.NON_FOOD, null, true],
      [CommerceDomain.FOOD, CommerceDomain.NON_FOOD, false],
      [null, CommerceDomain.NON_FOOD, false],
      [CommerceDomain.MIXED, CommerceDomain.NON_FOOD, true],
      [CommerceDomain.MIXED, CommerceDomain.FOOD, false],
      [CommerceDomain.MIXED, null, false],
    ] as const) {
      const candidate = await createFixture({ merchantDomain, productDomain });
      if (allowed)
        await expect(
          rfqs.acceptQuotationAndCreateOrder(
            candidate.buyer.id,
            candidate.quotation.id,
          ),
        ).resolves.toMatchObject({ createdNow: true });
      else
        await expect(
          rfqs.acceptQuotationAndCreateOrder(
            candidate.buyer.id,
            candidate.quotation.id,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      await candidate.cleanup();
    }
  });

  it('persists decline idempotently and rejects acceptance after decline', async () => {
    fixture = await createFixture();
    await expect(
      rfqs.declineQuotation(fixture.buyer.id, fixture.quotation.id),
    ).resolves.toMatchObject({ status: QuotationStatus.DECLINED });
    await expect(
      rfqs.declineQuotation(fixture.buyer.id, fixture.quotation.id),
    ).resolves.toMatchObject({ status: QuotationStatus.DECLINED });
    await expect(
      rfqs.acceptQuotationAndCreateOrder(
        fixture.buyer.id,
        fixture.quotation.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await prisma.wkOrder.count({ where: { userId: fixture.buyer.id } }),
    ).toBe(0);
    expect(
      (
        await prisma.shopInventory.findUniqueOrThrow({
          where: { id: fixture.inventory.id },
        })
      ).reservedQuantity,
    ).toBe(0);
  });

  it('preserves revised v1 and only converts a new v2', async () => {
    fixture = await createFixture();
    await rfqs.requestQuotationRevision(
      fixture.buyer.id,
      fixture.quotation.id,
      '  revise delivery details  ',
    );
    const v1 = await prisma.merchantQuotation.findUniqueOrThrow({
      where: { id: fixture.quotation.id },
    });
    expect(v1.status).toBe(QuotationStatus.REVISED);
    expect(v1.revisionRequest).toBe('revise delivery details');
    expect(Number(v1.unitPrice)).toBe(850);
    const v2 = await rfqs.quote(fixture.merchantUser.id, fixture.rfq.id, {
      unitPrice: 800,
      validUntil: new Date(Date.now() + 60_000).toISOString(),
      send: true,
    });
    expect(v2.version).toBe(2);
    expect(v2.status).toBe(QuotationStatus.SENT);
    await rfqs.acceptQuotationAndCreateOrder(fixture.buyer.id, v2.id);
    await expect(
      rfqs.requestQuotationRevision(fixture.buyer.id, v2.id, 'again'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      rfqs.declineQuotation(fixture.buyer.id, v2.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      (
        await prisma.merchantQuotation.findUniqueOrThrow({
          where: { id: fixture.quotation.id },
        })
      ).wkOrderId,
    ).toBeNull();
    expect(
      (
        await prisma.merchantQuotation.findUniqueOrThrow({
          where: { id: v2.id },
        })
      ).wkOrderId,
    ).not.toBeNull();
  });

  it('persists tax and other charges in the accepted snapshot and order total', async () => {
    fixture = await createFixture({ unitPrice: 1000 });
    await prisma.merchantQuotation.update({
      where: { id: fixture.quotation.id },
      data: { tax: 120, otherCharges: 80, total: 1200 },
    });
    await prisma.product.update({
      where: { id: fixture.product.id },
      data: { price: 1100, sellingPrice: 1100 },
    });
    await rfqs.acceptQuotationAndCreateOrder(
      fixture.buyer.id,
      fixture.quotation.id,
    );
    const quote = await prisma.merchantQuotation.findUniqueOrThrow({
      where: { id: fixture.quotation.id },
      include: { wkOrder: true },
    });
    expect(quote.acceptedSnapshot).toMatchObject({
      tax: 120,
      otherCharges: 80,
      total: 1200,
    });
    expect(Number(quote.wkOrder?.totalAmount)).toBe(1200);
  });

  it('uses the frozen RFQ WkOrder total, not the live catalogue price, for payment selection', async () => {
    fixture = await createFixture({ unitPrice: 850 });
    await prisma.merchantQuotation.update({
      where: { id: fixture.quotation.id },
      data: { tax: 100, otherCharges: 50, total: 1000 },
    });
    await prisma.product.update({
      where: { id: fixture.product.id },
      data: { price: 1100, sellingPrice: 1100 },
    });
    await rfqs.acceptQuotationAndCreateOrder(
      fixture.buyer.id,
      fixture.quotation.id,
    );
    const quote = await prisma.merchantQuotation.findUniqueOrThrow({
      where: { id: fixture.quotation.id },
      include: { wkOrder: true },
    });
    const order = quote.wkOrder!;
    expect(order.paymentMethod).toBe('pending_selection');
    expect(Number(order.totalAmount)).toBe(1000);
    await prisma.product.update({
      where: { id: fixture.product.id },
      data: { price: 1400, sellingPrice: 1400 },
    });
    await orders.selectPaymentMethod(order.id, fixture.buyer.id, 'gcash');
    expect(paymentGateway.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: Number(order.totalAmount) }),
    );
    expect(paymentGateway.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1000 }),
    );
  });

  it('blocks a different merchant from reading or quoting another merchant RFQ', async () => {
    fixture = await createFixture();
    const token = randomUUID();
    const merchantBUser = await prisma.user.create({
      data: {
        phone: `+63${Date.now()}999`,
        email: `stage2-b-${token}@test.invalid`,
        role: 'merchant',
      },
    });
    const merchantB = await prisma.merchant.create({
      data: {
        userId: merchantBUser.id,
        name: `Merchant B ${token}`,
        slug: `stage2-b-${token}`,
        commerceDomain: CommerceDomain.NON_FOOD,
      },
    });
    try {
      await expect(
        rfqs.merchantDetail(merchantBUser.id, fixture.rfq.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        rfqs.quote(merchantBUser.id, fixture.rfq.id, {
          unitPrice: 1,
          validUntil: new Date(Date.now() + 60_000).toISOString(),
          send: true,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        await prisma.merchantQuotation.count({
          where: { rfqId: fixture.rfq.id },
        }),
      ).toBe(1);
      expect(
        await prisma.wkOrder.count({ where: { userId: fixture.buyer.id } }),
      ).toBe(0);
    } finally {
      await prisma.merchant.delete({ where: { id: merchantB.id } });
      await prisma.user.delete({ where: { id: merchantBUser.id } });
    }
  });

  it('rolls back an ordinary direct order if inventory cannot be reserved', async () => {
    fixture = await createFixture({ stock: 0 });
    await expect(
      orders.create(fixture.buyer.id, {
        merchantId: fixture.merchant.id,
        shopId: fixture.shop.id,
        items: [{ productId: fixture.product.id, quantity: 1, price: 0 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await prisma.wkOrder.count({ where: { userId: fixture.buyer.id } }),
    ).toBe(0);
    expect(
      await prisma.orderItem.count({
        where: { productId: fixture.product.id },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.shopInventory.findUniqueOrThrow({
          where: { id: fixture.inventory.id },
        })
      ).reservedQuantity,
    ).toBe(0);
    expect(effects.calls).toBe(0);
  });

  it('creates a normal direct order at the live price and charges its persisted amount', async () => {
    fixture = await createFixture();
    await prisma.product.update({
      where: { id: fixture.product.id },
      data: { price: 1234.56, sellingPrice: 1234.56 },
    });
    await orders.create(fixture.buyer.id, {
      merchantId: fixture.merchant.id,
      shopId: fixture.shop.id,
      payment_method: 'gcash',
      items: [{ productId: fixture.product.id, quantity: 1, price: 0 }],
    });
    const order = await prisma.wkOrder.findFirstOrThrow({
      where: { userId: fixture.buyer.id },
      include: { orderItems: true, originatingQuotation: true },
    });
    expect(Number(order.totalAmount)).toBe(1234.56);
    expect(Number(order.orderItems[0].price)).toBe(1234.56);
    expect(order.originatingQuotation).toBeNull();
    expect(
      (
        await prisma.shopInventory.findUniqueOrThrow({
          where: { id: fixture.inventory.id },
        })
      ).reservedQuantity,
    ).toBe(1);
    expect(effects.calls).toBe(1);
    expect(paymentGateway.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1234.56 }),
    );
  });

  it('executes two real concurrent accepts with one persisted order and reservation', async () => {
    fixture = await createFixture();
    const results = await Promise.allSettled([
      rfqs.acceptQuotationAndCreateOrder(
        fixture.buyer.id,
        fixture.quotation.id,
      ),
      rfqs.acceptQuotationAndCreateOrder(
        fixture.buyer.id,
        fixture.quotation.id,
      ),
    ]);
    const [ordersCount, inventory] = await Promise.all([
      prisma.wkOrder.count({ where: { userId: fixture.buyer.id } }),
      prisma.shopInventory.findUniqueOrThrow({
        where: { id: fixture.inventory.id },
      }),
    ]);
    expect(ordersCount).toBe(1);
    expect(inventory.reservedQuantity).toBe(1);
    expect(effects.calls).toBe(1);
    expect(
      results.filter((result) => result.status === 'fulfilled').length,
    ).toBeGreaterThanOrEqual(1);
  });
});
