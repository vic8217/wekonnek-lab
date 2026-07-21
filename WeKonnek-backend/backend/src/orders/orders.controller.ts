import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Place a new order' })
  create(@Req() req: any, @Body() body: any) {
    return this.ordersService.create(req.user.id, body);
  }

  @Get()
  @ApiOperation({
    summary:
      'List orders. merchantId → merchant view, admin=true or admin/staff role → all, otherwise the caller’s own orders',
  })
  @ApiQuery({ name: 'merchantId', required: false })
  @ApiQuery({ name: 'admin', required: false })
  @ApiQuery({ name: 'status', required: false })
  findAll(
    @Req() req: any,
    @Query('merchantId') merchantId?: string,
    @Query('admin') admin?: string,
    @Query('status') status?: string,
  ) {
    const role = req.user?.role;
    const isAdmin = admin === 'true' || role === 'admin' || role === 'staff';
    return this.ordersService.findAll({
      merchantId: merchantId ? Number(merchantId) : undefined,
      userId: req.user.id,
      isAdmin,
      status,
    });
  }

  @Get('my-orders')
  @ApiOperation({ summary: 'List the logged-in customer’s orders' })
  myOrders(@Req() req: any) {
    return this.ordersService.findAll({ userId: req.user.id });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Order stats (optionally per merchant)' })
  @ApiQuery({ name: 'merchantId', required: false })
  stats(@Query('merchantId') merchantId?: string) {
    return this.ordersService.getStats(merchantId ? Number(merchantId) : undefined);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single order' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findById(id);
  }

  @Get(':id/items')
  @ApiOperation({ summary: 'Get the items of an order' })
  items(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findItems(id);
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Update order status (PUT)' })
  updateStatusPut(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: string },
  ) {
    return this.ordersService.updateStatus(id, body.status);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update order status (PATCH)' })
  updateStatusPatch(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: string },
  ) {
    return this.ordersService.updateStatus(id, body.status);
  }

  @Patch(':id/payment')
  @ApiOperation({ summary: 'Update payment status' })
  updatePayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { payment_status?: string; paymentStatus?: string; payment_ref?: string },
  ) {
    return this.ordersService.updatePayment(
      id,
      (body.payment_status || body.paymentStatus) as string,
      body.payment_ref,
    );
  }
}
