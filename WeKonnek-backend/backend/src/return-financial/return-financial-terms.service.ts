import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ReturnFinancialPartyType,
  ReturnFinancialTermsKind,
  UserRole,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export const STAGE9_MERCHANT_TERMS_V1 = {
  kind: ReturnFinancialTermsKind.MERCHANT_RETURN_FINANCIAL,
  versionNumber: 1,
  canonicalTerms: {
    title: 'Merchant Return Financial Terms v1',
    clauses: [
      'Qualifying full return accepts returned goods for financial resolution.',
      'Merchant repays outstanding rider-funded principal (P−R) to RiderAdvance.riderId.',
      'Merchant refunds customer-borne reimbursed amount R externally.',
      'WeKonnek records obligations only; platform does not hold or transfer funds.',
      'Creditor rider is the original RiderAdvance.riderId, not active/physical/return rider.',
    ],
  },
} as const;

export const STAGE9_CUSTOMER_TERMS_V1 = {
  kind: ReturnFinancialTermsKind.CUSTOMER_RETURN_FINANCIAL,
  versionNumber: 1,
  canonicalTerms: {
    title: 'Customer Return Financial Terms v1',
    clauses: [
      'Historical Stage 5B reimbursement facts remain immutable.',
      'After finalized qualifying return, remaining customer reimbursement may become non-collectible.',
      'Customer may be entitled to Merchant→Customer refund of acknowledged reimbursement R.',
      'External settlement acknowledgment only; WeKonnek does not move funds.',
    ],
  },
} as const;

function termsHash(canonical: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex');
}

@Injectable()
export class ReturnFinancialTermsService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSeededTerms() {
    const merchantHash = termsHash(STAGE9_MERCHANT_TERMS_V1.canonicalTerms);
    const customerHash = termsHash(STAGE9_CUSTOMER_TERMS_V1.canonicalTerms);

    const merchant = await this.prisma.returnFinancialTermsVersion.upsert({
      where: { termsHash: merchantHash },
      create: {
        id: randomUUID(),
        kind: STAGE9_MERCHANT_TERMS_V1.kind,
        versionNumber: STAGE9_MERCHANT_TERMS_V1.versionNumber,
        termsHash: merchantHash,
        canonicalTerms: STAGE9_MERCHANT_TERMS_V1.canonicalTerms,
        activatedAt: new Date(),
      },
      update: {},
    });

    const customer = await this.prisma.returnFinancialTermsVersion.upsert({
      where: { termsHash: customerHash },
      create: {
        id: randomUUID(),
        kind: STAGE9_CUSTOMER_TERMS_V1.kind,
        versionNumber: STAGE9_CUSTOMER_TERMS_V1.versionNumber,
        termsHash: customerHash,
        canonicalTerms: STAGE9_CUSTOMER_TERMS_V1.canonicalTerms,
        activatedAt: new Date(),
      },
      update: {},
    });

