import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomerDeliveryHandoffTokenStatus,
  DeliveryAttemptOutcome,
  FulfillmentStatus,
  OperationalCaseEventType,
  OperationalCaseStatus,
  OperationalCaseType,
  Prisma,
  RedeliveryAddressMode,
  RedeliveryAuthorizationStatus,
  RedeliveryCustomerAuthMethod,
  ReturnFinancialDeterminationStatus,
  ReturnFinancialObligationStatus,
  RiderAssignmentStatus,
  UserRole,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { AuthActorService } from '../fulfillment/auth-actor.service';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  evaluateRedeliveryAttemptCollectibility,
  MAX_DELIVERY_ATTEMPTS,
  REDELIVERY_ADDRESS_MODE_SAME_AS_ORDER,
  REDELIVERY_BLOCKING_DETERMINATION_STATUSES,
  REDELIVERY_TIMEZONE,
  REDELIVERY_WINDOW_MAX_AHEAD_MS,
  REDELIVERY_WINDOW_MAX_MS,
  REDELIVERY_WINDOW_MIN_MS,
} from './redelivery.policy';

function stablePayloadHash(parts: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex');
}

const OPEN_AUTH_STATUSES: RedeliveryAuthorizationStatus[] = [
  RedeliveryAuthorizationStatus.REQUESTED,
  RedeliveryAuthorizationStatus.CONFIRMED,
];

