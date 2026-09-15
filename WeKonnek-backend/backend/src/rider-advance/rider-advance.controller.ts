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
import { RiderAdvanceService } from './rider-advance.service';

@ApiTags('Rider Advance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class RiderAdvanceController {
  constructor(private readonly riderAdvance: RiderAdvanceService) {}

  @Get('orders/:orderId/rider-advance')
  @ApiOperation({ summary: 'Get active Rider Advance for an order' })
  getForOrder(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.riderAdvance.getForOrder(orderId, req.user.id);
  }

  @Post('orders/:orderId/rider-advance/authorize')
  @ApiOperation({
    summary:
      'Customer authorizes Rider Advance (server-derived customer/rider/assignment)',
  })
  authorize(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body()
    body: {
      maximumAuthorizedAdvance: string | number;
      idempotencyKey?: string;
      correlationId?: string;
    },
  ) {
    return this.riderAdvance.authorize({
      wkOrderId: orderId,
      actorUserId: req.user.id,
      maximumAuthorizedAdvance: body.maximumAuthorizedAdvance,
      idempotencyKey: body.idempotencyKey,
      correlationId: body.correlationId,
    });
  }

  @Post('rider-advances/:id/amend')
  @ApiOperation({ summary: 'Customer amends authorized maximum (pre-expenditure)' })
  amend(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      maximumAuthorizedAdvance: string | number;
      correlationId?: string;
    },
  ) {
    return this.riderAdvance.amendMaximum({
      riderAdvanceId: id,
      actorUserId: req.user.id,
      maximumAuthorizedAdvance: body.maximumAuthorizedAdvance,
      correlationId: body.correlationId,
    });
  }

  @Post('rider-advances/:id/accept')
  @ApiOperation({ summary: 'Assigned rider accepts Rider Advance obligation' })
  accept(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: { idempotencyKey?: string; correlationId?: string } = {},
  ) {
    return this.riderAdvance.accept({
      riderAdvanceId: id,
      actorUserId: req.user.id,
      idempotencyKey: body.idempotencyKey,
      correlationId: body.correlationId,
    });
  }

  @Post('rider-advances/:id/record-advance')
  @ApiOperation({
    summary: 'Rider records actual cash advanced (claim; not vendor ack)',
  })
  recordAdvance(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      actualAdvanceAmount: string | number;
      notes?: string;
      receiptStorageReference?: string;
      merchantReceiptReference?: string;
      idempotencyKey?: string;
      correlationId?: string;
    },
  ) {
    return this.riderAdvance.recordAdvance({
      riderAdvanceId: id,
      actorUserId: req.user.id,
      actualAdvanceAmount: body.actualAdvanceAmount,
      notes: body.notes,
      receiptStorageReference: body.receiptStorageReference,
      merchantReceiptReference: body.merchantReceiptReference,
      idempotencyKey: body.idempotencyKey,
      correlationId: body.correlationId,
    });
  }

  @Post('rider-advances/:id/vendor-acknowledgment')
  @ApiOperation({
    summary: 'Merchant acknowledges cash received from rider (not goods release)',
  })
  vendorAck(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      acknowledgedAmount: string | number;
      idempotencyKey?: string;
      correlationId?: string;
    },
  ) {
    return this.riderAdvance.vendorAcknowledge({
      riderAdvanceId: id,
      actorUserId: req.user.id,
      acknowledgedAmount: body.acknowledgedAmount,
      idempotencyKey: body.idempotencyKey,
      correlationId: body.correlationId,
    });
  }

  @Post('rider-advances/:id/cancel')
  @ApiOperation({
    summary:
      'Cancel before advance, or dispute/preserve obligation after advance',
  })
  cancel(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: { reason?: string; correlationId?: string },
  ) {
    return this.riderAdvance.cancel({
      riderAdvanceId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      correlationId: body.correlationId,
    });
  }
}
