import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { DeliveryHandoffService } from './delivery-handoff.service';

@ApiTags('Customer Delivery Handoff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class DeliveryHandoffController {
  constructor(private readonly delivery: DeliveryHandoffService) {}

  @Post('orders/:orderId/delivery-token')
  @ApiOperation({
    summary:
      'Active delivery rider issues short-lived QR + OTP customer delivery capability',
  })
  issue(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body()
    body: { correlationId?: string; riderId?: string; customerId?: string } = {},
  ) {
    return this.delivery.issueForOrder({
      wkOrderId: orderId,
      actorUserId: req.user.id,
      riderId: body.riderId,
      customerId: body.customerId,
      correlationId: body.correlationId,
    });
  }

  @Post('delivery-handoffs/validate')
  @ApiOperation({
    summary:
      'Owning customer validates delivery QR/OTP preview (does not consume)',
  })
  validate(
    @Req() req: { user: { id: string } },
    @Body()
    body: {
      qrPayload?: string;
      otp?: string;
      orderId?: number;
      correlationId?: string;
    },
  ) {
    return this.delivery.validate({
      actorUserId: req.user.id,
      qrPayload: body.qrPayload,
      otp: body.otp,
      orderId: body.orderId,
      correlationId: body.correlationId,
    });
  }

  @Post('delivery-handoffs/confirm')
  @ApiOperation({
    summary:
      'Owning customer confirms delivery: consume capability, custody, delivered',
  })
  confirm(
    @Req() req: { user: { id: string } },
    @Body()
    body: {
      qrPayload?: string;
      otp?: string;
      orderId?: number;
      correlationId?: string;
      idempotencyKey?: string;
    },
  ) {
    return this.delivery.confirm({
      actorUserId: req.user.id,
      qrPayload: body.qrPayload,
      otp: body.otp,
      orderId: body.orderId,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('delivery-handoffs/:id/revoke')
  @ApiOperation({ summary: 'Active delivery rider or admin revokes capability' })
  revoke(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: { reason?: string; correlationId?: string } = {},
  ) {
    return this.delivery.revoke({
      tokenId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      correlationId: body.correlationId,
    });
  }
}
