import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiQuery, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

function stripPassword(user: any) {
  if (user && typeof user === 'object') {
    const { password, ...rest } = user;
    return rest;
  }
  return user;
}

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  async getProfile(@Req() req: any) {
    return stripPassword(await this.usersService.findById(req.user.id));
  }

  @Get('me')
  async getMe(@Req() req: any) {
    return stripPassword(await this.usersService.findById(req.user.id));
  }

  @Patch('me')
  async updateMe(@Req() req: any, @Body() data: any) {
    return this.usersService.updateProfile(req.user.id, data);
  }

  @Put('me')
  async putMe(@Req() req: any, @Body() data: any) {
    return this.usersService.updateProfile(req.user.id, data);
  }

  @Patch('me/password')
  async changePassword(
    @Req() req: any,
    @Body() body: { currentPassword?: string; current_password?: string; newPassword?: string; new_password?: string },
  ) {
    return this.usersService.changePassword(
      req.user.id,
      body.currentPassword ?? body.current_password ?? '',
      body.newPassword ?? body.new_password ?? '',
    );
  }

  // ─── 2FA Endpoints ─────────────────────────────

  @Get('me/2fa/status')
  get2faStatus(@Req() req: any) {
    return this.usersService.get2faStatus(req.user.id);
  }

  @Post('me/2fa/setup')
  setup2fa(@Req() req: any) {
    return this.usersService.setup2fa(req.user.id);
  }

  @Post('me/2fa/verify')
  verify2fa(@Req() req: any, @Body() body: { token: string }) {
    return this.usersService.verify2fa(req.user.id, body.token);
  }

  @Delete('me/2fa')
  disable2fa(@Req() req: any, @Body() body: { token: string }) {
    return this.usersService.disable2fa(req.user.id, body.token);
  }

  @Get('count')
  @ApiQuery({ name: 'role', required: false, enum: UserRole })
  async count(@Query('role') role?: UserRole) {
    const users = await this.usersService.findAll(role);
    return { count: Array.isArray(users) ? users.length : 0 };
  }

  @Put('profile')
  async updateProfile(@Req() req: any, @Body() data: any) {
    return this.usersService.update(req.user.id, data);
  }

  @Get()
  @ApiQuery({ name: 'role', required: false, enum: UserRole })
  findAll(@Query('role') role?: UserRole) {
    return this.usersService.findAll(role);
  }

  @Get('riders/online')
  getOnlineRiders() {
    return this.usersService.getOnlineRiders();
  }

  @Get('riders/available')
  @ApiQuery({ name: 'zoneId', required: true })
  @ApiOperation({ summary: 'Get online riders assigned to a zone' })
  getAvailableRiders(@Query('zoneId') zoneId: string) {
    return this.usersService.findAvailableRidersByZone(zoneId);
  }

  @Get('drivers/online')
  getOnlineDrivers() {
    return this.usersService.getOnlineDrivers();
  }

  @Patch(':id/zones')
  @ApiOperation({ summary: "Replace a rider's full set of zones (admin)" })
  setRiderZones(
    @Param('id') id: string,
    @Body() body: { zoneIds: string[] },
  ) {
    return this.usersService.setRiderZones(id, body.zoneIds || []);
  }

  @Post(':id/zones')
  @ApiOperation({ summary: 'Add a single zone to a rider (admin)' })
  addRiderZone(
    @Param('id') id: string,
    @Body() body: { zoneId: string },
  ) {
    return this.usersService.addRiderZone(id, body.zoneId);
  }

  @Delete(':id/zones/:zoneId')
  @ApiOperation({ summary: 'Remove a single zone from a rider (admin)' })
  removeRiderZone(
    @Param('id') id: string,
    @Param('zoneId') zoneId: string,
  ) {
    return this.usersService.removeRiderZone(id, zoneId);
  }

  @Patch(':id/zone')
  @ApiOperation({ summary: 'Legacy: set/clear a single zone for a rider (admin)' })
  assignZone(
    @Param('id') id: string,
    @Body() body: { zoneId: string | null },
  ) {
    return this.usersService.setRiderZones(id, body.zoneId ? [body.zoneId] : []);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Approve, reject, suspend or reinstate a rider (admin)' })
  setRiderStatus(
    @Param('id') id: string,
    @Body() body: { status: string; zoneIds?: string[] },
  ) {
    return this.usersService.setRiderStatus(id, body.status, body.zoneIds);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() data: any) {
    return this.usersService.update(id, data);
  }

  @Put(':id/location')
  updateLocation(
    @Param('id') id: string,
    @Body() body: { lat: number; lng: number },
  ) {
    return this.usersService.updateLocation(id, body.lat, body.lng);
  }

  @Put(':id/online')
  setOnline(@Param('id') id: string, @Body() body: { isOnline: boolean }) {
    return this.usersService.setOnline(id, body.isOnline);
  }
}
