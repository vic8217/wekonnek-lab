import { Body, Controller, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { SocialAuthProviderService } from './social-auth.service';

@Controller()
export class SocialAuthProviderController {
  constructor(private service: SocialAuthProviderService) {}
  @Get('auth/providers') providers() { return this.service.publicProviders(); }
  @Get('admin/social-auth/providers') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.admin) list() { return this.service.list(); }
  @Get('admin/social-auth/providers/:provider') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.admin) get(@Param('provider') provider: string) { return this.service.get(provider); }
  @Patch('admin/social-auth/providers/:provider') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.admin) update(@Param('provider') provider: string, @Body() body: any, @Req() req: any) { return this.service.update(provider, body, req.user.id); }
  @Put('admin/social-auth/providers/:provider') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.admin) replace(@Param('provider') provider: string, @Body() body: any, @Req() req: any) { return this.service.update(provider, body, req.user.id); }
  @Patch('admin/social-auth/providers/:provider/status') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.admin) status(@Param('provider') provider: string, @Body() body: { enabled: boolean }, @Req() req: any) { return this.service.setStatus(provider, body.enabled, req.user.id); }
  @Post('admin/social-auth/providers/:provider/test') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.admin) test(@Param('provider') provider: string, @Req() req: any) { return this.service.test(provider, req.user.id); }
}
