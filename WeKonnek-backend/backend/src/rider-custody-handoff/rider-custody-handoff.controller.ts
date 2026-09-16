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
import { RiderCustodyHandoffService } from './rider-custody-handoff.service';

@ApiTags('Rider Custody Handoff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class RiderCustodyHandoffController {
  constructor(private readonly handoffs: RiderCustodyHandoffService) {}

  @Post('orders/:orderId/rider-handoffs')
  @ApiOperation({
    summary:
      'Outgoing physical custodian issues short-lived QR + OTP rider custody capability (WKRR1)',
  })
  issue(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body()
    body: {
      correlationId?: string;
      riderId?: string;
      incomingRiderId?: string;
    } = {},
  ) {
    return this.handoffs.issueForOrder({
      wkOrderId: orderId,
      actorUserId: req.user.id,
      riderId: body.riderId,
      incomingRiderId: body.incomingRiderId,
      correlationId: body.correlationId,
    });
  }

  @Post('rider-handoffs/validate')
  @ApiOperation({
    summary:
      'Pending incoming rider validates rider custody QR/OTP preview (does not consume)',
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
    return this.handoffs.validate({
      actorUserId: req.user.id,
      qrPayload: body.qrPayload,
      otp: body.otp,
      orderId: body.orderId,
      correlationId: body.correlationId,
    });
  }

  @Post('rider-handoffs/confirm')
  @ApiOperation({
    summary:
      'Incoming rider confirms custody: RIDER_TRANSFER_RELEASED + RECEIVED and assignment finalize',
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
    return this.handoffs.confirm({
      actorUserId: req.user.id,
      qrPayload: body.qrPayload,
      otp: body.otp,
      orderId: body.orderId,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }
}
