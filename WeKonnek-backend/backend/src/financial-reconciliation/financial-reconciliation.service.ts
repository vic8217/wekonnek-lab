/**
 * Stage13B-1 order-level read composer.
 * Prisma reads + pure adapters only. No writer services. No mutation.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { loadExceptionFinancialItems } from './exception-financial.adapter';
import { groupDirectionalItems } from './financial-reconciliation.policy';
import {
  FinancialRailId,
  FinancialReconciliationItem,
  OrderFinancialReconciliation,
  RAIL_EXCEPTION_FINANCIAL,
  RAIL_RETURN_FINANCIAL,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
} from './financial-reconciliation.types';
import { loadReturnFinancialItems } from './return-financial.adapter';
import { loadRiderAdvanceReimbursementItems } from './rider-advance-reimbursement.adapter';

@Injectable()
export class FinancialReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async forOrder(wkOrderId: number): Promise<OrderFinancialReconciliation> {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
      select: { id: true },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    const [ra, ret, ex] = await Promise.all([
      loadRiderAdvanceReimbursementItems(this.prisma, wkOrderId),
      loadReturnFinancialItems(this.prisma, wkOrderId),
      loadExceptionFinancialItems(this.prisma, wkOrderId),
    ]);
    const items = [...ra, ...ret, ...ex];
    return {
      wkOrderId,
      items,
      directionalGroups: groupDirectionalItems(items),
    };
  }

  async forObligation(
    rail: FinancialRailId,
    obligationId: string,
  ): Promise<FinancialReconciliationItem | null> {
    if (rail === RAIL_RIDER_ADVANCE_REIMBURSEMENT) {
      const ra = await this.prisma.riderAdvance.findUnique({
        where: { id: obligationId },
        select: { wkOrderId: true },
      });
      if (!ra) return null;
      const items = await loadRiderAdvanceReimbursementItems(
        this.prisma,
        ra.wkOrderId,
      );
      return items.find((i) => i.obligationId === obligationId) ?? null;
    }
    if (rail === RAIL_RETURN_FINANCIAL) {
      const obl = await this.prisma.returnFinancialObligation.findUnique({
        where: { id: obligationId },
        select: { wkOrderId: true },
      });
      if (!obl) return null;
      const items = await loadReturnFinancialItems(this.prisma, obl.wkOrderId);
      return items.find((i) => i.obligationId === obligationId) ?? null;
    }
    if (rail === RAIL_EXCEPTION_FINANCIAL) {
      const obl = await this.prisma.exceptionFinancialObligation.findUnique({
        where: { id: obligationId },
        select: { wkOrderId: true },
      });
      if (!obl) return null;
      const items = await loadExceptionFinancialItems(
        this.prisma,
        obl.wkOrderId,
      );
      return items.find((i) => i.obligationId === obligationId) ?? null;
    }
    return null;
  }
}
