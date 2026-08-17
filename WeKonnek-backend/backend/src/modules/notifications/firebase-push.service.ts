import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export type PushMessage = { token: string; title: string; body: string; data?: Record<string, string> };
const PERMANENT_TOKEN_ERRORS = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument']);

@Injectable()
export class FirebasePushService implements OnModuleInit {
  private readonly logger = new Logger(FirebasePushService.name);
  private app: App | null = null;
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.enabled = this.config.get<string>('FIREBASE_PUSH_ENABLED') === 'true';
    if (!this.enabled) return void this.logger.log('Firebase push delivery is disabled');
    const projectId = this.config.get<string>('FIREBASE_PROJECT_ID')?.trim();
    const clientEmail = this.config.get<string>('FIREBASE_CLIENT_EMAIL')?.trim();
    const privateKey = this.config.get<string>('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) {
      this.enabled = false;
      return void this.logger.error('Firebase push was enabled but its environment configuration is incomplete');
    }
    try {
      this.app = getApps()[0] || initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
      this.logger.log('Firebase Admin push transport initialized');
    } catch (error) {
      this.enabled = false;
      this.logger.error(`Firebase push initialization failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  isEnabled() { return this.enabled && Boolean(this.app); }

  async send(messages: PushMessage[]): Promise<{ invalidTokens: string[] }> {
    if (!this.isEnabled() || messages.length === 0) return { invalidTokens: [] };
    const invalidTokens: string[] = [];
    for (let offset = 0; offset < messages.length; offset += 500) {
      const batch = messages.slice(offset, offset + 500);
      try {
        const response = await getMessaging(this.app!).sendEach(batch.map(message => ({
          token: message.token,
          notification: { title: message.title, body: message.body },
          data: message.data || {},
          webpush: { fcmOptions: { link: safeInternalPath(message.data?.url) } },
        })));
        response.responses.forEach((result, index) => {
          if (!result.success && PERMANENT_TOKEN_ERRORS.has(String(result.error?.code))) invalidTokens.push(batch[index].token);
        });
        if (response.failureCount) this.logger.warn(`Firebase push batch completed with ${response.failureCount} failed delivery attempt(s)`);
      } catch (error) {
        this.logger.warn(`Firebase push batch temporarily failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    return { invalidTokens };
  }
}

export function safeInternalPath(value?: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  try {
    const parsed = new URL(value, 'https://wekonnek.invalid');
    return parsed.origin === 'https://wekonnek.invalid' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/';
  } catch { return '/'; }
}
