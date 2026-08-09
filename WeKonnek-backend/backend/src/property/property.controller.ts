import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole, WalletPaymentGateway } from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { PropertyService } from './property.service';

@Controller('property')
export class PropertyController {
  constructor(private readonly service: PropertyService) {}

  @Get('types') types(@Query('includeInactive') includeInactive?: string) { return this.service.types(includeInactive === 'true'); }
  @Get('plans') plans() { return this.service.plans(); }
  @Get('listings') browse(@Query() query: any) { return this.service.browse(query); }
  @Get('listings/:id') detail(@Param('id') id: string) { return this.service.detail(id); }

  @Get('mine') @UseGuards(JwtAuthGuard) mine(@Req() req: any, @Query() query: any) { return this.service.mine(req.user.id, query); }
  @Get('mine/:id') @UseGuards(JwtAuthGuard) ownedDetail(@Req() req: any, @Param('id') id: string) { return this.service.ownedDetail(req.user.id, id); }
  @Post('listings') @UseGuards(JwtAuthGuard) create(@Req() req: any, @Body() body: any) { return this.service.create(req.user.id, body); }
  @Patch('listings/:id') @UseGuards(JwtAuthGuard) update(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.update(req.user.id, id, body); }
  @Post('listings/:id/publish') @UseGuards(JwtAuthGuard) publish(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.publish(req.user.id, id, body); }
  @Post('listings/:id/checkout') @UseGuards(JwtAuthGuard) checkout(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.checkout(req.user.id, id, body); }
  @Post('webhook/:gateway') async webhook(@Req() req: any, @Param('gateway') gateway: WalletPaymentGateway, @Body() body: any) { return this.service.webhook(gateway, body, req.headers || {}); }
  @Patch('listings/:id/status') @UseGuards(JwtAuthGuard) status(@Req() req: any, @Param('id') id: string, @Body('status') status: string) { return this.service.ownerStatus(req.user.id, id, status); }
  @Delete('listings/:id') @UseGuards(JwtAuthGuard) remove(@Req() req: any, @Param('id') id: string) { return this.service.remove(req.user.id, id); }

  @Get('saved') @UseGuards(JwtAuthGuard) saved(@Req() req: any) { return this.service.saved(req.user.id); }
  @Post('listings/:id/save') @UseGuards(JwtAuthGuard) save(@Req() req: any, @Param('id') id: string) { return this.service.save(req.user.id, id); }
  @Delete('listings/:id/save') @UseGuards(JwtAuthGuard) unsave(@Req() req: any, @Param('id') id: string) { return this.service.unsave(req.user.id, id); }
  @Post('listings/:id/viewings') @UseGuards(JwtAuthGuard) requestViewing(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.requestViewing(req.user.id, id, body); }
  @Get('viewings/received') @UseGuards(JwtAuthGuard) received(@Req() req: any) { return this.service.receivedViewings(req.user.id); }
  @Patch('viewings/:id/status') @UseGuards(JwtAuthGuard) viewingStatus(@Req() req: any, @Param('id') id: string, @Body('status') status: string) { return this.service.viewingStatus(req.user.id, id, status); }
  @Post('listings/:id/report') @UseGuards(JwtAuthGuard) report(@Req() req: any, @Param('id') id: string, @Body() body: any) { return this.service.report(req.user.id, id, body); }

  @Get('admin/listings') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.staff) admin(@Query() query: any) { return this.service.adminList(query); }
  @Patch('admin/listings/:id/moderate') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.staff) moderate(@Param('id') id: string, @Body() body: any) { return this.service.moderate(id, body); }
  @Post('admin/types') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.staff) createType(@Body() body: any) { return this.service.createType(body); }
  @Patch('admin/types/:id') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.staff) updateType(@Param('id') id: string, @Body() body: any) { return this.service.updateType(id, body); }
  @Get('admin/plans') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.staff) adminPlans() { return this.service.adminPlans(); }
  @Post('admin/plans') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.staff) createPlan(@Body() body: any) { return this.service.createPlan(body); }
  @Patch('admin/plans/:id') @UseGuards(JwtAuthGuard, RolesGuard) @Roles(UserRole.admin, UserRole.staff) updatePlan(@Param('id') id: string, @Body() body: any) { return this.service.updatePlan(id, body); }
}
