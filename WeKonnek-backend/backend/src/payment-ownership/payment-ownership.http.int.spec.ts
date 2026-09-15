import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import {
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  UserRole,
} from '@prisma/client';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGatewayService } from '../modules/wallet/payment-gateway.service';

describe('Stage 1B payment ownership HTTP acceptance', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let gateway: PaymentGatewayService;
  let customerA: any;
  let customerB: any;
  let merchantUserA: any;
  let merchantUserB: any;
  let rider: any;
  let merchantA: any;
  let merchantB: any;
  let shopA: any;
  let productA: any;
  let orderA: any;
  let orderB: any;
  const runtimeI18n = join(process.cwd(), 'i18n');
  const sourceI18n = join(process.cwd(), 'src', 'i18n');
  const token = (user: any) =>
    sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET || 'dev-secret', {
      expiresIn: '1h',
    });
  const auth = (user: any) => ({ Authorization: `Bearer ${token(user)}` });

  beforeAll(async () => {
    if (!existsSync(runtimeI18n)) {
      mkdirSync(runtimeI18n, { recursive: true });
      cpSync(sourceI18n, runtimeI18n, { recursive: true });
    }
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    gateway = app.get(PaymentGatewayService);
  });

  beforeEach(async () => {
    const suffix = randomUUID().replace(/-/g, '');
    const makeUser = (role: UserRole) =>
      prisma.user.create({
        data: {
          phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`,
          email: `s1b-${role}-${randomUUID()}@test.invalid`,
          role,
        },
      });
    customerA = await makeUser(UserRole.customer);
    customerB = await makeUser(UserRole.customer);
    merchantUserA = await makeUser(UserRole.merchant);
    merchantUserB = await makeUser(UserRole.merchant);
    rider = await makeUser(UserRole.rider);
    merchantA = await prisma.merchant.create({
      data: { userId: merchantUserA.id, name: `Stage 1 A ${suffix}`, slug: `s1b-a-${suffix}` },
    });
    merchantB = await prisma.merchant.create({
      data: { userId: merchantUserB.id, name: `Stage 1 B ${suffix}`, slug: `s1b-b-${suffix}` },
    });
    shopA = await prisma.branch.create({
      data: { merchantId: merchantA.id, name: `Stage 1 Shop ${suffix}` },
    });
    productA = await prisma.product.create({
      data: { merchantId: merchantA.id, name: 'Stage 1 product', price: 100, sellingPrice: 100 },
    });
    const makeOrder = (userId: string, merchantId: number, code: string) =>
      prisma.wkOrder.create({
        data: {
          orderCode: code,
          userId,
          merchantId,
          status: 'pending',
          orderType: 'delivery',
          totalAmount: 115,
          deliveryFee: 10,
          transactionFeeAmount: 5,
          paymentMethod: 'pending_selection',
          paymentStatus: 'pending',
          merchantPaymentStatus: MerchantPaymentStatus.AWAITING_PAYMENT,
          orderItems: { create: [{ productName: 'Stage 1 item', quantity: 1, price: 100, subtotal: 100 }] },
        },
      });
    orderA = await makeOrder(customerA.id, merchantA.id, `S1B-A-${suffix}`);
    orderB = await makeOrder(customerB.id, merchantB.id, `S1B-B-${suffix}`);
  });

  afterEach(async () => {
    const orderIds = [orderA?.id, orderB?.id].filter(Boolean);
    if (orderIds.length) {
      await prisma.orderDomainEvent.deleteMany({ where: { wkOrderId: { in: orderIds } } });
      await prisma.merchantPaymentEvidence.deleteMany({ where: { wkOrderId: { in: orderIds } } });
      await prisma.orderPaymentAllocation.deleteMany({ where: { wkOrderId: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.wkOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    await prisma.product.deleteMany({ where: { id: productA?.id } });
    await prisma.branch.deleteMany({ where: { id: shopA?.id } });
    await prisma.merchantPaymentMethod.deleteMany({ where: { merchantId: { in: [merchantA?.id, merchantB?.id].filter(Boolean) } } });
    await prisma.merchant.deleteMany({ where: { id: { in: [merchantA?.id, merchantB?.id].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: [customerA?.id, customerB?.id, merchantUserA?.id, merchantUserB?.id, rider?.id].filter(Boolean) } } });
  });

  afterAll(async () => {
    await app?.close();
    if (existsSync(runtimeI18n)) rmSync(runtimeI18n, { recursive: true, force: true });
  });

  it('shows only the owning merchant options and isolates private order context', async () => {
    const qr = await prisma.merchantPaymentMethod.create({ data: { id: randomUUID(), merchantId: merchantA.id, kind: MerchantPaymentMethodKind.MERCHANT_QR, displayName: 'Merchant A QR', qrAssetUrl: 'https://merchant-a.invalid/qr' } });
    const bank = await prisma.merchantPaymentMethod.create({ data: { id: randomUUID(), merchantId: merchantA.id, kind: MerchantPaymentMethodKind.BANK_TRANSFER, displayName: 'Merchant A bank', accountReference: 'A-123' } });
    const hidden = await prisma.merchantPaymentMethod.create({ data: { id: randomUUID(), merchantId: merchantB.id, kind: MerchantPaymentMethodKind.MERCHANT_QR, displayName: 'Merchant B QR', qrAssetUrl: 'https://merchant-b.invalid/qr' } });
    const response = await request(app.getHttpServer()).get(`/orders/${orderA.id}/payment-options`).set(auth(customerA)).query({ merchantId: merchantB.id, beneficiary: 'PLATFORM' }).expect(200);
    expect(response.body.beneficiary).toBe('MERCHANT');
    expect(response.body.paymentOptions.map((method: any) => method.id)).toEqual(expect.arrayContaining([qr.id, bank.id]));
    expect(response.body.paymentOptions.map((method: any) => method.id)).not.toContain(hidden.id);
    expect(response.body.wekonnekPayCoolsAllowed).toBe(false);
    await request(app.getHttpServer()).get(`/orders/${orderA.id}/payment-options`).set(auth(customerB)).expect(404);
  });

  it('enforces merchant configuration ownership and hides disabled methods', async () => {
    const created = await request(app.getHttpServer()).post(`/merchants/${merchantA.id}/payment-methods`).set(auth(merchantUserA)).send({ kind: 'MERCHANT_QR', displayName: 'A QR', qrAssetUrl: 'https://a.invalid/qr' }).expect(201);
    await request(app.getHttpServer()).post(`/merchants/${merchantA.id}/payment-methods`).set(auth(customerA)).send({ kind: 'BANK_TRANSFER', displayName: 'bad' }).expect(403);
    await request(app.getHttpServer()).post(`/merchants/${merchantA.id}/payment-methods`).set(auth(merchantUserB)).send({ kind: 'BANK_TRANSFER', displayName: 'bad' }).expect(403);
    await request(app.getHttpServer()).patch(`/merchant-payment-methods/${created.body.id}`).set(auth(merchantUserB)).send({ enabled: false }).expect(403);
    await request(app.getHttpServer()).patch(`/merchant-payment-methods/${created.body.id}`).set(auth(merchantUserA)).send({ enabled: false }).expect(200);
    const options = await request(app.getHttpServer()).get(`/orders/${orderA.id}/payment-options`).set(auth(customerA)).expect(200);
    expect(options.body.paymentOptions.map((method: any) => method.id)).not.toContain(created.body.id);
  });

  it('accepts customer evidence only for an enabled same-merchant method and merchant verifies idempotently', async () => {
    const methodA = await prisma.merchantPaymentMethod.create({ data: { id: randomUUID(), merchantId: merchantA.id, kind: MerchantPaymentMethodKind.BANK_TRANSFER, displayName: 'A Bank', accountReference: 'A-1' } });
    const methodB = await prisma.merchantPaymentMethod.create({ data: { id: randomUUID(), merchantId: merchantB.id, kind: MerchantPaymentMethodKind.BANK_TRANSFER, displayName: 'B Bank', accountReference: 'B-1' } });
    await request(app.getHttpServer()).post(`/orders/${orderA.id}/merchant-payment-evidence`).set(auth(customerA)).send({ merchantPaymentMethodId: methodB.id, declaredAmount: 1 }).expect(404);
    const submitted = await request(app.getHttpServer()).post(`/orders/${orderA.id}/merchant-payment-evidence`).set(auth(customerA)).send({ merchantPaymentMethodId: methodA.id, declaredAmount: 1, customerReference: 'declared-only', idempotencyKey: `proof-${randomUUID()}` }).expect(201);
    expect(Number(submitted.body.declaredAmount)).toBe(1);
    await request(app.getHttpServer()).post(`/merchant-payment-evidences/${submitted.body.id}/verify`).set(auth(customerA)).send({ verifiedBy: merchantUserA.id }).expect(403);
    await request(app.getHttpServer()).post(`/merchant-payment-evidences/${submitted.body.id}/verify`).set(auth(merchantUserB)).expect(403);
    const verified = await request(app.getHttpServer()).post(`/merchant-payment-evidences/${submitted.body.id}/verify`).set(auth(merchantUserA)).expect(201);
    expect(verified.body.evidence.status).toBe('VERIFIED');
    expect(verified.body.idempotent).toBe(false);
    const duplicate = await request(app.getHttpServer()).post(`/merchant-payment-evidences/${submitted.body.id}/verify`).set(auth(merchantUserA)).expect(201);
    expect(duplicate.body.idempotent).toBe(true);
    const order = await prisma.wkOrder.findUniqueOrThrow({ where: { id: orderA.id } });
    expect(order.merchantPaymentStatus).toBe(MerchantPaymentStatus.VERIFIED);
    expect(Number(order.totalAmount)).toBe(115);
    expect(order.status).toBe('pending');
  });

  it('allows only the owning merchant to reject proof and keeps fulfillment and totals unchanged', async () => {
    const method = await prisma.merchantPaymentMethod.create({ data: { id: randomUUID(), merchantId: merchantA.id, kind: MerchantPaymentMethodKind.BANK_TRANSFER, displayName: 'Reject bank', accountReference: 'A-reject' } });
    const submitted = await request(app.getHttpServer()).post(`/orders/${orderA.id}/merchant-payment-evidence`).set(auth(customerA)).send({ merchantPaymentMethodId: method.id, idempotencyKey: `reject-${randomUUID()}` }).expect(201);
    await request(app.getHttpServer()).post(`/merchant-payment-evidences/${submitted.body.id}/reject`).set(auth(customerA)).send({ reason: 'spoof' }).expect(403);
    await request(app.getHttpServer()).post(`/merchant-payment-evidences/${submitted.body.id}/reject`).set(auth(merchantUserB)).send({ reason: 'wrong merchant' }).expect(403);
    const rejected = await request(app.getHttpServer()).post(`/merchant-payment-evidences/${submitted.body.id}/reject`).set(auth(merchantUserA)).send({ reason: 'unreadable proof' }).expect(201);
    expect(rejected.body.evidence.status).toBe('REJECTED');
    const duplicate = await request(app.getHttpServer()).post(`/merchant-payment-evidences/${submitted.body.id}/reject`).set(auth(merchantUserA)).send({ reason: 'retry' }).expect(201);
    expect(duplicate.body.idempotent).toBe(true);
    const order = await prisma.wkOrder.findUniqueOrThrow({ where: { id: orderA.id } });
    expect(order.merchantPaymentStatus).toBe(MerchantPaymentStatus.REJECTED);
    expect(order.status).toBe('pending');
    expect(Number(order.totalAmount)).toBe(115);
  });

  it('rejects every legacy WeKonnek gateway order path before provider invocation', async () => {
    const provider = jest.spyOn(gateway, 'createPayment');
    for (const method of ['gcash', 'maya', 'card']) {
      await request(app.getHttpServer()).post(`/orders/${orderA.id}/payment-selection`).set(auth(customerA)).send({ method, gateway: 'paymongo', beneficiary: 'PLATFORM', purpose: 'PLATFORM_WALLET_RELOAD' }).expect(403);
    }
    await prisma.wkOrder.update({ where: { id: orderA.id }, data: { orderType: 'dine_in', status: 'payment_pending', paymentMethod: 'pending_selection' } });
    await request(app.getHttpServer()).post(`/orders/${orderA.id}/checkout-payment`).set(auth(customerA)).send({ method: 'gcash', gateway: 'xendit' }).expect(403);
    expect(provider).not.toHaveBeenCalled();
    const unchanged = await prisma.wkOrder.findUniqueOrThrow({ where: { id: orderA.id } });
    expect(unchanged.paymentStatus).toBe('pending');
    expect(unchanged.paymentRef).toBeNull();
  });

  it('blocks repeated merchant-order PayCools attacks without provider or financial side effects', async () => {
    await prisma.wkOrder.update({ where: { id: orderA.id }, data: { paymentMethod: 'cod' } });
    const beforeTransactions = await prisma.platformPaymentTransaction.count({ where: { sourceId: String(orderA.id) } });
    await request(app.getHttpServer()).post(`/orders/${orderA.id}/paycools-payment`).set(auth(customerA)).send({ beneficiary: 'PLATFORM', purpose: 'PLATFORM_OTHER' }).expect(403);
    await request(app.getHttpServer()).post(`/orders/${orderA.id}/paycools-payment`).set(auth(customerA)).expect(403);
    expect(await prisma.platformPaymentTransaction.count({ where: { sourceId: String(orderA.id) } })).toBe(beforeTransactions);
    const unchanged = await prisma.wkOrder.findUniqueOrThrow({ where: { id: orderA.id } });
    expect(unchanged.paymentRef).toBeNull();
    expect(unchanged.paymentUrl).toBeNull();
    expect(unchanged.paymentStatus).toBe('pending');
    expect(await prisma.orderDomainEvent.count({ where: { wkOrderId: orderA.id, action: 'FORBIDDEN_MERCHANT_ORDER_PAYCOOLS_ATTEMPT' } })).toBe(2);
  });

  it('rejects online merchant-order creation before a legacy gateway can be called', async () => {
    const provider = jest.spyOn(gateway, 'createPayment');
    await request(app.getHttpServer())
      .post('/orders')
      .set(auth(customerA))
      .send({
        merchant_id: merchantA.id,
        shop_id: shopA.id,
        payment_method: 'gcash',
        gateway: 'paymongo',
        beneficiary: 'PLATFORM',
        purpose: 'PLATFORM_OTHER',
        items: [{ product_id: productA.id, quantity: 1, price: 0 }],
      })
      .expect(403);
    expect(provider).not.toHaveBeenCalled();
    expect(await prisma.wkOrder.count({ where: { userId: customerA.id, merchantId: merchantA.id } })).toBe(1);
  });
});
