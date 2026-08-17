import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('devices')
  @ApiOperation({ summary: 'Register or refresh the current user device' })
  registerDevice(@Req() req: any, @Body() body: { fcmToken: string; platform?: string; deviceName?: string; browser?: string; operatingSystem?: string }) {
    return this.notificationsService.registerDevice(req.user.id, body);
  }

  @Get('devices')
  @ApiOperation({ summary: 'List active push devices for the current user' })
  getDevices(@Req() req: any) {
    return this.notificationsService.getDevices(req.user.id);
  }

  @Delete('devices/current')
  @ApiOperation({ summary: 'Deactivate the current browser push device' })
  deactivateCurrent(@Req() req: any, @Body('fcmToken') fcmToken: string) {
    return this.notificationsService.deactivateCurrentDevice(req.user.id, fcmToken);
  }

  @Get()
  @ApiOperation({ summary: 'Get notifications for the current user' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiQuery({ name: 'unreadOnly', required: false })
  getNotifications(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notificationsService.getForUser(req.user.id, {
      limit: limit ? parseInt(limit) : 30,
      offset: offset ? parseInt(offset) : 0,
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count' })
  getUnreadCount(@Req() req: any) {
    return this.notificationsService.getUnreadCount(req.user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markAsRead(@Req() req: any, @Param('id') id: string) {
    return this.notificationsService.markAsRead(req.user.id, id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllAsRead(@Req() req: any) {
    return this.notificationsService.markAllAsRead(req.user.id);
  }

  @Put(':id/read')
  markAsReadCompatibility(@Req() req: any, @Param('id') id: string) {
    return this.notificationsService.markAsRead(req.user.id, id);
  }

  @Put('read-all')
  markAllAsReadCompatibility(@Req() req: any) {
    return this.notificationsService.markAllAsRead(req.user.id);
  }
}
