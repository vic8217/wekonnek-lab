import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AgreementAcceptanceMethod,
  AgreementEvidenceType,
  AgreementPartyRole,
  CustodyEventType,
} from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { AgreementService } from './agreement.service';
import { AgreementEvidenceService } from './agreement-evidence.service';
import { CustodyEventService } from './custody-event.service';
import { buildMerchantTradeTerms } from './agreement-canonical';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Agreements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AgreementsController {
  constructor(
    private readonly agreements: AgreementService,
    private readonly evidence: AgreementEvidenceService,
    private readonly custody: CustodyEventService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('agreements/:id')
  @ApiOperation({ summary: 'Get agreement with versions, acceptances, evidence' })
  getOne(@Req() req: any, @Param('id') id: string) {
    return this.agreements.getAgreement(id, req.user.id);
  }

  @Get('agreement-versions/:id/integrity')
  @ApiOperation({ summary: 'Recompute SHA-256 of stored canonical terms' })
  verify(@Req() req: any, @Param('id') id: string) {
    return this.agreements.verifyIntegrityForActor(id, req.user.id);
  }

  @Post('agreement-versions/:id/accept')
  @ApiOperation({ summary: 'Explicitly accept an offered agreement version' })
  accept(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      partyRole: AgreementPartyRole;
      method?: AgreementAcceptanceMethod;
      correlationId?: string;
    },
  ) {
    return this.agreements.acceptVersion({
      agreementVersionId: id,
      actor: { userId: req.user.id, partyRole: body.partyRole },
      method: body.method ?? AgreementAcceptanceMethod.WEB_CONFIRMATION,
      correlationId: body.correlationId,
    });
  }

  @Post('agreement-versions/:id/decline')
  decline(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { partyRole: AgreementPartyRole; correlationId?: string },
  ) {
    return this.agreements.declineVersion({
      agreementVersionId: id,
      actor: { userId: req.user.id, partyRole: body.partyRole },
      correlationId: body.correlationId,
    });
  }

  @Post('agreements/:id/amendments')
  @ApiOperation({
    summary: 'Offer a new immutable version superseding the prior open offer',
  })
  async amend(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { reason: string; correlationId?: string },
  ) {
    const agreement = await this.agreements.getAgreement(id, req.user.id);
    if (!agreement.wkOrderId) {
      throw new BadRequestException('Agreement is not linked to a commerce order');
    }
    const order = await this.prisma.wkOrder.findUniqueOrThrow({
      where: { id: agreement.wkOrderId },
      include: { merchant: true, orderItems: true },
    });
    return this.agreements.offerAmendment({
      agreementId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      correlationId: body.correlationId,
      termsBuilder: () =>
        buildMerchantTradeTerms({
          wkOrderId: order.id,
          orderCode: order.orderCode,
          buyerId: order.userId,
          merchantId: order.merchantId,
          merchantName: order.merchant.name,
          shopId: order.shopId,
          paymentMethod: order.paymentMethod,
          paymentStatus: order.paymentStatus,
          paymentRef: order.paymentRef,
          totalAmount: order.totalAmount,
          deliveryFee: order.deliveryFee,
          discountAmount: order.discountAmount,
          transactionFeeAmount: order.transactionFeeAmount,
          items: order.orderItems.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            variantId: item.variantId,
            quantity: item.quantity,
            price: item.price,
            subtotal: item.subtotal,
          })),
        }),
    });
  }

  @Post('agreements/:id/cancel')
  cancel(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { reason?: string; correlationId?: string },
  ) {
    return this.agreements.cancelAgreement({
      agreementId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      correlationId: body.correlationId,
    });
  }

  @Post('agreements/:id/evidence')
  addEvidence(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      evidenceType: AgreementEvidenceType;
      contentType?: string;
      sizeBytes?: number;
      storageReference?: string;
      idempotencyKey?: string;
      merchantPaymentEvidenceId?: string;
      correlationId?: string;
    },
  ) {
    return this.evidence.addEvidence({
      agreementId: id,
      actorUserId: req.user.id,
      ...body,
    });
  }

  @Get('orders/:orderId/custody-events')
  listCustody(@Req() req: any, @Param('orderId') orderId: string) {
    return this.custody.listForOrder(Number(orderId), req.user.id);
  }

  @Post('custody-events')
  recordCustody(
    @Req() req: any,
    @Body()
    body: {
      eventType: CustodyEventType;
      wkOrderId?: number;
      fulfillmentId?: string;
      agreementId?: string;
      fromPartyRole?: AgreementPartyRole;
      toPartyRole?: AgreementPartyRole;
      fromUserId?: string;
      toUserId?: string;
      evidenceIds?: string[];
      correlationId?: string;
    },
  ) {
    return this.custody.record({
      actorUserId: req.user.id,
      ...body,
    });
  }
}
