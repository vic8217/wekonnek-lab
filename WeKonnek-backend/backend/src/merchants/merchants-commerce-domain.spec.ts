import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { CommerceDomain, UserRole } from '@prisma/client';
import { ExecutionContext } from '@nestjs/common';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../modules/auth/guards/roles.guard';

describe('merchant commerce-domain administration', () => {
  const setCommerceDomain = jest.fn();
  const controller = new MerchantsController({ setCommerceDomain } as never);
  const handler = Object.getOwnPropertyDescriptor(
    MerchantsController.prototype,
    'setCommerceDomain',
  )?.value as () => unknown;
  const contextFor = (role?: UserRole): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => MerchantsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: role ? { role } : undefined }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => jest.clearAllMocks());

  it('uses JWT and admin-only role metadata', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual(
      expect.arrayContaining([JwtAuthGuard, RolesGuard]),
    );
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.admin]);
    expect(
      new RolesGuard(new Reflector()).canActivate(
        contextFor(UserRole.merchant),
      ),
    ).toBe(false);
  });

  it.each([
    CommerceDomain.FOOD,
    CommerceDomain.NON_FOOD,
    CommerceDomain.MIXED,
    null,
  ])('passes %s to the guarded service', async (domain) => {
    setCommerceDomain.mockResolvedValue({ commerceDomain: domain });
    await expect(
      controller.setCommerceDomain(1, { commerceDomain: domain }),
    ).resolves.toEqual({ commerceDomain: domain });
  });

  it('rejects an invalid commerce domain before updating a merchant', async () => {
    const service = new MerchantsService(
      { merchant: { update: jest.fn() } } as never,
      {} as never,
    );
    await expect(
      service.setCommerceDomain(1, 'INVALID' as CommerceDomain),
    ).rejects.toThrow('Invalid commerce domain');
  });
});
