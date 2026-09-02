import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AccuraWebhooksService } from './accura-webhooks.service';
import {
  ACCURA_EVENT_ID_HEADER,
  ACCURA_SIGNATURE_HEADER,
  ACCURA_TIMESTAMP_HEADER,
} from './accura-webhook.types';

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

@ApiTags('ACCURA')
@Controller('integrations/accura')
export class AccuraWebhooksController {
  constructor(private readonly webhooks: AccuraWebhooksService) {}

  @Post('webhooks')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'ACCURA invoice.issued webhook (HMAC + timestamp authenticated, no JWT)',
  })
  receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers(ACCURA_EVENT_ID_HEADER) eventId: string | string[] | undefined,
    @Headers(ACCURA_TIMESTAMP_HEADER) timestamp: string | string[] | undefined,
    @Headers(ACCURA_SIGNATURE_HEADER) signature: string | string[] | undefined,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException('Webhook authentication failed');
    }
    return this.webhooks.handleWebhook({
      rawBody,
      headers: {
        eventId: firstHeader(eventId),
        timestamp: firstHeader(timestamp),
        signature: firstHeader(signature),
      },
    });
  }
}
