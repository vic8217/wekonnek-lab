import { Controller, Post, Body, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { PaymentGatewayService } from '../modules/wallet/payment-gateway.service';
import { WalletPaymentGateway } from '@prisma/client';

@ApiTags('subscription-payments')
@Controller('subscription-payments')
export class SubscriptionPaymentsWebhookController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly paymentGateway: PaymentGatewayService,
  ) {}

  @Post('webhook/:gateway')
  @ApiOperation({ summary: 'Payment gateway webhook to settle subscription payments' })
  async webhook(
    @Param('gateway') gateway: string,
    @Req() req: any,
    @Body() body: any,
  ) {
    const gw = gateway as WalletPaymentGateway;
    const result = await this.paymentGateway.verifyWebhook({
      gateway: gw,
      body,
      headers: req.headers || {},
    });
    const subscriptionPaymentId = result.metadata?.subscriptionPaymentId;
    if (subscriptionPaymentId) {
      await this.subscriptionsService.markPaidByGateway(
        subscriptionPaymentId,
        result.status,
      );
    }
    return { received: true };
  }
}
