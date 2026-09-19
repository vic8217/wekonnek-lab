/**
 * Stage13B-1/13B-2 order-level read composer.
 * Prisma reads + pure adapters + pure detectors. No writer services. No mutation.
 *
 * forOrder: RepeatableRead snapshot across rails, then Stage13B-2 detectors.
 * forObligation: single-rail item lookup only — no cross-rail detection and
 * no shared snapshot. Callers that need findings must use forOrder.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadExceptionFinancialItems } from './exception-financial.adapter';
import { detectCrossRail } from './financial-reconciliation.detectors';
import { composeOrderFinancialReconciliation } from './financial-reconciliation.policy';
import {
  FinancialRailId,
  FinancialReconciliationItem,
  OrderFinancialReconciliation,
  RAIL_EXCEPTION_FINANCIAL,
  RAIL_RETURN_FINANCIAL,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
} from './financial-reconciliation.types';
import { loadReconciliationReadContext } from './reconciliation-read-context';
import { loadReturnFinancialItems } from './return-financial.adapter';
import { loadRiderAdvanceReimbursementItems } from './rider-advance-reimbursement.adapter';

@Injectable()
export class FinancialReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async forOrder(wkOrderId: number): Promise<OrderFinancialReconciliation> {
    return this.prisma.$transaction(
      async (tx) => {
        const order = await tx.wkOrder.findUnique({
          where: { id: wkOrderId },
          select: { id: true },
        });
        if (!order) {
          throw new NotFoundException({
            code: 'ORDER_NOT_FOUND',
            message: 'Order not found',
          });
        }

        const [ra, ret, ex, ctx] = await Promise.all([
          loadRiderAdvanceReimbursementItems(tx, wkOrderId),
          loadReturnFinancialItems(tx, wkOrderId),
          loadExceptionFinancialItems(tx, wkOrderId),
          loadReconciliationReadContext(tx, wkOrderId),
        ]);
        const items = [...ra, ...ret, ...ex];
        const detected = detectCrossRail(items, ctx);
        return composeOrderFinancialReconciliation({
          wkOrderId,
          items,
          findings: detected.findings,
          relatedItems: detected.relatedItems,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * Single-rail canonical item. Does not run Stage13B-2 detectors and does
   * not wrap rails in RepeatableRead. Use forOrder for cross-rail findings.
   */
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
