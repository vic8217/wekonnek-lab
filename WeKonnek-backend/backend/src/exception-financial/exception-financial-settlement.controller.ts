import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { ExceptionFinancialSettlementService } from './exception-financial-settlement.service';

/**
 * Stage 13A party settlement routes.
 * No RolesGuard admin-only — debtor/creditor actions; admin may view only.
 */
@ApiTags('Exception Financial Settlement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ExceptionFinancialSettlementController {
  constructor(
    private readonly settlements: ExceptionFinancialSettlementService,
  ) {}

  @Post('exception-financial-obligations/:id/settlements/claim')
  @ApiOperation({
    summary:
      'Debtor creates a transfer claim (DIRECT_TRANSFER / BANK_TRANSFER / MERCHANT_QR)',
  })
  claim(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      method: string;
      amount: string | number;
      externalReference?: string;
      idempotencyKey?: string;
      correlationId?: string;
    },
  ) {
    return this.settlements.claimTransfer({
      obligationId: id,
      actorUserId: req.user.id,
      method: body.method,
      amount: body.amount,
      externalReference: body.externalReference,
      idempotencyKey: body.idempotencyKey,
      correlationId: body.correlationId,
    });
  }

  @Post('exception-financial-obligations/:id/settlements/cash')
  @ApiOperation({
    summary: 'Creditor records cash receipt (immediately ACKNOWLEDGED)',
  })
  cash(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      amount: string | number;
      externalReference?: string;
      idempotencyKey?: string;
      correlationId?: string;
    },
  ) {
    return this.settlements.recordCashReceipt({
      obligationId: id,
      actorUserId: req.user.id,
      amount: body.amount,
      externalReference: body.externalReference,
      idempotencyKey: body.idempotencyKey,
      correlationId: body.correlationId,
    });
  }

  @Post('exception-financial-settlements/:id/acknowledge')
  @ApiOperation({
    summary: 'Creditor acknowledges a CLAIMED transfer (full or partial)',
  })
  acknowledge(
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

  @Post('exception-financial-settlements/:id/reject')
  @ApiOperation({ summary: 'Creditor rejects a CLAIMED transfer' })
  reject(
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

  @Post('exception-financial-settlements/:id/cancel')
  @ApiOperation({
    summary: 'Debtor cancels their own CLAIMED transfer claim',
  })
  cancel(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: { idempotencyKey?: string; correlationId?: string } = {},
  ) {
    return this.settlements.cancelClaim({
      settlementId: id,
      actorUserId: req.user.id,
      idempotencyKey: body.idempotencyKey,
      correlationId: body.correlationId,
    });
  }

  @Post('exception-financial-settlements/:id/evidence')
  @ApiOperation({
    summary: 'Append-only settlement evidence (does not change status)',
  })
  evidence(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      kind: string;
      storageReference: string;
      note?: string;
      idempotencyKey?: string;
      correlationId?: string;
    },
  ) {
    return this.settlements.attachEvidence({
      settlementId: id,
      actorUserId: req.user.id,
      kind: body.kind,
      storageReference: body.storageReference,
      note: body.note,
      idempotencyKey: body.idempotencyKey,
      correlationId: body.correlationId,
    });
  }

  @Get('exception-financial-obligations/:id/settlement-summary')
  @ApiOperation({
    summary:
      'Obligation settlement summary (principal, settled, remaining, derivedState)',
  })
  summary(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.settlements.getObligationSettlementSummary(id, req.user.id);
  }

  @Get('exception-financial-settlements/:id')
  @ApiOperation({ summary: 'Get a settlement with evidence' })
  get(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.settlements.getSettlement(id, req.user.id);
  }
}
