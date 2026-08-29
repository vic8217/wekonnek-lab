import { Module } from '@nestjs/common';
import { MerchantsService } from './merchants.service';
import { MerchantsController } from './merchants.controller';
import { CoordinatorApplicationsModule } from '../coordinator-applications/coordinator-applications.module';
import { MerchantSubscriptionBillingService } from './merchant-subscription-billing.service';
import { MerchantSubscriptionBillingScheduler } from './merchant-subscription-billing.scheduler';
import { MerchantSubscriptionBillingController } from './merchant-subscription-billing.controller';

@Module({
  imports: [CoordinatorApplicationsModule],
  controllers: [MerchantsController, MerchantSubscriptionBillingController],
  providers: [
    MerchantsService,
    MerchantSubscriptionBillingService,
    MerchantSubscriptionBillingScheduler,
  ],
  exports: [MerchantsService, MerchantSubscriptionBillingService],
})
export class MerchantsModule {}
