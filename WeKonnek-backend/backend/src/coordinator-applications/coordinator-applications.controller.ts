import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
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

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() body: { status: string; managementZoneId?: string | null }) { return this.service.updateStatus(id, body.status, body.managementZoneId); }
}
