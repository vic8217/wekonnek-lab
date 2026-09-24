import {
  RiderAssignmentDetail,
  RiderAssignmentSummary,
} from './rider-assignments.types';

export type RiderReadPlace = {
  name: string;
  address: string | null;
};

export type RiderReadItem = {
  productName: string;
  quantity: number;
};

export type RiderReadOrder = {
  id: number;
  orderCode: string;
  orderType: string;
  deliveryAddress: string | null;
  notes: string | null;
  merchant: RiderReadPlace | null;
  shop: RiderReadPlace | null;
  orderItems: RiderReadItem[];
};

export type RiderReadRow = {
  status: string;
  activeRiderId: string | null;
  physicalCustodianRiderId: string | null;
  wkOrder: RiderReadOrder | null;
  riderAdvances: { status: string }[];
  deliveryAttempts?: {
    outcome: string;
    failureReasonCode: string | null;
    attemptNumber: number;
  }[];
};

function place(order: RiderReadOrder): {
  name: string | null;
  address: string | null;
} {
  const source = order.shop ?? order.merchant;
  if (!source) return { name: null, address: null };
  const name = source.name.trim();
  const address = source.address?.trim() || null;
  return { name: name.length > 0 ? name : null, address };
}

function itemCount(items: RiderReadItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

function merchantName(order: RiderReadOrder): string | null {
  const name = order.merchant?.name.trim() ?? '';
  return name.length > 0 ? name : null;
}

export function projectRiderAssignment(
  row: RiderReadRow,
  riderId: string,
): RiderAssignmentSummary | null {
  const order = row.wkOrder;
  if (!order) return null;
  const advance = row.riderAdvances[0] ?? null;
  return {
    orderId: order.id,
    orderCode: order.orderCode,
    fulfillment: {
      status: row.status,
      assignment: { isActiveRider: row.activeRiderId === riderId },
      custody: {
        hasPhysicalCustody: row.physicalCustodianRiderId === riderId,
      },
    },
    delivery: {
      type: order.orderType,
      pickup: place(order),
      merchant: { name: merchantName(order) },
      dropoff: {
        recipientName: null,
        address: order.deliveryAddress?.trim() || null,
      },
      itemCount: itemCount(order.orderItems),
    },
    riderAdvance: {
      exists: advance != null,
      status: advance?.status ?? null,
    },
  };
}

export function projectRiderAssignmentDetail(
  row: RiderReadRow,
  riderId: string,
): RiderAssignmentDetail | null {
  const summary = projectRiderAssignment(row, riderId);
  if (!summary || !row.wkOrder) return null;
  const attempt = row.deliveryAttempts?.[0] ?? null;
  const instructions = row.wkOrder.notes?.trim() || null;
  return {
    ...summary,
    instructions,
    items: row.wkOrder.orderItems.map((item) => ({
      name: item.productName,
      quantity: item.quantity,
    })),
    latestAttempt: attempt
      ? {
          outcome: attempt.outcome,
          failureReasonCode: attempt.failureReasonCode,
          attemptNumber: attempt.attemptNumber,
        }
      : null,
  };
}
