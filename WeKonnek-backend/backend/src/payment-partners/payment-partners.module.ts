import { Module } from '@nestjs/common';
import { PaymentPartnersController } from './payment-partners.controller';
import { PaymentPartnerConfigService } from './payment-partner-config.service';
import { PlatformPaymentService } from './platform-payment.service';

@Module({
  controllers: [PaymentPartnersController],
  providers: [PaymentPartnerConfigService, PlatformPaymentService],
  exports: [PaymentPartnerConfigService, PlatformPaymentService],
})
export class PaymentPartnersModule {}
