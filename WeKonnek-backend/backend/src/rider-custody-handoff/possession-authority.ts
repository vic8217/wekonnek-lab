import { FulfillmentStatus } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';

const MID_POSSESSION: ReadonlySet<FulfillmentStatus> = new Set([
  FulfillmentStatus.picked_up,
  FulfillmentStatus.in_transit,
  FulfillmentStatus.delivery_failed,
  FulfillmentStatus.returning,
]);

export function isMidPossessionStatus(status: FulfillmentStatus): boolean {
  return MID_POSSESSION.has(status);
}

/**
 * Stage 7: possession-dependent handoff issuance requires the actor to be both
 * the active assignee and the proven physical custodian.
 * Legacy rows with null physicalCustodianRiderId fall back to activeRiderId only
 * when no pending custody transfer is open.
 */
export function assertPossessionDependentRiderAuthority(input: {
  actorUserId: string;
  status: FulfillmentStatus;
  activeRiderId: string | null;
  physicalCustodianRiderId: string | null;
  pendingCustodyIncomingRiderId?: string | null;
  action: 'delivery_capability' | 'return_capability' | 'possession_action';
}): void {
  if (!isMidPossessionStatus(input.status)) {
    throw new ForbiddenException({
      code: 'FULFILLMENT_NOT_POSSESSION_ELIGIBLE',
      message: 'Fulfillment is not in a mid-possession state',
    });
  }
  if (input.activeRiderId !== input.actorUserId) {
    throw new ForbiddenException({
      code: 'RIDER_NOT_ACTIVE_ASSIGNEE',
      message: 'Only the active assigned rider may perform this action',
    });
  }
  const custodian =
    input.physicalCustodianRiderId ??
    (input.pendingCustodyIncomingRiderId ? null : input.activeRiderId);
  if (custodian == null || custodian !== input.actorUserId) {
    throw new ForbiddenException({
      code: 'RIDER_NOT_PHYSICAL_CUSTODIAN',
      message:
        'Physical custody is not established for this rider; secure rider handoff required',
    });
  }
  if (
    input.pendingCustodyIncomingRiderId &&
    input.pendingCustodyIncomingRiderId !== input.actorUserId
  ) {
    // Pending transfer target must not exercise possession actions yet.
    // Outgoing rider (still custodian + active) may continue.
  }
}
