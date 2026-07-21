import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LoyaltyTier, PointsType } from '@prisma/client';

const TIER_THRESHOLDS: Record<string, number> = {
  [LoyaltyTier.bronze]: 0,
  [LoyaltyTier.silver]: 1000,
  [LoyaltyTier.gold]: 5000,
  [LoyaltyTier.platinum]: 15000,
};

const POINTS_PER_PESO = 1;
const PESO_PER_POINT_REDEEM = 0.5;

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateAccount(userId: string) {
    let account = await this.prisma.loyaltyAccount.findUnique({ where: { userId } });
    if (!account) {
      account = await this.prisma.loyaltyAccount.create({ data: { userId } });
      this.logger.log(`Created loyalty account for user ${userId}`);
    }
    return account;
  }

  async getBalance(userId: string) {
    const account = await this.getOrCreateAccount(userId);
    const nextTier = this.getNextTier(account.tier);

    return {
      balance: account.balance,
      lifetimePoints: account.lifetimePoints,
      tier: account.tier,
      pesoValue: Math.round(account.balance * PESO_PER_POINT_REDEEM * 100) / 100,
      nextTier,
      pointsToNextTier: nextTier ? TIER_THRESHOLDS[nextTier] - account.lifetimePoints : 0,
    };
  }

  async earnPoints(userId: string, orderTotal: number, orderId: string) {
    const account = await this.getOrCreateAccount(userId);

    const tierMultiplier = this.getTierMultiplier(account.tier);
    const points = Math.floor(orderTotal * POINTS_PER_PESO * tierMultiplier);

    if (points <= 0) return null;

    const newBalance = account.balance + points;
    const newLifetime = account.lifetimePoints + points;
    const newTier = this.computeTier(newLifetime);

    await this.prisma.loyaltyAccount.update({
      where: { id: account.id },
      data: { balance: newBalance, lifetimePoints: newLifetime, tier: newTier },
    });

    const txn = await this.prisma.pointsTransaction.create({
      data: {
        accountId: account.id,
        type: PointsType.earn,
        points,
        description: `Earned from order ${orderId}`,
        orderId,
        balanceAfter: newBalance,
      },
    });

    this.logger.log(`User ${userId} earned ${points} pts (order ${orderId}, tier: ${newTier})`);
    return txn;
  }

  async redeemPoints(userId: string, points: number, orderId?: string) {
    const account = await this.getOrCreateAccount(userId);

    if (points <= 0) throw new BadRequestException('Points must be greater than 0');
    if (points > account.balance) {
      throw new BadRequestException(`Insufficient points. You have ${account.balance} points.`);
    }

    const pesoDiscount = Math.round(points * PESO_PER_POINT_REDEEM * 100) / 100;
    const newBalance = account.balance - points;

    await this.prisma.loyaltyAccount.update({
      where: { id: account.id },
      data: { balance: newBalance },
    });

    const txn = await this.prisma.pointsTransaction.create({
      data: {
        accountId: account.id,
        type: PointsType.redeem,
        points: -points,
        description: orderId ? `Redeemed on order ${orderId}` : 'Points redemption',
        orderId: orderId ?? null,
        balanceAfter: newBalance,
      },
    });

    this.logger.log(`User ${userId} redeemed ${points} pts (₱${pesoDiscount})`);
    return { transaction: txn, pesoDiscount };
  }

  async addBonusPoints(userId: string, points: number, description: string) {
    const account = await this.getOrCreateAccount(userId);

    const newBalance = account.balance + points;
    const newLifetime = account.lifetimePoints + points;
    const newTier = this.computeTier(newLifetime);

    await this.prisma.loyaltyAccount.update({
      where: { id: account.id },
      data: { balance: newBalance, lifetimePoints: newLifetime, tier: newTier },
    });

    return this.prisma.pointsTransaction.create({
      data: {
        accountId: account.id,
        type: PointsType.bonus,
        points,
        description,
        balanceAfter: newBalance,
      },
    });
  }

  async getTransactionHistory(userId: string, limit = 20, offset = 0) {
    const account = await this.getOrCreateAccount(userId);

    const [data, total] = await Promise.all([
      this.prisma.pointsTransaction.findMany({
        where: { accountId: account.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.pointsTransaction.count({ where: { accountId: account.id } }),
    ]);

    return { data, total };
  }

  private getTierMultiplier(tier: LoyaltyTier): number {
    switch (tier) {
      case LoyaltyTier.platinum: return 2.0;
      case LoyaltyTier.gold: return 1.5;
      case LoyaltyTier.silver: return 1.2;
      default: return 1.0;
    }
  }

  private getNextTier(tier: LoyaltyTier): LoyaltyTier | null {
    switch (tier) {
      case LoyaltyTier.bronze: return LoyaltyTier.silver;
      case LoyaltyTier.silver: return LoyaltyTier.gold;
      case LoyaltyTier.gold: return LoyaltyTier.platinum;
      default: return null;
    }
  }

  private computeTier(lifetimePoints: number): LoyaltyTier {
    const tiers = [LoyaltyTier.platinum, LoyaltyTier.gold, LoyaltyTier.silver, LoyaltyTier.bronze];
    for (const tier of tiers) {
      if (lifetimePoints >= TIER_THRESHOLDS[tier]) return tier;
    }
    return LoyaltyTier.bronze;
  }
}
