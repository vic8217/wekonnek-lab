import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscountType, VoucherStatus, Voucher } from '@prisma/client';

export interface VoucherValidationResult {
  valid: boolean;
  voucher?: Voucher;
  discountAmount?: number;
  reason?: string;
}

@Injectable()
export class VouchersService {
  private readonly logger = new Logger(VouchersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: any) {
    const existing = await this.prisma.voucher.findUnique({
      where: { code: dto.code.toUpperCase() },
    });
    if (existing) {
      throw new BadRequestException(`Voucher code "${dto.code}" already exists`);
    }

    return this.prisma.voucher.create({
      data: {
        ...dto,
        code: dto.code.toUpperCase(),
        startsAt: new Date(dto.startsAt),
        expiresAt: new Date(dto.expiresAt),
      },
    });
  }

  async findAll(filters?: { status?: VoucherStatus; limit?: number; offset?: number }) {
    const where: Record<string, unknown> = {};
    if (filters?.status) where.status = filters.status;

    const [data, total] = await Promise.all([
      this.prisma.voucher.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters?.limit ?? 50,
        skip: filters?.offset ?? 0,
      }),
      this.prisma.voucher.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string) {
    const voucher = await this.prisma.voucher.findUnique({ where: { id } });
    if (!voucher) throw new NotFoundException('Voucher not found');
    return voucher;
  }

  async findByCode(code: string) {
    const voucher = await this.prisma.voucher.findUnique({ where: { code: code.toUpperCase() } });
    if (!voucher) throw new NotFoundException('Voucher not found');
    return voucher;
  }

  async findAvailableForCustomer(userId: string) {
    const now = new Date();

    const vouchers = await this.prisma.voucher.findMany({
      where: {
        status: VoucherStatus.active,
        startsAt: { lte: now },
        expiresAt: { gte: now },
      },
      orderBy: { expiresAt: 'asc' },
    });

    const available: Voucher[] = [];
    for (const v of vouchers) {
      if (v.maxTotalUses > 0 && v.totalRedemptions >= v.maxTotalUses) continue;

      const userRedemptions = await this.prisma.voucherRedemption.count({
        where: { voucherId: v.id, userId },
      });
      if (userRedemptions >= v.maxUsesPerUser) continue;

      available.push(v);
    }

    return available;
  }

  async validate(
    code: string, userId: string, orderSubtotal: number,
    orderType?: string, storeId?: string,
  ): Promise<VoucherValidationResult> {
    const voucher = await this.prisma.voucher.findUnique({ where: { code: code.toUpperCase() } });
    if (!voucher) return { valid: false, reason: 'Voucher code not found' };

    const now = new Date();
    if (voucher.status !== VoucherStatus.active) return { valid: false, reason: 'This voucher is no longer active' };
    if (now < voucher.startsAt) return { valid: false, reason: 'This voucher is not yet available' };
    if (now > voucher.expiresAt) return { valid: false, reason: 'This voucher has expired' };
    if (voucher.maxTotalUses > 0 && voucher.totalRedemptions >= voucher.maxTotalUses) {
      return { valid: false, reason: 'This voucher has been fully redeemed' };
    }

    const userRedemptions = await this.prisma.voucherRedemption.count({
      where: { voucherId: voucher.id, userId },
    });
    if (userRedemptions >= voucher.maxUsesPerUser) {
      return { valid: false, reason: 'You have already used this voucher' };
    }

    if (voucher.minOrderAmount > 0 && orderSubtotal < voucher.minOrderAmount) {
      return { valid: false, reason: `Minimum order of ₱${voucher.minOrderAmount} required` };
    }

    if (voucher.applicableOrderTypes && orderType && !voucher.applicableOrderTypes.includes(orderType)) {
      return { valid: false, reason: `This voucher is not valid for ${orderType} orders` };
    }

    if (voucher.storeId && storeId && voucher.storeId !== storeId) {
      return { valid: false, reason: 'This voucher is not valid for this store' };
    }

    let discountAmount: number;
    if (voucher.discountType === DiscountType.percentage) {
      discountAmount = orderSubtotal * (voucher.discountValue / 100);
      if (voucher.maxDiscountAmount && discountAmount > voucher.maxDiscountAmount) {
        discountAmount = voucher.maxDiscountAmount;
      }
    } else {
      discountAmount = voucher.discountValue;
    }

    discountAmount = Math.min(discountAmount, orderSubtotal);
    discountAmount = Math.round(discountAmount * 100) / 100;

    return { valid: true, voucher, discountAmount };
  }

  async redeem(voucherId: string, userId: string, orderId: string, discountApplied: number) {
    const voucher = await this.findById(voucherId);

    const redemption = await this.prisma.voucherRedemption.create({
      data: { voucherId, userId, orderId, discountApplied },
    });

    const newCount = voucher.totalRedemptions + 1;
    const newStatus = (voucher.maxTotalUses > 0 && newCount >= voucher.maxTotalUses)
      ? VoucherStatus.expired
      : voucher.status;

    await this.prisma.voucher.update({
      where: { id: voucherId },
      data: { totalRedemptions: newCount, status: newStatus },
    });

    this.logger.log(`Voucher ${voucher.code} redeemed by ${userId} on order ${orderId} (-₱${discountApplied})`);
    return redemption;
  }

  async update(id: string, data: Partial<Voucher>) {
    await this.findById(id);
    if (data.code) data.code = data.code.toUpperCase();
    return this.prisma.voucher.update({ where: { id }, data });
  }

  async disable(id: string) {
    return this.update(id, { status: VoucherStatus.disabled });
  }

  async getRedemptionsByVoucher(voucherId: string) {
    return this.prisma.voucherRedemption.findMany({
      where: { voucherId },
      include: { user: true },
      orderBy: { redeemedAt: 'desc' },
    });
  }
}
