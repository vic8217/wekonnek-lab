import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MerchantPaymentMethodKind } from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { MerchantPaymentConfigService } from './merchant-payment-config.service';
import { MerchantPaymentEvidenceService } from './merchant-payment-evidence.service';

@ApiTags('Payment Ownership')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class PaymentOwnershipController {
  constructor(
    private readonly config: MerchantPaymentConfigService,
    private readonly evidence: MerchantPaymentEvidenceService,
  ) {}

  @Get('orders/:id/payment-options')
  @ApiOperation({
    summary:
      'Merchant-owned payment options for a commerce order (never WeKonnek PayCools config)',
  })
  paymentOptions(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.evidence.getPaymentOptions(id, req.user.id);
  }

  @Post('orders/:id/merchant-payment-method')
  @ApiOperation({ summary: 'Select a merchant payment method for the order' })
  selectMethod(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { merchantPaymentMethodId: string },
  ) {
    return this.evidence.selectMerchantMethod(
      id,
      req.user.id,
      body.merchantPaymentMethodId,
    );
  }

  @Post('orders/:id/merchant-payment-evidence')
  @ApiOperation({ summary: 'Customer submits merchant payment proof/reference' })
  submitProof(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      merchantPaymentMethodId: string;
      declaredAmount?: number;
      customerReference?: string;
      proofAssetUrl?: string;
      idempotencyKey?: string;
    },
  ) {
    return this.evidence.submitProof({
      orderId: id,
      userId: req.user.id,
      merchantPaymentMethodId: body.merchantPaymentMethodId,
      declaredAmount: body.declaredAmount,
      customerReference: body.customerReference,
      proofAssetUrl: body.proofAssetUrl,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('merchant-payment-evidences/:id/verify')
  @ApiOperation({ summary: 'Merchant verifies customer payment evidence' })
  verify(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { expectedVersion?: number },
  ) {
    return this.evidence.verify({
      evidenceId: id,
      actorUserId: req.user.id,
      expectedVersion: body?.expectedVersion,
    });
  }

  @Post('merchant-payment-evidences/:id/reject')
  @ApiOperation({ summary: 'Merchant rejects customer payment evidence' })
  reject(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { reason?: string; expectedVersion?: number },
  ) {
    return this.evidence.reject({
      evidenceId: id,
      actorUserId: req.user.id,
      reason: body?.reason,
      expectedVersion: body?.expectedVersion,
    });
  }

  @Get('merchants/:merchantId/payment-methods')
  @ApiOperation({ summary: 'List merchant payment configuration (operator)' })
  listMethods(
    @Req() req: any,
    @Param('merchantId', ParseIntPipe) merchantId: number,
  ) {
    return this.config.listForOperator(req.user.id, merchantId);
  }

  @Post('merchants/:merchantId/payment-methods')
  @ApiOperation({ summary: 'Create merchant payment method' })
  createMethod(
    @Req() req: any,
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Body()
    body: {
      kind: MerchantPaymentMethodKind;
      displayName: string;
      accountName?: string;
      accountReference?: string;
      instructions?: string;
      qrAssetUrl?: string;
      enabled?: boolean;
      sortOrder?: number;
      shopId?: number;
    },
  ) {
    return this.config.create(req.user.id, merchantId, body);
  }

  @Patch('merchant-payment-methods/:id')
  @ApiOperation({ summary: 'Update merchant payment method' })
  updateMethod(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      displayName?: string;
      accountName?: string;
      accountReference?: string;
      instructions?: string;
      qrAssetUrl?: string;
      enabled?: boolean;
      sortOrder?: number;
      shopId?: number | null;
    },
  ) {
    return this.config.update(req.user.id, id, body);
  }
}
