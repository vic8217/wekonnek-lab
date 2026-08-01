import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGatewayService } from '../modules/wallet/payment-gateway.service';
import { WalletPaymentGateway } from '@prisma/client';
import {
  computeExpiry,
  getPlansResponse,
} from './subscription-plans';

interface UpgradeInput {
  tier: string;
  plan: string;
  payment_method?: string; // 'online' | 'manual'
  gateway?: string;
  payment_proof_url?: string;
  auto_renew?: boolean;
}

interface PlanDefinitionInput {
  audience?: string;
  tier?: string;
  fixed_amount?: number | string;
  variable_order_percent?: number | string;
  product_limit?: number | string;
  features?: string[] | string;
  minimum_orders?: number | string;
  is_active?: boolean;
}

interface AddOnPackageInput {
  audience?: string;
  name?: string;
  amount?: number | string;
  billing_unit?: string;
  amount_basis?: string;
  description?: string;
  is_active?: boolean;
}

const ONLINE_GATEWAYS = new Set(['gcash', 'maya', 'card', 'xendit', 'paymongo', 'grab_pay']);

function normalizeFeatures(value: string[] | string | undefined): string[] {
  const entries = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  const features = [...new Set(entries.map(item => item.trim()).filter(Boolean))];
  if (features.length > 20) {
    throw new BadRequestException('A tier can have up to 20 features');
  }
  if (features.some(feature => feature.length > 200)) {
    throw new BadRequestException('Each feature must be 200 characters or fewer');
  }
  return features;
}

