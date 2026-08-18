import { BadRequestException, Injectable } from '@nestjs/common';
import { Notification, NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { FirebasePushService, safeInternalPath } from './firebase-push.service';

type NotifyInput = { userId: string; title: string; body: string; type?: NotificationType; data?: Record<string, string>; orderId?: string; isRead?: boolean; replaceExistingOrder?: boolean };

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService, private readonly firebase: FirebasePushService) {}

  async registerDevice(userId: string, input: { fcmToken: string; platform?: string; deviceName?: string; browser?: string; operatingSystem?: string }) {
    const token = input.fcmToken?.trim();
    if (!token || token.length < 20 || token.length > 4096) throw new BadRequestException('A valid push token is required');
    const device = await this.prisma.pushDevice.upsert({
      where: { fcmToken: token },
      create: { userId, fcmToken: token, platform: input.platform || 'web', deviceName: input.deviceName, browser: input.browser, operatingSystem: input.operatingSystem },
      update: { userId, platform: input.platform || 'web', deviceName: input.deviceName, browser: input.browser, operatingSystem: input.operatingSystem, isActive: true, lastSeenAt: new Date() },
    });
    return { id: device.id, platform: device.platform, deviceName: device.deviceName, browser: device.browser, operatingSystem: device.operatingSystem, isActive: device.isActive, lastSeenAt: device.lastSeenAt, createdAt: device.createdAt };
  }

  getDevices(userId: string) {
    return this.prisma.pushDevice.findMany({ where: { userId, isActive: true }, select: { id: true, platform: true, deviceName: true, browser: true, operatingSystem: true, lastSeenAt: true, createdAt: true }, orderBy: { lastSeenAt: 'desc' } });
  }

  async deactivateCurrentDevice(userId: string, fcmToken: string) {
    if (!fcmToken) throw new BadRequestException('Push token is required');
    const result = await this.prisma.pushDevice.updateMany({ where: { userId, fcmToken, isActive: true }, data: { isActive: false, lastSeenAt: new Date() } });
    return { deactivated: result.count };
  }

  createNotification(data: NotifyInput): Promise<Notification> {
    return this.prisma.notification.create({ data: { userId: data.userId, title: data.title, body: data.body, type: data.type ?? NotificationType.system, data: data.data, orderId: data.orderId, isRead: data.isRead ?? false } });
  }

  async getForUser(userId: string, opts: { limit?: number; offset?: number; unreadOnly?: boolean }) {
    const limit = Math.max(1, Math.min(100, opts.limit ?? 30));
    const offset = Math.max(0, opts.offset ?? 0);
    const where = { userId, ...(opts.unreadOnly ? { isRead: false } : {}) };
    const [data, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, isRead: false } }),
    ]);
    return { data, total, unreadCount, limit, offset };
  }

  async getUnreadCount(userId: string) { return { count: await this.prisma.notification.count({ where: { userId, isRead: false } }) }; }

  async markAsRead(userId: string, id: string) {
    const result = await this.prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
    return { updated: result.count };
  }

  async markAllAsRead(userId: string) {
    const result = await this.prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    return { updated: result.count };
  }

  async notify(params: NotifyInput): Promise<Notification> {
    if (params.replaceExistingOrder && params.orderId) {
      await this.prisma.notification.deleteMany({ where: { userId: params.userId, orderId: params.orderId } });
    }
    const notification = await this.createNotification(params);
    await this.deliver(params).catch(() => undefined);
    return notification;
  }

  notifyUsers(userIds: string[], input: Omit<NotifyInput, 'userId'>) {
    return Promise.all([...new Set(userIds)].map(userId => this.notify({ ...input, userId })));
  }

  private async deliver(params: NotifyInput) {
    const devices = await this.prisma.pushDevice.findMany({ where: { userId: params.userId, isActive: true }, select: { fcmToken: true } });
    const data = Object.fromEntries(Object.entries(params.data || {}).map(([key, value]) => [key, String(value)]));
    data.url = safeInternalPath(data.url);
    const result = await this.firebase.send(devices.map(device => ({ token: device.fcmToken, title: params.title, body: params.body, data })));
    if (result.invalidTokens.length) await this.prisma.pushDevice.updateMany({ where: { fcmToken: { in: result.invalidTokens } }, data: { isActive: false } });
  }
}
