import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DeliveryFailureController } from './delivery-failure.controller';
import { DeliveryFailureService } from './delivery-failure.service';

@Module({
  imports: [PrismaModule, FulfillmentModule],
  controllers: [DeliveryFailureController],
  providers: [DeliveryFailureService],
  exports: [DeliveryFailureService],
})
export class DeliveryFailureModule {}
