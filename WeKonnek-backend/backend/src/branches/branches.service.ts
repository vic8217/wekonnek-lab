import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const TAX_CLASSIFICATIONS = new Set([
  'vat_registered',
  'non_vat_percentage_tax',
  'vat_exempt',
  'zero_rated_vat',
  'government_entity',
  'boi_peza_registered',
]);

function addOnQuantity(quantities: unknown, id: string) {
  if (!quantities || typeof quantities !== 'object' || Array.isArray(quantities)) return 1;
  const value = Number((quantities as Record<string, unknown>)[id]);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllByMerchant(merchantId: number) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new NotFoundException('Merchant not found');

    let walletBalance = 0;
    let dailyFee = Number(merchant.subscriptionAmount);
    let hasWalletCoverage = true;
    if (merchant.subscriptionPlan.toLowerCase() === 'daily') {
      const [wallet, application] = await Promise.all([
        merchant.userId
          ? this.prisma.wallet.findUnique({ where: { userId: merchant.userId } })
          : null,
        merchant.merchantCode
          ? this.prisma.merchantApplication.findUnique({ where: { merchantCode: merchant.merchantCode } })
          : null,
      ]);
      walletBalance = Number(wallet?.balance || 0);
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
      hasWalletCoverage = walletBalance >= dailyFee;
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
    return branches.map((b) => ({
      ...b,
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
    }));
  }

  async create(merchantId: number, input: any) {
    if (!TAX_CLASSIFICATIONS.has(String(input.tax_classification ?? input.taxClassification ?? ''))) {
      throw new BadRequestException('Choose a valid business tax classification');
    }
    const data: any = {
      merchantId,
      name: input.name,
    };

    if (input.address !== undefined) data.address = input.address;
    if (input.city !== undefined) data.city = input.city;
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
    return { ...branch, merchant_id: branch.merchantId, is_active: branch.isActive };
  }

  async update(id: number, input: any) {
    const existing = await this.prisma.branch.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Branch not found');

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
    if (input.is_active !== undefined || input.isActive !== undefined)
      data.isActive = input.is_active ?? input.isActive;

    const branch = await this.prisma.branch.update({ where: { id }, data });
    return { ...branch, merchant_id: branch.merchantId, is_active: branch.isActive };
  }

  async remove(id: number) {
    const existing = await this.prisma.branch.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Branch not found');
    if (existing.isDefault) {
      throw new BadRequestException('The default shop cannot be deleted');
    }

    await this.prisma.branch.delete({ where: { id } });
    return { message: 'Branch deleted' };
  }
}
