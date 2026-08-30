import {
  Body,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { isCustomerOrderPayCoolsMetadata } from './paycools-order-source';
import { OrderPayCoolsService } from './order-paycools.service';
import { PayCoolsProvider } from './paycools.provider';
import { WalletReloadService } from './wallet-reload.service';

@ApiTags('Payments')
@Controller('payments/callbacks/paycools')
export class PayCoolsCallbackController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paycools: PayCoolsProvider,
    private readonly reloads: WalletReloadService,
    private readonly orderPayments: OrderPayCoolsService,
  ) {}

  @Post('payment')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'PayCools payment callback (provider-authenticated, no merchant session)',
  })
  async payment(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const verified = await this.paycools.verifyWebhook(body, headers);
    const payment = await this.prisma.platformPaymentTransaction.findUnique({
      where: { reference: verified.reference },
    });
    if (!payment)
      throw new NotFoundException('Unknown PayCools payment reference');
    if (isCustomerOrderPayCoolsMetadata(payment.metadata)) {
      await this.orderPayments.settleVerified(verified);
    } else {
      await this.reloads.settleVerified(verified);
    }
    return { code: 10000, message: 'Success' };
  }
}
