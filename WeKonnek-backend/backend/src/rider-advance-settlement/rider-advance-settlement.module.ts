import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReturnFinancialModule } from '../return-financial/return-financial.module';
import { RiderAdvanceSettlementController } from './rider-advance-settlement.controller';
import { RiderAdvanceSettlementService } from './rider-advance-settlement.service';

@Module({
  imports: [PrismaModule, FulfillmentModule, ReturnFinancialModule],
  controllers: [RiderAdvanceSettlementController],
  providers: [RiderAdvanceSettlementService],
  exports: [RiderAdvanceSettlementService],
})
export class RiderAdvanceSettlementModule {}
