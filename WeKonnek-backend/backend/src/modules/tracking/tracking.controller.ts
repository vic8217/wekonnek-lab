import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthActorService } from '../../fulfillment/auth-actor.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';

@ApiTags('Tracking')
@Controller('tracking')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TrackingController {
  constructor(private readonly trackingService: TrackingService, private readonly actors: AuthActorService, private readonly prisma: PrismaService) {}

  private async assertOrderRead(req: any, orderId: string) {
    const actor = await this.actors.resolve(req.user);
    const fulfillment = await this.prisma.orderFulfillment.findUnique({ where: { orderV2Id: orderId } });
    if (!fulfillment || !(actor.type === 'SYSTEM_ADMIN' || (actor.type === 'CUSTOMER' && actor.id === fulfillment.customerId) || (actor.type === 'RIDER' && actor.id === fulfillment.activeRiderId))) throw new ForbiddenException('Tracking access denied');
    return fulfillment;
  }

  @Get('rider/:riderId/latest')
  @ApiOperation({ summary: 'Get latest location of a rider' })
  async getLatestLocation(@Req() req: any, @Param('riderId') riderId: string, @Query('orderId') orderId?: string) {
    if (!orderId) throw new ForbiddenException('orderId is required');
    const fulfillment = await this.assertOrderRead(req, orderId);
    if (fulfillment.activeRiderId !== riderId) throw new ForbiddenException('Rider does not match order');
    return this.trackingService.getLatestLocation(riderId);
  }

  @Get('rider/:riderId/history')
  @ApiOperation({ summary: 'Get location history of a rider' })
  @ApiQuery({ name: 'orderId', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getLocationHistory(
    @Req() req: any,
    @Param('riderId') riderId: string,
    @Query('orderId') orderId?: string,
    @Query('limit') limit?: string,
  ) {
    if (!orderId) throw new ForbiddenException('orderId is required');
    const fulfillment = await this.assertOrderRead(req, orderId);
    if (fulfillment.activeRiderId !== riderId) throw new ForbiddenException('Rider does not match order');
    return this.trackingService.getLocationHistory(
      riderId,
      orderId,
      limit ? parseInt(limit) : 100,
    );
  }

  @Get('order/:orderId/trail')
  @ApiOperation({ summary: 'Get the full GPS trail for a delivery' })
  async getOrderTrail(@Req() req: any, @Param('orderId') orderId: string) {
    await this.assertOrderRead(req, orderId);
    return this.trackingService.getOrderTrail(orderId);
  }

  @Get('riders/active')
  @ApiOperation({ summary: 'Get all active riders with last known location (Admin)' })
  async getActiveRiders(@Req() req: any) {
    const actor = await this.actors.resolve(req.user);
    if (actor.type !== 'SYSTEM_ADMIN') throw new ForbiddenException('Admin only');
    return this.trackingService.getActiveRiders();
  }
}
