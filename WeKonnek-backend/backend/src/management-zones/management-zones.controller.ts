import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { ManagementZonesService } from './management-zones.service';

@Controller('management-zones')
@UseGuards(JwtAuthGuard)
export class ManagementZonesController {
  constructor(private readonly service: ManagementZonesService) {}

  @Get() findAll() { return this.service.findAll(); }
  @Get('philippine-locations') locations() { return this.service.philippineLocations(); }
  @Get('philippine-locations/:localityCode/barangays')
  barangays(@Param('localityCode') localityCode: string) { return this.service.barangays(localityCode); }
  @Post() create(@Body() body: Record<string, unknown>) { return this.service.create(body); }
  @Patch(':id') update(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.service.remove(id); }
}