    return { merchant, customer };
  }

  async getActiveVersion(kind: ReturnFinancialTermsKind) {
    await this.ensureSeededTerms();
    const row = await this.prisma.returnFinancialTermsVersion.findFirst({
      where: { kind, activatedAt: { not: null } },
      orderBy: { versionNumber: 'desc' },
    });
    if (!row) {
      throw new NotFoundException({
        code: 'RETURN_FINANCIAL_TERMS_NOT_ACTIVATED',
        message: `No activated Stage 9 terms for ${kind}`,
      });
    }
    return row;
  }

  /**
   * Server resolves applicable terms. Client-supplied hash is never authority;
   * mismatch is rejected.
   */
  async resolveApplicableTerms(clientHash?: string) {
    const merchant = await this.getActiveVersion(
      ReturnFinancialTermsKind.MERCHANT_RETURN_FINANCIAL,
    );
    const customer = await this.getActiveVersion(
      ReturnFinancialTermsKind.CUSTOMER_RETURN_FINANCIAL,
    );
    if (clientHash && clientHash !== merchant.termsHash && clientHash !== customer.termsHash) {
      throw new BadRequestException({
        code: 'TERMS_VERSION_MISMATCH',
        message: 'Client terms hash is not authoritative and does not match server terms',
      });
    }
    return { merchant, customer };
  }

  async hasOrderPartyAccepted(
    wkOrderId: number,
    partyType: ReturnFinancialPartyType,
    termsVersionId: string,
  ): Promise<boolean> {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
      select: { userId: true, merchantId: true },
    });
    if (!order) return false;
    const row = await this.prisma.returnFinancialTermsAcceptance.findFirst({
      where: {
        wkOrderId,
        partyType,
        termsVersionId,
        ...(partyType === ReturnFinancialPartyType.MERCHANT
          ? { merchantId: order.merchantId }
          : partyType === ReturnFinancialPartyType.CUSTOMER
            ? { partyUserId: order.userId }
            : {}),
      },
    });
    return !!row;
  }

  /**
   * Both merchant + customer must have accepted the active Stage 9 terms for
   * the automatic formula path. Otherwise surface MANUAL gate.
   */
  async assertAutomaticFormulaApplicable(wkOrderId: number): Promise<{
    merchantTerms: { id: string; termsHash: string };
    customerTerms: { id: string; termsHash: string };
  }> {
    const { merchant, customer } = await this.resolveApplicableTerms();
    const merchantOk = await this.hasOrderPartyAccepted(
      wkOrderId,
      ReturnFinancialPartyType.MERCHANT,
      merchant.id,
    );
    const customerOk = await this.hasOrderPartyAccepted(
      wkOrderId,
      ReturnFinancialPartyType.CUSTOMER,
      customer.id,
    );
    if (!merchantOk || !customerOk) {
      throw new ForbiddenException({
        code: 'RETURN_FINANCIAL_MANUAL_DETERMINATION_REQUIRED',
        message:
          'Stage 9 return financial terms not accepted for this order; automatic formula unavailable',
        merchantAccepted: merchantOk,
        customerAccepted: customerOk,
      });
    }
    return {
      merchantTerms: { id: merchant.id, termsHash: merchant.termsHash },
      customerTerms: { id: customer.id, termsHash: customer.termsHash },
    };
  }

  async acceptTerms(input: {
    wkOrderId: number;
    actorUserId: string;
    kind: ReturnFinancialTermsKind | string;
    /** Spoof — ignored; server resolves hash. */
    termsHash?: string;
    correlationId?: string;
  }) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: input.wkOrderId },
    });
    if (!order) throw new NotFoundException('Order not found');

    const kind = String(input.kind) as ReturnFinancialTermsKind;
    if (
      kind !== ReturnFinancialTermsKind.MERCHANT_RETURN_FINANCIAL &&
      kind !== ReturnFinancialTermsKind.CUSTOMER_RETURN_FINANCIAL
    ) {
      throw new BadRequestException({
        code: 'INVALID_TERMS_KIND',
        message: 'Unknown return financial terms kind',
      });
    }

    const version = await this.getActiveVersion(kind);
    if (input.termsHash && input.termsHash !== version.termsHash) {
      throw new BadRequestException({
        code: 'TERMS_VERSION_MISMATCH',
        message: 'Client terms hash does not match server-activated terms',
      });
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: input.actorUserId },
    });
    if (!actor) throw new ForbiddenException('Actor not found');

    let partyType: ReturnFinancialPartyType;
    let partyUserId = input.actorUserId;
    let merchantId: number | null = null;

    if (kind === ReturnFinancialTermsKind.MERCHANT_RETURN_FINANCIAL) {
      const merchant = await this.prisma.merchant.findFirst({
        where: { id: order.merchantId, userId: input.actorUserId },
      });
      if (!merchant) {
        throw new ForbiddenException({
          code: 'NOT_MERCHANT_OWNER',
          message: 'Only the merchant owner may accept merchant return financial terms',
        });
      }
      partyType = ReturnFinancialPartyType.MERCHANT;
      merchantId = merchant.id;
    } else {
      if (order.userId !== input.actorUserId && actor.role !== UserRole.admin) {
        throw new ForbiddenException({
          code: 'NOT_CUSTOMER',
          message: 'Only the order customer may accept customer return financial terms',
        });
      }
      partyType = ReturnFinancialPartyType.CUSTOMER;
    }

    const existing = await this.prisma.returnFinancialTermsAcceptance.findFirst({
      where: {
        termsVersionId: version.id,
        wkOrderId: input.wkOrderId,
        partyType,
        ...(partyType === ReturnFinancialPartyType.MERCHANT
          ? { merchantId: merchantId! }
          : { partyUserId }),
      },
    });
    if (existing) {
      return { acceptance: existing, terms: version, idempotent: true };
    }

    const acceptance = await this.prisma.returnFinancialTermsAcceptance.create({
      data: {
        id: randomUUID(),
        termsVersionId: version.id,
        partyType,
        partyUserId,
        merchantId: merchantId ?? undefined,
        wkOrderId: input.wkOrderId,
        actorUserId: input.actorUserId,
        correlationId: input.correlationId,
        termsHashSnapshot: version.termsHash,
      },
    });

    return { acceptance, terms: version, idempotent: false };
  }

  /** Never mutate old terms hashes / canonical JSON. */
  async assertTermsImmutable(termsVersionId: string) {
    const row = await this.prisma.returnFinancialTermsVersion.findUnique({
      where: { id: termsVersionId },
    });
    if (!row) throw new NotFoundException('Terms version not found');
    const expected = termsHash(row.canonicalTerms);
    if (expected !== row.termsHash) {
      throw new BadRequestException({
        code: 'TERMS_HASH_CORRUPTION',
        message: 'Terms hash does not match canonical terms',
      });
    }
    return row;
  }
}
