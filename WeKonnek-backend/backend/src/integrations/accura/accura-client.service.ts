import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isWkOrderEligibleForAccuraInvoice,
  mapWkOrderToAccuraInvoiceRequest,
  resolveAccuraIssuanceTargets,
  type AccuraOrderSnapshot,
} from './accura-client.mapping';
import {
  ACCURA_CLIENT_FETCH,
  ACCURA_INVOICE_CREATE_PATH,
  DEFAULT_ACCURA_API_TIMEOUT_MS,
  accuraBasicAuthorization,
  accuraInvoiceIdempotencyKey,
  type AccuraInvoiceIssueRequest,
  type AccuraInvoiceIssueResponse,
  type AccuraIssuanceOutcome,
} from './accura-client.types';

type AccuraPlatformIssuanceConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  seriesId: string;
  timeoutMs: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type AccuraFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'status' | 'json'>>;

@Injectable()
export class AccuraClientService {
  private readonly logger = new Logger(AccuraClientService.name);
  private readonly fetchImpl: AccuraFetch;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional()
    @Inject(ACCURA_CLIENT_FETCH)
    fetchImpl?: AccuraFetch,
  ) {
    this.fetchImpl =
      fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  }

  async issueInvoiceForOrder(
    wkOrderId: number,
  ): Promise<AccuraIssuanceOutcome> {
    const machine = this.platformMachineConfig();
    if (!machine) {
      this.audit({
        result: 'not_configured',
        wkOrderId,
        category: 'NOT_CONFIGURED',
      });
      return {
        ok: false,
        category: 'NOT_CONFIGURED',
        retryable: false,
        wkOrderId,
        message: 'ACCURA platform invoice API is not configured',
      };
    }

    const order = await this.loadOrder(wkOrderId);
    if (!order) {
      this.audit({
        result: 'order_not_found',
        wkOrderId,
        category: 'NOT_FOUND',
      });
      return {
        ok: false,
        category: 'NOT_FOUND',
        retryable: false,
        wkOrderId,
        message: 'Order not found',
      };
    }
    if (!isWkOrderEligibleForAccuraInvoice(order)) {
      this.audit({
        result: 'not_eligible',
        wkOrderId: order.id,
        orderCode: order.orderCode,
        category: 'NOT_ELIGIBLE',
      });
      return {
        ok: false,
        category: 'NOT_ELIGIBLE',
        retryable: false,
        wkOrderId: order.id,
        orderCode: order.orderCode,
        message: 'Order is not eligible for an official ACCURA invoice',
      };
    }

    const targets = resolveAccuraIssuanceTargets(order);
    if (!targets.ok) {
      this.audit({
        result: 'rejected_branch_mapping',
        wkOrderId: order.id,
        orderCode: order.orderCode,
        category: 'REJECTED',
      });
      return {
        ok: false,
        category: 'REJECTED',
        retryable: false,
        wkOrderId: order.id,
        orderCode: order.orderCode,
        message: targets.message,
      };
    }

    const request = mapWkOrderToAccuraInvoiceRequest(order, {
      branchId: targets.branchId,
      seriesId: machine.seriesId,
      externalClientReference: targets.externalClientReference,
    });
    if (request.items.length < 1) {
      return {
        ok: false,
        category: 'REJECTED',
        retryable: false,
        wkOrderId: order.id,
        orderCode: order.orderCode,
        message: 'Order has no invoiceable line items',
      };
    }
    return this.postIssuance(machine, order, request);
  }

  private async postIssuance(
    machine: AccuraPlatformIssuanceConfig,
    order: AccuraOrderSnapshot,
    request: AccuraInvoiceIssueRequest,
  ): Promise<AccuraIssuanceOutcome> {
    const url = `${machine.baseUrl}${ACCURA_INVOICE_CREATE_PATH}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), machine.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: accuraBasicAuthorization(
            machine.clientId,
            machine.clientSecret,
          ),
          'Content-Type': 'application/json',
          'Idempotency-Key': request.idempotencyKey,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const payload = await this.readJson(response);
      if (response.status === 201) {
        const issued = this.parseIssued(payload);
        if (!issued) {
          return {
            ok: false,
            category: 'REJECTED',
            retryable: true,
            wkOrderId: order.id,
            orderCode: order.orderCode,
            message: 'ACCURA issuance response was incomplete',
            httpStatus: response.status,
          };
        }
        this.audit({
          result: 'issued',
          wkOrderId: order.id,
          orderCode: order.orderCode,
          accuraInvoiceId: issued.invoiceId,
          accuraInvoiceNumber: issued.officialNumber,
          category: 'ISSUED',
        });
        return {
          ok: true,
          category: 'ISSUED',
          retryable: false,
          wkOrderId: order.id,
          orderCode: order.orderCode,
          invoiceId: issued.invoiceId,
          officialNumber: issued.officialNumber,
          status: issued.status,
          issuedAt: issued.issuedAt,
          documentHash: issued.documentHash,
          externalOrderId: issued.externalOrderId || String(order.id),
          externalOrderCode: issued.externalOrderCode || order.orderCode,
          httpStatus: response.status,
        };
      }
      return this.classifyHttpFailure(response.status, payload, order);
    } catch (error) {
      const aborted =
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError');
      const category = aborted ? 'TIMEOUT' : 'NETWORK';
      this.audit({
        result: aborted ? 'timeout' : 'network_error',
        wkOrderId: order.id,
        orderCode: order.orderCode,
        category,
      });
      return {
        ok: false,
        category,
        retryable: true,
        wkOrderId: order.id,
        orderCode: order.orderCode,
        message: aborted
          ? 'ACCURA issuance timed out'
          : 'ACCURA issuance network error',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private classifyHttpFailure(
    status: number,
    payload: unknown,
    order: AccuraOrderSnapshot,
  ): AccuraIssuanceOutcome {
    const record = asRecord(payload);
    const code = typeof record?.error === 'string' ? record.error : undefined;
    let category: Extract<AccuraIssuanceOutcome, { ok: false }>['category'] =
      'REJECTED';
    let retryable = false;
    if (status === 401 || status === 403 || code === 'UNAUTHORIZED_CLIENT') {
      category = 'AUTH';
    } else if (status === 409 || code === 'IDEMPOTENCY_KEY_REUSED') {
      category = 'IDEMPOTENCY_CONFLICT';
    } else if (status === 429 || code === 'RATE_LIMIT_EXCEEDED') {
      category = 'RATE_LIMITED';
      retryable = true;
    } else if (status >= 500) {
      category = 'SERVER';
      retryable = true;
    }
    this.audit({
      result: `http_${status}`,
      wkOrderId: order.id,
      orderCode: order.orderCode,
      category,
    });
    return {
      ok: false,
      category,
      retryable,
      wkOrderId: order.id,
      orderCode: order.orderCode,
      message: 'ACCURA issuance was not accepted',
      httpStatus: status,
    };
  }

  private parseIssued(payload: unknown): AccuraInvoiceIssueResponse | null {
    const record = asRecord(payload);
    if (!record) return null;
    const invoiceId =
      typeof record.invoiceId === 'string' ? record.invoiceId : '';
    const officialNumber =
      typeof record.officialNumber === 'string' ? record.officialNumber : '';
    const status = typeof record.status === 'string' ? record.status : '';
    const issuedAt = typeof record.issuedAt === 'string' ? record.issuedAt : '';
    const documentHash =
      typeof record.documentHash === 'string' ? record.documentHash : '';
    if (
      !invoiceId ||
      !officialNumber ||
      !status ||
      !issuedAt ||
      !documentHash
    ) {
      return null;
    }
    return {
      invoiceId,
      officialNumber,
      status,
      issuedAt,
      documentHash,
      grandTotal:
        typeof record.grandTotal === 'string' ||
        typeof record.grandTotal === 'number'
          ? record.grandTotal
          : undefined,
      externalOrderId:
        typeof record.externalOrderId === 'string'
          ? record.externalOrderId
          : null,
      externalOrderCode:
        typeof record.externalOrderCode === 'string'
          ? record.externalOrderCode
          : null,
    };
  }

  private async readJson(response: Pick<Response, 'json'>): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private async loadOrder(
    wkOrderId: number,
  ): Promise<AccuraOrderSnapshot | null> {
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: wkOrderId },
      include: {
        orderItems: {
          select: {
            productName: true,
            quantity: true,
            price: true,
            productId: true,
          },
        },
        shop: {
          select: {
            id: true,
            name: true,
            merchantId: true,
            accuraBranchMapping: {
              select: { merchantId: true, accuraBranchId: true },
            },
          },
        },
      },
    });
    if (!order) return null;
    const buyer = await this.prisma.user.findUnique({
      where: { id: order.userId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    });
    return { ...order, buyer };
  }

  private platformMachineConfig(): AccuraPlatformIssuanceConfig | null {
    const baseUrl = this.config.get<string>('ACCURA_API_BASE_URL')?.trim();
    const clientId = this.config.get<string>('ACCURA_PLATFORM_CLIENT_ID')?.trim();
    const clientSecret = this.config
      .get<string>('ACCURA_PLATFORM_CLIENT_SECRET')
      ?.trim();
    const seriesId = this.config.get<string>('ACCURA_SERIES_ID')?.trim();
    const timeoutRaw = this.config.get<string | number>(
      'ACCURA_API_TIMEOUT_MS',
    );
    const timeoutMs = Number(timeoutRaw ?? DEFAULT_ACCURA_API_TIMEOUT_MS);
    if (!baseUrl || !clientId || !clientSecret || !seriesId) {
      return null;
    }
    return {
      baseUrl: baseUrl.replace(/\/+$/, ''),
      clientId,
      clientSecret,
      seriesId,
      timeoutMs:
        Number.isFinite(timeoutMs) && timeoutMs > 0
          ? timeoutMs
          : DEFAULT_ACCURA_API_TIMEOUT_MS,
    };
  }

  private audit(fields: {
    result: string;
    category: string;
    wkOrderId?: number;
    orderCode?: string;
    accuraInvoiceId?: string;
    accuraInvoiceNumber?: string;
  }) {
    this.logger.log(
      [
        'accura_issuance',
        `result=${fields.result}`,
        `category=${fields.category}`,
        fields.wkOrderId !== undefined ? `wkOrderId=${fields.wkOrderId}` : null,
        fields.orderCode ? `orderCode=${fields.orderCode}` : null,
        fields.accuraInvoiceId
          ? `accuraInvoiceId=${fields.accuraInvoiceId}`
          : null,
        fields.accuraInvoiceNumber
          ? `accuraInvoiceNumber=${fields.accuraInvoiceNumber}`
          : null,
        `idempotencyKey=${
          fields.wkOrderId !== undefined
            ? accuraInvoiceIdempotencyKey(fields.wkOrderId)
            : 'none'
        }`,
      ]
        .filter(Boolean)
        .join(' '),
    );
  }
}
