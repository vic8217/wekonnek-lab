import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';
import { operationState } from './branch-operation';
import { addOnQuantity, dailySubscriptionReference } from '../merchants/philippine-billing-day';
import { moneyNumber } from '../modules/wallet/wallet-money';

const PASSKEY_LIFETIME_MS = 24 * 60 * 60 * 1000;

const TAX_CLASSIFICATIONS = new Set([
  'vat_registered',
  'non_vat_percentage_tax',
  'vat_exempt',
  'zero_rated_vat',
  'government_entity',
  'boi_peza_registered',
]);

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertMerchantAccess(merchantId: number, requester: { id: string; role?: string }) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    if (merchant.userId !== requester.id && !['admin', 'staff'].includes(String(requester.role))) {
      throw new ForbiddenException('You do not have access to this merchant account');
    }
    return merchant;
  }

  private createPasskey() {
    return `WK-${randomBytes(9).toString('base64url')}`;
  }

  private createShopId(merchantId: number, latitude: unknown, longitude: unknown) {
    const coordinate = (value: unknown) => Number(value).toFixed(5).replace('-', 'M').replace('.', '');
    return `WKS-${merchantId}-${coordinate(latitude)}-${coordinate(longitude)}`.toUpperCase();
  }

  private async ensureShopAccess(branch: any): Promise<any> {
    const now = new Date();
    const needsShopId = !branch.shopId && Number.isFinite(Number(branch.latitude)) && Number.isFinite(Number(branch.longitude));
    const needsPasskey = !branch.passkey || !branch.passkeyExpiresAt || branch.passkeyExpiresAt <= now;
    if (!needsShopId && !needsPasskey) return branch;

    return this.prisma.branch.update({
      where: { id: branch.id },
      data: {
        ...(needsShopId ? { shopId: this.createShopId(branch.merchantId, branch.latitude, branch.longitude) } : {}),
        ...(needsPasskey
          ? { passkey: this.createPasskey(), passkeyExpiresAt: new Date(now.getTime() + PASSKEY_LIFETIME_MS) }
          : {}),
      },
      include: { _count: { select: { staff: true } } },
    });
  }

  async findAllByMerchant(merchantId: number, requester: { id: string; role?: string }) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    if (merchant.userId !== requester.id && !['admin', 'staff'].includes(String(requester.role))) {
      throw new ForbiddenException('You do not have access to this merchant account');
    }

    const application = merchant.merchantCode
      ? await this.prisma.merchantApplication.findUnique({ where: { merchantCode: merchant.merchantCode } })
      : null;

    let walletBalance = 0;
    let dailyFee = Number(merchant.subscriptionAmount);
    let hasWalletCoverage = true;
    if (merchant.subscriptionPlan.toLowerCase() === 'daily') {
      const wallet = await (
        merchant.userId
          ? this.prisma.wallet.findUnique({ where: { userId: merchant.userId } })
          : Promise.resolve(null)
      );
      walletBalance = moneyNumber(wallet?.balance || 0);
      const addOns = application?.selectedAddOnIds.length
        ? await this.prisma.subscriptionAddOnPackage.findMany({
            where: { id: { in: application.selectedAddOnIds } },
            select: { id: true, amount: true },
          })
        : [];
      dailyFee =
        Number(application?.subscriptionAmount ?? merchant.subscriptionAmount) +
        addOns.reduce(
          (sum, addOn) =>
            sum +
            Number(addOn.amount) *
              addOnQuantity(application?.selectedAddOnQuantities, addOn.id),
          0,
        );
      const paidToday = wallet
        ? await this.prisma.walletTransaction.findUnique({
            where: { referenceNumber: dailySubscriptionReference(merchant.id) },
            select: { id: true },
          })
        : null;
      hasWalletCoverage = Boolean(paidToday) || walletBalance >= dailyFee;
    }
    const isAdministrativelyActive = !['suspended', 'deactivated'].includes(
      merchant.status.toLowerCase(),
    );
    const shopsActive = isAdministrativelyActive && hasWalletCoverage;
    await this.prisma.branch.updateMany({
      where: { merchantId, isActive: { not: shopsActive } },
      data: { isActive: shopsActive },
    });

    let branches = await this.prisma.branch.findMany({
      where: { merchantId },
      include: { _count: { select: { staff: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (branches.length === 0) {
      await this.prisma.branch.create({
        data: {
          merchantId,
          name: merchant.name,
          address: merchant.address,
          city: merchant.city,
          state: merchant.state,
          zipCode: merchant.zipCode,
          phone: merchant.phone,
          tin: merchant.tin,
          registeredBusinessName: merchant.registeredBusinessName || merchant.name,
          taxClassification: merchant.taxClassification,
          isActive: shopsActive,
          isDefault: true,
        },
      });
      branches = await this.prisma.branch.findMany({
        where: { merchantId },
        include: { _count: { select: { staff: true } } },
        orderBy: { createdAt: 'desc' },
      });
    }
    branches = await Promise.all(branches.map((branch) => this.ensureShopAccess(branch)));
    return branches.map((b) => ({
      ...b,
      ...operationState(b),
      merchant_id: b.merchantId,
      zip_code: b.zipCode,
      registered_business_name: b.registeredBusinessName,
      tax_classification: b.taxClassification,
      is_default: b.isDefault,
      operating_hours: b.operatingHours,
      is_active: b.isActive,
      created_at: b.createdAt,
      updated_at: b.updatedAt,
      staff_count: b._count.staff,
      wallet_balance: walletBalance,
      daily_subscription_fee: dailyFee,
      wallet_funded: hasWalletCoverage,
      shop_id: b.shopId,
      passkey: b.passkey,
      passkey_expires_at: b.passkeyExpiresAt,
      store_id: b.shopId,
      temporary_password: b.passkey,
      recovery_key: b.isDefault ? application?.recoveryKey ?? null : null,
    }));
  }

  async create(merchantId: number, input: any, requester: { id: string; role?: string }) {
    await this.assertMerchantAccess(merchantId, requester);
    if (!TAX_CLASSIFICATIONS.has(String(input.tax_classification ?? input.taxClassification ?? ''))) {
      throw new BadRequestException('Choose a valid business tax classification');
    }
    if (!Number.isFinite(Number(input.latitude)) || !Number.isFinite(Number(input.longitude))) {
      throw new BadRequestException('Choose a valid shop location');
    }
    const data: any = {
      merchantId,
      name: input.name,
      shopId: this.createShopId(merchantId, input.latitude, input.longitude),
      passkey: this.createPasskey(),
      passkeyExpiresAt: new Date(Date.now() + PASSKEY_LIFETIME_MS),
    };

    if (input.address !== undefined) data.address = input.address;
    if (input.city !== undefined) data.city = input.city;
    if (input.region !== undefined) data.region = input.region;
    if (input.council_district !== undefined || input.councilDistrict !== undefined)
      data.councilDistrict = input.council_district ?? input.councilDistrict;
    if (input.geographic_area !== undefined || input.geographicArea !== undefined)
      data.geographicArea = input.geographic_area ?? input.geographicArea;
    if (input.state !== undefined) data.state = input.state;
    if (input.zip_code ?? input.zipCode) data.zipCode = input.zip_code ?? input.zipCode;
    if (input.latitude !== undefined) data.latitude = input.latitude;
    if (input.longitude !== undefined) data.longitude = input.longitude;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.tin !== undefined) data.tin = input.tin;
    if (input.registered_business_name !== undefined || input.registeredBusinessName !== undefined)
      data.registeredBusinessName = input.registered_business_name ?? input.registeredBusinessName;
    if (input.tax_classification !== undefined || input.taxClassification !== undefined)
      data.taxClassification = input.tax_classification ?? input.taxClassification;
    if (input.operating_hours ?? input.operatingHours)
      data.operatingHours = input.operating_hours ?? input.operatingHours;

    const branch = await this.prisma.branch.create({ data });
    return {
      ...branch,
      merchant_id: branch.merchantId,
      is_active: branch.isActive,
      shop_id: branch.shopId,
      passkey: branch.passkey,
      passkey_expires_at: branch.passkeyExpiresAt,
    };
  }

  async update(id: number, input: any, requester: { id: string; role?: string }) {
    const existing = await this.prisma.branch.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Branch not found');
    await this.assertMerchantAccess(existing.merchantId, requester);

    const data: any = {};
    const taxClassification = input.tax_classification ?? input.taxClassification;
    if (taxClassification !== undefined && !TAX_CLASSIFICATIONS.has(String(taxClassification))) {
      throw new BadRequestException('Choose a valid business tax classification');
    }
    if (input.name !== undefined) data.name = input.name;
    if (input.address !== undefined) data.address = input.address;
    if (input.city !== undefined) data.city = input.city;
    if (input.state !== undefined) data.state = input.state;
    if (input.zip_code !== undefined || input.zipCode !== undefined)
      data.zipCode = input.zip_code ?? input.zipCode;
    if (input.latitude !== undefined) data.latitude = input.latitude;
    if (input.longitude !== undefined) data.longitude = input.longitude;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.tin !== undefined) data.tin = input.tin;
    if (input.registered_business_name !== undefined || input.registeredBusinessName !== undefined)
      data.registeredBusinessName = input.registered_business_name ?? input.registeredBusinessName;
    if (input.tax_classification !== undefined || input.taxClassification !== undefined)
      data.taxClassification = input.tax_classification ?? input.taxClassification;
    if (input.operating_hours !== undefined || input.operatingHours !== undefined)
      data.operatingHours = input.operating_hours ?? input.operatingHours;
    if (input.manual_open_override !== undefined || input.manualOpenOverride !== undefined) {
      // `null` is meaningful here: it clears a manual override and restores
      // automatic schedule handling. Do not discard it with nullish coalescing.
      const override = input.manual_open_override !== undefined
        ? input.manual_open_override
        : input.manualOpenOverride;
      if (override !== null && typeof override !== 'boolean') {
        throw new BadRequestException('Manual shop override must be open, closed, or automatic');
      }
      data.manualOpenOverride = override;
      data.manualOverrideUpdatedAt = new Date();
      data.manualOverrideUpdatedBy = requester.id;
    }
    if (input.is_active !== undefined || input.isActive !== undefined)
      data.isActive = input.is_active ?? input.isActive;

    if (!existing.shopId && Number.isFinite(Number(input.latitude ?? existing.latitude)) && Number.isFinite(Number(input.longitude ?? existing.longitude))) {
      data.shopId = this.createShopId(
        existing.merchantId,
        input.latitude ?? existing.latitude,
        input.longitude ?? existing.longitude,
      );
    }
    if (!existing.passkey || !existing.passkeyExpiresAt || existing.passkeyExpiresAt <= new Date()) {
      data.passkey = this.createPasskey();
      data.passkeyExpiresAt = new Date(Date.now() + PASSKEY_LIFETIME_MS);
    }
    const branch = await this.prisma.branch.update({ where: { id }, data });
    return { ...branch, ...operationState(branch), merchant_id: branch.merchantId, is_active: branch.isActive };
  }

  async regeneratePasskey(id: number, requester: { id: string; role?: string }) {
    const existing = await this.prisma.branch.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Branch not found');
    await this.assertMerchantAccess(existing.merchantId, requester);

    const branch = await this.prisma.branch.update({
      where: { id },
      data: {
        passkey: this.createPasskey(),
        passkeyExpiresAt: new Date(Date.now() + PASSKEY_LIFETIME_MS),
      },
    });
    return {
      id: branch.id,
      passkey: branch.passkey,
      passkey_expires_at: branch.passkeyExpiresAt,
    };
  }

  async remove(id: number, requester: { id: string; role?: string }) {
    const existing = await this.prisma.branch.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Branch not found');
    await this.assertMerchantAccess(existing.merchantId, requester);
    if (existing.isDefault) {
      throw new BadRequestException('The default shop cannot be deleted');
    }

    await this.prisma.branch.delete({ where: { id } });
    return { message: 'Branch deleted' };
  }
}
