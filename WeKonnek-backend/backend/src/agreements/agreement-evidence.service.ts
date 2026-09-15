import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgreementEvidenceType, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OrderDomainEventService } from '../fulfillment/order-domain-event.service';
import { AgreementService, hashEvidencePayload } from './agreement.service';

@Injectable()
export class AgreementEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: OrderDomainEventService,
    private readonly agreements: AgreementService,
  ) {}

  async addEvidence(input: {
    agreementId: string;
    actorUserId: string;
    evidenceType: AgreementEvidenceType;
    contentType?: string;
    sizeBytes?: number;
    storageReference?: string;
    capturedAt?: Date;
    metadata?: Prisma.InputJsonValue;
    idempotencyKey?: string;
    merchantPaymentEvidenceId?: string;
    correlationId?: string;
  }) {
    if (input.idempotencyKey) {
      const prior = await this.prisma.agreementEvidence.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (prior) return { evidence: prior, idempotent: true };
    }

    const agreement = await this.agreements.getAgreement(
      input.agreementId,
      input.actorUserId,
    );

    if (input.merchantPaymentEvidenceId) {
      const mpe = await this.prisma.merchantPaymentEvidence.findUnique({
        where: { id: input.merchantPaymentEvidenceId },
      });
      if (!mpe || mpe.wkOrderId !== agreement.wkOrderId) {
        throw new BadRequestException(
          'merchantPaymentEvidenceId does not belong to this agreement order',
        );
      }
    }

    try {
      const evidence = await this.prisma.agreementEvidence.create({
        data: {
          id: randomUUID(),
          agreementId: agreement.id,
          agreementVersionId: agreement.currentVersionId ?? undefined,
          wkOrderId: agreement.wkOrderId ?? undefined,
          evidenceType: input.evidenceType,
          contentHash: hashEvidencePayload({
            contentType: input.contentType,
            storageReference: input.storageReference,
            sizeBytes: input.sizeBytes,
          }),
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          storageReference: input.storageReference,
          capturedAt: input.capturedAt,
          submittedBy: input.actorUserId,
          metadata: input.metadata,
          finalized: true,
          idempotencyKey: input.idempotencyKey,
          merchantPaymentEvidenceId: input.merchantPaymentEvidenceId,
        },
      });

      await this.events.record({
        aggregateType: 'AGREEMENT',
        aggregateId: agreement.id,
        wkOrderId: agreement.wkOrderId,
        actorId: input.actorUserId,
        action: 'EVIDENCE_ADDED',
        correlationId: input.correlationId,
        metadata: {
          evidenceId: evidence.id,
          evidenceType: evidence.evidenceType,
          hasStorageRef: Boolean(input.storageReference),
        },
      });

      return { evidence, idempotent: false };
    } catch (err) {
      // Concurrent same-key submissions: unique constraint wins → one authoritative row.
      if (
        input.idempotencyKey &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const prior = await this.prisma.agreementEvidence.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (prior) return { evidence: prior, idempotent: true };
      }
      throw err;
    }
  }

  async supersedeEvidence(input: {
    evidenceId: string;
    actorUserId: string;
    replacement: {
      evidenceType: AgreementEvidenceType;
      contentType?: string;
      sizeBytes?: number;
      storageReference?: string;
      metadata?: Prisma.InputJsonValue;
    };
    correlationId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "agreement_evidences" WHERE id = ${input.evidenceId}::uuid FOR UPDATE
      `;
      const prior = await tx.agreementEvidence.findUniqueOrThrow({
        where: { id: input.evidenceId },
      });
      if (!prior.finalized) {
        throw new BadRequestException('Evidence is not finalized');
      }
      if (prior.supersededById) {
        throw new ConflictException('Evidence already superseded');
      }
      await this.agreements.getAgreement(prior.agreementId, input.actorUserId);

      const replacement = await tx.agreementEvidence.create({
        data: {
          id: randomUUID(),
          agreementId: prior.agreementId,
          agreementVersionId: prior.agreementVersionId ?? undefined,
          wkOrderId: prior.wkOrderId ?? undefined,
          evidenceType: input.replacement.evidenceType,
          contentHash: hashEvidencePayload(input.replacement),
          contentType: input.replacement.contentType,
          sizeBytes: input.replacement.sizeBytes,
          storageReference: input.replacement.storageReference,
          submittedBy: input.actorUserId,
          metadata: input.replacement.metadata,
          finalized: true,
        },
      });
      await tx.agreementEvidence.update({
        where: { id: prior.id },
        data: { supersededById: replacement.id },
      });
      await this.events.record({
        tx,
        aggregateType: 'AGREEMENT',
        aggregateId: prior.agreementId,
        wkOrderId: prior.wkOrderId,
        actorId: input.actorUserId,
        action: 'EVIDENCE_SUPERSEDED',
        correlationId: input.correlationId,
        metadata: {
          priorEvidenceId: prior.id,
          replacementEvidenceId: replacement.id,
        },
      });
      return { prior, replacement };
    });
  }

  async assertImmutable(evidenceId: string) {
    const row = await this.prisma.agreementEvidence.findUnique({
      where: { id: evidenceId },
    });
    if (!row) throw new NotFoundException('Evidence not found');
    if (row.finalized) {
      throw new ForbiddenException(
        'Finalized evidence cannot be mutated or deleted; create a superseding record',
      );
    }
    return row;
  }
}