function serializePayment(p: any) {
  if (!p) return p;
  return {
    id: p.id,
    merchant_id: p.merchantId,
    merchantId: p.merchantId,
    tier: p.tier,
    plan: p.plan,
    amount: p.amount,
    payment_method: p.paymentMethod,
    paymentMethod: p.paymentMethod,
    gateway: p.gateway,
    status: p.status,
    payment_proof_url: p.paymentProofUrl,
    payment_ref: p.paymentRef,
    payment_url: p.paymentUrl,
    period_start: p.periodStart,
    period_end: p.periodEnd,
    rejection_reason: p.rejectionReason,
    reviewed_at: p.reviewedAt,
    created_at: p.createdAt,
    createdAt: p.createdAt,
    updated_at: p.updatedAt,
    merchant: p.merchant
      ? {
          id: p.merchant.id,
          name: p.merchant.name,
          slug: p.merchant.slug,
          subscription_tier: p.merchant.subscriptionTier,
          subscription_plan: p.merchant.subscriptionPlan,
        }
      : undefined,
  };
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentGateway: PaymentGatewayService,
  ) {}

  getPlans() {
    return getPlansResponse();
  }

  async getMerchantOptions() {
    const [plans, addOns] = await Promise.all([
      this.prisma.subscriptionPlanDefinition.findMany({
        where: { audience: 'merchant', isActive: true },
        orderBy: { fixedAmount: 'asc' },
      }),
      this.prisma.subscriptionAddOnPackage.findMany({
        where: { audience: 'merchant', isActive: true },
        orderBy: { amount: 'asc' },
      }),
    ]);
    return { plans, addOns };
  }

  async getPlanDefinitions() {
    return this.prisma.subscriptionPlanDefinition.findMany({
      orderBy: [{ audience: 'asc' }, { fixedAmount: 'desc' }],
    });
  }

  async createPlanDefinition(input: PlanDefinitionInput) {
    const audience = String(input.audience || '').trim().toLowerCase();
    const tier = String(input.tier || '').trim().toLowerCase();
    if (!['merchant', 'rider', 'coordinator'].includes(audience)) {
      throw new BadRequestException('Audience must be merchant, rider, or coordinator');
    }
    if (!tier) throw new BadRequestException('Tier name is required');
    if (audience === 'coordinator' && !['silver', 'gold', 'platinum'].includes(tier)) {
      throw new BadRequestException('Coordinator tiers must be Silver, Gold, or Platinum');
    }
    const fixedAmount = Number(input.fixed_amount);
    if (!Number.isFinite(fixedAmount) || fixedAmount < 0) {
      throw new BadRequestException('Fixed amount must be zero or greater');
    }
    const variablePercent = input.variable_order_percent === undefined || input.variable_order_percent === ''
      ? null : Number(input.variable_order_percent);
    const productLimit = input.product_limit === undefined || input.product_limit === ''
      ? null : Number(input.product_limit);
    const minimumOrders = input.minimum_orders === undefined || input.minimum_orders === ''
      ? null : Number(input.minimum_orders);
    const features = audience === 'merchant' ? normalizeFeatures(input.features) : [];
    if (audience === 'merchant' && variablePercent !== null && (!Number.isFinite(variablePercent) || variablePercent < 0 || variablePercent > 100)) {
      throw new BadRequestException('Merchant variable percentage must be N/A or between 0 and 100');
    }
    if (audience === 'merchant' && (!Number.isInteger(productLimit) || productLimit! < 0)) {
      throw new BadRequestException('Merchant product limit must be a whole number of zero or greater');
    }
    if (audience === 'rider' && (!Number.isInteger(minimumOrders) || minimumOrders! < 0)) {
      throw new BadRequestException('Rider minimum orders must be zero or greater');
    }
    const existing = await this.prisma.subscriptionPlanDefinition.findUnique({
      where: { audience_tier: { audience, tier } },
    });
    if (existing) throw new BadRequestException(`${tier} already exists for ${audience}s`);
    return this.prisma.subscriptionPlanDefinition.create({
      data: {
        audience,
        tier,
        fixedAmount,
        variableOrderPercent: audience === 'merchant' ? variablePercent : null,
        productLimit: audience === 'merchant' ? productLimit : null,
        features,
        minimumOrders: audience === 'rider' ? minimumOrders : null,
        includesInHouseRiders: audience === 'coordinator' ? tier !== 'silver' : null,
      },
    });
  }

  async getAddOnPackages() {
    return this.prisma.subscriptionAddOnPackage.findMany({
      orderBy: [{ audience: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createAddOnPackage(input: AddOnPackageInput) {
    const audience = String(input.audience || '').trim().toLowerCase();
    const name = String(input.name || '').trim();
    const amount = Number(input.amount);
    const billingUnit = String(input.billing_unit || '').trim().toLowerCase();
    const amountBasis = String(input.amount_basis || '').trim().toLowerCase();
    if (!['merchant', 'rider', 'coordinator'].includes(audience)) throw new BadRequestException('Invalid add-on audience');
    if (!name) throw new BadRequestException('Add-on name is required');
    if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException('Enter a valid add-on amount');
    if (!['day', 'week', 'month'].includes(billingUnit)) throw new BadRequestException('Billing period must be day, week, or month');
    if (amountBasis && !['keyword', 'inventory'].includes(amountBasis)) throw new BadRequestException('Amount basis must be per keyword, per inventory item, or blank');
    return this.prisma.subscriptionAddOnPackage.create({
      data: {
        audience,
        name,
        amount,
        billingUnit,
        amountBasis: amountBasis || null,
        description: String(input.description || '').trim() || null,
      },
    });
  }

  async updateAddOnPackage(id: string, input: AddOnPackageInput) {
    const existing = await this.prisma.subscriptionAddOnPackage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Add-on package not found');
    const name = String(input.name || '').trim();
    const amount = Number(input.amount);
    const billingUnit = String(input.billing_unit || '').trim().toLowerCase();
    const amountBasis = String(input.amount_basis || '').trim().toLowerCase();
    if (!name) throw new BadRequestException('Add-on name is required');
    if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException('Enter a valid add-on amount');
    if (!['day', 'week', 'month'].includes(billingUnit)) throw new BadRequestException('Billing period must be day, week, or month');
    if (amountBasis && !['keyword', 'inventory'].includes(amountBasis)) throw new BadRequestException('Amount basis must be per keyword, per inventory item, or blank');
    return this.prisma.subscriptionAddOnPackage.update({
      where: { id },
      data: {
        name,
        amount,
        billingUnit,
        amountBasis: amountBasis || null,
        description: String(input.description || '').trim() || null,
        isActive: input.is_active ?? existing.isActive,
      },
    });
  }

  async deleteAddOnPackage(id: string) {
    const existing = await this.prisma.subscriptionAddOnPackage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Add-on package not found');
    await this.prisma.subscriptionAddOnPackage.delete({ where: { id } });
    return { deleted: true, id };
  }

  async updatePlanDefinition(id: string, input: PlanDefinitionInput) {
    const existing = await this.prisma.subscriptionPlanDefinition.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Subscription tier not found');
    const fixedAmount = Number(input.fixed_amount);
    if (!Number.isFinite(fixedAmount) || fixedAmount < 0) {
      throw new BadRequestException('Fixed amount must be zero or greater');
    }
    const variablePercent = input.variable_order_percent === undefined || input.variable_order_percent === ''
      ? null : Number(input.variable_order_percent);
    const productLimit = input.product_limit === undefined || input.product_limit === ''
      ? null : Number(input.product_limit);
    const minimumOrders = input.minimum_orders === undefined || input.minimum_orders === ''
      ? null : Number(input.minimum_orders);
    const features = existing.audience === 'merchant'
      ? normalizeFeatures(input.features)
      : existing.features;
    if (existing.audience === 'merchant' && variablePercent !== null && (!Number.isFinite(variablePercent) || variablePercent < 0 || variablePercent > 100)) {
      throw new BadRequestException('Merchant variable percentage must be N/A or between 0 and 100');
    }
    if (existing.audience === 'merchant' && (!Number.isInteger(productLimit) || productLimit! < 0)) {
      throw new BadRequestException('Merchant product limit must be a whole number of zero or greater');
    }
    if (existing.audience === 'rider' && (!Number.isInteger(minimumOrders) || minimumOrders! < 0)) {
      throw new BadRequestException('Rider minimum orders must be zero or greater');
    }
    return this.prisma.subscriptionPlanDefinition.update({
      where: { id },
      data: {
        fixedAmount,
        variableOrderPercent: existing.audience === 'merchant' ? variablePercent : null,
        productLimit: existing.audience === 'merchant' ? productLimit : null,
        features,
        minimumOrders: existing.audience === 'rider' ? minimumOrders : null,
        isActive: input.is_active ?? existing.isActive,
      },
    });
  }

  async deletePlanDefinition(id: string) {
    const existing = await this.prisma.subscriptionPlanDefinition.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Subscription tier not found');
    if (existing.audience !== 'merchant') {
      throw new BadRequestException('Only merchant tiers can be deleted');
    }
    await this.prisma.subscriptionPlanDefinition.delete({ where: { id } });
    return { deleted: true, id };
  }

  private async resolveMerchantForUser(userId: string) {
    const merchant = await this.prisma.merchant.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    if (!merchant) {
      throw new NotFoundException('No merchant profile found for this account');
    }
    return merchant;
  }

  /** Create an upgrade/renewal request. Online → gateway URL; manual → pending admin review. */
  async upgrade(userId: string, input: UpgradeInput) {
    const tier = (input.tier || '').toLowerCase();
    const planDefinition = await this.prisma.subscriptionPlanDefinition.findUnique({
      where: { audience_tier: { audience: 'merchant', tier } },
    });
    if (!planDefinition?.isActive) {
      throw new BadRequestException('This merchant subscription tier is not available');
    }
    const plan = 'daily';
    const amount = Number(planDefinition.fixedAmount);

    const merchant = await this.resolveMerchantForUser(userId);
    const method = (input.payment_method || 'online').toLowerCase();
    const isOnline = method === 'online' || ONLINE_GATEWAYS.has(method);

    const payment = await this.prisma.subscriptionPayment.create({
      data: {
        merchantId: merchant.id,
        tier,
        plan,
        amount,
        paymentMethod: isOnline ? 'online' : 'manual',
        gateway: isOnline ? (input.gateway || 'xendit').toLowerCase() : null,
        status: 'pending',
        paymentProofUrl: input.payment_proof_url ?? null,
      },
    });

    if (isOnline) {
      try {
        const gateway = this.resolveGateway(input.gateway);
        const appUrl = process.env.APP_BASE_URL || 'http://localhost:3001';
        const result = await this.paymentGateway.createPayment({
          gateway,
          amount,
          description: `WeKonnek ${tier} (${plan}) subscription`,
          paymentMethod: 'gcash',
          redirectSuccess: `${appUrl}/merchant/subscription/upgrade?paid=1`,
          redirectFailed: `${appUrl}/merchant/subscription/upgrade?paid=0`,
          metadata: {
            subscriptionPaymentId: String(payment.id),
            merchantId: String(merchant.id),
          },
        });
        const updated = await this.prisma.subscriptionPayment.update({
          where: { id: payment.id },
          data: {
            paymentRef: result.gatewayTransactionId,
            paymentUrl: result.paymentUrl,
          },
        });
        return serializePayment(updated);
      } catch (err: any) {
        return {
          ...serializePayment(payment),
          payment_error:
            err?.message || 'Online payment could not be initialized',
        };
      }
    }

    // Manual: also flag the auto-renew preference if provided
    if (input.auto_renew != null) {
      await this.prisma.merchant
        .update({
          where: { id: merchant.id },
          data: { autoRenew: !!input.auto_renew },
        })
        .catch(() => undefined);
    }

    return serializePayment(payment);
  }

  private resolveGateway(requested?: string): WalletPaymentGateway {
    const g = (requested || '').toLowerCase();
    if (g === 'maya') return WalletPaymentGateway.maya;
    if (g === 'paymongo') return WalletPaymentGateway.paymongo;
    if (g === 'xendit') return WalletPaymentGateway.xendit;
    return WalletPaymentGateway.xendit;
  }

  async history(userId: string) {
    const merchant = await this.resolveMerchantForUser(userId);
    const payments = await this.prisma.subscriptionPayment.findMany({
      where: { merchantId: merchant.id },
      orderBy: { createdAt: 'desc' },
    });
    return payments.map(serializePayment);
  }

  /** Admin: list subscription payments (optionally filter by status). */
  async findAll(status?: string) {
    const where: any = {};
    if (status && status !== 'all') where.status = status;
    const payments = await this.prisma.subscriptionPayment.findMany({
      where,
      include: { merchant: true },
      orderBy: { createdAt: 'desc' },
    });
    return payments.map(serializePayment);
  }

  /** Activate a paid/approved subscription on the merchant. */
  private async activate(paymentId: number, reviewedBy?: string) {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Subscription payment not found');

    const start = new Date();
    const end = computeExpiry(payment.plan, start);

    await this.prisma.$transaction([
      this.prisma.subscriptionPayment.update({
        where: { id: paymentId },
        data: {
          status: 'paid',
          periodStart: start,
          periodEnd: end,
          reviewedBy: reviewedBy ?? null,
          reviewedAt: reviewedBy ? new Date() : null,
        },
      }),
      this.prisma.merchant.update({
        where: { id: payment.merchantId },
        data: {
          subscriptionTier: payment.tier,
          subscriptionPlan: payment.plan,
          subscriptionAmount: payment.amount,
          subscriptionStatus: 'active',
          subscriptionStartedAt: start,
          subscriptionExpiresAt: end,
        },
      }),
    ]);

    const updated = await this.prisma.subscriptionPayment.findUnique({
      where: { id: paymentId },
      include: { merchant: true },
    });
    return serializePayment(updated);
  }

  /** Admin approve a manual subscription payment. */
  async approve(id: number, reviewedBy?: string) {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { id: Number(id) },
    });
    if (!payment) throw new NotFoundException('Subscription payment not found');
    if (payment.status === 'paid') {
      throw new BadRequestException('This payment is already approved');
    }
    return this.activate(Number(id), reviewedBy);
  }

  /** Admin reject a manual subscription payment. */
  async reject(id: number, reason?: string, reviewedBy?: string) {
    const payment = await this.prisma.subscriptionPayment.findUnique({
      where: { id: Number(id) },
    });
    if (!payment) throw new NotFoundException('Subscription payment not found');
    const updated = await this.prisma.subscriptionPayment.update({
      where: { id: Number(id) },
      data: {
        status: 'rejected',
        rejectionReason: reason ?? null,
        reviewedBy: reviewedBy ?? null,
        reviewedAt: new Date(),
      },
      include: { merchant: true },
    });
    return serializePayment(updated);
  }

  /** Called by the payment webhook to confirm an online subscription payment. */
  async markPaidByGateway(
    subscriptionPaymentId: string,
    status: 'completed' | 'failed',
  ) {
    if (!subscriptionPaymentId) return;
    const id = Number(subscriptionPaymentId);
    if (Number.isNaN(id)) return;
    if (status === 'failed') {
      await this.prisma.subscriptionPayment
        .update({ where: { id }, data: { status: 'failed' } })
        .catch(() => undefined);
      return;
    }
    await this.activate(id).catch(() => undefined);
  }
}
