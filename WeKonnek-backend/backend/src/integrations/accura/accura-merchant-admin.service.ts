import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccuraOnboardingService } from './accura-onboarding.service';
import { getAccuraMerchantIssuanceEligibility } from './accura-eligibility';
import { accuraExternalClientReference } from './accura-client.types';

export type AccuraConnectionFilter =
  | 'all'
  | 'not_connected'
  | 'onboarding'
  | 'needs_action'
  | 'active'
  | 'suspended'
  | 'error';

@Injectable()
export class AccuraMerchantAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboarding: AccuraOnboardingService,
  ) {}

  async listConnections(filter: AccuraConnectionFilter = 'all') {
    const merchants = await this.prisma.merchant.findMany({
      orderBy: { id: 'asc' },
      take: 500,
      select: {
        id: true,
        name: true,
        accuraOnboardingLink: {
          select: {
            externalClientReference: true,
            lastReviewStatus: true,
            lastAccountStatus: true,
            lastProductionEligible: true,
            lastSyncedAt: true,
            lastReadinessPercent: true,
          },
        },
        accuraShopBranchMappings: {
          select: { shopId: true, accuraBranchId: true },
        },
      },
    });

    const rows = await Promise.all(
      merchants.map(async (merchant) => {
        const lastJob = await this.prisma.accuraIssuanceJob.findFirst({
          where: { wkOrder: { merchantId: merchant.id } },
          orderBy: { updatedAt: 'desc' },
          select: {
            status: true,
            lastErrorCategory: true,
            updatedAt: true,
            wkOrder: {
              select: {
                orderCode: true,
                accuraInvoice: {
                  select: {
                    accuraInvoiceNumber: true,
                    accuraIssuedAt: true,
                  },
                },
              },
            },
          },
        });
        const eligibility = getAccuraMerchantIssuanceEligibility({
          link: merchant.accuraOnboardingLink
            ? {
                lastAccountStatus: merchant.accuraOnboardingLink.lastAccountStatus,
                lastReviewStatus: merchant.accuraOnboardingLink.lastReviewStatus,
                lastProductionEligible:
                  merchant.accuraOnboardingLink.lastProductionEligible,
                lastSyncedAt: merchant.accuraOnboardingLink.lastSyncedAt,
              }
            : null,
          shopId: merchant.accuraShopBranchMappings[0]?.shopId ?? null,
          hasBranchMapping: merchant.accuraShopBranchMappings.length > 0,
        });
        return {
          merchantId: merchant.id,
          merchantName: merchant.name,
          externalClientReference:
            merchant.accuraOnboardingLink?.externalClientReference ||
            accuraExternalClientReference(merchant.id),
          connectionStatus: eligibility.status,
          productionEligible: eligibility.eligible,
          reviewStatus: merchant.accuraOnboardingLink?.lastReviewStatus ?? null,
          accountStatus: merchant.accuraOnboardingLink?.lastAccountStatus ?? null,
          mappedBranches: merchant.accuraShopBranchMappings.length,
          lastSyncedAt: merchant.accuraOnboardingLink?.lastSyncedAt ?? null,
          readinessPercent:
            merchant.accuraOnboardingLink?.lastReadinessPercent ?? null,
          lastInvoiceNumber:
            lastJob?.wkOrder?.accuraInvoice?.accuraInvoiceNumber ?? null,
          lastInvoiceAt: lastJob?.wkOrder?.accuraInvoice?.accuraIssuedAt ?? null,
          lastIssuanceStatus: lastJob?.status ?? null,
          lastIssuanceError: lastJob?.lastErrorCategory ?? null,
        };
      }),
    );

    return {
      items: rows.filter((row) => matchesFilter(filter, row)),
      filter,
    };
  }

  async getConnection(merchantId: number) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        name: true,
        email: true,
        accuraOnboardingLink: true,
        branches: {
          select: {
            id: true,
            name: true,
            accuraBranchMapping: { select: { accuraBranchId: true } },
          },
        },
      },
    });
    if (!merchant) throw new NotFoundException('Merchant not found');
    const recentJobs = await this.prisma.accuraIssuanceJob.findMany({
      where: { wkOrder: { merchantId } },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      include: {
        wkOrder: {
          select: {
            orderCode: true,
            accuraInvoice: {
              select: {
                accuraInvoiceId: true,
                accuraInvoiceNumber: true,
                accuraIssuedAt: true,
                accuraVerificationUrl: true,
              },
            },
          },
        },
      },
    });
    const eligibility = getAccuraMerchantIssuanceEligibility({
      link: merchant.accuraOnboardingLink
        ? {
            lastAccountStatus: merchant.accuraOnboardingLink.lastAccountStatus,
            lastReviewStatus: merchant.accuraOnboardingLink.lastReviewStatus,
            lastProductionEligible:
              merchant.accuraOnboardingLink.lastProductionEligible,
            lastSyncedAt: merchant.accuraOnboardingLink.lastSyncedAt,
          }
        : null,
      shopId: merchant.branches[0]?.id ?? null,
      hasBranchMapping: merchant.branches.some((b) => b.accuraBranchMapping),
    });
    return {
      merchantId: merchant.id,
      merchantName: merchant.name,
      merchantEmail: merchant.email,
      externalClientReference:
        merchant.accuraOnboardingLink?.externalClientReference ||
        accuraExternalClientReference(merchant.id),
      connectionStatus: eligibility.status,
      productionEligible: eligibility.eligible,
      eligibilityReason: eligibility.reason,
      link: merchant.accuraOnboardingLink,
      shops: merchant.branches.map((branch) => ({
        shopId: branch.id,
        name: branch.name,
        accuraBranchId: branch.accuraBranchMapping?.accuraBranchId ?? null,
      })),
      recentJobs,
      note: 'ACCURA remains authoritative. WeKonnek cannot force Active or override compliance.',
    };
  }

  async refreshStatus(merchantId: number, actorUserId?: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { userId: true },
    });
    if (!merchant?.userId) throw new NotFoundException('Merchant not found');
    // Pull via onboarding service using the merchant owner's user id.
    const setup = await this.onboarding.getSetup({
      id: merchant.userId,
      role: UserRole.merchant,
    });
    await this.prisma.accuraOnboardingAuditEvent.create({
      data: {
        merchantId,
        actorUserId: actorUserId || null,
        action: 'ADMIN_STATUS_REFRESH',
        result: setup.unavailable ? 'unavailable' : 'ok',
      },
    });
    return this.getConnection(merchantId);
  }
}

function matchesFilter(
  filter: AccuraConnectionFilter,
  row: {
    connectionStatus: string;
    productionEligible: boolean;
    lastIssuanceError: string | null;
  },
): boolean {
  if (filter === 'all') return true;
  if (filter === 'not_connected') return row.connectionStatus === 'NOT_CONNECTED';
  if (filter === 'active') return row.productionEligible;
  if (filter === 'suspended') return row.connectionStatus === 'SUSPENDED';
  if (filter === 'needs_action') return row.connectionStatus === 'NEEDS_ACTION';
  if (filter === 'onboarding') {
    return ['ONBOARDING', 'NEEDS_ACTION', 'BRANCH_NOT_MAPPED'].includes(
      row.connectionStatus,
    );
  }
  if (filter === 'error') return Boolean(row.lastIssuanceError);
  return true;
}
