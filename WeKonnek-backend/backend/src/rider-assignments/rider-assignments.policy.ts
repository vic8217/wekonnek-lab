import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

/**
 * UCE-2 rider identity for list, detail, start, and location.
 * Matches accepted assignment eligibility: the user exists, isActive, and
 * the role is rider or driver. User.status is not an authority source.
 */
export const RIDER_OPERATION_ROLES = ['rider', 'driver'] as const;

export type RiderOperationIdentity = {
  id: string;
  role: string;
  isActive: boolean;
};

export function assertActiveRiderIdentity(
  user: RiderOperationIdentity | null,
): asserts user is RiderOperationIdentity {
  if (!user?.id) {
    throw new UnauthorizedException();
  }
  const role = user.role.toLowerCase();
  if (
    !RIDER_OPERATION_ROLES.includes(role as (typeof RIDER_OPERATION_ROLES)[number])
  ) {
    throw new ForbiddenException({
      code: 'RIDER_ROLE_REQUIRED',
      message: 'Rider role required',
    });
  }
  if (!user.isActive) {
    throw new ForbiddenException({
      code: 'RIDER_NOT_ACTIVE',
      message: 'Rider account is not active',
    });
  }
}

/**
 * Current responsibility is the fulfillment pointer, not assignment history.
 * A SUPERSEDED RiderAssignment alone does not qualify.
 * pendingCustodyIncomingRiderId alone does not qualify.
 */
export function isCurrentRiderResponsibility(
  fulfillment: {
    wkOrderId: number | null;
    activeRiderId: string | null;
    physicalCustodianRiderId: string | null;
  },
  riderId: string,
): boolean {
  if (fulfillment.wkOrderId == null) return false;
  return (
    fulfillment.activeRiderId === riderId ||
    fulfillment.physicalCustodianRiderId === riderId
  );
}
