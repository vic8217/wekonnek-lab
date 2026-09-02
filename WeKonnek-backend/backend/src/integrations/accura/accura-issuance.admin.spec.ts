/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AccuraIssuanceJobStatus, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../modules/auth/guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../../modules/auth/guards/roles.guard';
import { AccuraIssuanceAdminController } from './accura-issuance.admin.controller';
import { AccuraIssuanceAdminService } from './accura-issuance.admin.service';
import { AccuraIssuanceJobsService } from './accura-issuance-jobs.service';
import { accuraInvoiceIdempotencyKey } from './accura-client.types';

describe('AccuraIssuanceAdminController authorization', () => {
  const retry = jest.fn(async () => ({
    status: AccuraIssuanceJobStatus.PENDING,
  }));
  const controller = new AccuraIssuanceAdminController({
    retryFailed: retry,
    getJob: jest.fn(),
    getJobForOrder: jest.fn(),
  } as unknown as AccuraIssuanceAdminService);
  const descriptor = Object.getOwnPropertyDescriptor(
    AccuraIssuanceAdminController.prototype,
    'retry',
  );
  const handler = descriptor?.value as unknown as () => unknown;
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    AccuraIssuanceAdminController,
  ) as unknown[];
  const roles =
    (Reflect.getMetadata(ROLES_KEY, handler) as UserRole[] | undefined) ??
    (Reflect.getMetadata(
      ROLES_KEY,
      AccuraIssuanceAdminController,
    ) as UserRole[]);
  const rolesGuard = new RolesGuard(new Reflector());

  const contextFor = (role?: UserRole): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => AccuraIssuanceAdminController,
      switchToHttp: () => ({
        getRequest: () => ({ user: role ? { role, id: 'user-1' } : undefined }),
      }),
    }) as unknown as ExecutionContext;

  it('guards issuance admin routes with JWT and admin role', () => {
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
    expect(roles).toEqual([UserRole.admin]);
    expect(rolesGuard.canActivate(contextFor(UserRole.customer))).toBe(false);
    expect(rolesGuard.canActivate(contextFor(UserRole.admin))).toBe(true);
  });

  it('invokes retry with the authenticated admin id', async () => {
    await controller.retry('job-1', { user: { id: 'admin-1' } });
    expect(retry).toHaveBeenCalledWith('job-1', 'admin-1');
  });
});

describe('AccuraIssuanceAdminService', () => {
  it('resets the same FAILED job to PENDING and writes an audit row', async () => {
    const job = {
      id: 'job-1',
      wkOrderId: 42,
      status: AccuraIssuanceJobStatus.FAILED,
      attemptCount: 6,
      nextAttemptAt: new Date(),
      processingStartedAt: null,
      lastAttemptAt: new Date(),
      lastErrorCategory: 'AUTH',
      lastHttpStatus: 401,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
      wkOrder: {
        orderCode: 'WK-ACC-42',
        paymentStatus: 'paid',
        accuraInvoice: null,
      },
    };
    const audits: any[] = [];
    const prisma = {
      accuraIssuanceJob: {
        findUnique: jest.fn(async () => ({ ...job })),
        updateMany: jest.fn(async ({ data }: any) => {
          Object.assign(job, data);
          return { count: 1 };
        }),
      },
      accuraIssuanceAuditEvent: {
        create: jest.fn(async ({ data }: any) => {
          audits.push(data);
          return data;
        }),
      },
    };
    const service = new AccuraIssuanceAdminService(
      prisma as never,
      new AccuraIssuanceJobsService(prisma as never),
    );
    const result = await service.retryFailed('job-1', 'admin-1');
    expect(job.status).toBe(AccuraIssuanceJobStatus.PENDING);
    expect(job.attemptCount).toBe(0);
    expect(result.id).toBe('job-1');
    expect(result.wkOrderId).toBe(42);
    expect(audits[0]).toMatchObject({
      result: 'MANUAL_RETRY',
      actorType: 'ADMIN',
      actorId: 'admin-1',
      jobId: 'job-1',
      wkOrderId: 42,
    });
    expect(accuraInvoiceIdempotencyKey(42)).toBe(
      'wekonnek:wkorder:42:accura-invoice',
    );
  });

  it('rejects unauthorized and non-FAILED retries', async () => {
    const service = new AccuraIssuanceAdminService(
      {
        accuraIssuanceJob: {
          findUnique: jest.fn(async () => ({
            id: 'job-1',
            status: AccuraIssuanceJobStatus.SUCCEEDED,
            wkOrder: { orderCode: 'WK-ACC-42' },
          })),
        },
      } as never,
      new AccuraIssuanceJobsService({} as never),
    );
    await expect(
      service.retryFailed('job-1', undefined),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.retryFailed('job-1', 'admin-1')).rejects.toThrow(
      'Only FAILED ACCURA issuance jobs can be retried',
    );
  });
});
