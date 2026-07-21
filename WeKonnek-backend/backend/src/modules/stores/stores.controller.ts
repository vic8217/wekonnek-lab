import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiQuery } from '@nestjs/swagger';
import { StoresService } from './stores.service';
import { StoreType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Stores')
@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  @ApiQuery({ name: 'type', required: false, enum: StoreType })
  findAll(@Query('type') type?: StoreType) {
    return this.storesService.findAll(type);
  }

  @Get('nearby')
  findNearby(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
    @Query('radius') radius?: number,
  ) {
    return this.storesService.findNearby(lat, lng, radius);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.storesService.findById(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() data: any) {
    return this.storesService.create(data);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.storesService.update(id, data);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Put(':id/toggle-open')
  toggleOpen(@Param('id') id: string) {
    return this.storesService.toggleOpen(id);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.storesService.delete(id);
  }
}
