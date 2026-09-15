import {
  Controller, Get, Post, Put, ForbiddenException,
  Body, Param, Query, UseGuards, Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiQuery } from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { OrderStatus, OrderType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthActorService } from '../../fulfillment/auth-actor.service';

@ApiTags('Delivery Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('delivery-orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService, private readonly actors: AuthActorService) {}

  @Post()
  create(@Req() req: any, @Body() data: any) {
    return this.ordersService.create({ ...data, customerId: req.user.id });
  }

  @Get()
  @ApiQuery({ name: 'type', required: false, enum: OrderType })
  @ApiQuery({ name: 'status', required: false, enum: OrderStatus })
  async findAll(
    @Req() req: any,
    @Query('type') type?: OrderType,
    @Query('status') status?: OrderStatus,
  ) {
    const actor = await this.actors.resolve(req.user);
    if (actor.type === 'SYSTEM_ADMIN') return this.ordersService.findAll({ type, status });
    if (actor.type === 'CUSTOMER') return this.ordersService.findByCustomer(req.user.id);
    if (actor.type === 'RIDER') return this.ordersService.findByRider(req.user.id);
    return [];
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
  async findOne(@Req() req: any, @Param('id') id: string) {
    const actor = await this.actors.resolve(req.user); const order = await this.ordersService.findById(id);
    if (actor.type === 'SYSTEM_ADMIN' || (actor.type === 'CUSTOMER' && order.customerId === req.user.id) || (actor.type === 'RIDER' && order.riderId === req.user.id)) return order;
    throw new ForbiddenException('Order access denied');
  }

  @Put(':id/status')
  async updateStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { status: OrderStatus },
  ) {
    return this.ordersService.updateStatus(id, body.status, await this.actors.resolve(req.user));
  }

  @Put(':id/assign-rider')
  async assignRider(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { riderId: string },
  ) {
    return this.ordersService.assignRider(id, body.riderId, await this.actors.resolve(req.user));
  }

  @Put(':id/rate')
  async rateOrder(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { rating: number; review?: string },
  ) {
    const order = await this.ordersService.findById(id);
    if (order.customerId !== req.user.id) throw new ForbiddenException('Only the order customer may rate');
    return this.ordersService.rateOrder(id, body.rating, body.review);
  }

  @Put(':id/payment')
  updatePayment(
    @Param('id') id: string,
    @Body() body: { paymentStatus: string; paymentRef?: string },
  ) {
    // Payment truth is provider/internal-only; no JWT caller may assert it.
    throw new ForbiddenException('Payment status is provider-managed');
  }
}
