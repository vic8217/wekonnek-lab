import {
  Controller, Get, Post, Put,
  Body, Param, Query, UseGuards, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiQuery } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { OrderStatus, OrderType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Delivery Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('delivery-orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(@Req() req: any, @Body() data: any) {
    return this.ordersService.create({ ...data, customerId: req.user.id });
  }

  @Get()
  @ApiQuery({ name: 'type', required: false, enum: OrderType })
  @ApiQuery({ name: 'status', required: false, enum: OrderStatus })
  findAll(
    @Query('type') type?: OrderType,
    @Query('status') status?: OrderStatus,
  ) {
    return this.ordersService.findAll({ type, status });
  }

  @Get('my-orders')
  myOrders(@Req() req: any) {
    return this.ordersService.findByCustomer(req.user.id);
  }

  @Get('rider-orders')
  riderOrders(@Req() req: any) {
    return this.ordersService.findByRider(req.user.id);
  }

  @Get('express/estimate')
  @ApiQuery({ name: 'pickupLat', required: true, type: Number })
  @ApiQuery({ name: 'pickupLng', required: true, type: Number })
  @ApiQuery({ name: 'deliveryLat', required: true, type: Number })
  @ApiQuery({ name: 'deliveryLng', required: true, type: Number })
  @ApiQuery({ name: 'weight', required: false, enum: ['small', 'medium', 'large'] })
  estimateExpress(
    @Query('pickupLat') pickupLat: string,
    @Query('pickupLng') pickupLng: string,
    @Query('deliveryLat') deliveryLat: string,
    @Query('deliveryLng') deliveryLng: string,
    @Query('weight') weight?: string,
  ) {
    return this.ordersService.estimateExpressDelivery(
      parseFloat(pickupLat),
      parseFloat(pickupLng),
      parseFloat(deliveryLat),
      parseFloat(deliveryLng),
      weight as 'small' | 'medium' | 'large' | undefined,
    );
  }

  @Get('pending')
  pendingOrders() {
    return this.ordersService.findPendingOrders();
  }

  @Get('stats')
  getStats() {
    return this.ordersService.getStats();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findById(id);
  }

  @Put(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: OrderStatus },
  ) {
    return this.ordersService.updateStatus(id, body.status);
  }

  @Put(':id/assign-rider')
  assignRider(
    @Param('id') id: string,
    @Body() body: { riderId: string },
  ) {
    return this.ordersService.assignRider(id, body.riderId);
  }

  @Put(':id/rate')
  rateOrder(
    @Param('id') id: string,
    @Body() body: { rating: number; review?: string },
  ) {
    return this.ordersService.rateOrder(id, body.rating, body.review);
  }

  @Put(':id/payment')
  updatePayment(
    @Param('id') id: string,
    @Body() body: { paymentStatus: string; paymentRef?: string },
  ) {
    return this.ordersService.updatePaymentStatus(
      id,
      body.paymentStatus as any,
      body.paymentRef,
    );
  }
}
