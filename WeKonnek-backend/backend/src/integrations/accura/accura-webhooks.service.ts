import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { accuraExternalClientReference } from './accura-client.types';
import {
  evaluateAccuraTimestamp,
  verifyAccuraWebhookSignature,
} from './accura-webhook.crypto';
import {
  ACCURA_INVOICE_ISSUED_EVENT,
  ACCURA_INVOICE_ISSUED_STATUS,
  ACCURA_SOURCE_SYSTEM,
  ACCURA_WEBHOOK_VERSION,
  DEFAULT_ACCURA_WEBHOOK_TOLERANCE_SECONDS,
  type AccuraInvoiceIssuedData,
  type AccuraWebhookEnvelope,
  type AccuraWebhookHandleInput,
  type AccuraWebhookResult,
} from './accura-webhook.types';

const AUTH_FAILED = 'Webhook authentication failed';

function headerValue(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function isUniqueConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function optionalText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (value === undefined || value === null) return undefined;
  throw new BadRequestException('Invalid webhook payload');
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`Invalid webhook payload: ${field}`);
  }
  return value.trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseExternalOrderId(value: unknown): number {
  if (typeof value === 'number') {
    if (
      !Number.isInteger(value) ||
      value <= 0 ||
      !Number.isSafeInteger(value)
    ) {
      throw new BadRequestException('Invalid webhook payload: externalOrderId');
    }
    return value;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException('Invalid webhook payload: externalOrderId');
  }
  const raw = value.trim();
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException('Invalid webhook payload: externalOrderId');
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || !Number.isSafeInteger(id)) {
    throw new BadRequestException('Invalid webhook payload: externalOrderId');
  }
  return id;
}

function parseIssuedAt(value: unknown): Date {
  const raw = requireNonEmptyString(value, 'issuedAt');
  const issuedAt = new Date(raw);
  if (Number.isNaN(issuedAt.getTime())) {
    throw new BadRequestException('Invalid webhook payload: issuedAt');
  }
  return issuedAt;
}

/**
 * Unknown WkOrder.externalOrderId returns HTTP 404 and writes nothing.
 * ACCURA invoice.issued is emitted after a committed WeKonnek order, so a
 * missing row is a permanent mismatch rather than a retryable create race.
 */
@Injectable()
export class AccuraWebhooksService {
  private readonly logger = new Logger(AccuraWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async handleWebhook(
    input: AccuraWebhookHandleInput,
  ): Promise<AccuraWebhookResult> {
    const secret = this.webhookSecret();
    const timestamp = headerValue(input.headers.timestamp);
    const signature = headerValue(input.headers.signature);
    const headerEventId = headerValue(input.headers.eventId);
    const now = input.now ?? new Date();

    if (!input.rawBody || !Buffer.isBuffer(input.rawBody)) {
      throw new UnauthorizedException(AUTH_FAILED);
    }

    const freshness = evaluateAccuraTimestamp(
      timestamp,
      now,
      this.toleranceSeconds(),
    );
    if (!freshness.ok) {
      this.audit({
        result: `rejected_timestamp_${freshness.reason}`,
        eventId: headerEventId,
        timestamp,
      });
      throw new UnauthorizedException(AUTH_FAILED);
    }

    const authentic = verifyAccuraWebhookSignature({
      secret,
      timestamp: timestamp as string,
      rawBody: input.rawBody,
      signatureHeader: signature,
    });
    if (!authentic) {
      this.audit({
        result: 'rejected_hmac',
        eventId: headerEventId,
        timestamp,
      });
      throw new UnauthorizedException(AUTH_FAILED);
    }

    const envelope = this.parseEnvelope(input.rawBody);
    if (!headerEventId || headerEventId !== envelope.eventId) {
      throw new BadRequestException('Invalid webhook payload: eventId');
    }

    if (envelope.version !== ACCURA_WEBHOOK_VERSION) {
      this.audit({
        result: 'rejected_unsupported_version',
        eventId: envelope.eventId,
        eventType: envelope.eventType,
        timestamp,
      });
      throw new BadRequestException('Unsupported ACCURA webhook version');
    }

    if (envelope.eventType !== ACCURA_INVOICE_ISSUED_EVENT) {
      this.audit({
        result: 'ignored_unsupported_event_type',
        eventId: envelope.eventId,
        eventType: envelope.eventType,
        timestamp,
      });
      return {
        outcome: 'ignored',
        eventId: envelope.eventId,
        eventType: envelope.eventType,
      };
    }

    return this.processInvoiceIssued(envelope);
  }

  private webhookSecret(): string {
    const secret = this.config.get<string>('ACCURA_WEBHOOK_SECRET')?.trim();
    if (!secret) {
      this.audit({ result: 'rejected_missing_secret' });
      throw new UnauthorizedException(AUTH_FAILED);
    }
    return secret;
  }

  private toleranceSeconds(): number {
    const raw = this.config.get<string | number>(
      'ACCURA_WEBHOOK_TOLERANCE_SECONDS',
    );
    const parsed = raw === undefined || raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_ACCURA_WEBHOOK_TOLERANCE_SECONDS;
    }
    return parsed;
  }

