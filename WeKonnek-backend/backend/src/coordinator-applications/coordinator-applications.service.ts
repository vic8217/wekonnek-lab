import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { NotificationType, UserRole } from '@prisma/client';
import { NotificationsService } from '../modules/notifications/notifications.service';

@Injectable()
export class CoordinatorApplicationsService {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  async getCommissionSettings() {
    const setting = await this.prisma.coordinatorCommissionSetting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, rate: 0 },
    });
    return { rate: Number(setting.rate), updatedAt: setting.updatedAt };
  }

  async updateCommissionSettings(rate?: number) {
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new BadRequestException('Commission rate must be between 0 and 100');
    }
    const setting = await this.prisma.coordinatorCommissionSetting.upsert({
      where: { id: 1 },
      update: { rate: value },
      create: { id: 1, rate: value },
    });
    return { rate: Number(setting.rate), updatedAt: setting.updatedAt };
  }

  async creditOrderCommission(orderId: number) {
    const order = await this.prisma.wkOrder.findUnique({
        where: { id: orderId },
        select: { id: true, totalAmount: true, merchant: { select: { id: true, name: true, subscriptionTier: true } } },
      });
    if (!order) return null;
    const plan = await this.prisma.subscriptionPlanDefinition.findUnique({
      where: { audience_tier: { audience: 'merchant', tier: order.merchant.subscriptionTier.toLowerCase() } },
      select: { variableOrderPercent: true },
    });
    const variableRate = Number(plan?.variableOrderPercent || 0);
    if (variableRate <= 0) return null;
    const orderTotal = Number(order.totalAmount);
    const netOfVatSales = orderTotal / 1.12;
    const systemFee = Math.round((netOfVatSales * variableRate / 100) * 100) / 100;
    return this.creditMerchantFeeCommission({
      merchantId: order.merchant.id,
      systemFee,
      sourceReference: `ORDER-${order.id}`,
      orderId: String(order.id),
      description: `Variable order-fee commission from ${order.merchant.name}`,
      metadata: { fee_type: 'variable_order_fee', order_total: orderTotal, net_of_vat_sales: netOfVatSales, merchant_variable_rate: variableRate },
    });
  }

  async creditFixedFeeCommission(merchantId: number, systemFee: number, chargeReference: string) {
    return this.creditMerchantFeeCommission({
      merchantId,
      systemFee,
      sourceReference: chargeReference,
      description: 'Fixed daily subscription-fee commission',
      metadata: { fee_type: 'fixed_daily_fee' },
    });
  }

  private async creditMerchantFeeCommission(input: { merchantId: number; systemFee: number; sourceReference: string; orderId?: string; description: string; metadata?: Record<string, unknown> }) {
    const referenceNumber = `COORD-COMM-${input.sourceReference}`;
    const existing = await this.prisma.walletTransaction.findUnique({ where: { referenceNumber } });
    if (existing) return existing;
    const [setting, merchant] = await Promise.all([
      this.prisma.coordinatorCommissionSetting.findUnique({ where: { id: 1 } }),
      this.prisma.merchant.findUnique({ where: { id: input.merchantId }, select: { id: true, name: true, merchantCode: true } }),
    ]);
    const rate = Number(setting?.rate || 0);
    if (!merchant?.merchantCode || rate <= 0 || input.systemFee <= 0) return null;
    const application = await this.prisma.merchantApplication.findUnique({
      where: { merchantCode: merchant.merchantCode },
      select: { assignedCoordinatorId: true },
    });
    if (!application?.assignedCoordinatorId) return null;
    const coordinator = await this.prisma.coordinatorApplication.findUnique({
      where: { userId: application.assignedCoordinatorId },
      select: { userId: true, status: true },
    });
    if (!coordinator?.userId || coordinator.status !== 'approved') return null;
    const amount = Math.round((input.systemFee * rate / 100) * 100) / 100;
    if (amount <= 0) return null;

    return this.prisma.$transaction(async tx => {
      const duplicate = await tx.walletTransaction.findUnique({ where: { referenceNumber } });
      if (duplicate) return duplicate;
      const wallet = await tx.wallet.upsert({
        where: { userId: coordinator.userId! },
        update: { balance: { increment: amount } },
        create: { userId: coordinator.userId!, balance: amount },
      });
      return tx.walletTransaction.create({
        data: {
          referenceNumber,
          walletId: wallet.id,
          type: 'earning',
          status: 'completed',
          gateway: 'internal',
          amount,
          fee: 0,
          netAmount: amount,
          orderId: input.orderId,
          description: input.description,
          metadata: { merchant_id: merchant.id, merchant_name: merchant.name, coordinator_commission_rate: rate, system_fee: input.systemFee, ...input.metadata },
        },
      });
    });
  }

  async create(input: Record<string, unknown>) {
    const required = ['fullName', 'mobileNumber', 'email', 'region', 'provinceDistrict', 'cityMunicipality', 'latitude', 'longitude'];
    for (const field of required) {
      if (input[field] === undefined || input[field] === '') throw new BadRequestException(`${field} is required`);
    }
    const application = await this.prisma.coordinatorApplication.create({
      data: {
        fullName: String(input.fullName), mobileNumber: String(input.mobileNumber),
        viberAccount: input.viberAccount ? String(input.viberAccount) : null,
        whatsappNumber: input.whatsappNumber ? String(input.whatsappNumber) : null,
        email: String(input.email).trim().toLowerCase(),
        region: String(input.region), provinceDistrict: String(input.provinceDistrict), cityMunicipality: String(input.cityMunicipality),
        councilDistrict: input.councilDistrict ? String(input.councilDistrict) : null,
        barangay: input.barangay ? String(input.barangay) : null,
        preferredCoverageArea: input.preferredCoverageArea ? String(input.preferredCoverageArea) : null,
        latitude: Number(input.latitude), longitude: Number(input.longitude),
        background: input.background ? String(input.background) : null, occupation: input.occupation ? String(input.occupation) : null,
        motivation: input.motivation ? String(input.motivation) : null, monthlyCapacity: input.monthlyCapacity ? String(input.monthlyCapacity) : null,
        referred: input.referred ? String(input.referred) : null,
        governmentIdFrontUrl: input.governmentIdFrontUrl ? String(input.governmentIdFrontUrl) : null,
        governmentIdBackUrl: input.governmentIdBackUrl ? String(input.governmentIdBackUrl) : null,
        resumeUrl: input.resumeUrl ? String(input.resumeUrl) : null,
        supportingDocumentUrl: input.supportingDocumentUrl ? String(input.supportingDocumentUrl) : null,
      },
    });
    const administrators = await this.prisma.user.findMany({ where: { role: { in: [UserRole.admin, UserRole.staff] }, isActive: true }, select: { id: true } });
    await this.notifications.notifyUsers(administrators.map(user => user.id), { title: 'New coordinator application', body: 'A new coordinator application is ready for review.', type: NotificationType.system, data: { kind: 'coordinator_application', applicationId: String(application.id), url: '/admin/coordinators' } }).catch(() => undefined);
    return application;
  }

  async findAll() {
    const coordinators = await this.prisma.coordinatorApplication.findMany({
      include: { managementZone: { include: { coverages: true } } },
      orderBy: { submittedAt: 'desc' },
    });
    const userIds = coordinators.flatMap(coordinator => coordinator.userId ? [coordinator.userId] : []);
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const wallets = userIds.length ? await this.prisma.wallet.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, transactions: { where: { type: 'earning', status: 'completed', createdAt: { gte: monthStart } }, select: { amount: true } } },
    }) : [];
    const commissionByUser = new Map(wallets.map(wallet => [wallet.userId, wallet.transactions.reduce((sum, transaction) => sum + transaction.amount, 0)]));
    return coordinators.map(coordinator => ({ ...coordinator, currentMonthCommission: coordinator.userId ? commissionByUser.get(coordinator.userId) || 0 : 0 }));
  }

  async commissionLedger(id: number) {
    const coordinator = await this.prisma.coordinatorApplication.findUnique({ where: { id } });
    if (!coordinator?.userId) throw new BadRequestException('Approved coordinator account not found');
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: coordinator.userId },
      select: { transactions: { where: { type: 'earning', status: 'completed' }, orderBy: { createdAt: 'desc' }, select: { id: true, amount: true, netAmount: true, orderId: true, description: true, metadata: true, referenceNumber: true, createdAt: true } } },
    });
    const transactions = wallet?.transactions || [];
    const orderIds = [...new Set(transactions.flatMap(transaction => transaction.orderId && /^\d+$/.test(transaction.orderId) ? [Number(transaction.orderId)] : []))];
    const orders = orderIds.length ? await this.prisma.wkOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderCode: true, merchant: { select: { id: true, name: true } } } }) : [];
    const orderById = new Map(orders.map(order => [order.id, order]));
    const months = new Map<string, { key: string; label: string; total: number; merchants: Map<string, { merchant_id: number | null; merchant_name: string; amount: number; transactions: number }> }>();
    transactions.forEach(transaction => {
      const date = new Date(transaction.createdAt);
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      const month = months.get(key) || { key, label: date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' }), total: 0, merchants: new Map() };
      const order = transaction.orderId && /^\d+$/.test(transaction.orderId) ? orderById.get(Number(transaction.orderId)) : undefined;
      const metadata = transaction.metadata && typeof transaction.metadata === 'object' && !Array.isArray(transaction.metadata) ? transaction.metadata as Record<string, unknown> : {};
      const merchantId = order?.merchant.id ?? (Number(metadata.merchant_id ?? metadata.merchantId) || null);
      const merchantName = order?.merchant.name ?? String(metadata.merchant_name ?? metadata.merchantName ?? transaction.description ?? 'Unattributed commission');
      const merchantKey = merchantId ? String(merchantId) : merchantName;
      const merchant = month.merchants.get(merchantKey) || { merchant_id: merchantId, merchant_name: merchantName, amount: 0, transactions: 0 };
      merchant.amount += transaction.amount;
      merchant.transactions += 1;
      month.total += transaction.amount;
      month.merchants.set(merchantKey, merchant);
      months.set(key, month);
    });
    const monthRows = [...months.values()].sort((a, b) => b.key.localeCompare(a.key)).map(month => ({ ...month, merchants: [...month.merchants.values()].sort((a, b) => b.amount - a.amount) }));
    const now = new Date();
    const currentKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    return { coordinator: { id: coordinator.id, full_name: coordinator.fullName, coordinator_code: coordinator.coordinatorCode }, current_month: monthRows.find(month => month.key === currentKey)?.total || 0, all_time: monthRows.reduce((sum, month) => sum + month.total, 0), months: monthRows };
  }

  async stats() {
    const [applicants, pending, approved, activeAreas] = await Promise.all([
      this.prisma.coordinatorApplication.count(),
      this.prisma.coordinatorApplication.count({ where: { status: 'pending' } }),
      this.prisma.coordinatorApplication.count({ where: { status: 'approved' } }),
      this.prisma.coordinatorApplication.findMany({ where: { status: 'approved', managementZoneId: { not: null } }, distinct: ['managementZoneId'], select: { managementZoneId: true } }),
    ]);
    return { applicants, pending, coordinators: approved, activeCoverageAreas: activeAreas.length };
  }

  async updateStatus(id: number, status: string, managementZoneId?: string | null) {
    if (!['pending', 'approved', 'rejected'].includes(status)) throw new BadRequestException('Invalid coordinator application status');
    if (status === 'approved' && !managementZoneId) throw new BadRequestException('Assign a coordinator zone before approval');
    if (managementZoneId) {
      const zone = await this.prisma.managementZone.findUnique({ where: { id: managementZoneId } });
      if (!zone || !zone.isActive) throw new BadRequestException('Select an active coordinator zone');
    }
    if (status !== 'approved') {
      return this.prisma.coordinatorApplication.update({
        where: { id },
        data: { status, managementZoneId: null },
        include: { managementZone: { include: { coverages: true } } },
      });
    }
    const existing = await this.prisma.coordinatorApplication.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Coordinator application not found');
    if (existing.status === 'approved' && existing.userId) throw new BadRequestException('Coordinator is already approved');

    const coordinatorCode = existing.coordinatorCode || `WKC-${String(id).padStart(6, '0')}`;
    const temporaryPassword = `Wk!${randomBytes(9).toString('base64url')}`;
    const password = await bcrypt.hash(temporaryPassword, 10);
    const resetKey = `WKR-${randomBytes(18).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const resetTokenHash = createHash('sha256').update(resetKey).digest('hex');
    const names = existing.fullName.trim().split(/\s+/);
    const firstName = names.shift() || 'Coordinator';
    const lastName = names.join(' ') || null;
    const application = await this.prisma.$transaction(async tx => {
      const matchingUser = await tx.user.findFirst({
        where: { OR: [{ email: existing.email }, { phone: existing.mobileNumber }] },
      });
      const user = matchingUser
        ? await tx.user.update({
            where: { id: matchingUser.id },
            data: { firstName, lastName, email: existing.email, phone: existing.mobileNumber, password, role: UserRole.coordinator, isActive: true, isVerified: true, status: 'active' },
          })
        : await tx.user.create({
            data: { firstName, lastName, email: existing.email, phone: existing.mobileNumber, password, role: UserRole.coordinator, isActive: true, isVerified: true, status: 'active' },
          });
      return tx.coordinatorApplication.update({
        where: { id },
        data: { status: 'approved', managementZoneId, coordinatorCode, userId: user.id, resetTokenHash, resetTokenExpiresAt: expiresAt, temporaryCredentialExpiresAt: expiresAt },
        include: { managementZone: { include: { coverages: true } } },
      });
    });
    return { ...application, credentials: { applicationId: id, coordinatorCode, email: existing.email, temporaryPassword, resetKey, expiresAt, viberAccount: existing.viberAccount, whatsappNumber: existing.whatsappNumber } };
  }

  async suspend(id: number) {
    const application = await this.prisma.coordinatorApplication.findUnique({ where: { id } });
    if (!application?.userId) throw new BadRequestException('Approved coordinator account not found');
    return this.prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: application.userId! }, data: { isActive: false, status: 'suspended' } });
      return tx.coordinatorApplication.update({
        where: { id }, data: { status: 'suspended', resetTokenHash: null, resetTokenExpiresAt: null },
        include: { managementZone: { include: { coverages: true } } },
      });
    });
  }

  async generateResetKey(id: number) {
    const application = await this.prisma.coordinatorApplication.findUnique({ where: { id } });
    if (!application?.userId || !application.coordinatorCode) throw new BadRequestException('Approved coordinator account not found');
    const resetKey = `WKR-${randomBytes(18).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await this.prisma.coordinatorApplication.update({
      where: { id },
      data: { resetTokenHash: createHash('sha256').update(resetKey).digest('hex'), resetTokenExpiresAt: expiresAt },
    });
    return { resetKey, coordinatorCode: application.coordinatorCode, expiresAt };
  }

  async resetPassword(resetKey: string, newPassword: string) {
    if (!resetKey || newPassword.length < 8) throw new BadRequestException('A valid reset key and password of at least 8 characters are required');
    const resetTokenHash = createHash('sha256').update(resetKey).digest('hex');
    const application = await this.prisma.coordinatorApplication.findFirst({
      where: { resetTokenHash, resetTokenExpiresAt: { gt: new Date() }, userId: { not: null }, status: 'approved' },
    });
    if (!application?.userId) throw new BadRequestException('Reset key is invalid or expired');
    const password = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: application.userId }, data: { password } }),
      this.prisma.coordinatorApplication.update({ where: { id: application.id }, data: { resetTokenHash: null, resetTokenExpiresAt: null, temporaryCredentialExpiresAt: null } }),
    ]);
    return { message: 'Password changed successfully' };
  }

  async updateNotes(id: number, adminNotes: string) {
    return this.prisma.coordinatorApplication.update({
      where: { id },
      data: { adminNotes: adminNotes.trim() || null },
      include: { managementZone: { include: { coverages: true } } },
    });
  }
}
