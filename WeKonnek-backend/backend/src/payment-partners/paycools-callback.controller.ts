import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { WalletReloadService } from './wallet-reload.service';

@ApiTags('Payments')
@Controller('payments/callbacks/paycools')
export class PayCoolsCallbackController {
  constructor(private readonly reloads: WalletReloadService) {}

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
    await this.reloads.handlePayCoolsCallback(body, headers);
    return { code: 10000, message: 'Success' };
  }
}
