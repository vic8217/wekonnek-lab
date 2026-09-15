import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { PickupHandoffService } from './pickup-handoff.service';

@ApiTags('Pickup Handoff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class PickupHandoffController {
  constructor(private readonly pickup: PickupHandoffService) {}

  @Post('orders/:orderId/pickup-token')
  @ApiOperation({
    summary:
      'Active assigned rider requests a short-lived single-use pickup QR capability',
  })
  issue(
    @Req() req: { user: { id: string } },
    @Param('orderId') orderId: string,
    @Body()
    body: { correlationId?: string; riderId?: string } = {},
  ) {
    return this.pickup.issueForOrder({
      wkOrderId: Number(orderId),
      actorUserId: req.user.id,
      riderId: body.riderId,
      correlationId: body.correlationId,
    });
  }

  @Post('pickup-handoffs/validate')
  @ApiOperation({
    summary:
      'Merchant validates pickup QR and receives safe preview (does not consume)',
  })
  validate(
    @Req() req: { user: { id: string } },
    @Body() body: { qrPayload: string; correlationId?: string },
  ) {
    return this.pickup.validate({
      actorUserId: req.user.id,
      qrPayload: body.qrPayload,
      correlationId: body.correlationId,
    });
  }

  @Post('pickup-handoffs/confirm')
  @ApiOperation({
    summary:
      'Merchant confirms pickup handoff: consume token, custody evidence, picked_up',
  })
  confirm(
    @Req() req: { user: { id: string } },
    @Body() body: { qrPayload: string; correlationId?: string },
  ) {
    return this.pickup.confirm({
      actorUserId: req.user.id,
      qrPayload: body.qrPayload,
      correlationId: body.correlationId,
    });
  }
}
