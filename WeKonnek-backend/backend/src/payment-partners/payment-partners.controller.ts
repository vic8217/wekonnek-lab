import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { PaymentPartnerConfigService } from './payment-partner-config.service';

@Controller('admin/payments/partners/paycools')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentPartnersController {
  constructor(private service: PaymentPartnerConfigService) {}

  @Get() @Roles(UserRole.admin, UserRole.staff) get() { return this.service.get(); }
  @Patch() @Roles(UserRole.admin) update(@Body() body: Record<string, unknown>, @Req() req: any) {
    return this.service.update(body, req.user, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }
  @Post('test') @Roles(UserRole.admin) test(@Req() req: any) { return this.service.testConnection(req.user.id); }
  @Post('reconcile') @Roles(UserRole.admin) reconcile() { return this.service.reconcile(); }
}
