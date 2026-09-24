/** Native rider HTTP contract. Not a Prisma model. */

export type RiderAssignmentSummary = {
  orderId: number;
  orderCode: string;
  fulfillment: {
    status: string;
    assignment: { isActiveRider: boolean };
    custody: { hasPhysicalCustody: boolean };
  };
  delivery: {
    type: string | null;
    pickup: { name: string | null; address: string | null };
    merchant: { name: string | null };
    dropoff: { recipientName: null; address: string | null };
    itemCount: number;
  };
  riderAdvance: {
    exists: boolean;
    status: string | null;
  };
};

export type RiderAssignmentDetail = RiderAssignmentSummary & {
  instructions: string | null;
  items: { name: string; quantity: number }[];
  latestAttempt: {
    outcome: string;
    failureReasonCode: string | null;
    attemptNumber: number;
  } | null;
};

export type RiderStartDeliveryResponse = {
  idempotent: boolean;
  assignment: RiderAssignmentDetail;
};

export type RiderLocationReportResponse = {
  accepted: true;
  recordedAt: string;
};

export type RiderAssignmentListResponse = {
  items: RiderAssignmentSummary[];
  page: { limit: number; nextCursor: string | null };
};
