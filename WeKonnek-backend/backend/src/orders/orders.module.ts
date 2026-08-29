import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { PaymentGatewayService } from '../modules/wallet/payment-gateway.service';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { VouchersModule } from '../modules/vouchers/vouchers.module';
import { InvoicesModule } from '../modules/invoices/invoices.module';
import { DineInCrewModule } from '../dine-in-crew/dine-in-crew.module';
import { CoordinatorApplicationsModule } from '../coordinator-applications/coordinator-applications.module';
import { TrustTradeModule } from '../trust-trade/trust-trade.module';

@Module({
  imports: [NotificationsModule, VouchersModule, InvoicesModule, DineInCrewModule, CoordinatorApplicationsModule, TrustTradeModule],
  controllers: [OrdersController, PaymentsWebhookController],
  providers: [OrdersService, PaymentGatewayService],
  exports: [OrdersService],
})
export class MarketplaceOrdersModule {}
