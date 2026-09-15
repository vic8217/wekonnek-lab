import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  MerchantPaymentMethodKind,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface UpsertMerchantPaymentMethodInput {
  kind: MerchantPaymentMethodKind;
  displayName: string;
  accountName?: string | null;
  accountReference?: string | null;
  instructions?: string | null;
  qrAssetUrl?: string | null;
  enabled?: boolean;
  sortOrder?: number;
  shopId?: number | null;
}

@Injectable()
export class MerchantPaymentConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async assertMerchantOperator(userId: string, merchantId: number) {
    const merchant = await this.prisma.merchant.findFirst({
      where: {
        id: merchantId,
        OR: [
          { userId },
          { merchantStaff: { some: { userId, isActive: true } } },
        ],
      },
      select: { id: true, userId: true },
    });
    if (!merchant) {
      throw new ForbiddenException(
        'You are not allowed to manage this merchant payment configuration',
      );
    }
    return merchant;
  }

  /** Ensure a default enabled CASH method exists (cash merchants need no QR/bank). */
  async ensureDefaultCashMethod(merchantId: number, shopId?: number | null) {
    const existing = await this.prisma.merchantPaymentMethod.findFirst({
      where: {
        merchantId,
        kind: MerchantPaymentMethodKind.CASH,
        shopId: shopId ?? null,
      },
    });
    if (existing) return existing;
    return this.prisma.merchantPaymentMethod.create({
      data: {
        id: randomUUID(),
        merchantId,
        shopId: shopId ?? undefined,
        kind: MerchantPaymentMethodKind.CASH,
        displayName: 'Cash / COD',
        instructions: 'Pay the merchant in cash',
        enabled: true,
        sortOrder: 0,
      },
    });
  }

  async listEnabledForMerchant(merchantId: number, shopId?: number | null) {
    await this.ensureDefaultCashMethod(merchantId, null);
    return this.prisma.merchantPaymentMethod.findMany({
      where: {
        merchantId,
        enabled: true,
        OR: [{ shopId: null }, ...(shopId != null ? [{ shopId }] : [])],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async listForOperator(userId: string, merchantId: number) {
    await this.assertMerchantOperator(userId, merchantId);
    await this.ensureDefaultCashMethod(merchantId, null);
    return this.prisma.merchantPaymentMethod.findMany({
      where: { merchantId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(
    userId: string,
    merchantId: number,
    input: UpsertMerchantPaymentMethodInput,
  ) {
    await this.assertMerchantOperator(userId, merchantId);
    if (!input.displayName?.trim()) {
      throw new BadRequestException('displayName is required');
    }
    if (
      input.kind === MerchantPaymentMethodKind.MERCHANT_QR &&
      !input.qrAssetUrl &&
      !input.instructions
    ) {
      throw new BadRequestException(
        'Merchant QR requires qrAssetUrl or instructions',
      );
    }
    return this.prisma.merchantPaymentMethod.create({
      data: {
        id: randomUUID(),
        merchantId,
        shopId: input.shopId ?? undefined,
        kind: input.kind,
        displayName: input.displayName.trim(),
        accountName: input.accountName ?? undefined,
        accountReference: input.accountReference ?? undefined,
        instructions: input.instructions ?? undefined,
        qrAssetUrl: input.qrAssetUrl ?? undefined,
        enabled: input.enabled ?? true,
        sortOrder: input.sortOrder ?? 100,
      },
    });
  }

  async update(
    userId: string,
    methodId: string,
    input: Partial<UpsertMerchantPaymentMethodInput>,
  ) {
    const method = await this.prisma.merchantPaymentMethod.findUnique({
      where: { id: methodId },
    });
    if (!method) throw new NotFoundException('Payment method not found');
    await this.assertMerchantOperator(userId, method.merchantId);
    return this.prisma.merchantPaymentMethod.update({
      where: { id: methodId },
      data: {
        displayName: input.displayName?.trim(),
        accountName: input.accountName,
        accountReference: input.accountReference,
        instructions: input.instructions,
        qrAssetUrl: input.qrAssetUrl,
        enabled: input.enabled,
        sortOrder: input.sortOrder,
        shopId: input.shopId === undefined ? undefined : input.shopId,
      },
    });
  }

  serialize(method: {
    id: string;
    merchantId: number;
    shopId: number | null;
    kind: MerchantPaymentMethodKind;
    displayName: string;
    accountName: string | null;
    accountReference: string | null;
    instructions: string | null;
    qrAssetUrl: string | null;
    enabled: boolean;
    sortOrder: number;
  }) {
    return {
      id: method.id,
      merchantId: method.merchantId,
      shopId: method.shopId,
      kind: method.kind,
      displayName: method.displayName,
      accountName: method.accountName,
      accountReference: method.accountReference,
      instructions: method.instructions,
      qrAssetUrl: method.qrAssetUrl,
      enabled: method.enabled,
      sortOrder: method.sortOrder,
    };
  }
}
