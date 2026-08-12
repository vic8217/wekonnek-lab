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

  @Patch(':id/bill-out')
  @ApiOperation({ summary: 'Request dine-in bill-out and apply one optional discount' })
  requestBillOut(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.ordersService.requestBillOut(id, req.user.id, body);
  }

  @Patch(':id/bill-out-draft')
  @ApiOperation({ summary: 'Persist an unfinished dine-in bill-out discount form' })
  saveBillOutDraft(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.ordersService.saveBillOutDraft(id, req.user.id, body);
  }

  @Post(':id/service-requests')
  @ApiOperation({ summary: 'Customer submits a dine-in table service request' })
  createServiceRequest(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Body() body: { type?: string; details?: string }) {
    return this.ordersService.createServiceRequest(id, req.user.id, body);
  }

  @Patch(':id/service-requests/:requestId')
  @ApiOperation({ summary: 'Shop assigns or completes a dine-in service request' })
  updateServiceRequest(@Req() req: any, @Param('id', ParseIntPipe) id: number, @Param('requestId', ParseIntPipe) requestId: number, @Body() body: { assignedStaffId?: number | null; status?: string }) {
    return this.ordersService.updateServiceRequest(id, requestId, req.user.id, body);
  }

  @Patch(':id/items/:itemId/status')
  @ApiOperation({ summary: 'Update a dine-in food item status' })
  updateItemStatus(
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() body: { status: string },
  ) {
    return this.ordersService.updateItemStatus(id, itemId, body.status);
  }

  @Patch(':id/confirm-bill-out')
  @ApiOperation({ summary: 'Merchant confirms a requested bill-out' })
  confirmBillOut(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.ordersService.confirmBillOut(id, req.user.id, req.user.role);
  }

  @Post(':id/checkout-payment')
  @ApiOperation({ summary: 'Choose manual payment or start a bill-out payment gateway' })
  checkoutPayment(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { method: 'manual' | 'gcash' | 'maya' | 'card' },
  ) {
    return this.ordersService.checkoutPayment(id, req.user.id, body.method);
  }
}
