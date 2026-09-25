import 'reflect-metadata';
import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import {
  CustomerDeliveryAuthorizationStatus,
  CustomerDeliveryHandoffPurpose,
  CustomerDeliveryHandoffTokenStatus,
  FulfillmentStatus,
  UserRole,
} from '@prisma/client';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { CustodyEventService } from '../agreements/custody-event.service';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { JwtStrategy } from '../modules/auth/strategies/jwt.strategy';
import { UsersService } from '../modules/users/users.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryHandoffController } from './delivery-handoff.controller';
import { DeliveryHandoffService } from './delivery-handoff.service';
import {
  encodeDeliveryQrPayload,
  hashDeliveryOtp,
  hashDeliverySecret,
} from './delivery-token';
import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

const SECRET = 'dev-secret';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MERCHANT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RIDER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ADMIN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TOKEN_ID = '11111111-1111-4111-8111-111111111111';
const FULFILLMENT_ID = '22222222-2222-4222-8222-222222222222';
const ASSIGNMENT_ID = '33333333-3333-4333-8333-333333333333';
const AUTHORIZATION_ID = '44444444-4444-4444-8444-444444444444';
const QR_SECRET = 'uce4-optional-jwt-repair-secret';
const OTP = '23456789';

const ACTORS = {
  owner: { id: OWNER, role: UserRole.customer },
  other: { id: OTHER, role: UserRole.customer },
  merchant: { id: MERCHANT, role: UserRole.merchant },
  rider: { id: RIDER, role: UserRole.rider },
  admin: { id: ADMIN, role: UserRole.admin },
} as const;

function httpContext(authorization?: string | string[]) {
  const headers: { authorization?: string | string[] } = {};
  if (authorization !== undefined) headers.authorization = authorization;
  const req = { headers };
  const context = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
  } as ExecutionContext;
  return { req, context };
}

function bearer(
  actor: { id: string; role: UserRole },
  opts?: { secret?: string; exp?: number },
) {
  const payload: { sub: string; role: UserRole; exp?: number } = {
    sub: actor.id,
    role: actor.role,
  };
  if (opts?.exp != null) payload.exp = opts.exp;
  const token = sign(
    payload,
    opts?.secret ?? SECRET,
    opts?.exp != null ? undefined : { expiresIn: '1h' },
  );
  return `Bearer ${token}`;
}

function expectUnauthenticated(err: unknown) {
  expect(err).toBeInstanceOf(UnauthorizedException);
  const body = JSON.stringify((err as UnauthorizedException).getResponse());
  expect(body).not.toMatch(/jwt expired|jwt malformed|invalid signature|No auth token/i);
}

describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard();

  it('permits a request with no Authorization header as anonymous', () => {
    const { req, context } = httpContext();
    expect(guard.canActivate(context)).toBe(true);
    expect(req).not.toHaveProperty('user');
  });

  it('rejects an empty Authorization header instead of treating it as anonymous', () => {
    const { context } = httpContext('');
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a whitespace Authorization header', () => {
    const { context } = httpContext('   ');
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects an empty Authorization header array', () => {
    const { context } = httpContext(['']);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('returns the authenticated user for a successful passport result', () => {
    const user = { id: OWNER, role: UserRole.customer };
    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('rejects the passport failure shape err=null user=false info=failure', () => {
    const info = { name: 'TokenExpiredError', message: 'jwt expired' };
    expect(() => guard.handleRequest(null, false, info)).toThrow(UnauthorizedException);
    try {
      guard.handleRequest(null, false, info);
    } catch (err) {
      expectUnauthenticated(err);
    }
  });

  it('rejects a passport Error info without exposing the JWT parser message', () => {
    const info = Object.assign(new Error('invalid signature'), {
      name: 'JsonWebTokenError',
    });
    try {
      guard.handleRequest(null, false, info);
      throw new Error('expected authentication failure');
    } catch (err) {
      expectUnauthenticated(err);
    }
  });

  it('rejects when passport reports err even if a user object is also present', () => {
    try {
      guard.handleRequest(new Error('jwt malformed'), { id: OWNER }, undefined);
      throw new Error('expected authentication failure');
    } catch (err) {
      expectUnauthenticated(err);
    }
  });
});

describe('delivery handoff optional JWT endpoints', () => {
  describe('alternate recipient', () => {
    const harness = boot('alternate');

    it('validates and confirms with QR and OTP when no Authorization header is supplied', async () => {
      const validated = await harness.hit('validate', harness.qrBody);
      expect(validated.status).toBe(201);
      expect(validated.body).toMatchObject({ ok: true, preview: { eligible: true } });
      expect(harness.effects.tokenReads).toBeGreaterThan(0);
      harness.expectNoMutation();

      harness.effects.reset();
      const confirmed = await harness.hit('confirm', harness.qrBody);
      expect(confirmed.status).toBe(201);
      expect(confirmed.body).toMatchObject({ ok: true, fulfillmentStatus: 'delivered' });
      expect(harness.effects.custodyWrites).toBe(1);
      expect(harness.effects.deliveredTransitions).toBe(1);
      expect(harness.effects.authorizationWrites).toBe(1);
      expect(harness.effects.tokenWrites).toBe(1);

      harness.effects.reset();
      const otpValidated = await harness.hit('validate', harness.otpBody);
      expect(otpValidated.status).toBe(201);
      expect(otpValidated.body.ok).toBe(true);
      harness.expectNoMutation();

      harness.effects.reset();
      const otpConfirmed = await harness.hit('confirm', harness.otpBody);
      expect(otpConfirmed.status).toBe(201);
      expect(otpConfirmed.body.ok).toBe(true);
      expect(harness.effects.custodyWrites).toBe(1);
    });

    it.each([
      ['validate', 'expired JWT', () => bearer(ACTORS.owner, { exp: pastExp() })],
      ['confirm', 'expired JWT', () => bearer(ACTORS.owner, { exp: pastExp() })],
      ['validate', 'malformed JWT', () => 'Bearer aaa.bbb.ccc'],
      ['confirm', 'malformed JWT', () => 'Bearer aaa.bbb.ccc'],
      ['validate', 'invalid-signature JWT', () => bearer(ACTORS.owner, { secret: 'wrong-secret' })],
      ['confirm', 'invalid-signature JWT', () => bearer(ACTORS.owner, { secret: 'wrong-secret' })],
      ['validate', 'garbage Authorization header', () => 'garbage'],
      ['confirm', 'garbage Authorization header', () => 'garbage'],
      ['validate', 'incomplete Bearer header', () => 'Bearer'],
      ['confirm', 'incomplete Bearer header', () => 'Bearer'],
      ['validate', 'blank Bearer credential', () => 'Bearer '],
      ['confirm', 'blank Bearer credential', () => 'Bearer '],
      ['validate', 'empty Authorization header', () => ''],
      ['confirm', 'empty Authorization header', () => ''],
    ] as const)(
      '%s rejects %s before anonymous delivery',
      async (endpoint, _label, header) => {
        const res = await harness.hit(endpoint, harness.qrBody, header());
        expect(res.status).toBe(401);
        expect(JSON.stringify(res.body)).not.toMatch(
          /jwt expired|jwt malformed|invalid signature|No auth token/i,
        );
        harness.expectNotEntered();
      },
    );

    it.each([
      ['validate', 'expired JWT', () => bearer(ACTORS.owner, { exp: pastExp() })],
      ['confirm', 'expired JWT', () => bearer(ACTORS.owner, { exp: pastExp() })],
      ['validate', 'malformed JWT', () => 'Bearer not-a-jwt'],
      ['confirm', 'malformed JWT', () => 'Bearer not-a-jwt'],
    ] as const)(
      '%s rejects %s presented with OTP',
      async (endpoint, _label, header) => {
        const res = await harness.hit(endpoint, harness.otpBody, header());
        expect(res.status).toBe(401);
        harness.expectNotEntered();
      },
    );

    it.each([
      ['validate', ACTORS.other, 'wrong customer'],
      ['confirm', ACTORS.other, 'wrong customer'],
      ['validate', ACTORS.merchant, 'merchant'],
      ['confirm', ACTORS.merchant, 'merchant'],
      ['validate', ACTORS.rider, 'rider'],
      ['confirm', ACTORS.rider, 'rider'],
      ['validate', ACTORS.admin, 'admin'],
      ['confirm', ACTORS.admin, 'admin'],
    ] as const)(
      '%s denies an authenticated %s without consuming delivery',
      async (endpoint, actor) => {
        const res = await harness.hit(endpoint, harness.qrBody, bearer(actor));
        expect(res.status).not.toBe(401);
        expect(res.body).toMatchObject({
          ok: false,
          code: 'CUSTOMER_UNAUTHORIZED',
        });
        expect(harness.effects.tokenReads).toBeGreaterThan(0);
        harness.expectNoMutation();
      },
    );

    it('denies an authenticated wrong customer presenting OTP', async () => {
      const res = await harness.hit('confirm', harness.otpBody, bearer(ACTORS.other));
      expect(res.body).toMatchObject({ ok: false, code: 'CUSTOMER_UNAUTHORIZED' });
      harness.expectNoMutation();
    });
  });

  describe('customer-self', () => {
    const harness = boot('self');

    it.each(['validate', 'confirm'] as const)(
      '%s succeeds for the owning customer JWT',
      async (endpoint) => {
        const res = await harness.hit(endpoint, harness.qrBody, bearer(ACTORS.owner));
        expect(res.status).toBe(201);
        expect(res.body.ok).toBe(true);
        expect(harness.effects.authorizationWrites).toBe(0);
        if (endpoint === 'confirm') {
          expect(harness.effects.custodyWrites).toBe(1);
          expect(harness.effects.deliveredTransitions).toBe(1);
          expect(harness.effects.tokenWrites).toBe(1);
        } else {
          harness.expectNoMutation();
        }
      },
    );

    it.each(['validate', 'confirm'] as const)(
      '%s fails without a JWT',
      async (endpoint) => {
        const res = await harness.hit(endpoint, harness.qrBody);
        expect(res.status).not.toBe(401);
        expect(res.body).toMatchObject({
          ok: false,
          code: 'CUSTOMER_UNAUTHORIZED',
        });
        harness.expectNoMutation();
      },
    );

    it.each([
      ['validate', 'expired JWT', () => bearer(ACTORS.owner, { exp: pastExp() })],
      ['confirm', 'expired JWT', () => bearer(ACTORS.owner, { exp: pastExp() })],
      ['validate', 'malformed JWT', () => 'Bearer aaa.bbb.ccc'],
      ['confirm', 'malformed JWT', () => 'Bearer aaa.bbb.ccc'],
      ['validate', 'invalid-signature JWT', () => bearer(ACTORS.owner, { secret: 'wrong-secret' })],
      ['confirm', 'invalid-signature JWT', () => bearer(ACTORS.owner, { secret: 'wrong-secret' })],
    ] as const)('%s fails for %s', async (endpoint, _label, header) => {
      const res = await harness.hit(endpoint, harness.qrBody, header());
      expect(res.status).toBe(401);
      harness.expectNotEntered();
    });

    it.each(['validate', 'confirm'] as const)(
      '%s denies a different customer',
      async (endpoint) => {
        const res = await harness.hit(endpoint, harness.qrBody, bearer(ACTORS.other));
        expect(res.body).toMatchObject({
          ok: false,
          code: 'CUSTOMER_UNAUTHORIZED',
        });
        harness.expectNoMutation();
      },
    );
  });
});

function pastExp() {
  return Math.floor(Date.now() / 1000) - 60;
}

function boot(mode: 'alternate' | 'self') {
  let app: INestApplication;
  const effects = {
    tokenReads: 0,
    tokenWrites: 0,
    authorizationWrites: 0,
    custodyWrites: 0,
    deliveredTransitions: 0,
    reset() {
      this.tokenReads = 0;
      this.tokenWrites = 0;
      this.authorizationWrites = 0;
      this.custodyWrites = 0;
      this.deliveredTransitions = 0;
    },
  };
  const fulfillment = {
    id: FULFILLMENT_ID,
    wkOrderId: 42,
    customerId: OWNER,
    status: FulfillmentStatus.in_transit,
    activeRiderId: RIDER,
    assignmentVersion: 3,
    physicalCustodianRiderId: RIDER,
    pendingCustodyIncomingRiderId: null,
  };
  const authorization = {
    id: AUTHORIZATION_ID,
    wkOrderId: 42,
    fulfillmentId: FULFILLMENT_ID,
    status: CustomerDeliveryAuthorizationStatus.ACTIVE,
    recipientDisplayName: 'Ana Cruz',
    recipientCategory: 'HOUSEHOLD_MEMBER',
  };
  const token = {
    id: TOKEN_ID,
    tokenHash: hashDeliverySecret(QR_SECRET),
    otpHash: hashDeliveryOtp(OTP),
    purpose: CustomerDeliveryHandoffPurpose.CUSTOMER_DELIVERY_HANDOFF,
    status: CustomerDeliveryHandoffTokenStatus.ACTIVE,
    expiresAt: new Date(Date.now() + 60_000),
    wkOrderId: 42,
    fulfillmentId: FULFILLMENT_ID,
    customerId: OWNER,
    deliveryRiderId: RIDER,
    riderAssignmentId: ASSIGNMENT_ID,
    assignmentVersion: 3,
    otpFailedAttempts: 0,
    otpLockedUntil: null,
    customerConfirmedByUserId: null,
    custodyEventId: null,
    confirmIdempotencyKey: null,
    authorizationId: mode === 'alternate' ? AUTHORIZATION_ID : null,
    fulfillment,
  };
  const db = {
    customerDeliveryHandoffToken: {
      findUnique: jest.fn(async (args: { where: { id?: string; confirmIdempotencyKey?: string } }) => {
        effects.tokenReads += 1;
        if (args.where.confirmIdempotencyKey) return null;
        return args.where.id === TOKEN_ID ? token : null;
      }),
      findUniqueOrThrow: jest.fn(async () => {
        effects.tokenReads += 1;
        return token;
      }),
      findFirst: jest.fn(async () => {
        effects.tokenReads += 1;
        return token;
      }),
      update: jest.fn(async () => {
        effects.tokenWrites += 1;
        return token;
      }),
    },
    orderFulfillment: {
      findUnique: jest.fn(async () => fulfillment),
      findUniqueOrThrow: jest.fn(async () => fulfillment),
    },
    wkOrder: {
      findUnique: jest.fn(async () => ({
        id: 42,
        status: 'preparing',
        userId: OWNER,
        orderCode: 'WK-42',
      })),
      findUniqueOrThrow: jest.fn(async () => ({
        id: 42,
        status: 'preparing',
        userId: OWNER,
        orderCode: 'WK-42',
      })),
    },
    riderAssignment: {
      findFirst: jest.fn(async () => ({ id: ASSIGNMENT_ID })),
    },
    customerDeliveryAuthorization: {
      findFirst: jest.fn(async () => (mode === 'alternate' ? authorization : null)),
      findUnique: jest.fn(async () => (mode === 'alternate' ? authorization : null)),
      updateMany: jest.fn(async () => {
        effects.authorizationWrites += 1;
        return { count: 1 };
      }),
    },
    redeliveryAuthorization: {
      findFirst: jest.fn(async () => null),
    },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };

  beforeAll(async () => {
    const users = new Map(Object.values(ACTORS).map((actor) => [actor.id, actor]));
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [DeliveryHandoffController],
      providers: [
        DeliveryHandoffService,
        JwtStrategy,
        {
          provide: UsersService,
          useValue: {
            findById: async (id: string) => users.get(id) ?? null,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'JWT_SECRET' ? SECRET : undefined),
          },
        },
        { provide: PrismaService, useValue: db },
        {
          provide: OrderDomainEventService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: CustodyEventService,
          useValue: {
            recordSecureCustomerDeliveryInTx: jest.fn(async () => {
              effects.custodyWrites += 1;
              return { id: 'custody-1' };
            }),
          },
        },
        {
          provide: FulfillmentTransitionService,
          useValue: {
            transitionInTx: jest.fn(async () => {
              effects.deliveredTransitions += 1;
              return { fulfillment: { status: 'delivered' } };
            }),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => effects.reset());

  afterAll(async () => {
    await app.close();
  });

  return {
    effects,
    qrBody: { qrPayload: encodeDeliveryQrPayload({ tokenId: TOKEN_ID, secret: QR_SECRET }) },
    otpBody: { otp: OTP, orderId: 42 },
    hit(
      endpoint: 'validate' | 'confirm',
      body: { qrPayload?: string; otp?: string; orderId?: number },
      authorization?: string,
    ) {
      const req = request(app.getHttpServer())
        .post(`/delivery-handoffs/${endpoint}`)
        .send(body);
      if (authorization !== undefined) req.set('Authorization', authorization);
      return req;
    },
    expectNoMutation() {
      expect(effects.tokenWrites).toBe(0);
      expect(effects.authorizationWrites).toBe(0);
      expect(effects.custodyWrites).toBe(0);
      expect(effects.deliveredTransitions).toBe(0);
    },
    expectNotEntered() {
      expect(effects.tokenReads).toBe(0);
      this.expectNoMutation();
    },
  };
}
