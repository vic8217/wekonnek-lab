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
import { ReturnHandoffService } from './return-handoff.service';

@ApiTags('Merchant Return Handoff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ReturnHandoffController {
  constructor(private readonly returns: ReturnHandoffService) {}

  @Post('orders/:orderId/return-token')
  @ApiOperation({
    summary:
      'Active return rider issues short-lived QR + OTP merchant return capability',
  })
  issue(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() body: { correlationId?: string; riderId?: string } = {},
  ) {
    return this.returns.issueForOrder({
      wkOrderId: orderId,
      actorUserId: req.user.id,
      riderId: body.riderId,
      correlationId: body.correlationId,
    });
  }

  @Post('return-handoffs/validate')
  @ApiOperation({
    summary: 'Order merchant validates return QR/OTP preview (does not consume)',
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
    return this.returns.validate({
      actorUserId: req.user.id,
      qrPayload: body.qrPayload,
      otp: body.otp,
      orderId: body.orderId,
      correlationId: body.correlationId,
    });
  }

  @Post('return-handoffs/confirm')
  @ApiOperation({
    summary:
      'Order merchant confirms return: RETURN_RECEIVED custody + returned',
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
    return this.returns.confirm({
      actorUserId: req.user.id,
      qrPayload: body.qrPayload,
      otp: body.otp,
      orderId: body.orderId,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }
}
