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
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { RedeliveryService } from './redelivery.service';

@ApiTags('Redelivery Authorization')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class RedeliveryController {
  constructor(private readonly redelivery: RedeliveryService) {}

  @Post('orders/:orderId/redelivery-requests')
  @ApiOperation({
    summary:
      'Customer requests same-address redelivery after delivery_failed (Stage 10)',
  })
  request(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body()
    body: {
      windowStart: string;
      windowEnd: string;
      timezone?: string;
      addressMode?: string;
      deliveryAddress?: string;
      correlationId?: string;
      idempotencyKey?: string;
    },
  ) {
    return this.redelivery.request({
      wkOrderId: orderId,
      actorUserId: req.user.id,
      windowStart: body.windowStart,
      windowEnd: body.windowEnd,
      timezone: body.timezone,
      addressMode: body.addressMode,
      deliveryAddress: body.deliveryAddress,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }

  @Get('orders/:orderId/redelivery')
  @ApiOperation({
    summary: 'Get redelivery authorization state for an order (merchant-visible)',
  })
  get(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.redelivery.getForOrder(orderId, req.user.id);
  }

  @Post('redelivery-requests/:id/confirm')
  @ApiOperation({
    summary:
      'Customer confirms redelivery; backend auto-activates (delivery_failed→in_transit)',
  })
  confirm(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      correlationId?: string;
      idempotencyKey?: string;
      autoActivate?: boolean;
    } = {},
  ) {
    return this.redelivery.confirm({
      authorizationId: id,
      actorUserId: req.user.id,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
      autoActivate: body.autoActivate,
    });
  }

  @Post('redelivery-requests/:id/cancel')
  @ApiOperation({ summary: 'Cancel an open redelivery authorization' })
  cancel(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() body: { reason?: string; correlationId?: string } = {},
  ) {
    return this.redelivery.cancel({
      authorizationId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      correlationId: body.correlationId,
    });
  }

  @Post('redelivery-requests/:id/admin-activate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({
    summary:
      'SYSTEM_ADMIN recovery activation (requires reason + correlationId)',
  })
  adminActivate(
    @Req() req: { user: { id: string } },
    @Param('id') id: string,
    @Body()
    body: {
      reason: string;
      correlationId: string;
      idempotencyKey?: string;
    },
  ) {
    return this.redelivery.adminActivate({
      authorizationId: id,
      actorUserId: req.user.id,
      reason: body.reason,
      correlationId: body.correlationId,
      idempotencyKey: body.idempotencyKey,
    });
  }
}
