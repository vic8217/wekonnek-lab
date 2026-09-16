import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReturnFinancialDeterminationStatus,
  ReturnFinancialObligationType,
  ReturnFinancialSettlementStatus,
  RiderAdvanceStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RiderAdvanceCollectibilityService } from './rider-advance-collectibility.service';

const MONEY = (v: unknown) =>
  new Prisma.Decimal((v ?? 0) as Prisma.Decimal.Value).toDecimalPlaces(2);

@Injectable()
export class ReturnFinancialResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly collectibility: RiderAdvanceCollectibilityService,
  ) {}

  async getForOrder(wkOrderId: number, actorUserId: string) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
    });
    if (!order) throw new NotFoundException('Order not found');

    const role = await this.resolveViewerRole(order, actorUserId);
    if (role === 'DENIED') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Not authorized to view return financial resolution',
      });
    }

    const determination = await this.prisma.returnFinancialDetermination.findFirst({
      where: { wkOrderId },
      orderBy: { createdAt: 'desc' },
    });

    const ra = await this.prisma.riderAdvance.findFirst({
      where: {
        wkOrderId,
        status: { not: RiderAdvanceStatus.CANCELLED },
      },
      orderBy: { createdAt: 'desc' },
    });

    let customerReimbursedAmount = MONEY(0);
    let customerCollectibleRemaining: Prisma.Decimal | null = null;
    let historicalReimbursementStatus: string | null = null;
    let currentCollectionStatus: string | null = null;

    if (ra) {
      historicalReimbursementStatus = ra.status;
      const view = await this.collectibility.customerCollectibleRemaining(
        this.prisma,
        ra,
      );
      customerReimbursedAmount = view.acknowledged;
      customerCollectibleRemaining = view.collectibleRemaining;
      if (view.restricted.gt(0)) {
        currentCollectionStatus = 'TRANSFERRED_TO_RETURN_RESOLUTION';
      }
    }

    const obligations = determination
      ? await this.prisma.returnFinancialObligation.findMany({
          where: { determinationId: determination.id },
        })
      : [];

    const repayment = obligations.find(
      (o) =>
        o.type ===
        ReturnFinancialObligationType.MERCHANT_TO_RIDER_ADVANCE_REPAYMENT,
    );
    const refund = obligations.find(
      (o) =>
        o.type === ReturnFinancialObligationType.MERCHANT_TO_CUSTOMER_REFUND,
    );

    const repaymentView = repayment
      ? await this.obligationView(repayment)
      : null;
    const refundView = refund ? await this.obligationView(refund) : null;

    const financialBlockingReasons: string[] = [];
    if (!determination) {
      financialBlockingReasons.push('RETURN_FINANCIAL_DETERMINATION_REQUIRED');
    } else if (
      determination.status === ReturnFinancialDeterminationStatus.PENDING ||
      determination.status === ReturnFinancialDeterminationStatus.PROPOSED ||
      determination.status === ReturnFinancialDeterminationStatus.ACKNOWLEDGED
    ) {
      financialBlockingReasons.push('RETURN_FINANCIAL_DETERMINATION_PENDING');
    } else if (
      determination.status === ReturnFinancialDeterminationStatus.DISPUTED
    ) {
      financialBlockingReasons.push('RETURN_FINANCIAL_DISPUTED');
    }

    if (
      repaymentView &&
      repaymentView.remainingAmount.gt(0)
    ) {
      financialBlockingReasons.push('RETURN_REPAYMENT_PENDING');
    }
    if (refundView && refundView.remainingAmount.gt(0)) {
      financialBlockingReasons.push('RETURN_REFUND_PENDING');
    }

    // Privacy filtering
    const base = {
      wkOrderId,
      returnFinancialStatus: determination?.status ?? null,
      outcome: determination?.outcome ?? null,
      path: determination?.path ?? null,
      historicalReimbursementStatus,
      customerReimbursedAmount: customerReimbursedAmount.toFixed(2),
      customerCollectibleRemaining:
        customerCollectibleRemaining?.toFixed(2) ?? null,
      currentCollectionStatus,
      financialBlockingReasons,
      determinationId: determination?.id ?? null,
    };

    if (role === 'CUSTOMER') {
      return {
        ...base,
        merchantToCustomerRefund: refundView
          ? {
              principal: refundView.principal.toFixed(2),
              settled: refundView.settledAmount.toFixed(2),
              remaining: refundView.remainingAmount.toFixed(2),
              status: refundView.status,
            }
          : null,
        // Hide merchant→rider evidence detail
        merchantToRiderRepayment: null,
      };
    }

    if (role === 'CREDITOR_RIDER') {
      return {
        ...base,
        merchantToRiderRepayment: repaymentView
          ? {
              principal: repaymentView.principal.toFixed(2),
              settled: repaymentView.settledAmount.toFixed(2),
              remaining: repaymentView.remainingAmount.toFixed(2),
              status: repaymentView.status,
            }
          : null,
        merchantToCustomerRefund: null,
      };
    }

    // Merchant / Admin: full view
    return {
      ...base,
      snapshotPrincipal: determination?.snapshotPrincipal?.toFixed(2) ?? null,
      snapshotReimbursed: determination?.snapshotReimbursed?.toFixed(2) ?? null,
      merchantToRiderRepayment: repaymentView
        ? {
            obligationId: repayment!.id,
            principal: repaymentView.principal.toFixed(2),
            settled: repaymentView.settledAmount.toFixed(2),
            remaining: repaymentView.remainingAmount.toFixed(2),
            status: repaymentView.status,
          }
        : null,
      merchantToCustomerRefund: refundView
        ? {
            obligationId: refund!.id,
            principal: refundView.principal.toFixed(2),
            settled: refundView.settledAmount.toFixed(2),
            remaining: refundView.remainingAmount.toFixed(2),
            status: refundView.status,
          }
        : null,
    };
  }

  private async obligationView(obl: {
    id: string;
    principal: Prisma.Decimal;
    status: string;
  }) {
    const rows = await this.prisma.returnFinancialSettlement.findMany({
      where: {
        obligationId: obl.id,
        status: ReturnFinancialSettlementStatus.ACKNOWLEDGED,
      },
      select: { acknowledgedAmount: true },
    });
    let settled = MONEY(0);
    for (const row of rows) {
      if (row.acknowledgedAmount) {
        settled = settled.add(MONEY(row.acknowledgedAmount));
      }
    }
    settled = settled.toDecimalPlaces(2);
    const remaining = MONEY(obl.principal).sub(settled).toDecimalPlaces(2);
    return {
      principal: MONEY(obl.principal),
      settledAmount: settled,
      remainingAmount: remaining.lt(0) ? MONEY(0) : remaining,
      status: obl.status,
    };
  }

  private async resolveViewerRole(
    order: { id: number; userId: string; merchantId: number },
    actorUserId: string,
  ): Promise<
    'CUSTOMER' | 'MERCHANT' | 'CREDITOR_RIDER' | 'ADMIN' | 'DENIED'
  > {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
    });
    if (actor?.role === UserRole.admin) return 'ADMIN';
    if (order.userId === actorUserId) return 'CUSTOMER';
    const merchant = await this.prisma.merchant.findFirst({
      where: { id: order.merchantId, userId: actorUserId },
    });
    if (merchant) return 'MERCHANT';
    const ra = await this.prisma.riderAdvance.findFirst({
      where: {
        wkOrderId: order.id,
        riderId: actorUserId,
        status: { not: RiderAdvanceStatus.CANCELLED },
      },
    });
    if (ra) return 'CREDITOR_RIDER';
    return 'DENIED';
  }
}
