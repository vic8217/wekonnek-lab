import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Prisma,
  RiderAdvanceCollectionRestrictionStatus,
  RiderAdvanceSettlementStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MONEY = (v: unknown) =>
  new Prisma.Decimal((v ?? 0) as Prisma.Decimal.Value).toDecimalPlaces(2);

/**
 * Single choke point for customer→rider Stage 5B collectibility after Stage 9
 * return financial finalization. Historical Stage 5B rows are never reversed;
 * ACTIVE collection restrictions reduce collectible remaining.
 */
@Injectable()
export class RiderAdvanceCollectibilityService {
  constructor(private readonly prisma: PrismaService) {}

  async sumAcknowledgedReimbursement(
    db: Prisma.TransactionClient | PrismaService,
    riderAdvanceId: string,
  ): Promise<Prisma.Decimal> {
    const rows = await db.riderAdvanceSettlement.findMany({
      where: {
        riderAdvanceId,
        status: RiderAdvanceSettlementStatus.ACKNOWLEDGED,
      },
      select: { acknowledgedAmount: true },
    });
    let settled = MONEY(0);
    for (const row of rows) {
      if (row.acknowledgedAmount) {
        settled = settled.add(MONEY(row.acknowledgedAmount));
      }
    }
    return settled.toDecimalPlaces(2);
  }

  async sumActiveRestrictions(
    db: Prisma.TransactionClient | PrismaService,
    riderAdvanceId: string,
  ): Promise<Prisma.Decimal> {
    const rows = await db.riderAdvanceCollectionRestriction.findMany({
      where: {
        riderAdvanceId,
        status: RiderAdvanceCollectionRestrictionStatus.ACTIVE,
      },
      select: { restrictedAmount: true },
    });
    let restricted = MONEY(0);
    for (const row of rows) {
      restricted = restricted.add(MONEY(row.restrictedAmount));
    }
    return restricted.toDecimalPlaces(2);
  }

  /**
   * customerCollectibleRemaining =
   *   max(0, P − SUM(5B ACK) − SUM(ACTIVE restrictions))
   */
  async customerCollectibleRemaining(
    db: Prisma.TransactionClient | PrismaService,
    ra: { id: string; reimbursementPrincipal: Prisma.Decimal | null },
  ): Promise<{
    principal: Prisma.Decimal;
    acknowledged: Prisma.Decimal;
    restricted: Prisma.Decimal;
    collectibleRemaining: Prisma.Decimal;
  }> {
    const principal = MONEY(ra.reimbursementPrincipal ?? 0);
    const acknowledged = await this.sumAcknowledgedReimbursement(db, ra.id);
    const restricted = await this.sumActiveRestrictions(db, ra.id);
    const remaining = principal
      .sub(acknowledged)
      .sub(restricted)
      .toDecimalPlaces(2);
    return {
      principal,
      acknowledged,
      restricted,
      collectibleRemaining: remaining.lt(0) ? MONEY(0) : remaining,
    };
  }

  /**
   * Call after FOR UPDATE on RiderAdvance, before cash/ack increases.
   * Rejects with CUSTOMER_REIMBURSEMENT_COLLECTION_RESTRICTED when insufficient.
   */
  async assertCollectibleForAmount(
    db: Prisma.TransactionClient | PrismaService,
    ra: { id: string; reimbursementPrincipal: Prisma.Decimal | null },
    requestedAmount: Prisma.Decimal,
  ): Promise<void> {
    const view = await this.customerCollectibleRemaining(db, ra);
    if (requestedAmount.gt(view.collectibleRemaining)) {
      throw new BadRequestException({
        code: 'CUSTOMER_REIMBURSEMENT_COLLECTION_RESTRICTED',
        message:
          'Customer reimbursement collection is restricted by return financial resolution',
        collectibleRemaining: view.collectibleRemaining.toFixed(2),
        requestedAmount: requestedAmount.toFixed(2),
      });
    }
  }
}
