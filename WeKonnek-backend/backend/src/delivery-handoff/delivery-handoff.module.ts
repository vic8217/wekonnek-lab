import { Module } from '@nestjs/common';
import { AgreementsModule } from '../agreements/agreements.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DeliveryHandoffController } from './delivery-handoff.controller';
import { DeliveryHandoffService } from './delivery-handoff.service';

@Module({
  imports: [PrismaModule, FulfillmentModule, AgreementsModule],
  controllers: [DeliveryHandoffController],
  providers: [DeliveryHandoffService],
  exports: [DeliveryHandoffService],
})
export class DeliveryHandoffModule {}
