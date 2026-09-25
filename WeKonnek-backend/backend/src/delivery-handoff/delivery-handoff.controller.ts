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
import { DeliveryHandoffService } from './delivery-handoff.service';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

type AuthRequest = { user?: { id: string } };

@ApiTags('Customer Delivery Handoff')
@Controller()
export class DeliveryHandoffController {
  constructor(private readonly delivery: DeliveryHandoffService) {}

  @Post('orders/:orderId/delivery-token')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Active delivery rider issues short-lived QR + OTP customer delivery capability',
  })
  issue(
    @Req() req: AuthRequest,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body()
    body: { correlationId?: string; riderId?: string; customerId?: string } = {},
  ) {
    return this.delivery.issueForOrder({
      wkOrderId: orderId,
      actorUserId: req.user!.id,
      riderId: body.riderId,
      customerId: body.customerId,
      correlationId: body.correlationId,
    });
  }

  @Get('orders/:orderId/delivery-recipient')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Owning customer reads the current delivery recipient',
  })
  currentRecipient(
    @Req() req: AuthRequest,
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.delivery.currentRecipient({
      wkOrderId: orderId,
      actorUserId: req.user!.id,
    });
  }

  @Post('orders/:orderId/delivery-recipient')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Owning customer authorizes or replaces an alternate delivery recipient',
  })
  authorizeRecipient(
    @Req() req: AuthRequest,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body()
    body: {
      recipientDisplayName?: string;
      recipientCategory?: string;
      idempotencyKey?: string;
      correlationId?: string;
    },
  ) {
    return this.delivery.authorizeRecipient({
      wkOrderId: orderId,
      actorUserId: req.user!.id,
      body,
      correlationId: body.correlationId,
    });
  }

  @Post('orders/:orderId/delivery-recipient/revoke')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Owning customer revokes the active alternate delivery recipient',
  })
  revokeRecipient(
    @Req() req: AuthRequest,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() body: { correlationId?: string } = {},
  ) {
    return this.delivery.revokeRecipient({
      wkOrderId: orderId,
      actorUserId: req.user!.id,
      correlationId: body.correlationId,
    });
  }

  @Post('delivery-handoffs/validate')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Preview delivery QR/OTP. Does not consume. Customer-self requires the owning customer.',
  })
  validate(
    @Req() req: AuthRequest,
    @Body()
    body: {
      qrPayload?: string;
      otp?: string;
      orderId?: number;
      correlationId?: string;
    },
  ) {
    return this.delivery.validate({
      actorUserId: req.user?.id,
      qrPayload: body.qrPayload,
      otp: body.otp,
      orderId: body.orderId,
      correlationId: body.correlationId,
    });
  }

  @Post('delivery-handoffs/confirm')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Confirm delivery. Customer-self requires the owning customer. Alternate recipient may present the credential.',
  })
  confirm(
    @Req() req: AuthRequest,
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
      actorUserId: req.user?.id,
      qrPayload: body.qrPayload,
      otp: body.otp,
      orderId: body.orderId,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Post('delivery-handoffs/:id/revoke')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Active delivery rider or admin revokes capability' })
  revoke(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Body() body: { reason?: string; correlationId?: string } = {},
  ) {
    return this.delivery.revoke({
      tokenId: id,
      actorUserId: req.user!.id,
      reason: body.reason,
      correlationId: body.correlationId,
    });
  }
}
