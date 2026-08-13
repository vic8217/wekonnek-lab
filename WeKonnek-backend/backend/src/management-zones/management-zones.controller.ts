import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { ManagementZonesService } from './management-zones.service';

@Controller('management-zones')
export class ManagementZonesController {
  constructor(private readonly service: ManagementZonesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  findAll() { return this.service.findAll(); }
  @Get('philippine-locations') locations() { return this.service.philippineLocations(); }
  @Get('philippine-locations/:localityCode/barangays')
  barangays(@Param('localityCode') localityCode: string) { return this.service.barangays(localityCode); }
  @Get('geographic-boundaries')
  boundaries(@Query('areas') areas: string, @Query('city') city: string) { return this.service.geographicBoundaries(areas, city); }
  @Get('region-import/template')
  @UseGuards(JwtAuthGuard)
  @Header('Cache-Control', 'no-store')
  async regionImportTemplate(@Res() response: Response) {
    const pdf = await this.service.regionImportTemplate();
    response.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="wekonnek-region-import-template.pdf"' });
    response.send(pdf);
  }
  @Post('region-import/preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  previewRegionPdf(@UploadedFile() file?: Express.Multer.File) {
    if (!file || file.mimetype !== 'application/pdf') throw new BadRequestException('A PDF file is required');
    return this.service.previewRegionPdf(file.buffer);
  }
  @Post('region-import')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  importRegion(@Body() body: { rows?: unknown }) { return this.service.importRegionRows(body.rows); }
  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Body() body: Record<string, unknown>) { return this.service.create(body); }
  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) { return this.service.update(id, body); }
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string) { return this.service.remove(id); }
}
