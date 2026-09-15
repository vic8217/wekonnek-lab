import { Module } from '@nestjs/common';
import { AgreementsModule } from '../agreements/agreements.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PickupHandoffController } from './pickup-handoff.controller';
import { PickupHandoffService } from './pickup-handoff.service';

@Module({
  imports: [PrismaModule, FulfillmentModule, AgreementsModule],
  controllers: [PickupHandoffController],
  providers: [PickupHandoffService],
  exports: [PickupHandoffService],
})
export class PickupHandoffModule {}
