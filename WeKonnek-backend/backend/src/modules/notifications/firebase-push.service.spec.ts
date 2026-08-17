import { ConfigService } from '@nestjs/config';
import { FirebasePushService, safeInternalPath } from './firebase-push.service';

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
});
