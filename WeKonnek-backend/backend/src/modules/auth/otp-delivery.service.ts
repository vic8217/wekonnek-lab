import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsService } from './sms.service';

export type OtpChannel = 'viber' | 'sms' | 'whatsapp';

export class OtpDeliveryError extends Error {
  constructor(public readonly channel: OtpChannel) {
    super(`${channel} delivery unavailable`);
  }
}

/** Vendor boundary for OTP delivery. Controllers and registration UI never depend on a vendor SDK. */
@Injectable()
export class OtpDeliveryService {
  private readonly logger = new Logger(OtpDeliveryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly sms: SmsService,
  ) {}

  async send(channel: OtpChannel, to: string, code: string): Promise<void> {
    const message = `Your WeKonnek verification code is ${code}. It expires in 5 minutes.`;
    try {
      if (channel === 'sms') return await this.sms.sendSms(to, message);
      if (channel === 'viber') return await this.sendViber(to, message);
      return await this.sendWhatsApp(to, message);
    } catch (error) {
      this.logger.warn(`${channel} OTP delivery failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      throw new OtpDeliveryError(channel);
    }
  }

  private async sendViber(to: string, message: string) {
    const token = this.config.get<string>('VIBER_BOT_TOKEN');
    if (!token) throw new Error('Viber is not configured');
    const response = await fetch(this.config.get('VIBER_API_URL') || 'https://chatapi.viber.com/pa/send_message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Viber-Auth-Token': token },
      body: JSON.stringify({ receiver: to, type: 'text', text: message, sender: { name: this.config.get('VIBER_SENDER_NAME') || 'WeKonnek' } }),
    });
    if (!response.ok) throw new Error(`Viber returned ${response.status}`);
  }

  private async sendWhatsApp(to: string, message: string) {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.config.get<string>('TWILIO_WHATSAPP_FROM');
    if (!accountSid || !authToken || !from) throw new Error('WhatsApp is not configured');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const client = require('twilio')(accountSid, authToken);
    await client.messages.create({ body: message, from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`, to: `whatsapp:${to}` });
  }
}
