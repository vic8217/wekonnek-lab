import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiQuery, ApiOperation } from '@nestjs/swagger';
import { ZonesService } from './zones.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Zones')
@Controller('zones')
export class ZonesController {
  constructor(private readonly zonesService: ZonesService) {}

  // ═══════════════════════════════════════════════════
  //  PUBLIC ENDPOINTS (no auth required)
  // ═══════════════════════════════════════════════════

  @Get('identify')
  @ApiOperation({
    summary: 'Identify which zone a coordinate falls in',
    description:
      'Pass lat/lng and get the zone (district, barangays, delivery fee). ' +
      'Example: /zones/identify?lat=14.5985&lng=120.9852 → District 3 (Binondo/Sta. Cruz/Quiapo/San Nicolas)',
  })
  @ApiQuery({ name: 'lat', type: Number, required: true })
  @ApiQuery({ name: 'lng', type: Number, required: true })
  identify(@Query('lat') lat: string, @Query('lng') lng: string) {
    return this.zonesService.identifyZone(parseFloat(lat), parseFloat(lng));
  }

  @Get('delivery-fee')
  @ApiOperation({
    summary: 'Calculate delivery fee between two coordinates',
    description:
      'Identifies zones for both pickup and delivery, then calculates fee based on distance and zone rates.',
  })
  @ApiQuery({ name: 'pickup_lat', type: Number })
  @ApiQuery({ name: 'pickup_lng', type: Number })
  @ApiQuery({ name: 'delivery_lat', type: Number })
  @ApiQuery({ name: 'delivery_lng', type: Number })
  calculateDeliveryFee(
    @Query('pickup_lat') pickupLat: string,
    @Query('pickup_lng') pickupLng: string,
    @Query('delivery_lat') deliveryLat: string,
    @Query('delivery_lng') deliveryLng: string,
  ) {
    return this.zonesService.calculateDeliveryFee(
      parseFloat(pickupLat),
      parseFloat(pickupLng),
      parseFloat(deliveryLat),
      parseFloat(deliveryLng),
    );
  }

  @Get('geojson')
  @ApiOperation({
    summary: 'Get all zones as GeoJSON FeatureCollection',
    description: 'Returns zones as GeoJSON for rendering on maps.',
  })
  getGeoJSON() {
    return this.zonesService.getGeoJSON();
  }

  @Get()
  @ApiOperation({ summary: 'List all zones' })
  @ApiQuery({ name: 'city', required: false })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  findAll(
    @Query('city') city?: string,
    @Query('active') active?: string,
  ) {
    return this.zonesService.findAll({
      city,
      isActive: active ? active === 'true' : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get zone by ID' })
  findOne(@Param('id') id: string) {
    return this.zonesService.findById(id);
  }

  @Get('code/:code')
  @ApiOperation({ summary: 'Get zone by code (e.g., MNL-D3)' })
  findByCode(@Param('code') code: string) {
    return this.zonesService.findByCode(code);
  }

  // ═══════════════════════════════════════════════════
  //  ADMIN ENDPOINTS (auth required)
  // ═══════════════════════════════════════════════════

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new zone (admin)' })
  create(@Body() data: any) {
    return this.zonesService.create(data);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a zone (admin)' })
  update(@Param('id') id: string, @Body() data: any) {
    return this.zonesService.update(id, data);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a zone (admin)' })
  remove(@Param('id') id: string) {
    return this.zonesService.delete(id);
  }

  @Put(':id/surge')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set surge multiplier for a zone (admin)' })
  setSurge(
    @Param('id') id: string,
    @Body() body: { multiplier: number },
  ) {
    return this.zonesService.setSurge(id, body.multiplier);
  }

  @Post('seed')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Seed Metro Manila district data',
    description:
      'Pre-populates zones with Manila Districts 1-6, Makati CBD, and BGC.',
  })
  seed() {
    return this.zonesService.seedManilaDistricts();
  }
}
