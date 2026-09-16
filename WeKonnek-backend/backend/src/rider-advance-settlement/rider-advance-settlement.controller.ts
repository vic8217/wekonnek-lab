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
import { RiderAdvanceSettlementService } from './rider-advance-settlement.service';

@ApiTags('Rider Advance Reimbursement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class RiderAdvanceSettlementController {
  constructor(private readonly settlements: RiderAdvanceSettlementService) {}

  @Get('orders/:orderId/rider-advance/reimbursement')
  @ApiOperation({
    summary:
      'Customer/creditor reimbursement summary (principal, settled, remaining)',
  })
  getForOrder(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.settlements.getReimbursementForOrder(orderId, req.user.id);
  }

  @Post('rider-advances/:id/reimbursements')
  @ApiOperation({
    summary:
      'Customer creates DIRECT_TRANSFER reimbursement claim (non-authoritative)',
  })
  createClaim(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      amount: string | number;
      method?: string;
      externalReference?: string;
      proofStorageReference?: string;
      idempotencyKey?: string;
      correlationId?: string;
      creditorRiderId?: string;
      customerId?: string;
      principal?: string | number;
      acknowledgedAmount?: string | number;
    },
  ) {
    return this.settlements.createDirectTransferClaim({
      riderAdvanceId: id,
      actorUserId: req.user.id,
      amount: body.amount,
      externalReference: body.externalReference,
      proofStorageReference: body.proofStorageReference,
      idempotencyKey: body.idempotencyKey,
      correlationId: body.correlationId,
      creditorRiderId: body.creditorRiderId,
      customerId: body.customerId,
      principal: body.principal,
      acknowledgedAmount: body.acknowledgedAmount,
    });
  }

  @Post('rider-advances/:id/cash-receipts')
  @ApiOperation({
    summary:
      'Creditor rider records cash received from customer (authoritative)',
  })
  cashReceipt(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      amount: string | number;
      notes?: string;
      idempotencyKey?: string;
      correlationId?: string;
    },
  ) {
    return this.settlements.createCashReceipt({
      riderAdvanceId: id,
      actorUserId: req.user.id,
      amount: body.amount,
      notes: body.notes,
      idempotencyKey: body.idempotencyKey,
      correlationId: body.correlationId,
    });
  }

  @Post('rider-advance-settlements/:id/acknowledge')
  @ApiOperation({
    summary:
      'Creditor acknowledges DIRECT_TRANSFER claim (full or partial amount)',
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

  @Post('rider-advance-settlements/:id/reject')
  @ApiOperation({ summary: 'Creditor rejects a CLAIMED DIRECT_TRANSFER claim' })
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
}
