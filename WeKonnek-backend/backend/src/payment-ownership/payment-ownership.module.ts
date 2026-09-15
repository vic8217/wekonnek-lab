import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MerchantPaymentConfigService } from './merchant-payment-config.service';
import { MerchantPaymentEvidenceService } from './merchant-payment-evidence.service';
import { PaymentAllocationService } from './payment-allocation.service';
import { PaymentOwnershipController } from './payment-ownership.controller';
import { PaymentRoutingService } from './payment-routing.service';

@Module({
  imports: [PrismaModule, FulfillmentModule],
  controllers: [PaymentOwnershipController],
  providers: [
    PaymentRoutingService,
    PaymentAllocationService,
    MerchantPaymentConfigService,
    MerchantPaymentEvidenceService,
  ],
  exports: [
    PaymentRoutingService,
    PaymentAllocationService,
    MerchantPaymentConfigService,
    MerchantPaymentEvidenceService,
  ],
})
export class PaymentOwnershipModule {}
