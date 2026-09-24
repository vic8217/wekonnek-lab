import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, RiderAdvanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { withSerializableRetry } from '../prisma/serializable-retry';
import { FulfillmentTransitionService } from '../fulfillment/fulfillment-transition.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import {
  projectRiderAssignment,
  projectRiderAssignmentDetail,
  RiderReadRow,
} from './rider-assignments.projection';
import { assertActiveRiderIdentity } from './rider-assignments.policy';
import {
  decideStartDelivery,
  StartDeliveryDecision,
} from './rider-assignments.start-delivery';
import {
  decideReportLocation,
  LocationSampleBody,
  parseLocationSample,
  ReportLocationDecision,
} from './rider-assignments.report-location';
import {
  RiderAssignmentDetail,
  RiderAssignmentListResponse,
  RiderLocationReportResponse,
  RiderStartDeliveryResponse,
} from './rider-assignments.types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const orderSelect = {
  id: true,
  orderCode: true,
  orderType: true,
  deliveryAddress: true,
  notes: true,
  merchant: { select: { name: true, address: true } },
  shop: { select: { name: true, address: true } },
  orderItems: { select: { productName: true, quantity: true } },
} satisfies Prisma.WkOrderSelect;

function fulfillmentSelect(riderId: string, includeAttempts: boolean) {
  return {
    id: true,
    status: true,
    updatedAt: true,
    wkOrderId: true,
    activeRiderId: true,
    physicalCustodianRiderId: true,
    wkOrder: { select: orderSelect },
    riderAdvances: {
      where: {
        riderId,
        status: { not: RiderAdvanceStatus.CANCELLED },
      },
      orderBy: { createdAt: 'desc' as const },
      take: 1,
      select: { status: true },
    },
    ...(includeAttempts
      ? {
          deliveryAttempts: {
            orderBy: { occurredAt: 'desc' as const },
            take: 1,
            select: {
              outcome: true,
              failureReasonCode: true,
              attemptNumber: true,
            },
          },
        }
      : {}),
  } satisfies Prisma.OrderFulfillmentSelect;
}

type Cursor = { updatedAt: Date; id: string };

function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(`${updatedAt.toISOString()}|${id}`, 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(raw: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
  const splitAt = decoded.lastIndexOf('|');
  if (splitAt <= 0) throw new BadRequestException('Invalid cursor');
  const iso = decoded.slice(0, splitAt);
  const id = decoded.slice(splitAt + 1);
  const updatedAt = new Date(iso);
  if (!id || Number.isNaN(updatedAt.getTime())) {
    throw new BadRequestException('Invalid cursor');
  }
  return { updatedAt, id };
}

function parseLimit(raw: string | undefined): number {
  if (raw == null || raw === '') return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) throw new BadRequestException('Invalid limit');
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequestException('Invalid limit');
  }
  return limit;
}

function startDeliveryDenial(
  decision: Extract<StartDeliveryDecision, { ok: false }>,
): ForbiddenException | BadRequestException {
  const body = { code: decision.code, message: decision.message };
  return decision.code === 'FULFILLMENT_NOT_START_ELIGIBLE'
    ? new BadRequestException(body)
    : new ForbiddenException(body);
}

function reportLocationDenial(
  decision: Extract<ReportLocationDecision, { ok: false }>,
): ForbiddenException {
  return new ForbiddenException({
    code: decision.code,
    message: decision.message,
  });
}

