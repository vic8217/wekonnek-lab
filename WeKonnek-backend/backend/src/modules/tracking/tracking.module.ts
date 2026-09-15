import { Module } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { TrackingGateway } from './tracking.gateway';
import { FulfillmentModule } from '../../fulfillment/fulfillment.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  controllers: [TrackingController],
  imports: [PrismaModule, FulfillmentModule],
  providers: [TrackingService, TrackingGateway],
  exports: [TrackingService, TrackingGateway],
})
export class TrackingModule {}
