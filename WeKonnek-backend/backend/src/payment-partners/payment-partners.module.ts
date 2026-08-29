import { Module } from '@nestjs/common';
import { PaymentPartnersController } from './payment-partners.controller';
import { PayCoolsCallbackController } from './paycools-callback.controller';
import { PaymentPartnerConfigService } from './payment-partner-config.service';
import { PayCoolsProvider } from './paycools.provider';
import { PlatformPaymentService } from './platform-payment.service';
import { WalletReloadService } from './wallet-reload.service';

@Module({
  controllers: [PaymentPartnersController, PayCoolsCallbackController],
  providers: [PaymentPartnerConfigService, PlatformPaymentService, PayCoolsProvider, WalletReloadService],
  exports: [PaymentPartnerConfigService, PlatformPaymentService, PayCoolsProvider, WalletReloadService],
})
export class PaymentPartnersModule {}
