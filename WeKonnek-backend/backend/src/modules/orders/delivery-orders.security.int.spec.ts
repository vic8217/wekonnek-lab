import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { RiderAssignmentService } from '../../fulfillment/rider-assignment.service';
import { OrderStatus, OrderType, PaymentMethod, PaymentStatus, UserRole } from '@prisma/client';

describe('Stage 0B delivery-order HTTP security (integration)', () => {
  let app: INestApplication; let prisma: PrismaService; let assignments: RiderAssignmentService;
  let customerA: any; let customerB: any; let riderA: any; let riderB: any; let merchant: any; let orderA: any; let orderB: any;
  const token = (u: any) => sign({ sub: u.id, role: u.role }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '1h' });
  const auth = (u: any) => ({ Authorization: `Bearer ${token(u)}` });
  const runtimeI18n = join(process.cwd(), 'i18n'); const sourceI18n = join(process.cwd(), 'src', 'i18n');
  beforeAll(async () => { if (!existsSync(runtimeI18n)) { mkdirSync(runtimeI18n, { recursive: true }); cpSync(sourceI18n, runtimeI18n, { recursive: true }); } const mod = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = mod.createNestApplication(); await app.init(); prisma = app.get(PrismaService); assignments = app.get(RiderAssignmentService); });
  beforeEach(async () => {
    const tag = randomUUID().replace(/-/g, '');
    const user = (role: UserRole) => prisma.user.create({ data: { phone: `+63${randomUUID().replace(/-/g, '').slice(0, 16)}`, email: `${role}-${randomUUID()}@test.invalid`, role } });
    customerA = await user(UserRole.customer); customerB = await user(UserRole.customer); riderA = await user(UserRole.rider); riderB = await user(UserRole.rider); merchant = await user(UserRole.merchant);
    const make = (customerId: string, status = OrderStatus.pending) => prisma.order.create({ data: { orderNumber: `S0B-${tag}-${Math.random()}`, type: OrderType.express, status, customerId, items: [], pickupAddress: {}, deliveryAddress: {}, paymentMethod: PaymentMethod.cash, paymentStatus: PaymentStatus.pending_payment } });
    orderA = await make(customerA.id); orderB = await make(customerB.id);
  });
  afterEach(async () => { if (!prisma) return; const ids = [orderA?.id, orderB?.id].filter(Boolean); if(ids.length) { await prisma.orderDomainEvent.deleteMany({ where:{ orderV2Id:{in:ids} } }); await prisma.riderAssignment.deleteMany({ where:{orderV2Id:{in:ids}} }); await prisma.orderFulfillment.deleteMany({where:{orderV2Id:{in:ids}}}); await prisma.order.deleteMany({where:{id:{in:ids}}}); } await prisma.user.deleteMany({where:{id:{in:[customerA?.id,customerB?.id,riderA?.id,riderB?.id,merchant?.id].filter(Boolean)}}}); });
  afterAll(async () => { await app?.close(); if (existsSync(runtimeI18n)) rmSync(runtimeI18n, { recursive: true, force: true }); });
  it('rejects unauthenticated protected delivery and payment routes', async () => { await request(app.getHttpServer()).get('/delivery-orders').expect(401); await request(app.getHttpServer()).get(`/delivery-orders/${orderA.id}`).expect(401); await request(app.getHttpServer()).put(`/delivery-orders/${orderA.id}/payment`).send({paymentStatus:'paid'}).expect(401); });
  it('enforces customer isolation and provider-managed payment status', async () => { await request(app.getHttpServer()).get(`/delivery-orders/${orderA.id}`).set(auth(customerA)).expect(200); await request(app.getHttpServer()).get(`/delivery-orders/${orderB.id}`).set(auth(customerA)).expect(403); await request(app.getHttpServer()).put(`/delivery-orders/${orderB.id}/rate`).set(auth(customerA)).send({rating:5}).expect(403); await request(app.getHttpServer()).put(`/delivery-orders/${orderA.id}/payment`).set(auth(customerA)).send({paymentStatus:'paid'}).expect(403); });
  it('fails closed for merchants on legacy orders_v2 and blocks unassigned riders', async () => { await request(app.getHttpServer()).get(`/delivery-orders/${orderA.id}`).set(auth(merchant)).expect(403); await request(app.getHttpServer()).put(`/delivery-orders/${orderA.id}/status`).set(auth(riderB)).send({status:'confirmed'}).expect(403); await request(app.getHttpServer()).put(`/delivery-orders/${orderA.id}/payment`).set(auth(merchant)).send({paymentStatus:'paid'}).expect(403); });
  it('enforces tracking privacy for customer, active rider, and admin', async () => { await prisma.order.update({where:{id:orderA.id},data:{status:OrderStatus.ready_for_pickup}}); await assignments.assign({orderV2Id:orderA.id,riderId:riderA.id,actor:{type:'SYSTEM_ADMIN'}}); await prisma.riderLocation.create({data:{riderId:riderA.id,orderId:orderA.id,lat:14.5,lng:121}}); await request(app.getHttpServer()).get(`/tracking/order/${orderA.id}/trail`).set(auth(customerA)).expect(200); await request(app.getHttpServer()).get(`/tracking/order/${orderA.id}/trail`).set(auth(customerB)).expect(403); await request(app.getHttpServer()).get(`/tracking/rider/${riderA.id}/latest?orderId=${orderA.id}`).set(auth(riderA)).expect(200); await request(app.getHttpServer()).get(`/tracking/rider/${riderA.id}/latest?orderId=${orderA.id}`).set(auth(riderB)).expect(403); await request(app.getHttpServer()).get('/tracking/riders/active').set(auth(customerA)).expect(403); });
});
