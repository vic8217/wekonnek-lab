import { Injectable } from '@nestjs/common';
import {
  OrderDomainActorType,
  OrderDomainAggregateType,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordDomainEventInput {
  aggregateType: OrderDomainAggregateType;
  aggregateId: string;
  action: string;
  actorId?: string | null;
  actorType?: OrderDomainActorType;
  wkOrderId?: number | null;
  fulfillmentId?: string | null;
  orderV2Id?: string | null;
  previousState?: string | null;
  newState?: string | null;
  reason?: string | null;
  correlationId?: string | null;
  /** Safe metadata only — never secrets or unnecessary PII */
  metadata?: Prisma.InputJsonValue;
  eventId?: string;
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class OrderDomainEventService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordDomainEventInput) {
    const client = input.tx ?? this.prisma;
    return client.orderDomainEvent.create({
      data: {
        id: randomUUID(),
        eventId: input.eventId ?? randomUUID().replace(/-/g, ''),
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        wkOrderId: input.wkOrderId ?? undefined,
        fulfillmentId: input.fulfillmentId ?? undefined,
        orderV2Id: input.orderV2Id ?? undefined,
        actorId: input.actorId ?? undefined,
        actorType: input.actorType ?? 'UNKNOWN',
        action: input.action,
        previousState: input.previousState ?? undefined,
        newState: input.newState ?? undefined,
        reason: input.reason ?? undefined,
        correlationId: input.correlationId ?? undefined,
        metadata: input.metadata,
      },
    });
  }
}
