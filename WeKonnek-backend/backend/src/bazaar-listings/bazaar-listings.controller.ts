import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { BazaarListingsService } from './bazaar-listings.service';
import { PaymentGatewayService } from '../modules/wallet/payment-gateway.service';
import { WalletPaymentGateway } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';

@Controller('bazaar-listings')
export class BazaarListingsController {
  constructor(private readonly service: BazaarListingsService, private readonly payments: PaymentGatewayService) {}
  @Get('admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  adminList(@Query() query: any) { return this.service.adminList(query); }

  @Patch('admin/:id/suspend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  suspend(@Req() req: any, @Param('id') id: string, @Body() body: { reason: string }) { return this.service.suspend(req.user.id, id, body.reason); }

  @Patch('admin/:id/reinstate')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  reinstate(@Param('id') id: string) { return this.service.reinstate(id); }

  @Get('mine') @UseGuards(JwtAuthGuard) mine(@Req() req: any) { return this.service.mine(req.user.id); }
  @Get('mine/:id') @UseGuards(JwtAuthGuard) ownedDetail(@Req() req: any, @Param('id') id: string) { return this.service.ownedDetail(req.user.id, id); }
  @Patch('mine/:id') @UseGuards(JwtAuthGuard) update(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.update(req.user.id, id, body); }
  @Get('public/:id') publicDetail(@Param('id') id: string) { return this.service.publicDetail(id); }
  @Post('drafts') @UseGuards(JwtAuthGuard) create(@Req() req: any, @Body() body: any) { return this.service.createDraft(req.user.id, body); }
  @Post(':id/checkout') @UseGuards(JwtAuthGuard) checkout(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.startCheckout(req.user.id, id, body); }
  @Post('webhook/:gateway') async webhook(@Req() req: any, @Param('gateway') gateway: WalletPaymentGateway, @Body() body: any) {
    const result = await this.payments.verifyWebhook({ gateway, body, headers: req.headers || {} });
    const id = result.metadata?.bazaarListingId;
    if (id) await this.service.settle(id, result.status);
    return { received: true };
  }
}
