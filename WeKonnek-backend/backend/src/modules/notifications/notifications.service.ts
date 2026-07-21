import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { Notification, NotificationType } from '@prisma/client';

interface PushNotification {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private firebaseApp: any = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID');
    const privateKey = this.config.get<string>('FIREBASE_PRIVATE_KEY');
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL');

    if (!projectId || !privateKey || !clientEmail) {
      this.logger.warn(
        'Firebase credentials not set — push notifications disabled. ' +
          'Set FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, and FIREBASE_CLIENT_EMAIL in .env',
      );
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const admin = require('firebase-admin');

      if (!admin.apps.length) {
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            privateKey: privateKey.replace(/\\n/g, '\n'),
            clientEmail,
          }),
        });
        this.logger.log('Firebase Admin SDK initialized successfully');
      } else {
        this.firebaseApp = admin.app();
      }
    } catch (err) {
      this.logger.error(
        `Failed to initialize Firebase Admin SDK: ${err.message}`,
      );
    }
  }

  // ═══════════════════════════════════════════════════
  //  PERSISTENCE (in-app notification inbox)
  // ═══════════════════════════════════════════════════

  async createNotification(data: {
    userId: string;
    title: string;
    body: string;
    type?: NotificationType;
    data?: Record<string, string>;
    orderId?: string;
  }): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        title: data.title,
        body: data.body,
        type: data.type ?? NotificationType.system,
        data: data.data ?? undefined,
        orderId: data.orderId,
      },
    });
  }

  async getForUser(
    userId: string,
    opts: { limit?: number; offset?: number; unreadOnly?: boolean },
  ): Promise<{ data: Notification[]; total: number; unreadCount: number }> {
    const where: any = { userId };
    if (opts.unreadOnly) where.isRead = false;

    const [data, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: opts.limit ?? 30,
        skip: opts.offset ?? 0,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);

    return { data, total, unreadCount };
  }

  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { count };
  }

  async markAsRead(id: string): Promise<Notification> {
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    return { updated: result.count };
  }

  // ═══════════════════════════════════════════════════
  //  PUSH (Firebase Cloud Messaging)
  // ═══════════════════════════════════════════════════

  async sendPushNotification(notification: PushNotification): Promise<void> {
    if (!this.firebaseApp) {
      this.logger.debug(
        `[DEV] Push skipped (Firebase not configured): [${notification.title}] ${notification.body}`,
      );
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const admin = require('firebase-admin');
      await admin.messaging().send({
        token: notification.token,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: notification.data ?? {},
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        apns: {
          payload: { aps: { sound: 'default', badge: 1 } },
        },
      });
      this.logger.log(
        `Push sent to ${notification.token.substring(0, 20)}...`,
      );
    } catch (error) {
      this.logger.error(`Push notification failed: ${error.message}`);
    }
  }

  async sendToMultiple(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    await Promise.all(
      tokens.map((token) =>
        this.sendPushNotification({ token, title, body, data }),
      ),
    );
  }

  // ═══════════════════════════════════════════════════
  //  COMBINED — persist + push in one call
  // ═══════════════════════════════════════════════════

  async notify(params: {
    userId: string;
    fcmToken?: string;
    title: string;
    body: string;
    type?: NotificationType;
    data?: Record<string, string>;
    orderId?: string;
  }): Promise<Notification> {
    const notif = await this.createNotification({
      userId: params.userId,
      title: params.title,
      body: params.body,
      type: params.type,
      data: params.data,
      orderId: params.orderId,
    });

    if (params.fcmToken) {
      await this.sendPushNotification({
        token: params.fcmToken,
        title: params.title,
        body: params.body,
        data: params.data,
      });
    }

    return notif;
  }

  // ═══════════════════════════════════════════════════
  //  CONVENIENCE METHODS (order lifecycle)
  // ═══════════════════════════════════════════════════

  async notifyOrderPlaced(
    userId: string,
    fcmToken: string,
    orderNumber: string,
    orderId: string,
  ) {
    return this.notify({
      userId,
      fcmToken,
      title: 'Order Placed!',
      body: `Your order ${orderNumber} has been placed successfully.`,
      type: NotificationType.order_update,
      data: { type: 'order_placed', orderNumber },
      orderId,
    });
  }

  async notifyRiderAssigned(
    userId: string,
    fcmToken: string,
    orderNumber: string,
    riderName: string,
    orderId: string,
  ) {
    return this.notify({
      userId,
      fcmToken,
      title: 'Rider On The Way!',
      body: `${riderName} is heading to pick up your order ${orderNumber}.`,
      type: NotificationType.order_update,
      data: { type: 'rider_assigned', orderNumber },
      orderId,
    });
  }

  async notifyOrderDelivered(
    userId: string,
    fcmToken: string,
    orderNumber: string,
    orderId: string,
  ) {
    return this.notify({
      userId,
      fcmToken,
      title: 'Order Delivered!',
      body: `Your order ${orderNumber} has been delivered. Enjoy!`,
      type: NotificationType.order_update,
      data: { type: 'order_delivered', orderNumber },
      orderId,
    });
  }

  async notifyNewDeliveryJob(
    riderId: string,
    fcmToken: string,
    orderNumber: string,
    storeName: string,
    orderId: string,
  ) {
    return this.notify({
      userId: riderId,
      fcmToken,
      title: 'New Delivery Job!',
      body: `New delivery from ${storeName} (${orderNumber}). Accept now!`,
      type: NotificationType.order_update,
      data: { type: 'new_job', orderNumber },
      orderId,
    });
  }
}