@Injectable()
export class RedeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
    private readonly transitions: FulfillmentTransitionService,
    private readonly authActors: AuthActorService,
  ) {}

  private async withSerializableRetry<T>(
    run: () => Promise<T>,
    attempts = 5,
  ): Promise<T> {
    let last: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await run();
      } catch (err) {
        last = err;
        const retryable =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          (err.code === 'P2034' ||
            err.code === 'P2002' ||
            (err.code === 'P2010' &&
              /could not serialize|40001|40P01|concurrent update|deadlock/i.test(
                err.message,
              )));
        if (!retryable || i === attempts - 1) throw err;
      }
    }
    throw last;
  }

  /**
   * Lock order (Stage 10 — compatible with Stages 5A/7/8/9):
   * 1. orders (wkOrder)
   * 2. order_fulfillments
   * 3. redelivery_authorizations
   * Secondary under fulfillment: operational_cases, customer_delivery_handoff_tokens
   * (never lock token/auth before order+fulfillment in Stage 10 paths).
   */
  private async lockOrderAndFulfillment(
    tx: Prisma.TransactionClient,
    wkOrderId: number,
  ) {
    await tx.$queryRaw`
      SELECT id FROM "orders" WHERE id = ${wkOrderId} FOR UPDATE
    `;
    const order = await tx.wkOrder.findUnique({ where: { id: wkOrderId } });
    if (!order) throw new NotFoundException('Order not found');

    const fulfillment = await tx.orderFulfillment.findUnique({
      where: { wkOrderId: order.id },
    });
    if (!fulfillment || fulfillment.wkOrderId == null) {
      throw new ForbiddenException({
        code: 'FULFILLMENT_MISSING',
        message: 'Marketplace fulfillment required',
      });
    }
    await tx.$queryRaw`
      SELECT id FROM "order_fulfillments" WHERE id = ${fulfillment.id}::uuid FOR UPDATE
    `;
    const locked = await tx.orderFulfillment.findUniqueOrThrow({
      where: { id: fulfillment.id },
    });
    return { order, fulfillment: locked };
  }

  private async lockAuthorization(
    tx: Prisma.TransactionClient,
    id: string,
  ) {
    await tx.$queryRaw`
      SELECT id FROM "redelivery_authorizations" WHERE id = ${id}::uuid FOR UPDATE
    `;
    return tx.redeliveryAuthorization.findUnique({ where: { id } });
  }

  private async countFailedAttempts(
    tx: Prisma.TransactionClient,
    fulfillmentId: string,
  ): Promise<number> {
    return tx.deliveryAttempt.count({
      where: {
        fulfillmentId,
        outcome: DeliveryAttemptOutcome.FAILED,
      },
    });
  }

  private buildAddressSnapshot(order: {
    deliveryAddress: string | null;
    customerBarangay: string | null;
    deliveryZoneName: string | null;
  }) {
    return {
      mode: REDELIVERY_ADDRESS_MODE_SAME_AS_ORDER,
      deliveryAddress: order.deliveryAddress,
      customerBarangay: order.customerBarangay,
      deliveryZoneName: order.deliveryZoneName,
    };
  }

  /** A SAME_AS_ORDER authorization is bound to the requested destination.
   * Never silently substitute a later order-address edit at confirmation or
   * activation time. */
  private assertAddressSnapshotCurrent(
    order: {
      deliveryAddress: string | null;
      customerBarangay: string | null;
      deliveryZoneName: string | null;
    },
    snapshot: Prisma.JsonValue,
  ) {
    if (JSON.stringify(this.buildAddressSnapshot(order)) !== JSON.stringify(snapshot)) {
      throw new ConflictException({
        code: 'REDELIVERY_ADDRESS_SNAPSHOT_STALE',
        message:
          'Order delivery address changed after redelivery was requested; request a new authorization',
      });
    }
  }

  private assertWindow(windowStart: Date, windowEnd: Date, now: Date) {
    if (!(windowStart instanceof Date) || Number.isNaN(windowStart.getTime())) {
      throw new BadRequestException({
        code: 'REDELIVERY_WINDOW_INVALID',
        message: 'windowStart must be a valid timestamp',
      });
    }
    if (!(windowEnd instanceof Date) || Number.isNaN(windowEnd.getTime())) {
      throw new BadRequestException({
        code: 'REDELIVERY_WINDOW_INVALID',
        message: 'windowEnd must be a valid timestamp',
      });
    }
    if (windowStart.getTime() <= now.getTime()) {
      throw new BadRequestException({
        code: 'REDELIVERY_WINDOW_INVALID',
        message: 'windowStart must be in the future',
      });
    }
    if (windowStart.getTime() - now.getTime() > REDELIVERY_WINDOW_MAX_AHEAD_MS) {
      throw new BadRequestException({
        code: 'REDELIVERY_WINDOW_INVALID',
        message: 'windowStart must be within 7 days',
      });
    }
    const duration = windowEnd.getTime() - windowStart.getTime();
    if (duration < REDELIVERY_WINDOW_MIN_MS) {
      throw new BadRequestException({
        code: 'REDELIVERY_WINDOW_INVALID',
        message: 'Redelivery window must be at least 1 hour',
      });
    }
    if (duration > REDELIVERY_WINDOW_MAX_MS) {
      throw new BadRequestException({
        code: 'REDELIVERY_WINDOW_INVALID',
        message: 'Redelivery window must be at most 4 hours',
      });
    }
  }

  private async assertEligibilityGates(
    tx: Prisma.TransactionClient,
    fulfillment: {
      id: string;
      status: FulfillmentStatus;
      pendingCustodyIncomingRiderId: string | null;
    },
    wkOrderId: number,
  ) {
    if (fulfillment.status === FulfillmentStatus.returning) {
      throw new ForbiddenException({
        code: 'REDELIVERY_RETURN_IN_PROGRESS',
        message: 'Redelivery blocked while return path is selected',
      });
    }

    if (fulfillment.status === FulfillmentStatus.returned) {
      const returnReceived = await tx.custodyEvent.count({
        where: {
          fulfillmentId: fulfillment.id,
          eventType: 'RETURN_RECEIVED',
        },
      });
      if (returnReceived > 0) {
        throw new ForbiddenException({
          code: 'REDELIVERY_TERMINAL_RETURN',
          message: 'returned + RETURN_RECEIVED is terminal for redelivery',
        });
      }
      throw new ForbiddenException({
        code: 'REDELIVERY_TERMINAL_RETURN',
        message: 'returned fulfillment cannot be rescheduled for delivery',
      });
    }

    if (fulfillment.status !== FulfillmentStatus.delivery_failed) {
      throw new ForbiddenException({
        code: 'REDELIVERY_NOT_ELIGIBLE',
        message: 'Fulfillment must be delivery_failed to request redelivery',
      });
    }

    if (fulfillment.pendingCustodyIncomingRiderId) {
      throw new ForbiddenException({
        code: 'REDELIVERY_CUSTODY_TRANSFER_REQUIRED',
        message:
          'Pending Stage 7 custody transfer must complete before redelivery',
      });
    }

    const blockingDet = await tx.returnFinancialDetermination.findFirst({
      where: {
        wkOrderId,
        status: {
          in: [
            ...REDELIVERY_BLOCKING_DETERMINATION_STATUSES,
          ] as ReturnFinancialDeterminationStatus[],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (blockingDet) {
      if (
        blockingDet.status === ReturnFinancialDeterminationStatus.FINALIZED
      ) {
        throw new ForbiddenException({
          code: 'REDELIVERY_FINANCIAL_RESOLUTION_FINALIZED',
          message:
            'Stage 9 FINALIZED determination blocks redelivery; financial resolution is active',
        });
      }
      throw new ForbiddenException({
        code: 'REDELIVERY_RETURN_FINANCIAL_PATH_ACTIVE',
        message: `Stage 9 determination in ${blockingDet.status} blocks redelivery`,
      });
    }

    const openObl = await tx.returnFinancialObligation.count({
      where: {
        wkOrderId,
        status: {
          in: [
            ReturnFinancialObligationStatus.OPEN,
            ReturnFinancialObligationStatus.PARTIALLY_SETTLED,
          ],
        },
      },
    });
    if (openObl > 0) {
      throw new ForbiddenException({
        code: 'REDELIVERY_RETURN_FINANCIAL_PATH_ACTIVE',
        message: 'Open return financial obligations block redelivery',
      });
    }
  }

  private async assertViewer(
    order: { id: number; userId: string; merchantId: number },
    fulfillment: {
      customerId: string | null;
      merchantId: number | null;
      activeRiderId: string | null;
    },
    actorUserId: string,
  ): Promise<'CUSTOMER' | 'MERCHANT' | 'RIDER' | 'ADMIN'> {
    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
    });
    if (!user) {
      throw new ForbiddenException({
        code: 'REDELIVERY_FORBIDDEN',
        message: 'Not authorized',
      });
    }
    if (user.role === UserRole.admin || user.role === UserRole.staff) {
      return 'ADMIN';
    }
    if (
      fulfillment.customerId === actorUserId ||
      order.userId === actorUserId
    ) {
      return 'CUSTOMER';
    }
    if (fulfillment.activeRiderId === actorUserId) {
      return 'RIDER';
    }
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: order.merchantId },
    });
    if (merchant?.userId === actorUserId) return 'MERCHANT';
    const staff = await this.prisma.merchantStaff.findFirst({
      where: {
        userId: actorUserId,
        merchantId: order.merchantId,
        isActive: true,
      },
    });
    if (staff) return 'MERCHANT';
    throw new ForbiddenException({
      code: 'REDELIVERY_FORBIDDEN',
      message: 'Not authorized to view or mutate redelivery for this order',
    });
  }

  async lazyExpireAuthorization<
    T extends {
      id: string;
      status: RedeliveryAuthorizationStatus;
      windowEnd: Date;
    },
  >(
    tx: Prisma.TransactionClient,
    auth: T,
    now: Date,
    actorUserId: string,
    correlationId?: string,
  ): Promise<T | Awaited<ReturnType<Prisma.TransactionClient['redeliveryAuthorization']['update']>>> {
    if (
      (auth.status === RedeliveryAuthorizationStatus.REQUESTED ||
        auth.status === RedeliveryAuthorizationStatus.CONFIRMED) &&
      auth.windowEnd.getTime() < now.getTime()
    ) {
      const expired = await tx.redeliveryAuthorization.update({
        where: { id: auth.id },
        data: {
          status: RedeliveryAuthorizationStatus.EXPIRED,
          expiredAt: now,
        },
      });
      await this.events.record({
        tx,
        aggregateType: 'ORDER_FULFILLMENT',
        aggregateId: expired.fulfillmentId,
        wkOrderId: expired.wkOrderId,
        fulfillmentId: expired.fulfillmentId,
        actorId: actorUserId,
        actorType: 'INTERNAL_SERVICE',
        action: 'REDELIVERY_AUTHORIZATION_EXPIRED',
        previousState: auth.status,
        newState: RedeliveryAuthorizationStatus.EXPIRED,
        reason: 'lazy_window_expiry',
        correlationId,
        metadata: { redeliveryAuthorizationId: auth.id },
      });
      return expired;
    }
    return auth;
  }

  async request(input: {
    wkOrderId: number;
    actorUserId: string;
    windowStart: string | Date;
    windowEnd: string | Date;
    timezone?: string;
    addressMode?: string;
    deliveryAddress?: string;
    correlationId?: string;
    idempotencyKey?: string;
  }) {
    const now = new Date();
    const windowStart = new Date(input.windowStart);
    const windowEnd = new Date(input.windowEnd);
    this.assertWindow(windowStart, windowEnd, now);

    const tz = String(input.timezone ?? REDELIVERY_TIMEZONE).trim();
    if (tz !== REDELIVERY_TIMEZONE) {
      throw new BadRequestException({
        code: 'INVALID_TIMEZONE',
        message: `timezone must be ${REDELIVERY_TIMEZONE}`,
      });
    }

    if (
      input.addressMode != null &&
      String(input.addressMode) !== REDELIVERY_ADDRESS_MODE_SAME_AS_ORDER
    ) {
      throw new ForbiddenException({
        code: 'REDELIVERY_ADDRESS_CHANGE_NOT_SUPPORTED',
        message: 'Only SAME_AS_ORDER address mode is supported',
      });
    }
    if (input.deliveryAddress != null && String(input.deliveryAddress).trim()) {
      throw new ForbiddenException({
        code: 'REDELIVERY_ADDRESS_CHANGE_NOT_SUPPORTED',
        message: 'Address changes are not allowed for Stage 10 redelivery',
      });
    }

    const payloadHash = stablePayloadHash({
      wkOrderId: input.wkOrderId,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      timezone: tz,
      addressMode: REDELIVERY_ADDRESS_MODE_SAME_AS_ORDER,
    });
    const idempotencyKey = input.idempotencyKey
      ? String(input.idempotencyKey).slice(0, 64)
      : undefined;

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const { order, fulfillment } = await this.lockOrderAndFulfillment(
            tx,
            input.wkOrderId,
          );

          // Auth before idempotency cache.
          if (
            fulfillment.customerId !== input.actorUserId &&
            order.userId !== input.actorUserId
          ) {
            throw new ForbiddenException({
              code: 'REDELIVERY_CUSTOMER_AUTH_REQUIRED',
              message: 'Only the order customer may request redelivery',
            });
          }

          if (idempotencyKey) {
            const prior = await tx.redeliveryAuthorization.findFirst({
              where: {
                requestedByActorId: input.actorUserId,
                requestIdempotencyKey: idempotencyKey,
              },
            });
            if (prior) {
              if (prior.wkOrderId !== order.id) {
                throw new ConflictException({
                  code: 'IDEMPOTENCY_CROSS_ORDER_CONFLICT',
                  message:
                    'Idempotency key was already used for a different order',
                });
              }
              if (prior.requestPayloadHash !== payloadHash) {
                throw new ForbiddenException({
                  code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
                  message:
                    'Idempotency key was already used with a different payload',
                });
              }
              return {
                code: 'REDELIVERY_REQUESTED' as const,
                idempotent: true,
                authorization: prior,
              };
            }
          }

          await this.assertEligibilityGates(tx, fulfillment, order.id);

          const failedCount = await this.countFailedAttempts(tx, fulfillment.id);
          const budget = evaluateRedeliveryAttemptCollectibility(
            failedCount,
            MAX_DELIVERY_ATTEMPTS,
          );
          if (!budget.allowed) {
            throw new ForbiddenException({
              code: 'REDELIVERY_ATTEMPT_LIMIT_REACHED',
              message: `Maximum delivery attempts (${MAX_DELIVERY_ATTEMPTS}) reached`,
              maxAttempts: MAX_DELIVERY_ATTEMPTS,
              failedAttemptCount: failedCount,
            });
          }

          const openAuth = await tx.redeliveryAuthorization.findFirst({
            where: {
              fulfillmentId: fulfillment.id,
              status: { in: OPEN_AUTH_STATUSES },
            },
          });
          if (openAuth) {
            const maybe = await this.lazyExpireAuthorization(
              tx,
              openAuth,
              now,
              input.actorUserId,
              input.correlationId,
            );
            if (
              maybe.status === RedeliveryAuthorizationStatus.REQUESTED ||
              maybe.status === RedeliveryAuthorizationStatus.CONFIRMED
            ) {
              throw new ForbiddenException({
                code: 'REDELIVERY_ALREADY_PENDING',
                message: 'An open redelivery authorization already exists',
              });
            }
          }

          const priorCase = await tx.operationalCase.findFirst({
            where: {
              fulfillmentId: fulfillment.id,
              caseType: OperationalCaseType.DELIVERY_FAILURE,
              status: {
                in: [
                  OperationalCaseStatus.OPEN,
                  OperationalCaseStatus.DISPOSITION_SELECTED,
                ],
              },
            },
            orderBy: { openedAt: 'desc' },
          });

          const id = randomUUID();
          const created = await tx.redeliveryAuthorization.create({
            data: {
              id,
              wkOrderId: order.id,
              fulfillmentId: fulfillment.id,
              customerId: fulfillment.customerId ?? order.userId,
              merchantId: order.merchantId,
              targetAttemptNumber: budget.targetAttemptNumber,
              addressMode: RedeliveryAddressMode.SAME_AS_ORDER,
              addressSnapshot: this.buildAddressSnapshot(order),
              windowStart,
              windowEnd,
              timezone: tz,
              status: RedeliveryAuthorizationStatus.REQUESTED,
              priorOperationalCaseId: priorCase?.id ?? null,
              correlationId: input.correlationId,
              requestIdempotencyKey: idempotencyKey,
              requestPayloadHash: payloadHash,
              requestedByActorType: 'CUSTOMER',
              requestedByActorId: input.actorUserId,
            },
          });

          await this.events.record({
            tx,
            aggregateType: 'ORDER_FULFILLMENT',
            aggregateId: fulfillment.id,
            wkOrderId: order.id,
            fulfillmentId: fulfillment.id,
            actorId: input.actorUserId,
            actorType: 'CUSTOMER',
            action: 'REDELIVERY_AUTHORIZATION_REQUESTED',
            newState: RedeliveryAuthorizationStatus.REQUESTED,
            reason: 'stage10_redelivery_request',
            correlationId: input.correlationId,
            metadata: {
              redeliveryAuthorizationId: id,
              targetAttemptNumber: budget.targetAttemptNumber,
              windowStart: windowStart.toISOString(),
              windowEnd: windowEnd.toISOString(),
            },
          });

          return {
            code: 'REDELIVERY_REQUESTED' as const,
            idempotent: false,
            authorization: created,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async confirm(input: {
    authorizationId: string;
    actorUserId: string;
    correlationId?: string;
    idempotencyKey?: string;
    autoActivate?: boolean;
  }) {
    const payloadHash = stablePayloadHash({
      authorizationId: input.authorizationId,
      autoActivate: input.autoActivate !== false,
    });
    const idempotencyKey = input.idempotencyKey
      ? String(input.idempotencyKey).slice(0, 64)
      : undefined;
    const autoActivate = input.autoActivate !== false;

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.redeliveryAuthorization.findUnique({
            where: { id: input.authorizationId },
          });
          if (!existing) {
            throw new NotFoundException('Redelivery authorization not found');
          }

          const { order, fulfillment } = await this.lockOrderAndFulfillment(
            tx,
            existing.wkOrderId,
          );
          const auth = await this.lockAuthorization(tx, existing.id);
          if (!auth) throw new NotFoundException('Redelivery authorization not found');

          // Auth before idempotency cache.
          if (
            auth.customerId !== input.actorUserId &&
            order.userId !== input.actorUserId
          ) {
            throw new ForbiddenException({
              code: 'REDELIVERY_CUSTOMER_AUTH_REQUIRED',
              message: 'Only the order customer may confirm redelivery',
            });
          }

          if (idempotencyKey) {
            const prior = await tx.redeliveryAuthorization.findFirst({
              where: {
                customerAuthActorId: input.actorUserId,
                confirmIdempotencyKey: idempotencyKey,
              },
            });
            if (prior) {
              if (prior.id !== auth.id || prior.wkOrderId !== order.id) {
                throw new ConflictException({
                  code: 'IDEMPOTENCY_CROSS_ORDER_CONFLICT',
                  message:
                    'Idempotency key was already used for a different authorization/order',
                });
              }
              if (prior.confirmPayloadHash !== payloadHash) {
                throw new ForbiddenException({
                  code: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
                  message:
                    'Idempotency key was already used with a different payload',
                });
              }
              return {
                code: 'REDELIVERY_CONFIRMED' as const,
                idempotent: true,
                authorization: prior,
                activated: prior.status === RedeliveryAuthorizationStatus.ACTIVATED,
              };
            }
          }

          const now = new Date();
          const maybeExpired = await this.lazyExpireAuthorization(
            tx,
            auth,
            now,
            input.actorUserId,
            input.correlationId,
          );
          if (maybeExpired.status === RedeliveryAuthorizationStatus.EXPIRED) {
            throw new ForbiddenException({
              code: 'REDELIVERY_WINDOW_EXPIRED',
              message: 'Redelivery window has expired',
            });
          }
          if (maybeExpired.status === RedeliveryAuthorizationStatus.ACTIVATED) {
            return {
              code: 'REDELIVERY_CONFIRMED' as const,
              idempotent: true,
              authorization: maybeExpired,
              activated: true,
            };
          }
          if (
            maybeExpired.status !== RedeliveryAuthorizationStatus.REQUESTED &&
            maybeExpired.status !== RedeliveryAuthorizationStatus.CONFIRMED
          ) {
            throw new ForbiddenException({
              code: 'INVALID_REDELIVERY_STATE',
              message: `Cannot confirm redelivery in status ${maybeExpired.status}`,
            });
          }

          await this.assertEligibilityGates(tx, fulfillment, order.id);
          this.assertAddressSnapshotCurrent(order, maybeExpired.addressSnapshot);

          let confirmed =
            maybeExpired.status === RedeliveryAuthorizationStatus.CONFIRMED
              ? maybeExpired
              : await tx.redeliveryAuthorization.update({
                  where: { id: auth.id },
                  data: {
                    status: RedeliveryAuthorizationStatus.CONFIRMED,
                    customerAuthActorType: 'CUSTOMER',
                    customerAuthActorId: input.actorUserId,
                    customerAuthMethod: RedeliveryCustomerAuthMethod.CUSTOMER_JWT,
                    customerAuthorizedAt: now,
                    confirmIdempotencyKey: idempotencyKey,
                    confirmPayloadHash: payloadHash,
                    correlationId: input.correlationId ?? auth.correlationId,
                  },
                });

          if (maybeExpired.status === RedeliveryAuthorizationStatus.REQUESTED) {
            await this.events.record({
              tx,
              aggregateType: 'ORDER_FULFILLMENT',
              aggregateId: fulfillment.id,
              wkOrderId: order.id,
              fulfillmentId: fulfillment.id,
              actorId: input.actorUserId,
              actorType: 'CUSTOMER',
              action: 'REDELIVERY_AUTHORIZATION_CONFIRMED',
              previousState: RedeliveryAuthorizationStatus.REQUESTED,
              newState: RedeliveryAuthorizationStatus.CONFIRMED,
              reason: 'stage10_customer_confirm',
              correlationId: input.correlationId,
              metadata: { redeliveryAuthorizationId: auth.id },
            });
          }

          let activated = false;
          if (autoActivate) {
            confirmed = await this.activateInTx(tx, {
              authorization: confirmed,
              order,
              fulfillment,
              actorUserId: input.actorUserId,
              actorType: 'INTERNAL_SERVICE',
              correlationId: input.correlationId,
              idempotencyKey: idempotencyKey
                ? `activate:${idempotencyKey}`
                : undefined,
              payloadHash: stablePayloadHash({
                authorizationId: auth.id,
                activate: true,
              }),
            });
            activated = confirmed.status === RedeliveryAuthorizationStatus.ACTIVATED;
          }

          return {
            code: 'REDELIVERY_CONFIRMED' as const,
            idempotent: false,
            authorization: confirmed,
            activated,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  /**
   * Internal activation (also used by confirm auto-activate and admin recovery).
   * Caller must already hold order → fulfillment → authorization locks.
   */
  private async activateInTx(
    tx: Prisma.TransactionClient,
    input: {
      authorization: {
        id: string;
        status: RedeliveryAuthorizationStatus;
        wkOrderId: number;
        fulfillmentId: string;
        priorOperationalCaseId: string | null;
        targetAttemptNumber: number;
        addressSnapshot: Prisma.JsonValue;
        activateIdempotencyKey?: string | null;
        activatePayloadHash?: string | null;
        correlationId?: string | null;
      };
      order: {
        id: number;
        deliveryAddress: string | null;
        customerBarangay: string | null;
        deliveryZoneName: string | null;
      };
      fulfillment: {
        id: string;
        status: FulfillmentStatus;
        pendingCustodyIncomingRiderId: string | null;
        physicalCustodianRiderId?: string | null;
        activeRiderId?: string | null;
        assignmentVersion: number;
      };
      actorUserId: string;
      actorType: 'INTERNAL_SERVICE' | 'SYSTEM_ADMIN' | 'SYSTEM';
      correlationId?: string;
      idempotencyKey?: string;
      payloadHash: string;
    },
  ) {
    const auth = input.authorization;
    if (auth.status === RedeliveryAuthorizationStatus.ACTIVATED) {
      return tx.redeliveryAuthorization.findUniqueOrThrow({
        where: { id: auth.id },
      });
    }
    if (auth.status !== RedeliveryAuthorizationStatus.CONFIRMED) {
      throw new ForbiddenException({
        code: 'INVALID_REDELIVERY_STATE',
        message: 'Only CONFIRMED redelivery may be activated',
      });
    }

    await this.assertEligibilityGates(tx, input.fulfillment, input.order.id);
    this.assertAddressSnapshotCurrent(input.order, auth.addressSnapshot);

    if (input.fulfillment.pendingCustodyIncomingRiderId) {
      throw new ForbiddenException({
        code: 'REDELIVERY_CUSTODY_TRANSFER_REQUIRED',
        message:
          'Pending Stage 7 custody transfer blocks redelivery activation',
      });
    }

    if (!input.fulfillment.physicalCustodianRiderId) {
      throw new ForbiddenException({
        code: 'REDELIVERY_CUSTODY_NOT_PROVEN',
        message: 'Physical custodian must be proven before redelivery activation',
      });
    }

    const activeAssignment = await tx.riderAssignment.findFirst({
      where: {
        fulfillmentId: input.fulfillment.id,
        status: RiderAssignmentStatus.ACTIVE,
      },
      orderBy: { assignmentVersion: 'desc' },
    });
    if (
      !activeAssignment ||
      activeAssignment.riderId !== input.fulfillment.activeRiderId ||
      activeAssignment.assignmentVersion !== input.fulfillment.assignmentVersion
    ) {
      throw new ForbiddenException({
        code: 'REDELIVERY_ASSIGNMENT_MISMATCH',
        message: 'Active rider assignment does not match fulfillment',
      });
    }
    if (
      input.fulfillment.physicalCustodianRiderId !==
      input.fulfillment.activeRiderId
    ) {
      throw new ForbiddenException({
        code: 'REDELIVERY_CUSTODY_NOT_PROVEN',
        message:
          'Physical custodian must match active rider before executable redelivery',
      });
    }

    const failedCount = await this.countFailedAttempts(
      tx,
      input.fulfillment.id,
    );
    const budget = evaluateRedeliveryAttemptCollectibility(
      failedCount,
      MAX_DELIVERY_ATTEMPTS,
    );
    if (!budget.allowed) {
      throw new ForbiddenException({
        code: 'REDELIVERY_ATTEMPT_LIMIT_REACHED',
        message: `Maximum delivery attempts (${MAX_DELIVERY_ATTEMPTS}) reached`,
      });
    }
    if (auth.targetAttemptNumber !== budget.targetAttemptNumber) {
      throw new ConflictException({
        code: 'REDELIVERY_ATTEMPT_CONFLICT',
        message:
          'Authorization target attempt no longer matches failed-attempt budget',
      });
    }

    // Resolve prior DELIVERY_FAILURE case with redelivery provenance.
    const caseId =
      auth.priorOperationalCaseId ??
      (
        await tx.operationalCase.findFirst({
          where: {
            fulfillmentId: input.fulfillment.id,
            caseType: OperationalCaseType.DELIVERY_FAILURE,
            status: {
              in: [
                OperationalCaseStatus.OPEN,
                OperationalCaseStatus.DISPOSITION_SELECTED,
              ],
            },
          },
          orderBy: { openedAt: 'desc' },
        })
      )?.id;

    if (caseId) {
      const opCase = await tx.operationalCase.findUnique({
        where: { id: caseId },
      });
      if (
        opCase &&
        (opCase.status === OperationalCaseStatus.OPEN ||
          opCase.status === OperationalCaseStatus.DISPOSITION_SELECTED)
      ) {
        await tx.operationalCase.update({
          where: { id: caseId },
          data: {
            status: OperationalCaseStatus.RESOLVED,
            resolvedAt: new Date(),
            resolvedByActorType: input.actorType,
            resolvedByActorId: input.actorUserId,
            resolutionReason: 'stage10_redelivery_activated',
          },
        });
        await tx.operationalCaseEvent.create({
          data: {
            id: randomUUID(),
            operationalCaseId: caseId,
            eventType: OperationalCaseEventType.CASE_RESOLVED,
            fromStatus: opCase.status,
            toStatus: OperationalCaseStatus.RESOLVED,
            actorType: input.actorType,
            actorId: input.actorUserId,
            reason: 'stage10_redelivery_activated',
            correlationId: input.correlationId ?? auth.correlationId,
            metadata: {
              redeliveryAuthorizationId: auth.id,
              provenance: 'STAGE10_REDELIVERY',
              targetAttemptNumber: auth.targetAttemptNumber,
            },
          },
        });
      }
    }

    // Revoke ACTIVE Stage 5A delivery tokens before returning to in_transit.
    await this.revokeActiveDeliveryTokensInTx(
      tx,
      input.fulfillment.id,
      input.actorUserId,
      'stage10_redelivery_activation',
      input.correlationId ?? auth.correlationId ?? undefined,
    );

    await this.transitions.transitionInTx(
      tx,
      {
        fulfillmentId: input.fulfillment.id,
        targetStatus: 'in_transit',
        actor: {
          id: input.actorUserId,
          type: 'INTERNAL_SERVICE',
        },
        reason: 'stage10_redelivery_activation',
        correlationId: input.correlationId ?? auth.correlationId ?? undefined,
      },
      'in_transit',
    );

    const now = new Date();
    const activated = await tx.redeliveryAuthorization.update({
      where: { id: auth.id },
      data: {
        status: RedeliveryAuthorizationStatus.ACTIVATED,
        activatedAt: now,
        activateIdempotencyKey: input.idempotencyKey ?? null,
        activatePayloadHash: input.payloadHash,
        correlationId: input.correlationId ?? auth.correlationId,
      },
    });

    await this.events.record({
      tx,
      aggregateType: 'ORDER_FULFILLMENT',
      aggregateId: input.fulfillment.id,
      wkOrderId: input.order.id,
      fulfillmentId: input.fulfillment.id,
      actorId: input.actorUserId,
      actorType: input.actorType,
      action: 'REDELIVERY_AUTHORIZATION_ACTIVATED',
      previousState: FulfillmentStatus.delivery_failed,
      newState: FulfillmentStatus.in_transit,
      reason: 'stage10_redelivery_activation',
      correlationId: input.correlationId ?? auth.correlationId,
      metadata: {
        redeliveryAuthorizationId: auth.id,
        targetAttemptNumber: auth.targetAttemptNumber,
        priorOperationalCaseId: caseId ?? null,
      },
    });

    return activated;
  }

  async revokeActiveDeliveryTokensInTx(
    tx: Prisma.TransactionClient,
    fulfillmentId: string,
    actorUserId: string,
    reason: string,
    correlationId?: string,
  ) {
    const active = await tx.customerDeliveryHandoffToken.findMany({
      where: {
        fulfillmentId,
        status: CustomerDeliveryHandoffTokenStatus.ACTIVE,
      },
    });
    for (const token of active) {
      await tx.customerDeliveryHandoffToken.update({
        where: { id: token.id },
        data: {
          status: CustomerDeliveryHandoffTokenStatus.REVOKED,
          revokedAt: new Date(),
          revokeReason: reason,
        },
      });
      await this.events.record({
        tx,
        aggregateType: 'ORDER_FULFILLMENT',
        aggregateId: fulfillmentId,
        fulfillmentId,
        wkOrderId: token.wkOrderId,
        actorId: actorUserId,
        actorType: 'INTERNAL_SERVICE',
        action: 'DELIVERY_HANDOFF_TOKEN_REVOKED',
        reason,
        correlationId,
        metadata: { tokenId: token.id, revokeReason: reason },
      });
    }
    return active.length;
  }

  async cancel(input: {
    authorizationId: string;
    actorUserId: string;
    reason?: string;
    correlationId?: string;
  }) {
    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.redeliveryAuthorization.findUnique({
            where: { id: input.authorizationId },
          });
          if (!existing) {
            throw new NotFoundException('Redelivery authorization not found');
          }
          const { order, fulfillment } = await this.lockOrderAndFulfillment(
            tx,
            existing.wkOrderId,
          );
          const auth = await this.lockAuthorization(tx, existing.id);
          if (!auth) {
            throw new NotFoundException('Redelivery authorization not found');
          }

          const viewer = await this.assertViewer(
            order,
            fulfillment,
            input.actorUserId,
          );
          if (viewer !== 'CUSTOMER' && viewer !== 'ADMIN') {
            throw new ForbiddenException({
              code: 'REDELIVERY_CANCEL_FORBIDDEN',
              message: 'Only customer or admin may cancel redelivery',
            });
          }

          if (
            auth.status !== RedeliveryAuthorizationStatus.REQUESTED &&
            auth.status !== RedeliveryAuthorizationStatus.CONFIRMED
          ) {
            if (auth.status === RedeliveryAuthorizationStatus.CANCELLED) {
              return {
                code: 'REDELIVERY_CANCELLED' as const,
                idempotent: true,
                authorization: auth,
              };
            }
            throw new ForbiddenException({
              code: 'INVALID_REDELIVERY_STATE',
              message: `Cannot cancel redelivery in status ${auth.status}`,
            });
          }

          const reason = String(input.reason ?? 'cancelled').slice(0, 2000);
          const now = new Date();
          const cancelled = await tx.redeliveryAuthorization.update({
            where: { id: auth.id },
            data: {
              status: RedeliveryAuthorizationStatus.CANCELLED,
              cancelledAt: now,
              cancelReason: reason,
              correlationId: input.correlationId ?? auth.correlationId,
            },
          });

          await this.events.record({
            tx,
            aggregateType: 'ORDER_FULFILLMENT',
            aggregateId: fulfillment.id,
            wkOrderId: order.id,
            fulfillmentId: fulfillment.id,
            actorId: input.actorUserId,
            actorType: viewer === 'ADMIN' ? 'SYSTEM_ADMIN' : 'CUSTOMER',
            action: 'REDELIVERY_AUTHORIZATION_CANCELLED',
            previousState: auth.status,
            newState: RedeliveryAuthorizationStatus.CANCELLED,
            reason,
            correlationId: input.correlationId,
            metadata: { redeliveryAuthorizationId: auth.id },
          });

          return {
            code: 'REDELIVERY_CANCELLED' as const,
            idempotent: false,
            authorization: cancelled,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async getForOrder(wkOrderId: number, actorUserId: string) {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
    });
    if (!order) throw new NotFoundException('Order not found');
    const fulfillment = await this.prisma.orderFulfillment.findUnique({
      where: { wkOrderId },
    });
    if (!fulfillment) throw new NotFoundException('Fulfillment not found');
    await this.assertViewer(order, fulfillment, actorUserId);

    // Lazy expiry outside hot path via short txn.
    await this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          await this.lockOrderAndFulfillment(tx, wkOrderId);
          const open = await tx.redeliveryAuthorization.findMany({
            where: {
              fulfillmentId: fulfillment.id,
              status: { in: OPEN_AUTH_STATUSES },
            },
          });
          const now = new Date();
          for (const a of open) {
            await this.lockAuthorization(tx, a.id);
            await this.lazyExpireAuthorization(
              tx,
              a,
              now,
              actorUserId,
              undefined,
            );
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );

    const authorizations = await this.prisma.redeliveryAuthorization.findMany({
      where: { wkOrderId },
      orderBy: { createdAt: 'desc' },
    });
    const failedAttemptCount = await this.prisma.deliveryAttempt.count({
      where: {
        fulfillmentId: fulfillment.id,
        outcome: DeliveryAttemptOutcome.FAILED,
      },
    });
    const budget = evaluateRedeliveryAttemptCollectibility(
      failedAttemptCount,
      MAX_DELIVERY_ATTEMPTS,
    );
    const current =
      authorizations.find((a) =>
        OPEN_AUTH_STATUSES.includes(a.status),
      ) ??
      authorizations.find(
        (a) => a.status === RedeliveryAuthorizationStatus.ACTIVATED,
      ) ??
      authorizations[0] ??
      null;

    return {
      wkOrderId,
      fulfillmentId: fulfillment.id,
      fulfillmentStatus: fulfillment.status,
      current,
      authorizations,
      attemptBudget: budget,
      maxDeliveryAttempts: MAX_DELIVERY_ATTEMPTS,
      addressMode: REDELIVERY_ADDRESS_MODE_SAME_AS_ORDER,
      timezone: REDELIVERY_TIMEZONE,
    };
  }

  /** Admin recovery activation with mandatory reason + correlationId. */
  async adminActivate(input: {
    authorizationId: string;
    actorUserId: string;
    reason: string;
    correlationId: string;
    idempotencyKey?: string;
  }) {
    const reason = String(input.reason ?? '').trim();
    const correlationId = String(input.correlationId ?? '').trim();
    if (!reason || !correlationId) {
      throw new BadRequestException({
        code: 'AUDIT_FIELDS_REQUIRED',
        message: 'reason and correlationId are required',
      });
    }
    const actor = await this.authActors.resolve({
      id: input.actorUserId,
      role: undefined,
    });
    if (actor.type !== 'SYSTEM_ADMIN') {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Only SYSTEM_ADMIN may admin-activate redelivery',
      });
    }

    const payloadHash = stablePayloadHash({
      authorizationId: input.authorizationId,
      reason,
      correlationId,
    });
    const idempotencyKey = input.idempotencyKey
      ? String(input.idempotencyKey).slice(0, 64)
      : undefined;

    return this.withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.redeliveryAuthorization.findUnique({
            where: { id: input.authorizationId },
          });
          if (!existing) {
            throw new NotFoundException('Redelivery authorization not found');
          }
          const { order, fulfillment } = await this.lockOrderAndFulfillment(
            tx,
            existing.wkOrderId,
          );
          let auth = await this.lockAuthorization(tx, existing.id);
          if (!auth) {
            throw new NotFoundException('Redelivery authorization not found');
          }

          if (
            auth.status === RedeliveryAuthorizationStatus.REQUESTED
          ) {
            auth = await tx.redeliveryAuthorization.update({
              where: { id: auth.id },
              data: {
                status: RedeliveryAuthorizationStatus.CONFIRMED,
                customerAuthActorType: 'SYSTEM_ADMIN',
                customerAuthActorId: input.actorUserId,
                customerAuthMethod: RedeliveryCustomerAuthMethod.ADMIN_RECOVERY,
                customerAuthorizedAt: new Date(),
              },
            });
          }

          const activated = await this.activateInTx(tx, {
            authorization: auth,
            order,
            fulfillment,
            actorUserId: input.actorUserId,
            actorType: 'SYSTEM_ADMIN',
            correlationId,
            idempotencyKey,
            payloadHash,
          });

          return {
            code: 'REDELIVERY_ACTIVATED' as const,
            authorization: activated,
            reason,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  /** Find ACTIVATED redelivery for a fulfillment (Stage 5A SUCCESSFUL_HANDOFF gate). */
  async findActivatedForFulfillment(
    tx: Prisma.TransactionClient | PrismaService,
    fulfillmentId: string,
  ) {
    return tx.redeliveryAuthorization.findFirst({
      where: {
        fulfillmentId,
        status: RedeliveryAuthorizationStatus.ACTIVATED,
      },
      orderBy: { activatedAt: 'desc' },
    });
  }
}
