import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccuraIssuanceJobStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccuraClientService } from './accura-client.service';
import {
  accuraInvoiceIdempotencyKey,
  type AccuraIssuanceOutcome,
} from './accura-client.types';
import {
  ACCURA_ISSUANCE_CLAIMABLE,
  ACCURA_ISSUANCE_CLOCK,
  DEFAULT_ACCURA_ISSUANCE_BATCH_SIZE,
  DEFAULT_ACCURA_ISSUANCE_MAX_ATTEMPTS,
  DEFAULT_ACCURA_ISSUANCE_PROCESSING_LEASE_SECONDS,
  DEFAULT_ACCURA_ISSUANCE_WORKER_POLL_MS,
  nextAccuraIssuanceRetryAt,
  parsePositiveInt,
  type AccuraIssuanceClock,
} from './accura-issuance.types';

@Injectable()
export class AccuraIssuanceProcessorService {
  private readonly logger = new Logger(AccuraIssuanceProcessorService.name);
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accura: AccuraClientService,
    private readonly config: ConfigService,
    @Optional()
    @Inject(ACCURA_ISSUANCE_CLOCK)
    private readonly clock: AccuraIssuanceClock = () => new Date(),
  ) {}

  now(): Date {
    return this.clock();
  }

  batchSize(): number {
    return parsePositiveInt(
      this.config.get<string>('ACCURA_ISSUANCE_BATCH_SIZE'),
      DEFAULT_ACCURA_ISSUANCE_BATCH_SIZE,
    );
  }

  leaseSeconds(): number {
    return parsePositiveInt(
      this.config.get<string>('ACCURA_ISSUANCE_PROCESSING_LEASE_SECONDS'),
      DEFAULT_ACCURA_ISSUANCE_PROCESSING_LEASE_SECONDS,
    );
  }

  maxAttempts(): number {
    return parsePositiveInt(
      this.config.get<string>('ACCURA_ISSUANCE_MAX_ATTEMPTS'),
      DEFAULT_ACCURA_ISSUANCE_MAX_ATTEMPTS,
    );
  }

  pollMs(): number {
    return parsePositiveInt(
      this.config.get<string>('ACCURA_ISSUANCE_WORKER_POLL_MS'),
      DEFAULT_ACCURA_ISSUANCE_WORKER_POLL_MS,
    );
  }

  requestStop(): void {
    this.stopping = true;
  }

  async runUntilStopped(): Promise<void> {
    this.stopping = false;
    const onSignal = () => this.requestStop();
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    try {
      while (!this.stopping) {
        await this.processDueJobs();
        if (this.stopping) break;
        await this.sleep(this.pollMs());
      }
    } finally {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      this.logger.log('accura_issuance_worker_stopped');
    }
  }

  async processDueJobs(now: Date = this.now()): Promise<number> {
    const claimed = await this.claimDueJobs(now, this.batchSize());
    for (const job of claimed) {
      if (this.stopping) break;
      await this.processClaimedJob(job, now);
    }
    return claimed.length;
  }

  async claimDueJobs(
    now: Date,
    limit: number,
  ): Promise<Array<{ id: string; wkOrderId: number; attemptCount: number }>> {
    const staleBefore = new Date(now.getTime() - this.leaseSeconds() * 1000);
    const candidates = await this.prisma.accuraIssuanceJob.findMany({
      where: {
        OR: [
          {
            status: { in: ACCURA_ISSUANCE_CLAIMABLE },
            nextAttemptAt: { lte: now },
          },
          {
            status: AccuraIssuanceJobStatus.PROCESSING,
            processingStartedAt: { lte: staleBefore },
          },
        ],
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: Math.max(limit * 3, limit),
      select: { id: true },
    });

    const claimed: Array<{
      id: string;
      wkOrderId: number;
      attemptCount: number;
    }> = [];
    for (const candidate of candidates) {
      if (claimed.length >= limit) break;
      const updated = await this.prisma.accuraIssuanceJob.updateMany({
        where: {
          id: candidate.id,
          OR: [
            {
              status: { in: ACCURA_ISSUANCE_CLAIMABLE },
              nextAttemptAt: { lte: now },
            },
            {
              status: AccuraIssuanceJobStatus.PROCESSING,
              processingStartedAt: { lte: staleBefore },
            },
          ],
        },
        data: {
          status: AccuraIssuanceJobStatus.PROCESSING,
          processingStartedAt: now,
          lastAttemptAt: now,
          attemptCount: { increment: 1 },
        },
      });
      if (updated.count !== 1) continue;
      const job = await this.prisma.accuraIssuanceJob.findUnique({
        where: { id: candidate.id },
        select: { id: true, wkOrderId: true, attemptCount: true },
      });
      if (job) claimed.push(job);
    }
    return claimed;
  }

  async processClaimedJob(
    job: { id: string; wkOrderId: number; attemptCount: number },
    now: Date = this.now(),
  ): Promise<void> {
    const association = await this.prisma.wkOrderAccuraInvoice.findUnique({
      where: { wkOrderId: job.wkOrderId },
      select: { accuraInvoiceId: true },
    });
    if (association) {
      await this.completeJob(job, now, {
        result: 'ALREADY_COMPLETED',
        accuraInvoiceId: association.accuraInvoiceId,
      });
      return;
    }

    const idempotencyKey = accuraInvoiceIdempotencyKey(job.wkOrderId);
    this.logger.log(
      `accura_issuance_attempt jobId=${job.id} wkOrderId=${job.wkOrderId} attempt=${job.attemptCount} idempotencyKey=${idempotencyKey}`,
    );
    const outcome = await this.accura.issueInvoiceForOrder(job.wkOrderId);
    if (outcome.ok) {
      await this.completeJob(job, now, {
        result: 'ISSUED',
        accuraInvoiceId: outcome.invoiceId,
        httpStatus: outcome.httpStatus,
        orderCode: outcome.orderCode,
      });
      return;
    }
    if (outcome.retryable && job.attemptCount < this.maxAttempts()) {
      await this.scheduleRetry(job, now, outcome);
      return;
    }
    await this.failJob(job, now, outcome);
  }

  private async completeJob(
    job: { id: string; wkOrderId: number; attemptCount: number },
    now: Date,
    input: {
      result: 'ISSUED' | 'ALREADY_COMPLETED';
      accuraInvoiceId?: string;
      httpStatus?: number;
      orderCode?: string;
    },
  ): Promise<void> {
    const orderCode = input.orderCode ?? (await this.orderCode(job.wkOrderId));
    await this.prisma.accuraIssuanceJob.update({
      where: { id: job.id },
      data: {
        status: AccuraIssuanceJobStatus.SUCCEEDED,
        completedAt: now,
        processingStartedAt: null,
        lastErrorCategory: null,
        lastHttpStatus: input.httpStatus ?? null,
      },
    });
    await this.audit(job, {
      result: input.result,
      orderCode: orderCode ?? undefined,
      accuraInvoiceId: input.accuraInvoiceId,
    });
    this.logger.log(
      `accura_issuance_succeeded jobId=${job.id} wkOrderId=${job.wkOrderId} result=${input.result}`,
    );
  }

  private async scheduleRetry(
    job: { id: string; wkOrderId: number; attemptCount: number },
    now: Date,
    outcome: Extract<AccuraIssuanceOutcome, { ok: false }>,
  ): Promise<void> {
    const nextAttemptAt = nextAccuraIssuanceRetryAt(
      now,
      job.attemptCount,
      this.maxAttempts(),
    );
    if (!nextAttemptAt) {
      await this.failJob(job, now, outcome);
      return;
    }
    await this.prisma.accuraIssuanceJob.update({
      where: { id: job.id },
      data: {
        status: AccuraIssuanceJobStatus.RETRY_SCHEDULED,
        nextAttemptAt,
        processingStartedAt: null,
        lastErrorCategory: outcome.category,
        lastHttpStatus: outcome.httpStatus ?? null,
      },
    });
    await this.audit(job, {
      result: 'RETRY_SCHEDULED',
      errorCategory: outcome.category,
      orderCode: outcome.orderCode,
    });
    this.logger.warn(
      `accura_issuance_retry jobId=${job.id} wkOrderId=${job.wkOrderId} category=${outcome.category} nextAttemptAt=${nextAttemptAt.toISOString()}`,
    );
  }

  private async failJob(
    job: { id: string; wkOrderId: number; attemptCount: number },
    now: Date,
    outcome: Extract<AccuraIssuanceOutcome, { ok: false }>,
  ): Promise<void> {
    await this.prisma.accuraIssuanceJob.update({
      where: { id: job.id },
      data: {
        status: AccuraIssuanceJobStatus.FAILED,
        completedAt: now,
        processingStartedAt: null,
        lastErrorCategory: outcome.category,
        lastHttpStatus: outcome.httpStatus ?? null,
      },
    });
    await this.audit(job, {
      result: 'FAILED',
      errorCategory: outcome.category,
      orderCode: outcome.orderCode,
    });
    this.logger.error(
      `accura_issuance_failed jobId=${job.id} wkOrderId=${job.wkOrderId} category=${outcome.category} attempt=${job.attemptCount}`,
    );
  }

  private async audit(
    job: { id: string; wkOrderId: number; attemptCount: number },
    input: {
      result: string;
      errorCategory?: string;
      accuraInvoiceId?: string;
      orderCode?: string;
    },
  ): Promise<void> {
    await this.prisma.accuraIssuanceAuditEvent.create({
      data: {
        jobId: job.id,
        wkOrderId: job.wkOrderId,
        orderCode: input.orderCode ?? (await this.orderCode(job.wkOrderId)),
        attemptNumber: job.attemptCount,
        result: input.result,
        errorCategory: input.errorCategory ?? null,
        accuraInvoiceId: input.accuraInvoiceId ?? null,
        actorType: 'SYSTEM',
      },
    });
  }

  private async orderCode(wkOrderId: number): Promise<string | null> {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
      select: { orderCode: true },
    });
    return order?.orderCode ?? null;
  }

  private async sleep(ms: number): Promise<void> {
    const started = Date.now();
    while (!this.stopping && Date.now() - started < ms) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, ms - (Date.now() - started))),
      );
    }
  }
}
