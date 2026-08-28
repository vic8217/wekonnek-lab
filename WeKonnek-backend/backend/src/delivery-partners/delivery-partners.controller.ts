import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { DeliveryPartnersService } from './delivery-partners.service';

type AuthenticatedRequest = Request & { user: { id: string } };

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
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.updateLalamove(body, req.user.id);
  }
  @Patch('lalamove/status') @Roles(UserRole.admin) setLalamoveStatus(
    @Body() body: { enabled?: boolean },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.updateLalamove({ enabled: body.enabled }, req.user.id);
  }
  @Patch('lalamove/credentials')
  @Roles(UserRole.admin)
  updateLalamoveCredentials(
    @Body() body: Record<string, unknown>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.updateLalamoveCredentials(body, req.user.id);
  }
  @Post('lalamove/test')
  @Roles(UserRole.admin)
  testLalamove(@Req() req: AuthenticatedRequest) {
    return this.service.testLalamoveConnection(req.user.id);
  }
}
