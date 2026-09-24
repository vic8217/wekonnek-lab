import { FulfillmentStatus } from '@prisma/client';
import request from 'supertest';
import {
  authHeader,
  bootUce2App,
  cleanupOrder,
  describeUce2Live,
  seedActors,
  seedOrder,
  UCE2_LIVE,
} from '../../rider-assignments/uce2-live.harness';

jest.setTimeout(180_000);

describeUce2Live('UCE-2 canonical location read', () => {
  let live: Awaited<ReturnType<typeof bootUce2App>>;

  beforeAll(async () => {
    if (!UCE2_LIVE) return;
    live = await bootUce2App();
  });
  afterAll(async () => {
    await live?.close();
  });

  it('isolates the canonical sample and ignores a legacy order_id row', async () => {
    const actors = await seedActors(live.prisma);
    const order = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.delivered,
      activeRiderId: actors.rider.id,
      physicalCustodianRiderId: actors.rider.id,
    });
    const empty = await request(live.app.getHttpServer())
      .get(`/tracking/orders/${order.order.id}/location`)
      .set(authHeader(actors.customer))
      .expect(200);
    expect(empty.body).toEqual({ location: null });

    await live.prisma.riderLocation.create({
      data: {
        riderId: actors.rider.id,
        orderId: null,
        wkOrderId: order.order.id,
        lat: 14.2,
        lng: 121.3,
        accuracy: 5,
      },
    });
    await live.prisma.riderLocation.create({
      data: {
        riderId: actors.riderB.id,
        orderId: order.fulfillment.id,
        lat: 1,
        lng: 1,
      },
    });

    const own = await request(live.app.getHttpServer())
      .get(`/tracking/orders/${order.order.id}/location`)
      .set(authHeader(actors.customer))
      .expect(200);
    expect(own.body.location.lat).toBe(14.2);
    expect(own.body.location.riderId).toBe(actors.rider.id);
    expect(own.body.location.wkOrderId).toBe(order.order.id);

    await request(live.app.getHttpServer())
      .get(`/tracking/orders/${order.order.id}/location`)
      .set(authHeader(actors.otherCustomer))
      .expect(403);
    await request(live.app.getHttpServer())
      .get(`/tracking/orders/${order.order.id}/location`)
      .set(authHeader(actors.merchantUser))
      .expect(403);
    await request(live.app.getHttpServer())
      .get(`/tracking/orders/${order.order.id}/location`)
      .set(authHeader(actors.otherMerchantUser))
      .expect(403);
    await request(live.app.getHttpServer())
      .get(`/tracking/orders/${order.order.id}/location`)
      .set(authHeader(actors.rider))
      .expect(200);
    await request(live.app.getHttpServer())
      .get(`/tracking/orders/${order.order.id}/location`)
      .set(authHeader(actors.riderB))
      .expect(403);
    await request(live.app.getHttpServer())
      .get(`/tracking/orders/${order.order.id}/location`)
      .set(authHeader(actors.admin))
      .expect(200);
    await request(live.app.getHttpServer())
      .get('/tracking/orders/99999999/location')
      .set(authHeader(actors.customer))
      .expect(403);

    const incoming = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.in_transit,
      activeRiderId: actors.rider.id,
      physicalCustodianRiderId: actors.rider.id,
      pendingCustodyIncomingRiderId: actors.riderB.id,
    });
    await request(live.app.getHttpServer())
      .get(`/tracking/orders/${incoming.order.id}/location`)
      .set(authHeader(actors.riderB))
      .expect(403);

    await cleanupOrder(live.prisma, order.order.id, order.fulfillment.id);
    await cleanupOrder(live.prisma, incoming.order.id, incoming.fulfillment.id);
    await live.prisma.merchant.deleteMany({
      where: { id: { in: [actors.merchant.id, actors.otherMerchant.id] } },
    });
    await live.prisma.user.deleteMany({
      where: { email: { contains: actors.tag } },
    });
  });
});
