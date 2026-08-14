import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { UserRole } from '@prisma/client';
import { CoordinatorApplicationsService } from './coordinator-applications.service';

@Controller('coordinator-applications')
export class CoordinatorApplicationsController {
  constructor(private readonly service: CoordinatorApplicationsService) {}

  @Post()
  create(@Body() body: Record<string, unknown>) { return this.service.create(body); }

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() { return this.service.findAll(); }

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  stats() { return this.service.stats(); }

  @Get('commission-settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  commissionSettings() { return this.service.getCommissionSettings(); }

  @Patch('commission-settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin)
  updateCommissionSettings(@Body() body: { rate?: number }) { return this.service.updateCommissionSettings(body.rate); }

  @Get(':id/commission-ledger')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  commissionLedger(@Param('id', ParseIntPipe) id: number) { return this.service.commissionLedger(id); }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() body: { status: string; managementZoneId?: string | null }) { return this.service.updateStatus(id, body.status, body.managementZoneId); }

  @Patch(':id/suspend')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  suspend(@Param('id', ParseIntPipe) id: number) { return this.service.suspend(id); }

  @Post(':id/reset-key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  resetKey(@Param('id', ParseIntPipe) id: number) { return this.service.generateResetKey(id); }

  @Post('reset-password')
  resetPassword(@Body() body: { resetKey?: string; newPassword?: string }) {
    return this.service.resetPassword(body.resetKey ?? '', body.newPassword ?? '');
  }

  @Patch(':id/notes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  updateNotes(@Param('id', ParseIntPipe) id: number, @Body() body: { adminNotes?: string }) {
    return this.service.updateNotes(id, body.adminNotes ?? '');
  }
}
