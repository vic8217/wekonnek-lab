import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AccuraIssuanceJobStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccuraIssuanceJobsService } from './accura-issuance-jobs.service';

@Injectable()
export class AccuraIssuanceAdminService {
  private readonly logger = new Logger(AccuraIssuanceAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: AccuraIssuanceJobsService,
  ) {}

  async getJob(jobId: string) {
    const job = await this.prisma.accuraIssuanceJob.findUnique({
      where: { id: jobId },
      include: {
        wkOrder: {
          select: {
            orderCode: true,
            paymentStatus: true,
            accuraInvoice: { select: { accuraInvoiceId: true } },
          },
        },
      },
    });
    if (!job) throw new NotFoundException('ACCURA issuance job not found');
    return this.jobs.toReadModel(job);
  }

  async getJobForOrder(wkOrderId: number) {
    const job = await this.prisma.accuraIssuanceJob.findUnique({
      where: { wkOrderId },
      include: {
        wkOrder: {
          select: {
            orderCode: true,
            paymentStatus: true,
            accuraInvoice: { select: { accuraInvoiceId: true } },
          },
        },
      },
    });
    if (!job) throw new NotFoundException('ACCURA issuance job not found');
    return this.jobs.toReadModel(job);
  }

  async retryFailed(jobId: string, actorId: string | undefined) {
    if (!actorId) {
      throw new ForbiddenException('Admin authentication required');
    }
    const existing = await this.prisma.accuraIssuanceJob.findUnique({
      where: { id: jobId },
      include: { wkOrder: { select: { orderCode: true } } },
    });
    if (!existing) throw new NotFoundException('ACCURA issuance job not found');
    if (existing.status !== AccuraIssuanceJobStatus.FAILED) {
      throw new ConflictException(
        'Only FAILED ACCURA issuance jobs can be retried',
      );
    }

    const updated = await this.prisma.accuraIssuanceJob.updateMany({
      where: { id: jobId, status: AccuraIssuanceJobStatus.FAILED },
      data: {
        status: AccuraIssuanceJobStatus.PENDING,
        nextAttemptAt: new Date(),
        processingStartedAt: null,
        completedAt: null,
        attemptCount: 0,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException(
        'Only FAILED ACCURA issuance jobs can be retried',
      );
    }

    await this.prisma.accuraIssuanceAuditEvent.create({
      data: {
        jobId: existing.id,
        wkOrderId: existing.wkOrderId,
        orderCode: existing.wkOrder.orderCode,
        attemptNumber: existing.attemptCount,
        result: 'MANUAL_RETRY',
        errorCategory: existing.lastErrorCategory,
        actorType: 'ADMIN',
        actorId,
      },
    });
    this.logger.log(
      `accura_issuance_manual_retry jobId=${existing.id} wkOrderId=${existing.wkOrderId} actorId=${actorId}`,
    );
    return this.getJob(jobId);
  }
}
