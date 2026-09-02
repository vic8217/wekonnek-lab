import { Injectable, Logger } from '@nestjs/common';
import { AccuraIssuanceJobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isWkOrderEligibleForAccuraInvoice } from './accura-client.mapping';
import { accuraInvoiceVisibility } from './accura-issuance.types';

export type AccuraIssuanceDb = PrismaService | Prisma.TransactionClient;

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

@Injectable()
export class AccuraIssuanceJobsService {
  private readonly logger = new Logger(AccuraIssuanceJobsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist durable ACCURA issuance intent for a paid WkOrder.
   * Must run in the same DB transaction as the paymentStatus=paid write.
   * Never performs ACCURA HTTP.
   */
  async enqueueForSettledOrder(
    db: AccuraIssuanceDb,
    wkOrderId: number,
    now: Date = new Date(),
  ): Promise<{ enqueued: boolean; reason: string; jobId?: string }> {
    const order = await db.wkOrder.findUnique({
      where: { id: wkOrderId },
      include: { accuraInvoice: true, accuraIssuanceJob: true },
    });
    if (!order) {
      return { enqueued: false, reason: 'not_found' };
    }
    if (!isWkOrderEligibleForAccuraInvoice(order)) {
      return { enqueued: false, reason: 'not_eligible' };
    }
    if (order.accuraInvoice) {
      return { enqueued: false, reason: 'already_invoiced' };
    }
    if (order.accuraIssuanceJob) {
      return {
        enqueued: false,
        reason: 'job_exists',
        jobId: order.accuraIssuanceJob.id,
      };
    }

    try {
      const job = await db.accuraIssuanceJob.create({
        data: {
          wkOrderId: order.id,
          status: AccuraIssuanceJobStatus.PENDING,
          attemptCount: 0,
          nextAttemptAt: now,
        },
      });
      await db.accuraIssuanceAuditEvent.create({
        data: {
          jobId: job.id,
          wkOrderId: order.id,
          orderCode: order.orderCode,
          attemptNumber: 0,
          result: 'ENQUEUED',
          actorType: 'SYSTEM',
        },
      });
      this.logger.log(
        `accura_issuance_enqueued wkOrderId=${order.id} orderCode=${order.orderCode} jobId=${job.id}`,
      );
      return { enqueued: true, reason: 'created', jobId: job.id };
    } catch (error) {
      if (isUniqueConflict(error)) {
        return { enqueued: false, reason: 'job_exists' };
      }
      throw error;
    }
  }

  toReadModel(job: {
    id: string;
    wkOrderId: number;
    status: AccuraIssuanceJobStatus;
    attemptCount: number;
    nextAttemptAt: Date;
    processingStartedAt: Date | null;
    lastAttemptAt: Date | null;
    lastErrorCategory: string | null;
    lastHttpStatus: number | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
    wkOrder?: {
      orderCode: string;
      paymentStatus: string;
      accuraInvoice?: { accuraInvoiceId: string } | null;
    };
  }) {
    const hasInvoice = Boolean(job.wkOrder?.accuraInvoice);
    const invoiceVisibility = accuraInvoiceVisibility({
      jobStatus: job.status,
      hasInvoice,
    });
    const visibilityLabel =
      invoiceVisibility === 'INVOICE_ISSUED'
        ? 'INVOICE ISSUED'
        : invoiceVisibility === 'INVOICE_FAILED'
          ? 'INVOICE FAILED'
          : 'INVOICE PENDING';
    return {
      id: job.id,
      wkOrderId: job.wkOrderId,
      orderCode: job.wkOrder?.orderCode ?? null,
      paymentStatus: job.wkOrder?.paymentStatus ?? null,
      status: job.status,
      invoiceVisibility,
      displayStatus: `PAID / ${visibilityLabel}`,
      attemptCount: job.attemptCount,
      nextAttemptAt: job.nextAttemptAt,
      lastAttemptAt: job.lastAttemptAt,
      lastErrorCategory: job.lastErrorCategory,
      lastHttpStatus: job.lastHttpStatus,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      accuraInvoiceId: job.wkOrder?.accuraInvoice?.accuraInvoiceId ?? null,
    };
  }
}
