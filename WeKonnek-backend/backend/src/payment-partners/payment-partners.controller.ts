import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { PaymentPartnerConfigService } from './payment-partner-config.service';

@Controller('admin/payments/partners/paycools')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentPartnersController {
  constructor(private service: PaymentPartnerConfigService) {}

  @Get() @Roles(UserRole.admin, UserRole.staff) get() {
    return this.service.get();
  }
  @Get('environments/:environment')
  @Roles(UserRole.admin, UserRole.staff)
  getEnvironment(@Param('environment') environment: string) {
    return this.service.getEnvironment(environment);
  }
  @Patch() @Roles(UserRole.admin) update(
    @Body() body: Record<string, unknown>,
    @Req() req: any,
  ) {
    return this.service.update(body, req.user, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
  @Patch('environments/:environment') @Roles(UserRole.admin) updateEnvironment(
    @Param('environment') environment: string,
    @Body() body: Record<string, unknown>,
    @Req() req: any,
  ) {
    return this.service.updateEnvironment(environment, body, req.user.id);
  }
  @Post('environments/:environment/merchant-private-key')
  @Roles(UserRole.admin)
  replaceMerchantPrivateKey(
    @Param('environment') environment: string,
    @Body('merchantPrivateKey') value: unknown,
    @Req() req: any,
  ) {
    return this.service.replaceSecret(
      environment,
      'merchantPrivateKey',
      value,
      req.user.id,
    );
  }
  @Post('environments/:environment/callback-secret')
  @Roles(UserRole.admin)
  replaceCallbackSecret(
    @Param('environment') environment: string,
    @Body('callbackSecret') value: unknown,
    @Req() req: any,
  ) {
    return this.service.replaceSecret(
      environment,
      'callbackSecret',
      value,
      req.user.id,
    );
  }
  @Post('test') @Roles(UserRole.admin) test(@Req() req: any) {
    return this.service.testConnection(req.user.id);
  }
  @Post('reconcile') @Roles(UserRole.admin) reconcile() {
    return this.service.reconcile();
  }
}
