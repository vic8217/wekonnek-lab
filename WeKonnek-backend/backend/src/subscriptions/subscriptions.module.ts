import { Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionPaymentsWebhookController } from './subscription-payments-webhook.controller';
import { PaymentGatewayService } from '../modules/wallet/payment-gateway.service';

@Module({
  controllers: [SubscriptionsController, SubscriptionPaymentsWebhookController],
  providers: [SubscriptionsService, PaymentGatewayService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
