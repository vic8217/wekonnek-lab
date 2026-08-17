import { ConfigService } from '@nestjs/config';
import { FirebasePushService, safeInternalPath, toFirebaseWebPushMessage } from './firebase-push.service';

describe('FirebasePushService', () => {
  it('defaults push delivery to disabled', async () => {
    const service = new FirebasePushService({ get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService);
    service.onModuleInit();
    expect(service.isEnabled()).toBe(false);
    await expect(service.send([{ token: 'token', title: 'Title', body: 'Body' }])).resolves.toEqual({ invalidTokens: [] });
  });

  it('rejects external and protocol-relative deep links', () => {
    expect(safeInternalPath('https://evil.example/path')).toBe('/');
    expect(safeInternalPath('//evil.example/path')).toBe('/');
    expect(safeInternalPath('/merchant/orders?tab=new')).toBe('/merchant/orders?tab=new');
  });

  it('serializes one data-only payload for the custom root service worker', () => {
    expect(toFirebaseWebPushMessage({
      token: 'device-token',
      title: 'New order received',
      body: 'Order WK-123 is ready',
      data: { kind: 'new_order', url: '/merchant/orders?orderId=123' },
    })).toEqual({
      token: 'device-token',
      data: {
        kind: 'new_order',
        title: 'New order received',
        body: 'Order WK-123 is ready',
        url: '/merchant/orders?orderId=123',
      },
      webpush: {
        headers: { Urgency: 'high' },
      },
    });
  });

  it('does not propagate an external actionable link', () => {
    const payload = toFirebaseWebPushMessage({ token: 'device-token', title: 'Title', body: 'Body', data: { url: 'https://evil.example' } });
    expect(payload.data.url).toBe('/');
    expect(payload).not.toHaveProperty('notification');
  });
});
