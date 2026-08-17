import { NotificationType } from '@prisma/client';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const prisma: any = {
    pushDevice: { upsert: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    notification: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
  };
  const firebase: any = { send: jest.fn() };
  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationsService(prisma, firebase);
    prisma.pushDevice.findMany.mockResolvedValue([]);
    prisma.pushDevice.updateMany.mockResolvedValue({ count: 0 });
    firebase.send.mockResolvedValue({ invalidTokens: [] });
  });

  it('registers a token idempotently and assigns ownership from the authenticated user', async () => {
    prisma.pushDevice.upsert.mockResolvedValue({ id: 'device' });
    await service.registerDevice('user-a', { fcmToken: 'a'.repeat(40), platform: 'web' });
    expect(prisma.pushDevice.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { fcmToken: 'a'.repeat(40) },
      create: expect.objectContaining({ userId: 'user-a' }),
      update: expect.objectContaining({ userId: 'user-a', isActive: true }),
    }));
  });

  it('supports multiple devices by upserting each distinct token', async () => {
    prisma.pushDevice.upsert.mockResolvedValue({});
    await service.registerDevice('user-a', { fcmToken: 'a'.repeat(40) });
    await service.registerDevice('user-a', { fcmToken: 'b'.repeat(40) });
    expect(prisma.pushDevice.upsert).toHaveBeenCalledTimes(2);
  });

  it('reassigns a rotated/shared-browser token to the currently authenticated account', async () => {
    const row = { id: 'device', userId: 'user-a', fcmToken: 'a'.repeat(40), isActive: true };
    prisma.pushDevice.upsert.mockImplementation(({ update }: any) => Object.assign(row, update));
    await service.registerDevice('user-b', { fcmToken: 'a'.repeat(40) });
    expect(prisma.pushDevice.upsert.mock.calls[0][0].update.userId).toBe('user-b');
    expect(prisma.pushDevice.upsert.mock.calls[0][0].update.isActive).toBe(true);
    expect(row).toEqual(expect.objectContaining({ userId: 'user-b', isActive: true }));
  });

  it('deactivates only a token owned by the authenticated user', async () => {
    prisma.pushDevice.updateMany.mockResolvedValue({ count: 1 });
    await service.deactivateCurrentDevice('user-a', 'a'.repeat(40));
    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 'user-a', fcmToken: 'a'.repeat(40) }) }));
  });

  it('scopes history, unread count, mark-read, and mark-all to the owner', async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    await service.getForUser('user-a', { limit: 20 });
    await service.getUnreadCount('user-a');
    await service.markAsRead('user-a', 'notification-b');
    await service.markAllAsRead('user-a');
    expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-a' } }));
    expect(prisma.notification.updateMany).toHaveBeenNthCalledWith(1, { where: { id: 'notification-b', userId: 'user-a' }, data: { isRead: true } });
    expect(prisma.notification.updateMany).toHaveBeenNthCalledWith(2, { where: { userId: 'user-a', isRead: false }, data: { isRead: true } });
  });

  it('persists first and sends to every active registered device', async () => {
    const saved = { id: 'notification' } as any;
    prisma.notification.create.mockResolvedValue(saved);
    prisma.pushDevice.findMany.mockResolvedValue([{ fcmToken: 'token-a' }, { fcmToken: 'token-b' }]);
    await expect(service.notify({ userId: 'user-a', title: 'New order', body: 'Order received', type: NotificationType.order_update, data: { url: '/merchant/orders' } })).resolves.toBe(saved);
    expect(prisma.notification.create.mock.invocationCallOrder[0]).toBeLessThan(prisma.pushDevice.findMany.mock.invocationCallOrder[0]);
    expect(firebase.send).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ token: 'token-a' }), expect.objectContaining({ token: 'token-b' })]));
  });

  it('deactivates only permanently invalid Firebase tokens', async () => {
    prisma.notification.create.mockResolvedValue({ id: 'notification' });
    prisma.pushDevice.findMany.mockResolvedValue([{ fcmToken: 'invalid-token' }]);
    firebase.send.mockResolvedValue({ invalidTokens: ['invalid-token'] });
    await service.notify({ userId: 'user-a', title: 'Update', body: 'Body' });
    expect(prisma.pushDevice.updateMany).toHaveBeenCalledWith({ where: { fcmToken: { in: ['invalid-token'] } }, data: { isActive: false } });
  });

  it('does not fail a persisted notification when Firebase temporarily fails', async () => {
    prisma.notification.create.mockResolvedValue({ id: 'notification' });
    prisma.pushDevice.findMany.mockResolvedValue([{ fcmToken: 'token' }]);
    firebase.send.mockRejectedValue(new Error('timeout'));
    await expect(service.notify({ userId: 'user-a', title: 'Update', body: 'Body' })).resolves.toEqual({ id: 'notification' });
    expect(prisma.pushDevice.updateMany).not.toHaveBeenCalled();
  });
});
