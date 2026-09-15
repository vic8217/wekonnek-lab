import { Module, forwardRef } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RiderAdvanceController } from './rider-advance.controller';
import { RiderAdvanceService } from './rider-advance.service';

@Module({
  imports: [PrismaModule, forwardRef(() => FulfillmentModule)],
  controllers: [RiderAdvanceController],
  providers: [RiderAdvanceService],
  exports: [RiderAdvanceService],
})
export class RiderAdvanceModule {}
