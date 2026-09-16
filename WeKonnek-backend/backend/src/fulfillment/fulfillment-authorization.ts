import { ForbiddenException } from '@nestjs/common';
import { OrderDomainActorType } from '@prisma/client';
import type { FulfillmentLifecycleStatus } from './fulfillment-state-machine';

export type FulfillmentOperation =
  | 'read'
  | 'transition'
  | 'assign_rider'
  | 'unassign_rider'
  | 'record_payment_collection'
  | 'cancel';

export interface AuthActor {
  id?: string | null;
  type: OrderDomainActorType;
  /** Merchant staff role when type is MERCHANT_* */
  merchantStaffRole?: 'owner' | 'manager' | 'cashier' | 'staff' | null;
}

export interface FulfillmentAuthContext {
  customerId?: string | null;
  merchantId?: number | null;
  shopId?: number | null;
  /** Merchant owner user id when known */
  merchantOwnerUserId?: string | null;
  /** Active assigned rider */
  activeRiderId?: string | null;
  /** Merchant ids the actor may operate (owner or active staff) */
  actorMerchantIds?: number[];
  status?: FulfillmentLifecycleStatus | string | null;
}

/**
 * Actor × operation matrix (Stage 0A policy).
 * Ownership / assignment still required where noted.
 *
 * | Actor              | read | transition | assign | unassign | pay collect | cancel |
 * |--------------------|------|------------|--------|----------|-------------|--------|
 * | CUSTOMER           | own  | no*        | no     | no       | no          | own†   |
 * | MERCHANT_OWNER     | shop | merchant‡  | yes    | yes      | yes         | yes    |
 * | MERCHANT_ADMIN     | shop | merchant‡  | yes    | yes      | yes         | yes    |
 * | MERCHANT_STAFF     | shop | limited‡   | no     | no       | limited     | limited|
 * | RIDER              | asg  | rider path | no     | no       | no          | no     |
 * | SYSTEM_ADMIN       | all  | yes        | yes    | yes      | yes         | yes    |
 * | PAYMENT_PROVIDER   | no   | no         | no     | no       | yes§        | no     |
 * | INTERNAL_SERVICE   | all  | yes        | yes    | yes      | yes         | yes    |
 * | SYSTEM             | all  | yes        | yes    | yes      | yes         | yes    |
 *
 * * Customer may request cancel only while pending/confirmed (enforced in service).
 * † Early cancel only.
 * ‡ Merchant transitions exclude rider custody steps unless system.
 * § Trusted callback authority only — not a user JWT.
 */
const MATRIX: Record<
  OrderDomainActorType,
  Record<FulfillmentOperation, boolean>
> = {
  CUSTOMER: {
    read: true,
    transition: false,
    assign_rider: false,
    unassign_rider: false,
    record_payment_collection: false,
    cancel: true,
  },
  MERCHANT_OWNER: {
    read: true,
    transition: true,
    assign_rider: true,
    unassign_rider: true,
    record_payment_collection: true,
    cancel: true,
  },
  MERCHANT_ADMIN: {
    read: true,
    transition: true,
    assign_rider: true,
    unassign_rider: true,
    record_payment_collection: true,
    cancel: true,
  },
  MERCHANT_STAFF: {
    read: true,
    transition: true,
    assign_rider: false,
    unassign_rider: false,
    record_payment_collection: false,
    cancel: true,
  },
  RIDER: {
    read: true,
    transition: true,
    assign_rider: false,
    unassign_rider: false,
    record_payment_collection: false,
    cancel: false,
  },
  SYSTEM_ADMIN: {
    read: true,
    transition: true,
    assign_rider: true,
    unassign_rider: true,
    record_payment_collection: true,
    cancel: true,
  },
  PAYMENT_PROVIDER: {
    read: false,
    transition: false,
    assign_rider: false,
    unassign_rider: false,
    record_payment_collection: true,
    cancel: false,
  },
  INTERNAL_SERVICE: {
    read: true,
    transition: true,
    assign_rider: true,
    unassign_rider: true,
    record_payment_collection: true,
    cancel: true,
  },
  SYSTEM: {
    read: true,
    transition: true,
    assign_rider: true,
    unassign_rider: true,
    record_payment_collection: true,
    cancel: true,
  },
  UNKNOWN: {
    read: false,
    transition: false,
    assign_rider: false,
    unassign_rider: false,
    record_payment_collection: false,
    cancel: false,
  },
};

const RIDER_ALLOWED_TARGETS: ReadonlySet<string> = new Set([
  'picked_up',
  'in_transit',
  // Stage 5A: 'delivered' removed — customer handoff only (INTERNAL_SERVICE).
  'delivery_failed',
  'returning',
  // Stage 6: 'returned' removed — merchant return handoff only (INTERNAL_SERVICE).
]);

