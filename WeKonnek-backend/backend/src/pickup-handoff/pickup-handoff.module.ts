import { Module, forwardRef } from '@nestjs/common';
import { AgreementsModule } from '../agreements/agreements.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RiderAdvanceModule } from '../rider-advance/rider-advance.module';
import { PickupHandoffController } from './pickup-handoff.controller';
import { PickupHandoffService } from './pickup-handoff.service';

@Module({
  imports: [
    PrismaModule,
    FulfillmentModule,
    AgreementsModule,
    forwardRef(() => RiderAdvanceModule),
  ],
  controllers: [PickupHandoffController],
  providers: [PickupHandoffService],
  exports: [PickupHandoffService],
})
export class PickupHandoffModule {}
