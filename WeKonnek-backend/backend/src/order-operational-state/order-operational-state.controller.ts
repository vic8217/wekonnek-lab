import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { OrderOperationalStateService } from './order-operational-state.service';

@ApiTags('Order Operational State')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class OrderOperationalStateController {
  constructor(private readonly operational: OrderOperationalStateService) {}

  @Get('orders/:orderId/operational-state')
  @ApiOperation({
    summary:
      'Derived read-only operational state from fulfillment, payment, RA, custody',
  })
  get(
    @Req() req: { user: { id: string } },
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.operational.getForOrder(orderId, req.user.id);
  }
}
