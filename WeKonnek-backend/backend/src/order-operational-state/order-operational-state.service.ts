import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CustodyEventType,
  FulfillmentStatus,
  MerchantPaymentStatus,
  Prisma,
  RiderAdvanceSettlementStatus,
  RiderAdvanceStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type DerivedOperationalState =
  | 'ACTIVE'
  | 'FINANCIALLY_PENDING'
  | 'EXCEPTION'
  | 'COMPLETE'
  | 'CANCELLED';

const MONEY = (v: unknown) =>
  new Prisma.Decimal((v ?? 0) as Prisma.Decimal.Value).toDecimalPlaces(2);

@Injectable()
export class OrderOperationalStateService {
  constructor(private readonly prisma: PrismaService) {}

  async getForOrder(wkOrderId: number, actorUserId: string) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
    });
    if (!order) throw new NotFoundException('Order not found');

    const fulfillment = await this.prisma.orderFulfillment.findUnique({
      where: { wkOrderId },
    });
    const role = await this.resolveViewerRole(order, fulfillment, actorUserId);
    if (role === 'DENIED') {
      throw new ForbiddenException({
        code: 'OPERATIONAL_STATE_FORBIDDEN',
        message: 'Not authorized to view operational state for this order',
      });
    }

    const custody = fulfillment
      ? await this.prisma.custodyEvent.findMany({
          where: { fulfillmentId: fulfillment.id },
          select: { eventType: true },
        })
      : [];
    const hasCustomerReceived = custody.some(
      (c) => c.eventType === CustodyEventType.CUSTOMER_RECEIVED,
    );
    const hasReturnReceived = custody.some(
      (c) => c.eventType === CustodyEventType.RETURN_RECEIVED,
    );

    const ra = await this.prisma.riderAdvance.findFirst({
      where: {
        wkOrderId,
        status: { not: RiderAdvanceStatus.CANCELLED },
      },
      orderBy: { createdAt: 'desc' },
    });

    let settledAmount = MONEY(0);
    let remainingAmount: Prisma.Decimal | null = null;
    let reimbursedTotalMismatch = false;
    if (ra?.reimbursementPrincipal != null) {
      const principal = MONEY(ra.reimbursementPrincipal);
      const rows = await this.prisma.riderAdvanceSettlement.findMany({
        where: {
          riderAdvanceId: ra.id,
          status: RiderAdvanceSettlementStatus.ACKNOWLEDGED,
        },
        select: { acknowledgedAmount: true },
      });
      for (const row of rows) {
        if (row.acknowledgedAmount) {
          settledAmount = settledAmount.add(MONEY(row.acknowledgedAmount));
        }
      }
      settledAmount = settledAmount.toDecimalPlaces(2);
      remainingAmount = principal.sub(settledAmount).toDecimalPlaces(2);
      if (
        ra.status === RiderAdvanceStatus.REIMBURSED &&
        !settledAmount.eq(principal)
      ) {
        reimbursedTotalMismatch = true;
      }
    }

    const physicalStatus = fulfillment?.status ?? null;
    const merchantPaymentStatus = order.merchantPaymentStatus;
    const paymentResolved =
      merchantPaymentStatus === MerchantPaymentStatus.NOT_REQUIRED ||
      merchantPaymentStatus === MerchantPaymentStatus.VERIFIED ||
      merchantPaymentStatus === MerchantPaymentStatus.CANCELLED;

    const flags: string[] = [];
    if (
      physicalStatus === FulfillmentStatus.delivered &&
      !hasCustomerReceived
    ) {
      flags.push('CUSTOMER_CUSTODY_UNCONFIRMED');
      flags.push('DELIVERED_WITHOUT_CUSTOMER_RECEIVED');
    }
    if (physicalStatus === FulfillmentStatus.returned && !hasReturnReceived) {
      flags.push('RETURN_CUSTODY_UNCONFIRMED');
      flags.push('RETURNED_WITHOUT_RETURN_RECEIVED');
    }
    if (physicalStatus === FulfillmentStatus.returned && hasReturnReceived) {
      flags.push('RETURN_COMPLETED');
    }
    if (
      ra &&
      (ra.status === RiderAdvanceStatus.REIMBURSEMENT_DUE ||
        (ra.status === RiderAdvanceStatus.DISPUTED &&
          ra.reimbursementPrincipal != null &&
          MONEY(ra.reimbursementPrincipal).gt(0) &&
          remainingAmount != null &&
          remainingAmount.gt(0)))
    ) {
      flags.push('RIDER_ADVANCE_REIMBURSEMENT_DUE');
    }
    if (ra?.status === RiderAdvanceStatus.REIMBURSEMENT_DUE && !ra.reimbursementPrincipal) {
      flags.push('RA_DUE_WITHOUT_PRINCIPAL');
    }
    if (reimbursedTotalMismatch) {
      flags.push('RA_REIMBURSED_TOTAL_MISMATCH');
    }

    if (fulfillment) {
      const pickupTerminalStatuses: ReadonlySet<FulfillmentStatus> = new Set([
        FulfillmentStatus.picked_up,
        FulfillmentStatus.in_transit,
        FulfillmentStatus.delivered,
        FulfillmentStatus.delivery_failed,
        FulfillmentStatus.returning,
        FulfillmentStatus.returned,
        FulfillmentStatus.cancelled,
      ]);
      if (pickupTerminalStatuses.has(fulfillment.status)) {
        const activePickup = await this.prisma.pickupHandoffToken.count({
          where: { fulfillmentId: fulfillment.id, status: 'ACTIVE' },
        });
        if (activePickup > 0) flags.push('ACTIVE_PICKUP_TOKEN_AFTER_PICKUP_TERMINAL');
      }
      const deliveryTerminalStatuses: ReadonlySet<FulfillmentStatus> = new Set([
        FulfillmentStatus.delivered,
        FulfillmentStatus.returned,
        FulfillmentStatus.cancelled,
      ]);
      if (deliveryTerminalStatuses.has(fulfillment.status)) {
        const activeDelivery = await this.prisma.customerDeliveryHandoffToken.count({
          where: { fulfillmentId: fulfillment.id, status: 'ACTIVE' },
        });
        if (activeDelivery > 0) {
          flags.push('ACTIVE_DELIVERY_TOKEN_AFTER_FULFILLMENT_TERMINAL');
        }
        const activeReturn = await this.prisma.merchantReturnHandoffToken.count({
          where: { fulfillmentId: fulfillment.id, status: 'ACTIVE' },
        });
        if (activeReturn > 0) {
          flags.push('ACTIVE_RETURN_TOKEN_AFTER_FULFILLMENT_TERMINAL');
        }
      }
    }

    if (physicalStatus === FulfillmentStatus.returning) {
      flags.push('RETURN_IN_PROGRESS');
    }

    const integrityBlocking = flags.some((f) =>
      [
        'CUSTOMER_CUSTODY_UNCONFIRMED',
        'RETURN_CUSTODY_UNCONFIRMED',
        'RA_REIMBURSED_TOTAL_MISMATCH',
        'RA_DUE_WITHOUT_PRINCIPAL',
      ].includes(f),
    );

    let operationalState: DerivedOperationalState = 'ACTIVE';
    if (physicalStatus === FulfillmentStatus.cancelled) {
      operationalState = 'CANCELLED';
    } else if (
      physicalStatus === FulfillmentStatus.delivery_failed ||
      physicalStatus === FulfillmentStatus.returning ||
      physicalStatus === FulfillmentStatus.returned ||
      integrityBlocking
    ) {
      operationalState = 'EXCEPTION';
    } else if (
      physicalStatus === FulfillmentStatus.delivered &&
      hasCustomerReceived &&
      paymentResolved &&
      (!ra ||
        ra.status === RiderAdvanceStatus.REIMBURSED ||
        ra.status === RiderAdvanceStatus.CANCELLED) &&
      !reimbursedTotalMismatch
    ) {
      operationalState = 'COMPLETE';
    } else if (
      (physicalStatus === FulfillmentStatus.delivered &&
        (!paymentResolved ||
          flags.includes('RIDER_ADVANCE_REIMBURSEMENT_DUE'))) ||
      (physicalStatus === FulfillmentStatus.delivered && !hasCustomerReceived)
    ) {
      if (!hasCustomerReceived || integrityBlocking) {
        operationalState = 'EXCEPTION';
      } else {
        operationalState = 'FINANCIALLY_PENDING';
      }
    } else {
      operationalState = 'ACTIVE';
    }

    // Ordinary cash delivered but payment unresolved
    if (
      physicalStatus === FulfillmentStatus.delivered &&
      hasCustomerReceived &&
      !paymentResolved &&
      !flags.includes('RIDER_ADVANCE_REIMBURSEMENT_DUE') &&
      !integrityBlocking
    ) {
      operationalState = 'FINANCIALLY_PENDING';
    }

    return this.projectForRole(role, {
      orderId: order.id,
      operationalState,
      physicalStatus,
      merchantPaymentStatus,
      riderAdvanceStatus: ra?.status ?? null,
      reimbursement: ra
        ? {
            principal: ra.reimbursementPrincipal?.toFixed(2) ?? null,
            settledAmount: settledAmount.toFixed(2),
            remainingAmount: remainingAmount?.toFixed(2) ?? null,
            creditorRiderId: ra.riderId,
            status: ra.status,
          }
        : null,
      custody: {
        customerReceived: hasCustomerReceived,
        returnReceived: hasReturnReceived,
      },
      flags,
      activeRiderId: fulfillment?.activeRiderId ?? null,
    });
  }

  private projectForRole(
    role: 'CUSTOMER' | 'MERCHANT' | 'CREDITOR' | 'ACTIVE_RIDER' | 'ADMIN',
    full: Record<string, unknown> & {
      reimbursement: null | {
        principal: string | null;
        settledAmount: string;
        remainingAmount: string | null;
        creditorRiderId: string;
        status: RiderAdvanceStatus;
      };
      flags: string[];
    },
  ) {
    if (role === 'ADMIN' || role === 'CUSTOMER') {
      return full;
    }
    if (role === 'CREDITOR') {
      // Creditor sees physical/ops + own reimbursement; not merchant payment proof.
      const { merchantPaymentStatus: _mp, ...rest } = full as Record<
        string,
        unknown
      > & { merchantPaymentStatus?: unknown };
      return rest;
    }
    if (role === 'MERCHANT') {
      const { reimbursement, ...rest } = full;
      return {
        ...rest,
        reimbursement: reimbursement
          ? {
              status: reimbursement.status,
              // No settlement proof/refs for merchant
              principalPresent: reimbursement.principal != null,
            }
          : null,
      };
    }
    // ACTIVE_RIDER (delivery/return): minimal
    return {
      orderId: full.orderId,
      operationalState: full.operationalState,
      physicalStatus: full.physicalStatus,
      flags: full.flags.filter((f) =>
        ['RETURN_IN_PROGRESS', 'RETURN_COMPLETED'].includes(f),
      ),
      custody: full.custody,
      activeRiderId: full.activeRiderId,
    };
  }

  private async resolveViewerRole(
    order: { id: number; userId: string; merchantId: number },
    fulfillment: { activeRiderId: string | null } | null,
    actorUserId: string,
  ): Promise<
    'CUSTOMER' | 'MERCHANT' | 'CREDITOR' | 'ACTIVE_RIDER' | 'ADMIN' | 'DENIED'
  > {
    if (actorUserId === order.userId) return 'CUSTOMER';
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { role: true },
    });
    if (user?.role === UserRole.admin || user?.role === UserRole.staff) {
      return 'ADMIN';
    }
    const merchant = await this.prisma.merchant.findFirst({
      where: {
        id: order.merchantId,
        OR: [
          { userId: actorUserId },
          {
            merchantStaff: {
              some: { userId: actorUserId, isActive: true },
            },
          },
        ],
      },
      select: { id: true },
    });
    if (merchant) return 'MERCHANT';

    const ra = await this.prisma.riderAdvance.findFirst({
      where: {
        wkOrderId: order.id,
        riderId: actorUserId,
        status: { not: RiderAdvanceStatus.CANCELLED },
      },
      select: { id: true },
    });
    if (ra) return 'CREDITOR';

    if (fulfillment?.activeRiderId === actorUserId) return 'ACTIVE_RIDER';
    return 'DENIED';
  }
}
