import { BadRequestException } from '@nestjs/common';
import { FulfillmentStatus, OrderStatus } from '@prisma/client';

/** Shared fulfillment lifecycle used by OrderFulfillment and legacy orders_v2. */
export type FulfillmentLifecycleStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready_for_pickup'
  | 'rider_assigned'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'delivery_failed'
  | 'returning'
  | 'returned'
  | 'cancelled';

export const FULFILLMENT_TRANSITIONS: Record<
  FulfillmentLifecycleStatus,
  readonly FulfillmentLifecycleStatus[]
> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['rider_assigned', 'cancelled'],
  rider_assigned: ['picked_up', 'cancelled'],
  // Future verified pickup inserts between rider_assigned and in_transit.
  picked_up: ['in_transit'],
  // Stage 5A: secured delivery via customer handoff; failed-delivery branch.
  in_transit: ['delivered', 'delivery_failed'],
  delivered: [],
  delivery_failed: ['returning'],
  returning: ['returned'],
  returned: [],
  cancelled: [],
} as const;

export const TERMINAL_FULFILLMENT_STATUSES: ReadonlySet<FulfillmentLifecycleStatus> =
  new Set(['delivered', 'returned', 'cancelled']);

export function isFulfillmentLifecycleStatus(
  value: string,
): value is FulfillmentLifecycleStatus {
  return Object.prototype.hasOwnProperty.call(FULFILLMENT_TRANSITIONS, value);
}

export function assertFulfillmentTransition(
  from: FulfillmentLifecycleStatus,
  to: FulfillmentLifecycleStatus,
): void {
  const allowed = FULFILLMENT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new BadRequestException(
      `Cannot transition fulfillment from ${from} to ${to}`,
    );
  }
}

export function toFulfillmentStatus(
  status: FulfillmentLifecycleStatus,
): FulfillmentStatus {
  return status as FulfillmentStatus;
}

export function toOrderStatus(status: FulfillmentLifecycleStatus): OrderStatus {
  return status as OrderStatus;
}

export function fromOrderStatus(
  status: OrderStatus | FulfillmentStatus | string,
): FulfillmentLifecycleStatus {
  if (!isFulfillmentLifecycleStatus(status)) {
    throw new BadRequestException(`Unknown fulfillment status: ${status}`);
  }
  return status;
}

export interface TransitionDefinition {
  from: FulfillmentLifecycleStatus;
  to: FulfillmentLifecycleStatus;
  /** Who may request this transition (coarse; ownership checked separately). */
  authorizedActorTypes: readonly string[];
  preconditions: readonly string[];
  sideEffects: readonly string[];
  idempotency: string;
  failure: string;
}

/**
 * Catalog of critical transitions for documentation and tests.
 * Enforcement lives in FulfillmentTransitionService.
 */
export const TRANSITION_CATALOG: readonly TransitionDefinition[] = [
  {
    from: 'ready_for_pickup',
    to: 'rider_assigned',
    authorizedActorTypes: [
      'SYSTEM_ADMIN',
      'INTERNAL_SERVICE',
      'SYSTEM',
      'MERCHANT_OWNER',
      'MERCHANT_ADMIN',
    ],
    preconditions: [
      'Fulfillment not cancelled/delivered/returned',
      'Target rider exists with rider role (when assigning)',
      'Assignment version matches expected (when provided)',
    ],
    sideEffects: [
      'Write RiderAssignment ACTIVE row',
      'Bump assignmentVersion',
      'Set activeRiderId / orders_v2.riderId',
      'Emit ORDER_DOMAIN event',
    ],
    idempotency:
      'Same rider already ACTIVE at rider_assigned → return current row, no version bump',
    failure: 'ConflictException on version mismatch; BadRequest on illegal transition',
  },
  {
    from: 'rider_assigned',
    to: 'picked_up',
    authorizedActorTypes: ['RIDER', 'SYSTEM_ADMIN', 'INTERNAL_SERVICE', 'SYSTEM'],
    preconditions: [
      'Active rider assignment exists',
      'Actor is assigned rider (unless system)',
      // Known debt: Stage 3 QR path exists but rider→picked_up bypass remains.
    ],
    sideEffects: ['Update status', 'Emit domain event'],
    idempotency: 'Already picked_up → no-op success',
    failure: 'Forbidden if rider not assigned; BadRequest if illegal',
  },
  {
    from: 'picked_up',
    to: 'in_transit',
    authorizedActorTypes: ['RIDER', 'SYSTEM_ADMIN', 'INTERNAL_SERVICE', 'SYSTEM'],
    preconditions: ['Active assignment; actor is assigned rider (unless system)'],
    sideEffects: ['Update status', 'Emit domain event'],
    idempotency: 'Already in_transit → no-op success',
    failure: 'Forbidden / BadRequest as above',
  },
  {
    from: 'in_transit',
    to: 'delivered',
    // Stage 5A: RIDER removed — customer handoff uses INTERNAL_SERVICE.
    authorizedActorTypes: ['SYSTEM_ADMIN', 'INTERNAL_SERVICE', 'SYSTEM'],
    preconditions: [
      'Active assignment',
      'Customer-authenticated delivery handoff (secured WkOrder path)',
    ],
    sideEffects: [
      'Update status + deliveredAt',
      'Emit domain event',
      'Does NOT mark commerce payment paid (payment separate)',
      'Does NOT settle Rider Advance reimbursement',
    ],
    idempotency: 'Already delivered → no-op success',
    failure: 'Forbidden for rider self-confirm; BadRequest if illegal',
  },
  {
    from: 'in_transit',
    to: 'delivery_failed',
    authorizedActorTypes: ['RIDER', 'SYSTEM_ADMIN', 'INTERNAL_SERVICE', 'SYSTEM'],
    preconditions: ['Active assignment; actor is assigned rider (unless system)'],
    sideEffects: [
      'Update status',
      'Emit domain event',
      'Does NOT erase Rider Advance principal / evidence',
    ],
    idempotency: 'Already delivery_failed → no-op success',
    failure: 'Forbidden / BadRequest',
  },
  {
    from: 'delivery_failed',
    to: 'returning',
    authorizedActorTypes: ['RIDER', 'SYSTEM_ADMIN', 'INTERNAL_SERVICE', 'SYSTEM'],
    preconditions: ['Active assignment where applicable'],
    sideEffects: ['Update status', 'Emit domain event', 'Optional RETURN_INITIATED custody'],
    idempotency: 'Already returning → no-op success',
    failure: 'Forbidden / BadRequest',
  },
  {
    from: 'returning',
    to: 'returned',
    // Stage 6: RIDER removed — merchant return handoff uses INTERNAL_SERVICE.
    authorizedActorTypes: ['SYSTEM_ADMIN', 'INTERNAL_SERVICE', 'SYSTEM'],
    preconditions: [
      'Merchant-authenticated return handoff (secured WkOrder path)',
      'Does not invent merchant receipt without RETURN_RECEIVED custody',
    ],
    sideEffects: [
      'Update status',
      'Emit domain event',
      'Does NOT erase Rider Advance principal / settlements',
      'Does NOT mutate merchant payment ownership',
    ],
    idempotency: 'Already returned → no-op success',
    failure: 'Forbidden for rider self-confirm; BadRequest if illegal',
  },
];
