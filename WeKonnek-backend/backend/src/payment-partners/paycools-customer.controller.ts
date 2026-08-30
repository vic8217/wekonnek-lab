import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { OrderPayCoolsService } from './order-paycools.service';

@ApiTags('Payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payments/paycools')
export class PayCoolsCustomerController {
  constructor(private readonly orderPayments: OrderPayCoolsService) {}

  @Get('availability')
  @ApiOperation({
    summary:
      'Whether QRPH is operational for a checkout merchant and order type',
  })
  availability(
    @Req() req: { user: { id: string } },
    @Query('merchantId') merchantId?: string,
    @Query('orderType') orderType?: string,
    @Query('orderId') orderId?: string,
  ) {
    return this.orderPayments.getAvailability({
      merchantId: merchantId ? Number(merchantId) : undefined,
      orderType,
      orderId: orderId ? Number(orderId) : undefined,
      userId: req.user.id,
    });
  }
}
