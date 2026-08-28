import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { DeliveryPartnersService } from './delivery-partners.service';

@Controller('admin/delivery-partners')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeliveryPartnersController {
  constructor(private readonly service: DeliveryPartnersService) {}

  @Get() @Roles(UserRole.admin, UserRole.staff) list() {
    return this.service.list();
  }
  @Get('lalamove') @Roles(UserRole.admin, UserRole.staff) getLalamove() {
    return this.service.getLalamove();
  }
  @Patch('lalamove') @Roles(UserRole.admin) updateLalamove(
    @Body() body: Record<string, unknown>,
    @Req() req: any,
  ) {
    return this.service.updateLalamove(body, req.user.id);
  }
  @Patch('lalamove/status') @Roles(UserRole.admin) setLalamoveStatus(
    @Body() body: { enabled?: boolean },
    @Req() req: any,
  ) {
    return this.service.updateLalamove({ enabled: body.enabled }, req.user.id);
  }
  @Patch('lalamove/credentials')
  @Roles(UserRole.admin)
  updateLalamoveCredentials(
    @Body() body: Record<string, unknown>,
    @Req() req: any,
  ) {
    return this.service.updateLalamoveCredentials(body, req.user.id);
  }
}
