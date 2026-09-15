import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MerchantPaymentMethodKind,
  MerchantPaymentStatus,
  MerchantPaymentEvidence,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { moneyDecimal, moneyNumber } from '../modules/wallet/wallet-money';
import { MerchantPaymentConfigService } from './merchant-payment-config.service';
import { PaymentRoutingService } from './payment-routing.service';

@Injectable()
export class MerchantPaymentEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
    private readonly config: MerchantPaymentConfigService,
    private readonly routing: PaymentRoutingService,
  ) {}

  async getPaymentOptions(orderId: number, userId: string) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        merchantId: true,
        shopId: true,
        paymentStatus: true,
        merchantPaymentStatus: true,
        totalAmount: true,
      },
    });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('Order not found');
    }
    const decision = this.routing.decide({
      kind: 'wk_order',
      orderId: order.id,
      merchantId: order.merchantId,
    });
    const methods = await this.config.listEnabledForMerchant(
      order.merchantId,
      order.shopId,
    );
    return {
      beneficiary: decision.beneficiary,
      purpose: decision.purpose,
      merchantId: order.merchantId,
      orderId: order.id,
      authoritativeAmount: moneyNumber(order.totalAmount),
      currency: 'PHP',
      merchantPaymentStatus: order.merchantPaymentStatus,
      wekonnekPayCoolsAllowed: false,
      paymentOptions: methods.map((m) => this.config.serialize(m)),
    };
  }

  async selectMerchantMethod(
    orderId: number,
    userId: string,
    merchantPaymentMethodId: string,
  ) {
    const order = await this.loadCustomerOrder(orderId, userId);
    const decision = this.routing.decide({
      kind: 'wk_order',
      orderId,
      merchantId: order.merchantId,
    });
    const method = await this.prisma.merchantPaymentMethod.findFirst({
      where: {
        id: merchantPaymentMethodId,
        merchantId: order.merchantId,
        enabled: true,
      },
    });
    if (!method) throw new NotFoundException('Merchant payment method not found');

    const paymentMethod =
      method.kind === MerchantPaymentMethodKind.CASH
        ? 'cod'
        : method.kind === MerchantPaymentMethodKind.MERCHANT_QR
          ? 'merchant_qr'
          : 'bank_transfer';

    const nextStatus =
      method.kind === MerchantPaymentMethodKind.CASH
        ? MerchantPaymentStatus.AWAITING_PAYMENT
        : MerchantPaymentStatus.AWAITING_PAYMENT;

    const updated = await this.prisma.wkOrder.update({
      where: { id: orderId },
      data: {
        paymentMethod,
        merchantPaymentStatus: nextStatus,
        paymentRef: null,
        paymentUrl: null,
      },
    });

    await this.events.record({
      aggregateType: 'WK_ORDER',
      aggregateId: String(orderId),
      wkOrderId: orderId,
      actorId: userId,
      actorType: 'CUSTOMER',
      action: 'MERCHANT_PAYMENT_OPTION_SELECTED',
      previousState: order.merchantPaymentStatus,
      newState: nextStatus,
      metadata: {
        merchantPaymentMethodId: method.id,
        kind: method.kind,
        beneficiary: decision.beneficiary,
        purpose: decision.purpose,
      },
    });

    return {
      orderId,
      beneficiary: decision.beneficiary,
      paymentMethod: updated.paymentMethod,
      merchantPaymentStatus: updated.merchantPaymentStatus,
      selectedMethod: this.config.serialize(method),
    };
  }

  async submitProof(input: {
    orderId: number;
    userId: string;
    merchantPaymentMethodId: string;
    declaredAmount?: number;
    customerReference?: string;
    proofAssetUrl?: string;
    idempotencyKey?: string;
  }) {
    const order = await this.loadCustomerOrder(input.orderId, input.userId);
    if (['cancelled'].includes(order.status)) {
      throw new BadRequestException('Cannot submit proof for a cancelled order');
    }
    if (order.paymentStatus === 'paid') {
      throw new ConflictException('Order payment is already marked paid');
    }

    if (input.idempotencyKey) {
      const prior = await this.prisma.merchantPaymentEvidence.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (prior) return prior;
    }

    const method = await this.prisma.merchantPaymentMethod.findFirst({
      where: {
        id: input.merchantPaymentMethodId,
        merchantId: order.merchantId,
        enabled: true,
      },
    });
    if (!method) throw new NotFoundException('Merchant payment method not found');
    if (method.kind === MerchantPaymentMethodKind.CASH) {
      throw new BadRequestException(
        'Cash/COD does not require payment proof submission',
      );
    }

    // Declared amount is evidence only — authoritative total remains order.totalAmount
    const declared = moneyDecimal(
      input.declaredAmount ?? order.totalAmount,
    );

    let evidence: MerchantPaymentEvidence;
    let created = true;
    try {
      evidence = await this.prisma.$transaction(async (tx) => {
        const createdEvidence = await tx.merchantPaymentEvidence.create({
          data: {
            id: randomUUID(),
            wkOrderId: order.id,
            merchantPaymentMethodId: method.id,
            declaredAmount: declared,
            customerReference: input.customerReference ?? undefined,
            proofAssetUrl: input.proofAssetUrl ?? undefined,
            status: MerchantPaymentStatus.PROOF_SUBMITTED,
            submittedBy: input.userId,
            idempotencyKey: input.idempotencyKey ?? undefined,
          },
        });
        await tx.wkOrder.update({
          where: { id: order.id },
          data: {
            merchantPaymentStatus: MerchantPaymentStatus.PROOF_SUBMITTED,
            paymentMethod:
              method.kind === MerchantPaymentMethodKind.MERCHANT_QR
                ? 'merchant_qr'
                : 'bank_transfer',
          },
        });
        return createdEvidence;
      });
    } catch (error) {
      // Concurrent identical submissions race at the unique index. Resolve the
      // losing request to the single authoritative evidence record instead of
      // exposing a retryable server error or creating an ambiguous attempt.
      if (!input.idempotencyKey || (error as { code?: string }).code !== 'P2002') {
        throw error;
      }
      const existing = await this.prisma.merchantPaymentEvidence.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (!existing) throw error;
      evidence = existing;
      created = false;
    }

    if (!created) return evidence;

    await this.events.record({
      aggregateType: 'WK_ORDER',
      aggregateId: String(order.id),
      wkOrderId: order.id,
      actorId: input.userId,
      actorType: 'CUSTOMER',
      action: 'MERCHANT_PAYMENT_PROOF_SUBMITTED',
      previousState: order.merchantPaymentStatus,
      newState: MerchantPaymentStatus.PROOF_SUBMITTED,
      metadata: {
        evidenceId: evidence.id,
        merchantPaymentMethodId: method.id,
        // Do not log proof contents
        hasProofAsset: Boolean(input.proofAssetUrl),
        hasReference: Boolean(input.customerReference),
      },
    });

    return evidence;
  }

  async verify(input: {
    evidenceId: string;
    actorUserId: string;
    expectedVersion?: number;
  }) {
    return this.decideEvidence({
      ...input,
      decision: 'VERIFY',
    });
  }

  async reject(input: {
    evidenceId: string;
    actorUserId: string;
    reason?: string;
    expectedVersion?: number;
  }) {
    return this.decideEvidence({
      evidenceId: input.evidenceId,
      actorUserId: input.actorUserId,
      expectedVersion: input.expectedVersion,
      decision: 'REJECT',
      reason: input.reason,
    });
  }

  private async decideEvidence(input: {
    evidenceId: string;
    actorUserId: string;
    expectedVersion?: number;
    decision: 'VERIFY' | 'REJECT';
    reason?: string;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "merchant_payment_evidences" WHERE id = ${input.evidenceId}::uuid FOR UPDATE
        `;
        if (!locked.length) throw new NotFoundException('Evidence not found');

        const evidence = await tx.merchantPaymentEvidence.findUniqueOrThrow({
          where: { id: input.evidenceId },
          include: {
            wkOrder: true,
            method: true,
          },
        });

        await this.config.assertMerchantOperator(
          input.actorUserId,
          evidence.wkOrder.merchantId,
        );

        // Cross-merchant isolation: method must belong to order merchant
        if (evidence.method.merchantId !== evidence.wkOrder.merchantId) {
          throw new ForbiddenException('Payment method/order merchant mismatch');
        }

        if (
          input.expectedVersion != null &&
          input.expectedVersion !== evidence.version
        ) {
          throw new ConflictException('Evidence version conflict');
        }

        if (evidence.status === MerchantPaymentStatus.VERIFIED) {
          if (input.decision === 'VERIFY') return { evidence, idempotent: true };
          throw new ConflictException('Evidence already verified');
        }
        if (evidence.status === MerchantPaymentStatus.REJECTED) {
          if (input.decision === 'REJECT') return { evidence, idempotent: true };
          throw new ConflictException('Evidence already rejected');
        }
        if (evidence.status !== MerchantPaymentStatus.PROOF_SUBMITTED) {
          throw new BadRequestException(
            `Cannot ${input.decision.toLowerCase()} evidence in status ${evidence.status}`,
          );
        }

        const nextStatus =
          input.decision === 'VERIFY'
            ? MerchantPaymentStatus.VERIFIED
            : MerchantPaymentStatus.REJECTED;

        const updated = await tx.merchantPaymentEvidence.update({
          where: { id: evidence.id },
          data: {
            status: nextStatus,
            version: { increment: 1 },
            verifiedAt: new Date(),
            verifiedBy: input.actorUserId,
            rejectionReason:
              input.decision === 'REJECT'
                ? input.reason ?? 'rejected'
                : null,
          },
        });

        const orderData: Prisma.WkOrderUpdateInput = {
          merchantPaymentStatus: nextStatus,
        };
        if (input.decision === 'VERIFY') {
          // Merchant verification confirms merchant payment — not fulfillment delivery
          orderData.paymentStatus = 'paid';
        }

        await tx.wkOrder.update({
          where: { id: evidence.wkOrderId },
          data: orderData,
        });

        await this.events.record({
          tx,
          aggregateType: 'WK_ORDER',
          aggregateId: String(evidence.wkOrderId),
          wkOrderId: evidence.wkOrderId,
          actorId: input.actorUserId,
          actorType: 'MERCHANT_OWNER',
          action:
            input.decision === 'VERIFY'
              ? 'MERCHANT_PAYMENT_PROOF_VERIFIED'
              : 'MERCHANT_PAYMENT_PROOF_REJECTED',
          previousState: evidence.status,
          newState: nextStatus,
          reason: input.reason,
          metadata: {
            evidenceId: evidence.id,
            fulfillmentUnchanged: true,
          },
        });

        return { evidence: updated, idempotent: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async loadCustomerOrder(orderId: number, userId: string) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: orderId },
    });
    if (!order || order.userId !== userId) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }
}
