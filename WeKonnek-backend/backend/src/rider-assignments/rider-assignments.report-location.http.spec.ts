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
} from './uce2-live.harness';

jest.setTimeout(180_000);

describeUce2Live('UCE-2 location write', () => {
  let live: Awaited<ReturnType<typeof bootUce2App>>;

  beforeAll(async () => {
    if (!UCE2_LIVE) return;
    live = await bootUce2App();
  });
  afterAll(async () => {
    await live?.close();
  });

  it('appends a canonical sample only for the in-transit custodian', async () => {
    const actors = await seedActors(live.prisma);
    const moving = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.in_transit,
      activeRiderId: actors.rider.id,
      physicalCustodianRiderId: actors.rider.id,
    });
    const financeBefore = await live.prisma.wkOrder.findUniqueOrThrow({
      where: { id: moving.order.id },
      select: { paymentStatus: true, merchantPaymentStatus: true },
    });
    const response = await request(live.app.getHttpServer())
      .post(`/rider/assignments/${moving.order.id}/location`)
      .set(authHeader(actors.rider))
      .send({
        latitude: 14.55,
        lng: 121.02,
        accuracy: 8,
        heading: 20,
        speed: 3,
        recordedAt: '1999-01-01T00:00:00.000Z',
      })
      .expect(202);
    expect(response.body.accepted).toBe(true);
    expect(response.body.recordedAt).not.toContain('1999-01-01');
    const sample = await live.prisma.riderLocation.findFirstOrThrow({
      where: { wkOrderId: moving.order.id },
    });
    expect(sample.orderId).toBeNull();
    expect(sample.wkOrderId).toBe(moving.order.id);
    expect(sample.riderId).toBe(actors.rider.id);
    const row = await live.prisma.orderFulfillment.findUniqueOrThrow({
      where: { id: moving.fulfillment.id },
    });
    expect(row.physicalCustodianRiderId).toBe(actors.rider.id);
    expect(row.status).toBe(FulfillmentStatus.in_transit);
    expect(
      await live.prisma.custodyEvent.count({ where: { wkOrderId: moving.order.id } }),
    ).toBe(0);
    expect(
      await live.prisma.wkOrder.findUniqueOrThrow({
        where: { id: moving.order.id },
        select: { paymentStatus: true, merchantPaymentStatus: true },
      }),
    ).toEqual(financeBefore);

    const assigneeOnly = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.in_transit,
      activeRiderId: actors.rider.id,
      physicalCustodianRiderId: actors.riderB.id,
    });
    await request(live.app.getHttpServer())
      .post(`/rider/assignments/${assigneeOnly.order.id}/location`)
      .set(authHeader(actors.rider))
      .send({ lat: 14.5, lng: 121 })
      .expect(403);

    const custodianNotAssignee = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.in_transit,
      activeRiderId: actors.riderB.id,
      physicalCustodianRiderId: actors.rider.id,
    });
    await request(live.app.getHttpServer())
      .post(`/rider/assignments/${custodianNotAssignee.order.id}/location`)
      .set(authHeader(actors.rider))
      .send({ lat: 14.6, lng: 121.1 })
      .expect(202);

    const incoming = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.in_transit,
      activeRiderId: actors.riderB.id,
      physicalCustodianRiderId: actors.riderB.id,
      pendingCustodyIncomingRiderId: actors.rider.id,
    });
    await request(live.app.getHttpServer())
      .post(`/rider/assignments/${incoming.order.id}/location`)
      .set(authHeader(actors.rider))
      .send({ lat: 14.5, lng: 121 })
      .expect(403);

    await request(live.app.getHttpServer())
      .post(`/rider/assignments/${moving.order.id}/location`)
      .set(authHeader(actors.riderB))
      .send({ lat: 14.5, lng: 121 })
      .expect(403);

    const picked = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.picked_up,
      activeRiderId: actors.rider.id,
      physicalCustodianRiderId: actors.rider.id,
    });
    await request(live.app.getHttpServer())
      .post(`/rider/assignments/${picked.order.id}/location`)
      .set(authHeader(actors.rider))
      .send({ lat: 14.5, lng: 121 })
      .expect(403);

    await request(live.app.getHttpServer())
      .post(`/rider/assignments/${moving.order.id}/location`)
      .set(authHeader(actors.rider))
      .send({ lat: 91, lng: 0 })
      .expect(400);
    await request(live.app.getHttpServer())
      .post(`/rider/assignments/${moving.order.id}/location`)
      .set(authHeader(actors.rider))
      .send({ lat: 0, lng: 200 })
      .expect(400);
    await request(live.app.getHttpServer())
      .post(`/rider/assignments/${moving.order.id}/location`)
      .set(authHeader(actors.rider))
      .send({ lat: 0, lng: 0, accuracy: -1, heading: 400, speed: 5000 })
      .expect(400);
    await request(live.app.getHttpServer())
      .post(`/rider/assignments/${moving.order.id}/location`)
      .set(authHeader(actors.rider))
      .send({ lat: 1, latitude: 2, lng: 3 })
      .expect(400);

    for (const created of [
      moving,
      assigneeOnly,
      custodianNotAssignee,
      incoming,
      picked,
    ]) {
      await cleanupOrder(live.prisma, created.order.id, created.fulfillment.id);
    }
    await live.prisma.merchant.deleteMany({
      where: { id: { in: [actors.merchant.id, actors.otherMerchant.id] } },
    });
    await live.prisma.user.deleteMany({
      where: { email: { contains: actors.tag } },
    });
  });
});