  private parseEnvelope(rawBody: Buffer): AccuraWebhookEnvelope {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid webhook payload');
    }
    const record = asRecord(parsed);
    if (!record) throw new BadRequestException('Invalid webhook payload');
    const data = asRecord(record.data);
    if (!data) {
      throw new BadRequestException('Invalid webhook payload: data');
    }
    return {
      version: requireNonEmptyString(record.version, 'version'),
      eventId: requireNonEmptyString(record.eventId, 'eventId'),
      eventType: requireNonEmptyString(record.eventType, 'eventType'),
      createdAt: requireNonEmptyString(record.createdAt, 'createdAt'),
      data,
    };
  }

  private parseInvoiceIssued(
    envelope: AccuraWebhookEnvelope,
  ): AccuraInvoiceIssuedData {
    const data = envelope.data;
    const status = requireNonEmptyString(data.status, 'status');
    const sourceSystem = requireNonEmptyString(
      data.sourceSystem,
      'sourceSystem',
    );
    if (status !== ACCURA_INVOICE_ISSUED_STATUS) {
      throw new BadRequestException('Invalid webhook payload: status');
    }
    if (sourceSystem !== ACCURA_SOURCE_SYSTEM) {
      throw new BadRequestException('Invalid webhook payload: sourceSystem');
    }
    const invoice: AccuraInvoiceIssuedData = {
      invoiceId: requireNonEmptyString(data.invoiceId, 'invoiceId'),
      invoiceNumber: requireNonEmptyString(data.invoiceNumber, 'invoiceNumber'),
      status,
      issuedAt: requireNonEmptyString(data.issuedAt, 'issuedAt'),
      documentHash: requireNonEmptyString(data.documentHash, 'documentHash'),
      sourceSystem,
      externalOrderId: optionalText(data.externalOrderId) ?? '',
    };
    parseIssuedAt(invoice.issuedAt);
    parseExternalOrderId(
      typeof data.externalOrderId === 'number'
        ? data.externalOrderId
        : invoice.externalOrderId,
    );
    const externalOrderCode = optionalText(data.externalOrderCode);
    if (externalOrderCode) invoice.externalOrderCode = externalOrderCode;
    const verificationUrl = optionalText(data.verificationUrl);
    if (verificationUrl) invoice.verificationUrl = verificationUrl;
    const externalClientReference = optionalText(data.externalClientReference);
    if (externalClientReference) {
      invoice.externalClientReference = externalClientReference;
    }
    return invoice;
  }

  private async processInvoiceIssued(
    envelope: AccuraWebhookEnvelope,
  ): Promise<AccuraWebhookResult> {
    const invoice = this.parseInvoiceIssued(envelope);
    const wkOrderId = parseExternalOrderId(invoice.externalOrderId);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existingEvent = await tx.accuraWebhookEvent.findUnique({
          where: { eventId: envelope.eventId },
        });
        if (existingEvent) {
          return this.duplicateResult(envelope, existingEvent.wkOrderId);
        }

        const order = await tx.wkOrder.findUnique({
          where: { id: wkOrderId },
          select: {
            id: true,
            orderCode: true,
            merchantId: true,
            paymentStatus: true,
            status: true,
          },
        });
        if (!order) {
          throw new NotFoundException('Order not found');
        }
        if (
          invoice.externalOrderCode &&
          order.orderCode !== invoice.externalOrderCode
        ) {
          throw new ConflictException('Order reference mismatch');
        }
        if (
          invoice.externalClientReference &&
          invoice.externalClientReference !==
            accuraExternalClientReference(order.merchantId)
        ) {
          throw new ConflictException('Order reference mismatch');
        }

        const association = await this.ensureInvoiceAssociation(tx, {
          envelope,
          invoice,
          order,
        });

        await tx.accuraWebhookEvent.create({
          data: {
            eventId: envelope.eventId,
            eventType: envelope.eventType,
            wkOrderId: order.id,
            accuraInvoiceId: association.accuraInvoiceId,
            payloadVersion: envelope.version,
            processedAt: new Date(),
          },
        });

        return {
          outcome: 'processed' as const,
          eventId: envelope.eventId,
          eventType: envelope.eventType,
          wkOrderId: order.id,
          orderCode: order.orderCode,
          accuraInvoiceId: association.accuraInvoiceId,
          accuraInvoiceNumber: association.accuraInvoiceNumber,
        };
      });
      this.audit({
        result: result.outcome,
        eventId: result.eventId,
        eventType: result.eventType,
        wkOrderId: result.wkOrderId,
        orderCode: result.orderCode,
        accuraInvoiceId: result.accuraInvoiceId,
        accuraInvoiceNumber: result.accuraInvoiceNumber,
      });
      return result;
    } catch (error) {
      if (isUniqueConflict(error)) {
        const existingEvent = await this.prisma.accuraWebhookEvent.findUnique({
          where: { eventId: envelope.eventId },
        });
        if (existingEvent) {
          const duplicate = this.duplicateResult(
            envelope,
            existingEvent.wkOrderId,
          );
          this.audit({
            result: 'duplicate',
            eventId: duplicate.eventId,
            eventType: duplicate.eventType,
            wkOrderId: duplicate.wkOrderId,
            accuraInvoiceId: existingEvent.accuraInvoiceId ?? undefined,
          });
          return duplicate;
        }
      }
      throw error;
    }
  }

  private duplicateResult(
    envelope: AccuraWebhookEnvelope,
    wkOrderId: number | null,
  ): AccuraWebhookResult {
    return {
      outcome: 'duplicate',
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      wkOrderId: wkOrderId ?? undefined,
    };
  }

  private async ensureInvoiceAssociation(
    tx: Prisma.TransactionClient,
    input: {
      envelope: AccuraWebhookEnvelope;
      invoice: AccuraInvoiceIssuedData;
      order: { id: number; orderCode: string };
    },
  ) {
    const existing = await tx.wkOrderAccuraInvoice.findUnique({
      where: { wkOrderId: input.order.id },
    });
    if (existing) {
      if (
        existing.accuraInvoiceId === input.invoice.invoiceId &&
        existing.accuraInvoiceNumber === input.invoice.invoiceNumber &&
        existing.accuraDocumentHash === input.invoice.documentHash
      ) {
        return existing;
      }
      this.audit({
        result: 'rejected_invoice_conflict',
        eventId: input.envelope.eventId,
        eventType: input.envelope.eventType,
        wkOrderId: input.order.id,
        orderCode: input.order.orderCode,
        accuraInvoiceId: existing.accuraInvoiceId,
        accuraInvoiceNumber: existing.accuraInvoiceNumber,
      });
      throw new ConflictException('ACCURA invoice association conflict');
    }

    const otherOrder = await tx.wkOrderAccuraInvoice.findUnique({
      where: { accuraInvoiceId: input.invoice.invoiceId },
    });
    if (otherOrder && otherOrder.wkOrderId !== input.order.id) {
      throw new ConflictException('ACCURA invoice association conflict');
    }

    try {
      return await tx.wkOrderAccuraInvoice.create({
        data: {
          wkOrderId: input.order.id,
          accuraInvoiceId: input.invoice.invoiceId,
          accuraInvoiceNumber: input.invoice.invoiceNumber,
          accuraIssuedAt: parseIssuedAt(input.invoice.issuedAt),
          accuraDocumentHash: input.invoice.documentHash,
          accuraVerificationUrl: input.invoice.verificationUrl ?? null,
          sourceSystem: input.invoice.sourceSystem,
          externalOrderId: String(input.order.id),
          externalOrderCode:
            input.invoice.externalOrderCode ?? input.order.orderCode,
        },
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const raced = await tx.wkOrderAccuraInvoice.findUnique({
        where: { wkOrderId: input.order.id },
      });
      if (
        raced &&
        raced.accuraInvoiceId === input.invoice.invoiceId &&
        raced.accuraInvoiceNumber === input.invoice.invoiceNumber &&
        raced.accuraDocumentHash === input.invoice.documentHash
      ) {
        return raced;
      }
      throw new ConflictException('ACCURA invoice association conflict');
    }
  }

  private audit(fields: {
    result: string;
    eventId?: string;
    eventType?: string;
    wkOrderId?: number;
    orderCode?: string;
    accuraInvoiceId?: string;
    accuraInvoiceNumber?: string;
    timestamp?: string;
  }) {
    this.logger.log(
      [
        'accura_webhook',
        `result=${fields.result}`,
        fields.eventId ? `eventId=${fields.eventId}` : null,
        fields.eventType ? `eventType=${fields.eventType}` : null,
        fields.wkOrderId !== undefined ? `wkOrderId=${fields.wkOrderId}` : null,
        fields.orderCode ? `orderCode=${fields.orderCode}` : null,
        fields.accuraInvoiceId
          ? `accuraInvoiceId=${fields.accuraInvoiceId}`
          : null,
        fields.accuraInvoiceNumber
          ? `accuraInvoiceNumber=${fields.accuraInvoiceNumber}`
          : null,
        fields.timestamp ? `timestamp=${fields.timestamp}` : null,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
}
