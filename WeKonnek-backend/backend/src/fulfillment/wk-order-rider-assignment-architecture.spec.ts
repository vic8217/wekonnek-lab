import { readFileSync } from 'fs';
import { join } from 'path';

describe('UCE-1 canonical WkOrder rider-assignment architecture', () => {
  const root = join(__dirname);
  const controller = readFileSync(
    join(root, 'wk-order-rider-assignment.controller.ts'),
    'utf8',
  );
  const service = readFileSync(join(root, 'rider-assignment.service.ts'), 'utf8');
  const moduleSrc = readFileSync(join(root, 'fulfillment.module.ts'), 'utf8');

  it('HTTP adapter is a thin delegate to RiderAssignmentService.assign', () => {
    expect(controller).toContain("Post('orders/:wkOrderId/rider-assignment')");
    expect(controller).toContain('this.assignments.assign');
    expect(controller).toContain('wkOrderId');
    expect(controller).not.toContain('allowReassignment:');
    expect(controller).not.toContain('orderV2Id');
    expect(controller).not.toContain('delivery-orders');
    expect(controller).not.toContain("from '../modules/orders/orders.service'");
    expect(controller).not.toMatch(/physicalCustodianRiderId:\s*riderId/);
    expect(controller).not.toMatch(/if\s*\(\s*fulfillment\.status/);
    expect(controller).not.toMatch(/riderAssignment\.create/);
  });

  it('canonical assignment service does not import legacy delivery-order assignment', () => {
    expect(service).not.toContain("from '../modules/orders/orders.service'");
    expect(service).not.toContain('delivery-orders.assignRider');
    expect(moduleSrc).toContain('WkOrderRiderAssignmentController');
  });

  it('wkOrderId lock order is orders then order_fulfillments', () => {
    const lock = service.slice(service.indexOf('private async lockFulfillment'));
    const wk = lock.slice(lock.indexOf('if (input.wkOrderId != null)'));
    const ordersLock = wk.indexOf('FROM "orders"');
    const fulfillmentLock = wk.indexOf('FROM "order_fulfillments"');
    expect(ordersLock).toBeGreaterThan(-1);
    expect(fulfillmentLock).toBeGreaterThan(ordersLock);
    expect(wk.slice(0, fulfillmentLock)).toContain('FOR UPDATE');
  });

  it('initial HTTP path cannot enable reassignment and does not write custody', () => {
    expect(controller).not.toContain('allowReassignment: true');
    expect(controller).not.toContain('RIDER_TRANSFER_RELEASED');
    expect(controller).not.toContain('MERCHANT_RELEASED');
    const update = service.slice(
      service.indexOf('const updated = await tx.orderFulfillment.update'),
      service.indexOf('if (fulfillment.orderV2Id)'),
    );
    expect(update).not.toContain('physicalCustodianRiderId: input.riderId');
  });

  it('UCE-1 HTTP adapter does not mutate payment, advance, or custody events', () => {
    expect(controller).not.toContain('paymentStatus');
    expect(controller).not.toContain('RiderAdvance');
    expect(controller).not.toContain('CustodyEvent');
    expect(controller).not.toContain('picked_up');
    expect(controller).not.toContain('CUSTOMER_RECEIVED');
    expect(controller).not.toContain('RETURN_RECEIVED');
    expect(controller).toContain('this.assignments.assign({');
  });

  it('wkOrderId terminal commerce block is present; UCE-1B shared policies are absent', () => {
    expect(service).toContain('TERMINAL_WKORDER_STATUSES');
    expect(service).toContain('ORDER_TERMINAL');
    expect(service).not.toContain('INELIGIBLE_RIDER_STATUSES');
    expect(service).not.toContain('RIDER_NOT_ELIGIBLE');
    expect(service).not.toContain('merchant?.userId ?? null');
    expect(service).toContain('merchantOwnerUserId: input.merchantOwnerUserId');
    expect(controller).toContain('AuthActorService');
    expect(controller).toContain('this.actors.resolve');
    expect(controller).toContain('actor.actorMerchantIds.includes(orderRow.merchantId)');
    expect(controller).toContain('ForbiddenException');
    expect(controller).not.toContain('allowReassignment:');
  });
});
