import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ExecutionContext } from '@nestjs/common';
import { DeliveryPartnersController } from './delivery-partners.controller';
import { DeliveryPartnersService } from './delivery-partners.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../modules/auth/guards/roles.guard';

describe('Lalamove test connection authorization', () => {
  const testConnection = jest.fn();
  const controller = new DeliveryPartnersController({
    testLalamoveConnection: testConnection,
  } as unknown as DeliveryPartnersService);
  const descriptor = Object.getOwnPropertyDescriptor(
    DeliveryPartnersController.prototype,
    'testLalamove',
  );
  const handler = descriptor?.value as unknown as () => unknown;
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    DeliveryPartnersController,
  ) as unknown[];
  const roles = Reflect.getMetadata(ROLES_KEY, handler) as UserRole[];
  const rolesGuard = new RolesGuard(new Reflector());

  const contextFor = (role?: UserRole): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => DeliveryPartnersController,
      switchToHttp: () => ({
        getRequest: () => ({ user: role ? { role } : undefined }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => jest.resetAllMocks());

  it('wires JwtAuthGuard and RolesGuard on the controller so unauthenticated routes are guarded', () => {
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  it('rejects an authenticated non-admin role through the actual RolesGuard metadata', () => {
    expect(roles).toEqual([UserRole.admin]);
    expect(rolesGuard.canActivate(contextFor(UserRole.customer))).toBe(false);
  });

  it('allows an admin through RolesGuard metadata and invokes the test service once', () => {
    testConnection.mockResolvedValue({ ok: true, status: 'CONNECTED' });
    expect(rolesGuard.canActivate(contextFor(UserRole.admin))).toBe(true);
    void controller.testLalamove({ user: { id: 'admin-id' } } as never);
    expect(testConnection).toHaveBeenCalledTimes(1);
    expect(testConnection).toHaveBeenCalledWith('admin-id');
  });
});
