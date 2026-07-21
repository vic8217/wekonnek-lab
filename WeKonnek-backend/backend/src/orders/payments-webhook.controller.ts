import { Controller, Post, Body, Param, Req } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { PaymentGatewayService } from '../modules/wallet/payment-gateway.service';
import { WalletPaymentGateway } from '@prisma/client';

@ApiTags('order-payments')
@Controller('order-payments')
export class PaymentsWebhookController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly paymentGateway: PaymentGatewayService,
  ) {}

  @Post('webhook/:gateway')
  @ApiOperation({ summary: 'Payment gateway webhook to settle order payments' })
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
    const orderId = result.metadata?.orderId;
    if (orderId) {
      await this.ordersService.markPaidByGateway(orderId, result.status);
    }
    return { received: true };
  }
}
