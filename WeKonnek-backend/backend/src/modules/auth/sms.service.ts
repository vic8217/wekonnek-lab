import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly config: ConfigService) {}

  async sendSms(to: string, message: string): Promise<void> {
    const provider = this.config.get('SMS_PROVIDER') || 'console';

    switch (provider) {
      case 'twilio':
        await this.sendViaTwilio(to, message);
        break;
      case 'semaphore':
        await this.sendViaSemaphore(to, message);
        break;
      default:
        // Console fallback for development
        this.logger.log(`📱 SMS to ${to}: ${message}`);
    }
  }

  private async sendViaTwilio(to: string, message: string): Promise<void> {
    try {
      const accountSid = this.config.get('TWILIO_ACCOUNT_SID');
      const authToken = this.config.get('TWILIO_AUTH_TOKEN');
      const from = this.config.get('TWILIO_PHONE_NUMBER');

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const twilio = require('twilio')(accountSid, authToken);
      await twilio.messages.create({ body: message, from, to });
      this.logger.log(`SMS sent to ${to} via Twilio`);
    } catch (error) {
      this.logger.error(`Failed to send SMS via Twilio: ${error}`);
      throw error;
    }
  }

  private async sendViaSemaphore(to: string, message: string): Promise<void> {
    try {
      const apiKey = this.config.get('SEMAPHORE_API_KEY');
      const response = await fetch('https://api.semaphore.co/api/v4/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apikey: apiKey,
          number: to,
          message,
          sendername: 'WEKONNEK',
        }),
      });
      this.logger.log(`SMS sent to ${to} via Semaphore: ${response.status}`);
    } catch (error) {
      this.logger.error(`Failed to send SMS via Semaphore: ${error}`);
      throw error;
    }
  }
}