const MERCHANT_ALLOWED_TARGETS: ReadonlySet<string> = new Set([
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'rider_assigned',
  'cancelled',
]);

const CUSTOMER_CANCEL_FROM: ReadonlySet<string> = new Set([
  'pending',
  'confirmed',
]);

const TRUSTED: ReadonlySet<OrderDomainActorType> = new Set([
  'SYSTEM_ADMIN',
  'INTERNAL_SERVICE',
  'SYSTEM',
]);

export function matrixAllows(
  actorType: OrderDomainActorType,
  operation: FulfillmentOperation,
): boolean {
  return MATRIX[actorType]?.[operation] === true;
}

export function assertOperationAllowed(
  actor: AuthActor,
  operation: FulfillmentOperation,
  ctx: FulfillmentAuthContext,
  targetStatus?: string,
): void {
  if (!matrixAllows(actor.type, operation)) {
    throw new ForbiddenException(
      `${actor.type} is not allowed to perform ${operation}`,
    );
  }

  if (TRUSTED.has(actor.type)) return;

  if (actor.type === 'CUSTOMER') {
    if (!actor.id || actor.id !== ctx.customerId) {
      throw new ForbiddenException('Customers may only access their own orders');
    }
    if (operation === 'cancel') {
      if (targetStatus && targetStatus !== 'cancelled') {
        throw new ForbiddenException('Customers may only cancel');
      }
      if (ctx.status && !CUSTOMER_CANCEL_FROM.has(String(ctx.status))) {
        throw new ForbiddenException(
          'Customer cancel is only allowed while pending or confirmed',
        );
      }
    }
    return;
  }

  if (
    actor.type === 'MERCHANT_OWNER' ||
    actor.type === 'MERCHANT_ADMIN' ||
    actor.type === 'MERCHANT_STAFF'
  ) {
    const merchantId = ctx.merchantId;
    if (
      merchantId == null ||
      !ctx.actorMerchantIds?.includes(merchantId)
    ) {
      // Fall back: merchant owner user id match
      if (
        !(
          actor.type === 'MERCHANT_OWNER' &&
          actor.id &&
          ctx.merchantOwnerUserId &&
          actor.id === ctx.merchantOwnerUserId
        )
      ) {
        throw new ForbiddenException(
          'Merchant actors may only operate their merchant/shop orders',
        );
      }
    }
    if (operation === 'transition' && targetStatus) {
      if (!MERCHANT_ALLOWED_TARGETS.has(targetStatus)) {
        throw new ForbiddenException(
          `Merchant actors cannot transition to ${targetStatus}`,
        );
      }
    }
    if (
      (operation === 'assign_rider' || operation === 'unassign_rider') &&
      actor.type === 'MERCHANT_STAFF'
    ) {
      throw new ForbiddenException('Merchant staff cannot assign riders');
    }
    return;
  }

  if (actor.type === 'RIDER') {
    if (!actor.id || actor.id !== ctx.activeRiderId) {
      throw new ForbiddenException(
        'Riders may only access/update actively assigned fulfillments',
      );
    }
    if (operation === 'transition' && targetStatus) {
      if (!RIDER_ALLOWED_TARGETS.has(targetStatus)) {
        throw new ForbiddenException(
          `Riders cannot transition to ${targetStatus}`,
        );
      }
    }
    return;
  }

  if (actor.type === 'PAYMENT_PROVIDER') {
    if (operation !== 'record_payment_collection') {
      throw new ForbiddenException('Payment provider authority is payment-only');
    }
  }
}

export function resolveActorTypeFromRoles(input: {
  userRole?: string | null;
  merchantStaffRole?: string | null;
  isPaymentProvider?: boolean;
  isInternalService?: boolean;
}): OrderDomainActorType {
  if (input.isPaymentProvider) return 'PAYMENT_PROVIDER';
  if (input.isInternalService) return 'INTERNAL_SERVICE';
  const role = String(input.userRole ?? '').toLowerCase();
  if (role === 'admin' || role === 'staff') return 'SYSTEM_ADMIN';
  if (role === 'rider' || role === 'driver') return 'RIDER';
  if (role === 'customer') return 'CUSTOMER';
  if (role === 'merchant') {
    const staff = String(input.merchantStaffRole ?? '').toLowerCase();
    if (staff === 'owner' || staff === '') return 'MERCHANT_OWNER';
    if (staff === 'manager') return 'MERCHANT_ADMIN';
    return 'MERCHANT_STAFF';
  }
  return 'UNKNOWN';
}

export { MATRIX as FULFILLMENT_AUTH_MATRIX };
