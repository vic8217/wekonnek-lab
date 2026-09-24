import { FulfillmentStatus, RiderAssignmentStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import request from 'supertest';
import {
  authHeader,
  bootUce2App,
  cleanupOrder,
  describeUce2Live,
  isApprovedUce2Target,
  seedActors,
  seedOrder,
  UCE2_LIVE,
} from './uce2-live.harness';

jest.setTimeout(180_000);

describe('UCE-2 harness database identity', () => {
  it('accepts only the UCE-2 cursor and terra names', () => {
    expect(isApprovedUce2Target('wekonnek_uce2_cursor_test')).toBe(true);
    expect(isApprovedUce2Target('wekonnek_uce2_terra_test')).toBe(true);
    expect(isApprovedUce2Target('wekonnek_uce1b_cursor_test')).toBe(false);
    expect(isApprovedUce2Target('wekonnek_stage12_test')).toBe(false);
  });
});

describeUce2Live('UCE-2 rider assignment list and detail', () => {
  let live: Awaited<ReturnType<typeof bootUce2App>>;

  beforeAll(async () => {
    if (!UCE2_LIVE) return;
    live = await bootUce2App();
  });
  afterAll(async () => {
    await live?.close();
  });

  it('uses the JWT rider, ignores a client riderId, and hides unrelated work', async () => {
    const actors = await seedActors(live.prisma);
    const own = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.picked_up,
      activeRiderId: actors.rider.id,
      physicalCustodianRiderId: actors.rider.id,
    });
    const other = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.picked_up,
      activeRiderId: actors.riderB.id,
      physicalCustodianRiderId: actors.riderB.id,
    });
    const pendingOnly = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.in_transit,
      activeRiderId: actors.riderB.id,
      physicalCustodianRiderId: actors.riderB.id,
      pendingCustodyIncomingRiderId: actors.rider.id,
    });
    const superseded = await live.prisma.riderAssignment.create({
      data: {
        id: randomUUID(),
        fulfillmentId: other.fulfillment.id,
        riderId: actors.rider.id,
        status: RiderAssignmentStatus.SUPERSEDED,
        assignmentVersion: 1,
      },
    });

    const list = await request(live.app.getHttpServer())
      .get('/rider/assignments')
      .query({ riderId: actors.riderB.id })
      .set(authHeader(actors.rider))
      .expect(200);
    const ids = list.body.items.map((item: { orderId: number }) => item.orderId);
    expect(ids).toContain(own.order.id);
    expect(ids).not.toContain(other.order.id);
    expect(ids).not.toContain(pendingOnly.order.id);
    expect(list.body.items[0].delivery.dropoff.recipientName).toBeNull();
    expect(list.body.items[0].riderAdvance.exists).toBe(false);
    expect(list.body.items[0]).not.toHaveProperty('authorizedRecipient');

    const detail = await request(live.app.getHttpServer())
      .get(`/rider/assignments/${own.order.id}`)
      .set(authHeader(actors.rider))
      .expect(200);
    expect(detail.body.instructions).toBe('leave at door');
    expect(detail.body.items).toEqual([{ name: 'UCE2 Item', quantity: 2 }]);
    expect(detail.body.latestAttempt).toBeNull();
    expect(detail.body).not.toHaveProperty('authorizedRecipient');

    await request(live.app.getHttpServer())
      .get(`/rider/assignments/${other.order.id}`)
      .set(authHeader(actors.rider))
      .expect(403);
    await request(live.app.getHttpServer())
      .get('/rider/assignments/99999999')
      .set(authHeader(actors.rider))
      .expect(403);
    await request(live.app.getHttpServer())
      .get('/rider/assignments')
      .set(authHeader(actors.driver))
      .expect(200);
    await request(live.app.getHttpServer())
      .get('/rider/assignments')
      .set(authHeader({ id: actors.inactive.id, role: UserRole.rider }))
      .expect(403);

    const custodian = await seedOrder(live.prisma, actors, {
      status: FulfillmentStatus.in_transit,
      activeRiderId: actors.riderB.id,
      physicalCustodianRiderId: actors.rider.id,
    });
    const custodianDetail = await request(live.app.getHttpServer())
      .get(`/rider/assignments/${custodian.order.id}`)
      .set(authHeader(actors.rider))
      .expect(200);
    expect(custodianDetail.body.fulfillment.assignment.isActiveRider).toBe(false);
    expect(custodianDetail.body.fulfillment.custody.hasPhysicalCustody).toBe(true);

    await live.prisma.riderAssignment.delete({ where: { id: superseded.id } });
    await cleanupOrder(live.prisma, own.order.id, own.fulfillment.id);
    await cleanupOrder(live.prisma, other.order.id, other.fulfillment.id);
    await cleanupOrder(live.prisma, pendingOnly.order.id, pendingOnly.fulfillment.id);
    await cleanupOrder(live.prisma, custodian.order.id, custodian.fulfillment.id);
    await live.prisma.merchant.deleteMany({
      where: { id: { in: [actors.merchant.id, actors.otherMerchant.id] } },
    });
    await live.prisma.user.deleteMany({
      where: {
        id: {
          in: [
            actors.customer.id,
            actors.otherCustomer.id,
            actors.rider.id,
            actors.riderB.id,
            actors.driver.id,
            actors.inactive.id,
            actors.merchantUser.id,
            actors.otherMerchantUser.id,
            actors.admin.id,
          ],
        },
      },
    });
  });
});
