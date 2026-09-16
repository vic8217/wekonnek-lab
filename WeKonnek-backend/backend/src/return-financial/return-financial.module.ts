import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReturnFinancialController } from './return-financial.controller';
import { ReturnFinancialDeterminationService } from './return-financial-determination.service';
import { ReturnFinancialResolutionService } from './return-financial-resolution.service';
import { ReturnFinancialSettlementService } from './return-financial-settlement.service';
import { ReturnFinancialTermsService } from './return-financial-terms.service';
import { RiderAdvanceCollectibilityService } from './rider-advance-collectibility.service';

@Module({
  imports: [PrismaModule, FulfillmentModule],
  controllers: [ReturnFinancialController],
  providers: [
    RiderAdvanceCollectibilityService,
    ReturnFinancialTermsService,
    ReturnFinancialDeterminationService,
    ReturnFinancialSettlementService,
    ReturnFinancialResolutionService,
  ],
  exports: [
    RiderAdvanceCollectibilityService,
    ReturnFinancialTermsService,
    ReturnFinancialDeterminationService,
    ReturnFinancialSettlementService,
    ReturnFinancialResolutionService,
  ],
})
export class ReturnFinancialModule {}
