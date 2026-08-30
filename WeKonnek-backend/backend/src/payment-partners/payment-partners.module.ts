import { Module, forwardRef } from '@nestjs/common';
import { DineInCrewModule } from '../dine-in-crew/dine-in-crew.module';
import { MarketplaceOrdersModule } from '../orders/orders.module';
import { PayCoolsCallbackController } from './paycools-callback.controller';
import { PayCoolsCustomerController } from './paycools-customer.controller';
import { PaymentPartnersController } from './payment-partners.controller';
import { OrderPayCoolsService } from './order-paycools.service';
import { PaymentPartnerConfigService } from './payment-partner-config.service';
import { PayCoolsProvider } from './paycools.provider';
import { PlatformPaymentService } from './platform-payment.service';
import { WalletReloadService } from './wallet-reload.service';

@Module({
  imports: [DineInCrewModule, forwardRef(() => MarketplaceOrdersModule)],
  controllers: [
    PaymentPartnersController,
    PayCoolsCallbackController,
    PayCoolsCustomerController,
  ],
  providers: [
    PaymentPartnerConfigService,
    PlatformPaymentService,
    PayCoolsProvider,
    WalletReloadService,
    OrderPayCoolsService,
  ],
  exports: [
    PaymentPartnerConfigService,
    PlatformPaymentService,
    PayCoolsProvider,
    WalletReloadService,
    OrderPayCoolsService,
  ],
})
export class PaymentPartnersModule {}
