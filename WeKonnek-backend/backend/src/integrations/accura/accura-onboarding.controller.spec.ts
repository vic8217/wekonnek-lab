/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../../modules/auth/guards/roles.guard';
import { AccuraOnboardingController } from './accura-onboarding.controller';
import { AccuraOnboardingService } from './accura-onboarding.service';

describe('AccuraOnboardingController authorization', () => {
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    AccuraOnboardingController,
  ) as unknown[];
  const roles = Reflect.getMetadata(
    ROLES_KEY,
    AccuraOnboardingController,
  ) as UserRole[];
  const rolesGuard = new RolesGuard(new Reflector());
  const descriptor = Object.getOwnPropertyDescriptor(
    AccuraOnboardingController.prototype,
    'getProfile',
  );
  const handler = descriptor?.value as unknown as () => unknown;
  const contextFor = (role?: UserRole): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => AccuraOnboardingController,
      switchToHttp: () => ({
        getRequest: () => ({ user: role ? { role, id: 'user-1' } : undefined }),
      }),
    }) as unknown as ExecutionContext;

  it('requires merchant JWT and rejects other roles', () => {
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
    expect(roles).toEqual([UserRole.merchant]);
    expect(rolesGuard.canActivate(contextFor(UserRole.merchant))).toBe(true);
    expect(rolesGuard.canActivate(contextFor(UserRole.customer))).toBe(false);
    expect(rolesGuard.canActivate(contextFor(UserRole.coordinator))).toBe(false);
    expect(rolesGuard.canActivate(contextFor(UserRole.admin))).toBe(false);
  });
});

describe('AccuraOnboardingController HTTP', () => {
  let app: INestApplication;
  let currentUser: { id: string; role: UserRole; portal?: string } | null;
  const getSetup = jest.fn();
  const saveProfile = jest.fn();
  const submit = jest.fn();
  const mapShop = jest.fn();
  const uploadDocument = jest.fn();

  beforeEach(async () => {
    currentUser = { id: 'user-a', role: UserRole.merchant };
    getSetup.mockReset().mockResolvedValue({
      unavailable: false,
      profile: { legalName: 'ABC FOOD CORPORATION' },
      documents: [],
    });
    saveProfile.mockReset().mockResolvedValue({ unavailable: false });
    submit.mockReset().mockResolvedValue({ status: { reviewStatus: 'SUBMITTED' } });
    mapShop.mockReset().mockResolvedValue({ shops: [] });
    uploadDocument.mockReset().mockResolvedValue({ documents: [] });
    const module = await Test.createTestingModule({
      controllers: [AccuraOnboardingController],
      providers: [
        {
          provide: AccuraOnboardingService,
          useValue: {
            getSetup,
            saveProfile,
            getReadiness: jest.fn(),
            listBranches: jest.fn(),
            createBranch: jest.fn(),
            updateBranch: jest.fn(),
            mapShop,
            submit,
            uploadDocument,
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          if (!currentUser) return false;
          req.user = currentUser;
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
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

  it('loads profile for the authenticated merchant only', async () => {
    await request(app.getHttpServer())
      .get('/api/integrations/accura/onboarding/profile')
      .expect(200);
    expect(getSetup).toHaveBeenCalledWith({
      id: 'user-a',
      role: UserRole.merchant,
    });
  });

  it('saves a draft and submits through the WeKonnek proxy', async () => {
    await request(app.getHttpServer())
      .patch('/api/integrations/accura/onboarding/profile')
      .send({ legalName: 'ABC FOOD CORPORATION', classification: 'VAT' })
      .expect(200);
    expect(saveProfile).toHaveBeenCalledWith(
      { id: 'user-a', role: UserRole.merchant },
      expect.objectContaining({ legalName: 'ABC FOOD CORPORATION' }),
    );
    await request(app.getHttpServer())
      .post('/api/integrations/accura/onboarding/submit')
      .expect(201);
    expect(submit).toHaveBeenCalledWith({
      id: 'user-a',
      role: UserRole.merchant,
    });
  });

  it('rejects unknown fields and maps shops without accepting a merchantId body', async () => {
    await request(app.getHttpServer())
      .patch('/api/integrations/accura/onboarding/profile')
      .send({ legalName: 'ABC', companyId: 'someone-else' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/integrations/accura/onboarding/shop-mappings')
      .send({ shopId: 7, accuraBranchId: 'br-1', merchantId: 22 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/integrations/accura/onboarding/shop-mappings')
      .send({ shopId: 7, accuraBranchId: 'br-1' })
      .expect(201);
    expect(mapShop).toHaveBeenCalledWith(
      { id: 'user-a', role: UserRole.merchant },
      { shopId: 7, accuraBranchId: 'br-1' },
    );
  });

  it('proxies document upload without exposing ACCURA storage keys', async () => {
    await request(app.getHttpServer())
      .post('/api/integrations/accura/onboarding/documents')
      .field('documentType', 'BIR_CERTIFICATE_OF_REGISTRATION')
      .attach('file', Buffer.from('%PDF-1.4 test'), 'cor.pdf')
      .expect(201);
    expect(uploadDocument).toHaveBeenCalledWith(
      { id: 'user-a', role: UserRole.merchant },
      expect.objectContaining({ originalname: 'cor.pdf' }),
      'BIR_CERTIFICATE_OF_REGISTRATION',
    );
  });
});