@Injectable()
export class RiderAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: FulfillmentTransitionService,
    private readonly events: OrderDomainEventService,
  ) {}

  async list(
    actor: { id?: string } | undefined,
    query: { limit?: string; cursor?: string },
  ): Promise<RiderAssignmentListResponse> {
    const riderId = await this.requireActiveRider(actor);
    const limit = parseLimit(query.limit);
    const cursor =
      query.cursor && query.cursor.length > 0
        ? decodeCursor(query.cursor)
        : null;

    const rows = await this.prisma.orderFulfillment.findMany({
      where: {
        AND: [
          { wkOrderId: { not: null } },
          {
            OR: [
              { activeRiderId: riderId },
              { physicalCustodianRiderId: riderId },
            ],
          },
          ...(cursor
            ? [
                {
                  OR: [
                    { updatedAt: { lt: cursor.updatedAt } },
                    {
                      AND: [
                        { updatedAt: cursor.updatedAt },
                        { id: { lt: cursor.id } },
                      ],
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: fulfillmentSelect(riderId, false),
    });

    const pageRows = rows.slice(0, limit);
    const extra = rows.length > limit ? rows[limit] : null;
    const last = pageRows[pageRows.length - 1];
    return {
      items: pageRows
        .map((row) => projectRiderAssignment(row as RiderReadRow, riderId))
        .filter((item): item is NonNullable<typeof item> => item != null),
      page: {
        limit,
        nextCursor:
          extra && last ? encodeCursor(last.updatedAt, last.id) : null,
      },
    };
  }

  async detail(
    actor: { id?: string } | undefined,
    wkOrderId: number,
  ): Promise<RiderAssignmentDetail> {
    const riderId = await this.requireActiveRider(actor);
    const row = await this.prisma.orderFulfillment.findUnique({
      where: { wkOrderId },
      select: fulfillmentSelect(riderId, true),
    });
    const responsible =
      row != null &&
      row.wkOrderId != null &&
      (row.activeRiderId === riderId ||
        row.physicalCustodianRiderId === riderId);
    if (!responsible) {
      throw new ForbiddenException({
        code: 'RIDER_ASSIGNMENT_FORBIDDEN',
        message: 'Assignment access denied',
      });
    }
    const projected = projectRiderAssignmentDetail(row, riderId);
    if (!projected) {
      throw new ForbiddenException({
        code: 'RIDER_ASSIGNMENT_FORBIDDEN',
        message: 'Assignment access denied',
      });
    }
    return projected;
  }

  /**
   * picked_up → in_transit only. Target status is fixed. Custody pointers
   * and custody events are not written. The Serializable body is retried by
   * the accepted UCE-C1 helper without changing that helper.
   */
  async startDelivery(
    actor: { id?: string } | undefined,
    wkOrderId: number,
    options: { correlationId?: string } = {},
  ): Promise<RiderStartDeliveryResponse> {
    const riderId = await this.requireActiveRider(actor);
    const correlationId = options.correlationId;

    const committed = await withSerializableRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.orderFulfillment.findUnique({
            where: { wkOrderId },
            select: { id: true },
          });
          if (!existing) {
            throw startDeliveryDenial({
              ok: false,
              code: 'RIDER_ASSIGNMENT_FORBIDDEN',
              message: 'Assignment access denied',
            });
          }
          await tx.$queryRaw`
            SELECT id FROM "order_fulfillments" WHERE id = ${existing.id}::uuid FOR UPDATE
          `;
          const locked = await tx.orderFulfillment.findUniqueOrThrow({
            where: { id: existing.id },
          });

          const decision = decideStartDelivery({ riderId, fulfillment: locked });
          if (!decision.ok) throw startDeliveryDenial(decision);

          const transition = await this.transitions.transitionInTx(
            tx,
            {
              fulfillmentId: locked.id,
              targetStatus: 'in_transit',
              actor: { id: riderId, type: 'INTERNAL_SERVICE' },
              reason: 'rider_start_delivery',
              correlationId,
              expectedVersion: locked.assignmentVersion,
            },
            'in_transit',
          );

          await this.events.record({
            tx,
            aggregateType: 'ORDER_FULFILLMENT',
            aggregateId: locked.id,
            fulfillmentId: locked.id,
            wkOrderId: locked.wkOrderId,
            actorId: riderId,
            actorType: 'RIDER',
            action: 'RIDER_DELIVERY_STARTED',
            previousState: locked.status,
            newState: transition.fulfillment.status,
            reason: 'rider_start_delivery',
            correlationId,
            metadata: {
              idempotent: transition.idempotent,
              custodyUnchanged: true,
              merchantReleaseUnchanged: true,
              paymentStatusUnchanged: true,
            },
          });

          return { idempotent: transition.idempotent };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );

    return {
      idempotent: committed.idempotent,
      assignment: await this.detail(actor, wkOrderId),
    };
  }

  /**
   * Append one canonical location sample. Not a lifecycle transaction.
   * Does not change fulfillment, custody, payment, or the audit trail.
   */
  async reportLocation(
    actor: { id?: string } | undefined,
    wkOrderId: number,
    body: LocationSampleBody | undefined,
  ): Promise<RiderLocationReportResponse> {
    const riderId = await this.requireActiveRider(actor);

    const parsed = parseLocationSample(body);
    if (!parsed.ok) {
      throw new BadRequestException({
        code: 'LOCATION_SAMPLE_INVALID',
        message: parsed.message,
      });
    }

    const fulfillment = await this.prisma.orderFulfillment.findUnique({
      where: { wkOrderId },
      select: {
        wkOrderId: true,
        status: true,
        activeRiderId: true,
        physicalCustodianRiderId: true,
      },
    });
    if (!fulfillment) {
      throw reportLocationDenial({
        ok: false,
        code: 'RIDER_ASSIGNMENT_FORBIDDEN',
        message: 'Assignment access denied',
      });
    }

    const decision = decideReportLocation({ riderId, fulfillment });
    if (!decision.ok) throw reportLocationDenial(decision);

    const created = await this.prisma.riderLocation.create({
      data: {
        riderId,
        wkOrderId,
        lat: parsed.sample.lat,
        lng: parsed.sample.lng,
        accuracy: parsed.sample.accuracy,
        heading: parsed.sample.heading,
        speed: parsed.sample.speed,
      },
      select: { recordedAt: true, orderId: true, wkOrderId: true },
    });

    return { accepted: true, recordedAt: created.recordedAt.toISOString() };
  }

  private async requireActiveRider(
    actor: { id?: string } | undefined,
  ): Promise<string> {
    if (!actor?.id) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { id: true, role: true, isActive: true },
    });
    assertActiveRiderIdentity(user);
    return user.id;
  }
}
