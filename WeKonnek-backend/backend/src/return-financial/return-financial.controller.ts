import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { ReturnFinancialDeterminationService } from './return-financial-determination.service';
import { ReturnFinancialResolutionService } from './return-financial-resolution.service';
import { ReturnFinancialSettlementService } from './return-financial-settlement.service';
import { ReturnFinancialTermsService } from './return-financial-terms.service';

@ApiTags('Return Financial Determination')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ReturnFinancialController {
  constructor(
    private readonly determinations: ReturnFinancialDeterminationService,
    private readonly settlements: ReturnFinancialSettlementService,
    private readonly resolution: ReturnFinancialResolutionService,
    private readonly terms: ReturnFinancialTermsService,
  ) {}

  @Get('orders/:orderId/return-financial-resolution')
  @ApiOperation({ summary: 'Derived return financial resolution view' })
  getResolution(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.resolution.getForOrder(orderId, req.user.id);
  }

  @Post('orders/:orderId/return-financial-terms/accept')
  @ApiOperation({
    summary: 'Accept server-resolved Stage 9 return financial terms for an order',
  })
  acceptTerms(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body()
    body: {
      kind: string;
      termsHash?: string;
      correlationId?: string;
    },
  ) {
    return this.terms.acceptTerms({
      wkOrderId: orderId,
      actorUserId: req.user.id,
      kind: body.kind,
      termsHash: body.termsHash,
      correlationId: body.correlationId,
    });
  }

  @Post('orders/:orderId/return-financial-determinations')
  @ApiOperation({ summary: 'Create/propose a return financial determination' })
  createDetermination(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body()
    body: {
      outcome?: string;
      reason?: string;
      ordinaryRefundPrincipal?: string | number;
      path?: string;
      termsHash?: string;
      correlationId?: string;
      idempotencyKey?: string;
      adminAdjudication?: boolean;
    },
  ) {
    return this.determinations.createOrPropose({
      wkOrderId: orderId,
      actorUserId: req.user.id,
      outcome: body.outcome,
      reason: body.reason,
      ordinaryRefundPrincipal: body.ordinaryRefundPrincipal,
      path: body.path,
      termsHash: body.termsHash,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
      adminAdjudication: body.adminAdjudication,
    });
  }

  @Post('return-financial-determinations/:id/acknowledge')
  @ApiOperation({ summary: 'Merchant owner acknowledges a proposed determination' })
  acknowledge(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: { correlationId?: string } = {},
  ) {
    return this.determinations.acknowledge({
      determinationId: id,
      actorUserId: req.user.id,
      correlationId: body.correlationId,
    });
  }

  @Post('return-financial-determinations/:id/dispute')
  @ApiOperation({ summary: 'Dispute a return financial determination' })
  dispute(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: { reason?: string; correlationId?: string } = {},
  ) {
    return this.determinations.dispute({
      determinationId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      correlationId: body.correlationId,
    });
  }

  @Post('return-financial-determinations/:id/finalize')
  @ApiOperation({
    summary:
      'Finalize determination; creates obligations + collection restriction under formula',
  })
  finalize(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      correlationId?: string;
      idempotencyKey?: string;
      adminAdjudication?: boolean;
      reason?: string;
    } = {},
  ) {
    return this.determinations.finalize({
      determinationId: id,
      actorUserId: req.user.id,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
      adminAdjudication: body.adminAdjudication,
      reason: body.reason,
    });
  }

  @Get('return-financial-obligations/:id')
  @ApiOperation({ summary: 'Get obligation with settlement totals' })
  getObligation(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.settlements.getObligation(id, req.user.id);
  }

  @Post('return-financial-obligations/:id/settlements')
  @ApiOperation({
    summary: 'Create cash receipt (creditor) or direct-transfer claim (merchant)',
  })
  createSettlement(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      method: string;
      amount: string | number;
      externalReference?: string;
      proofStorageReference?: string;
      idempotencyKey?: string;
      correlationId?: string;
    },
  ) {
    return this.settlements.createSettlement({
      obligationId: id,
      actorUserId: req.user.id,
      method: body.method,
      amount: body.amount,
      externalReference: body.externalReference,
      proofStorageReference: body.proofStorageReference,
      idempotencyKey: body.idempotencyKey,
      correlationId: body.correlationId,
    });
  }

  @Post('return-financial-settlements/:id/acknowledge')
  @ApiOperation({ summary: 'Creditor acknowledges a DIRECT_TRANSFER claim' })
  acknowledgeSettlement(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      acknowledgedAmount: string | number;
      idempotencyKey?: string;
      correlationId?: string;
    },
  ) {
    return this.settlements.acknowledge({
      settlementId: id,
      actorUserId: req.user.id,
      acknowledgedAmount: body.acknowledgedAmount,
      idempotencyKey: body.idempotencyKey,
      correlationId: body.correlationId,
    });
  }

  @Post('return-financial-settlements/:id/reject')
  @ApiOperation({ summary: 'Creditor rejects a CLAIMED DIRECT_TRANSFER claim' })
  rejectSettlement(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      reason?: string;
      idempotencyKey?: string;
      correlationId?: string;
    } = {},
  ) {
    return this.settlements.reject({
      settlementId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      idempotencyKey: body.idempotencyKey,
      correlationId: body.correlationId,
    });
  }
}
