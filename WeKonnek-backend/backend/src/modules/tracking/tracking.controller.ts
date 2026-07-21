import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Tracking')
@Controller('tracking')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Get('rider/:riderId/latest')
  @ApiOperation({ summary: 'Get latest location of a rider' })
  getLatestLocation(@Param('riderId') riderId: string) {
    return this.trackingService.getLatestLocation(riderId);
  }

  @Get('rider/:riderId/history')
  @ApiOperation({ summary: 'Get location history of a rider' })
  @ApiQuery({ name: 'orderId', required: false })
  @ApiQuery({ name: 'limit', required: false })
  getLocationHistory(
    @Param('riderId') riderId: string,
    @Query('orderId') orderId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.trackingService.getLocationHistory(
      riderId,
      orderId,
      limit ? parseInt(limit) : 100,
    );
  }

  @Get('order/:orderId/trail')
  @ApiOperation({ summary: 'Get the full GPS trail for a delivery' })
  getOrderTrail(@Param('orderId') orderId: string) {
    return this.trackingService.getOrderTrail(orderId);
  }

  @Get('riders/active')
  @ApiOperation({ summary: 'Get all active riders with last known location (Admin)' })
  getActiveRiders() {
    return this.trackingService.getActiveRiders();
  }
}
