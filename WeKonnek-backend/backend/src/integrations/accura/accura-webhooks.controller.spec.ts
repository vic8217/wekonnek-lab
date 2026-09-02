/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccuraWebhooksController } from './accura-webhooks.controller';
import { AccuraWebhooksService } from './accura-webhooks.service';
import { computeAccuraHmacHex } from './accura-webhook.crypto';
import {
  ACCURA_INVOICE_ISSUED_EVENT,
  ACCURA_WEBHOOK_VERSION,
} from './accura-webhook.types';
import { PayCoolsCallbackController } from '../../payment-partners/paycools-callback.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderPayCoolsService } from '../../payment-partners/order-paycools.service';
import { PayCoolsProvider } from '../../payment-partners/paycools.provider';
import { WalletReloadService } from '../../payment-partners/wallet-reload.service';
import { CUSTOMER_ORDER_PAYMENT_PURPOSE } from '../../payment-partners/paycools-order-source';

const SECRET = 'accura-http-test-secret';

function invoiceBody(eventId = 'evt-http-1') {
  return {
    version: ACCURA_WEBHOOK_VERSION,
    eventId,
    eventType: ACCURA_INVOICE_ISSUED_EVENT,
    createdAt: '2026-09-01T12:00:00.000Z',
    data: {
      invoiceId: 'accura-inv-http',
      invoiceNumber: 'ACC-HTTP-1',
      status: 'ISSUED',
      issuedAt: '2026-09-01T11:59:00.000Z',
      documentHash: 'hash-http',
      sourceSystem: 'WEKONNEK',
      externalOrderId: '42',
      externalOrderCode: 'WK-ACC-42',
    },
  };
}

async function createAccuraApp(
  handleWebhook: AccuraWebhooksService['handleWebhook'],
) {
  const module = await Test.createTestingModule({
    controllers: [AccuraWebhooksController],
    providers: [
      { provide: AccuraWebhooksService, useValue: { handleWebhook } },
    ],
  }).compile();
  const app = module.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

describe('POST /api/integrations/accura/webhooks', () => {
  let app: INestApplication;
  const handleWebhook = jest.fn();

  beforeEach(async () => {
    handleWebhook.mockReset();
    handleWebhook.mockResolvedValue({
      outcome: 'processed',
      eventId: 'evt-http-1',
    });
    app = await createAccuraApp(handleWebhook);
  });

  afterEach(async () => {
    await app.close();
  });

  it('passes the exact raw body and ACCURA headers to the service', async () => {
    const body = invoiceBody();
    const raw = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v1=${computeAccuraHmacHex(SECRET, timestamp, Buffer.from(raw))}`;
    await request(app.getHttpServer())
      .post('/api/integrations/accura/webhooks')
      .set('Content-Type', 'application/json')
      .set('X-Accura-Event-Id', body.eventId)
      .set('X-Accura-Timestamp', timestamp)
      .set('X-Accura-Signature', signature)
      .send(raw)
      .expect(200);
    expect(handleWebhook).toHaveBeenCalledTimes(1);
    const argument = handleWebhook.mock.calls[0][0];
    expect(Buffer.isBuffer(argument.rawBody)).toBe(true);
    expect(argument.rawBody.equals(Buffer.from(raw))).toBe(true);
    expect(argument.headers).toEqual({
      eventId: body.eventId,
      timestamp,
      signature,
    });
  });

  it('rejects a missing raw body without calling durable processing', async () => {
    handleWebhook.mockRejectedValue(
      new UnauthorizedException('Webhook authentication failed'),
    );
    await request(app.getHttpServer())
      .post('/api/integrations/accura/webhooks')
      .set('X-Accura-Event-Id', 'evt-http-1')
      .set('X-Accura-Timestamp', '1')
      .set('X-Accura-Signature', 'v1=ab')
      .expect(401);
  });
});

describe('rawBody global regression — PayCools callback JSON parsing', () => {
  let app: INestApplication;
  const verifyWebhook = jest.fn();
  const settleVerified = jest.fn();

  beforeEach(async () => {
    verifyWebhook.mockReset();
    settleVerified.mockReset();
    verifyWebhook.mockResolvedValue({
      reference: 'WK260829TESTREF0001',
      providerTransactionId: 'pc-txn-1',
      amountMinor: 50000,
      status: 'PAID',
    });
    settleVerified.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      controllers: [PayCoolsCallbackController],
      providers: [
        {
          provide: PrismaService,
          useValue: {
            platformPaymentTransaction: {
              findUnique: async () => ({
                reference: 'WK260829TESTREF0001',
                metadata: { purpose: CUSTOMER_ORDER_PAYMENT_PURPOSE },
              }),
            },
          },
        },
        { provide: PayCoolsProvider, useValue: { verifyWebhook } },
        {
          provide: WalletReloadService,
          useValue: { settleVerified: jest.fn() },
        },
        { provide: OrderPayCoolsService, useValue: { settleVerified } },
      ],
    }).compile();

    app = module.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('still delivers a parsed JSON object to the PayCools callback', async () => {
    const payload = {
      eventName: 'qrcode.payment.success',
      mchOrderId: 'WK260829TESTREF0001',
      amount: 50000,
      sign: 'synthetic-sign',
    };
    await request(app.getHttpServer())
      .post('/api/payments/callbacks/paycools/payment')
      .send(payload)
      .expect(200)
      .expect({ code: 10000, message: 'Success' });
    expect(verifyWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        mchOrderId: 'WK260829TESTREF0001',
        amount: 50000,
        sign: 'synthetic-sign',
      }),
      expect.any(Object),
    );
    expect(settleVerified).toHaveBeenCalled();
  });
});
