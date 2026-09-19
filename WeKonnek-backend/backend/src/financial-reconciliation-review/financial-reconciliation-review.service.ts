/**
 * Stage14A FinancialReconciliationReview service.
 * Operational metadata only. Frozen Stage13B remains detector authority.
 * Review writes never lock frozen financial rails.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  FinancialReconciliationReviewEventType,
  FinancialReconciliationReviewRoute,
  FinancialReconciliationReviewStatus,
  FinancialReconciliationReviewWaitingParty,
  Prisma,
  UserRole,
} from '@prisma/client';
import { FinancialReconciliationService } from '../financial-reconciliation/financial-reconciliation.service';
import type { OrderFinancialReconciliation } from '../financial-reconciliation/financial-reconciliation.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  allowedRouteClassifications,
  assertRouteAllowed,
  buildDetectorFingerprint,
  encodeReviewCursor,
  isReviewOnlyCloseCode,
  isTerminalReviewStatus,
  locateLiveFinding,
  parseExpectedVersion,
  parseReviewListQuery,
  validateIdempotencyKey,
  validateNoteBody,
  validateReason,
  WAITING_PARTY_VALUES,
  type ReviewWaitingParty,
} from './financial-reconciliation-review.policy';

type RequestUser = {
  id?: string;
  role?: UserRole;
  portal?: string;
};

type LiveSnapshot = {
  order: OrderFinancialReconciliation;
  fingerprint: string;
};

@Injectable()
export class FinancialReconciliationReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliation: FinancialReconciliationService,
  ) {}

  async assertPersistedAdmin(user: RequestUser | undefined): Promise<{ id: string }> {
    if (!user?.id) throw new UnauthorizedException();
    if (user.portal === 'shop') {
      throw new ForbiddenException({
        code: 'REVIEW_FORBIDDEN',
        message: 'Financial reconciliation review is not available for this actor',
      });
    }
    const persisted = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, role: true, isActive: true },
    });
    if (!persisted || persisted.isActive === false) {
      throw new UnauthorizedException();
    }
    if (persisted.role !== UserRole.admin) {
      throw new ForbiddenException({
        code: 'REVIEW_FORBIDDEN',
        message: 'Financial reconciliation review is not available for this actor',
      });
    }
    return { id: persisted.id };
  }

  private async liveSnapshot(wkOrderId: number): Promise<LiveSnapshot> {
    const order = await this.reconciliation.forOrder(wkOrderId);
    return {
      order,
      fingerprint: buildDetectorFingerprint({
        findings: order.findings,
        relatedItems: order.relatedItems,
      }),
    };
  }

  private async requireAssignableAdmin(userId: string): Promise<void> {
    const persisted = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isActive: true },
    });
    if (!persisted || persisted.isActive === false || persisted.role !== UserRole.admin) {
      throw new BadRequestException({
        code: 'INVALID_ASSIGNEE',
        message: 'Assignee must be an active system admin.',
      });
    }
  }

  private conflict(code: string, message = code): never {
    throw new ConflictException({ code, message });
  }

  private bad(code: string, message = code): never {
    throw new BadRequestException({ code, message });
  }

  async create(
    actorUserId: string,
    input: { wkOrderId: unknown; findingKey: unknown },
  ) {
    const wkOrderId = Number(input.wkOrderId);
    if (!Number.isInteger(wkOrderId) || wkOrderId <= 0) {
      this.bad('INVALID_EXACT_KEY', 'INVALID_EXACT_KEY: wkOrderId');
    }
    if (typeof input.findingKey !== 'string' || input.findingKey.trim() === '') {
      this.bad('INVALID_FINDING_KEY', 'INVALID_FINDING_KEY');
    }
    const requestedKey = input.findingKey.trim();
    const live = await this.liveSnapshot(wkOrderId);
    const finding = locateLiveFinding(live.order.findings, requestedKey);
    if (!finding) {
      this.conflict('STALE_FINDING', 'STALE_FINDING');
    }

    const existing = await this.prisma.financialReconciliationReview.findFirst({
      where: {
        wkOrderId,
        findingKey: finding.findingKey,
        status: {
          in: [
            FinancialReconciliationReviewStatus.OPEN,
            FinancialReconciliationReviewStatus.IN_REVIEW,
            FinancialReconciliationReviewStatus.WAITING_ON_PARTY,
            FinancialReconciliationReviewStatus.ESCALATED_ENGINEERING,
          ],
        },
      },
    });
    if (existing) {
      return { created: false, review: await this.loadReview(existing.id, live) };
    }

    const prior = await this.prisma.financialReconciliationReview.findFirst({
      where: {
        wkOrderId,
        findingKey: finding.findingKey,
        status: FinancialReconciliationReviewStatus.CLOSED_CONDITION_CLEARED,
      },
      orderBy: { closedAt: 'desc' },
    });

    try {
    const created = await this.prisma.$transaction(async (tx) => {
      const review = await tx.financialReconciliationReview.create({
        data: {
          wkOrderId,
          findingKey: finding.findingKey,
          findingCode: finding.code,
          openingFingerprint: live.fingerprint,
          currentFingerprint: live.fingerprint,
          status: FinancialReconciliationReviewStatus.OPEN,
          priorReviewId: prior?.id ?? null,
          createdByAdminUserId: actorUserId,
        },
      });
      await tx.financialReconciliationReviewEvent.create({
        data: {
          reviewId: review.id,
          type: FinancialReconciliationReviewEventType.REVIEW_OPENED,
          actorAdminUserId: actorUserId,
          payload: {
            findingKey: finding.findingKey,
            findingCode: finding.code,
            fingerprint: live.fingerprint,
          },
        },
      });
      if (prior) {
        await tx.financialReconciliationReviewEvent.create({
          data: {
            reviewId: review.id,
            type: FinancialReconciliationReviewEventType.NEW_CASE_FROM_REAPPEARANCE,
            actorAdminUserId: actorUserId,
            payload: { priorReviewId: prior.id },
          },
        });
      }
      return review;
    });

    return { created: true, review: await this.loadReview(created.id, live) };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this.prisma.financialReconciliationReview.findFirst({
          where: {
            wkOrderId,
            findingKey: finding.findingKey,
            status: {
              in: [
                FinancialReconciliationReviewStatus.OPEN,
                FinancialReconciliationReviewStatus.IN_REVIEW,
                FinancialReconciliationReviewStatus.WAITING_ON_PARTY,
                FinancialReconciliationReviewStatus.ESCALATED_ENGINEERING,
              ],
            },
          },
        });
        if (raced) {
          return { created: false, review: await this.loadReview(raced.id, live) };
        }
      }
      throw err;
    }
  }

  async list(actorUserId: string, query: Record<string, string | undefined>) {
    const parsed = parseReviewListQuery(query);
    if (!parsed.ok) this.bad(parsed.code, parsed.message);
    const filters = parsed.value;

    const where: Prisma.FinancialReconciliationReviewWhereInput = {
      createdAt: { gte: filters.since, lte: filters.until },
    };
    if (filters.status) {
      where.status = filters.status as FinancialReconciliationReviewStatus;
    }
    if (filters.wkOrderId != null) where.wkOrderId = filters.wkOrderId;
    if (filters.findingCode) where.findingCode = filters.findingCode;
    if (filters.findingKey) where.findingKey = filters.findingKey;
    if (filters.assignedTo === 'me') where.assignedAdminUserId = actorUserId;
    if (filters.assignedTo === 'unassigned') where.assignedAdminUserId = null;
    if (filters.assignedAdminUserId) {
      where.assignedAdminUserId = filters.assignedAdminUserId;
    }
    if (filters.cursor) {
      where.OR = [
        { createdAt: { lt: new Date(filters.cursor.createdAt) } },
        {
          createdAt: new Date(filters.cursor.createdAt),
          id: { lt: filters.cursor.id },
        },
      ];
    }

    const rows = await this.prisma.financialReconciliationReview.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filters.limit + 1,
    });
    const page = rows.slice(0, filters.limit);
    const next = rows.length > filters.limit ? rows[filters.limit] : null;
    return {
      items: page.map((row) => this.listItem(row)),
      nextCursor: next ? encodeReviewCursor(next.createdAt, next.id) : null,
    };
  }

  async get(id: string) {
    const review = await this.prisma.financialReconciliationReview.findUnique({
      where: { id },
    });
    if (!review) {
      throw new NotFoundException({
        code: 'REVIEW_NOT_FOUND',
        message: 'REVIEW_NOT_FOUND',
      });
    }
    const live = await this.liveSnapshot(review.wkOrderId);
    return this.loadReview(review.id, live);
  }

  async assign(
    actorUserId: string,
    id: string,
    input: { assignedAdminUserId?: unknown; expectedVersion?: unknown },
  ) {
    const version = parseExpectedVersion(input.expectedVersion);
    if (!version.ok) this.bad(version.code, version.message);
    let assignee: string | null = null;
    if (input.assignedAdminUserId != null && input.assignedAdminUserId !== '') {
      if (typeof input.assignedAdminUserId !== 'string') {
        this.bad('INVALID_ASSIGNEE', 'INVALID_ASSIGNEE');
      }
      assignee = input.assignedAdminUserId;
      await this.requireAssignableAdmin(assignee);
    }
    return this.mutateOpen(id, version.version, actorUserId, async (tx, current) => {
      const nextStatus =
        assignee == null
          ? current.status === FinancialReconciliationReviewStatus.IN_REVIEW
            ? FinancialReconciliationReviewStatus.OPEN
            : current.status
          : current.status === FinancialReconciliationReviewStatus.OPEN
            ? FinancialReconciliationReviewStatus.IN_REVIEW
            : current.status;
      const updated = await tx.financialReconciliationReview.update({
        where: { id: current.id, rowVersion: current.rowVersion },
        data: {
          assignedAdminUserId: assignee,
          status: nextStatus,
          rowVersion: { increment: 1 },
        },
      });
      await tx.financialReconciliationReviewEvent.create({
        data: {
          reviewId: current.id,
          type: assignee
            ? FinancialReconciliationReviewEventType.ASSIGNED
            : FinancialReconciliationReviewEventType.UNASSIGNED,
          actorAdminUserId: actorUserId,
          payload: { assignedAdminUserId: assignee },
        },
      });
      return updated.id;
    });
  }

  async addNote(
    actorUserId: string,
    id: string,
    input: { body?: unknown; idempotencyKey?: unknown },
  ) {
    const body = validateNoteBody(input.body);
    if (!body.ok) this.bad(body.code, body.message);
    const key = validateIdempotencyKey(input.idempotencyKey);
    if (!key.ok) this.bad(key.code, key.message);
    const review = await this.requireReview(id);
    const existing = await this.prisma.financialReconciliationReviewNote.findUnique({
      where: {
        reviewId_idempotencyKey: {
          reviewId: review.id,
          idempotencyKey: key.key,
        },
      },
    });
    if (existing) {
      if (existing.body !== body.body) {
        this.conflict('NOTE_IDEMPOTENCY_CONFLICT', 'NOTE_IDEMPOTENCY_CONFLICT');
      }
      return existing;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const note = await tx.financialReconciliationReviewNote.create({
          data: {
            reviewId: review.id,
            authorAdminUserId: actorUserId,
            body: body.body,
            idempotencyKey: key.key,
          },
        });
        await tx.financialReconciliationReviewEvent.create({
          data: {
            reviewId: review.id,
            type: FinancialReconciliationReviewEventType.NOTE_ADDED,
            actorAdminUserId: actorUserId,
            payload: { noteId: note.id },
          },
        });
        return note;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this.prisma.financialReconciliationReviewNote.findUnique({
          where: {
            reviewId_idempotencyKey: {
              reviewId: review.id,
              idempotencyKey: key.key,
            },
          },
        });
        if (raced) {
          if (raced.body !== body.body) {
            this.conflict('NOTE_IDEMPOTENCY_CONFLICT', 'NOTE_IDEMPOTENCY_CONFLICT');
          }
          return raced;
        }
      }
      throw err;
    }
  }

  async refresh(actorUserId: string, id: string) {
    const review = await this.requireReview(id);
    if (isTerminalReviewStatus(review.status)) {
      this.conflict('REVIEW_ALREADY_CLOSED', 'REVIEW_ALREADY_CLOSED');
    }
    const live = await this.liveSnapshot(review.wkOrderId);
    await this.prisma.$transaction(async (tx) => {
      await tx.financialReconciliationReview.update({
        where: { id: review.id, rowVersion: review.rowVersion },
        data: {
          currentFingerprint: live.fingerprint,
          rowVersion: { increment: 1 },
        },
      });
      await tx.financialReconciliationReviewEvent.create({
        data: {
          reviewId: review.id,
          type: FinancialReconciliationReviewEventType.LIVE_RECONCILIATION_REFRESHED,
          actorAdminUserId: actorUserId,
          payload: {
            fingerprint: live.fingerprint,
            findingActive: live.order.findings.some(
              (finding) => finding.findingKey === review.findingKey,
            ),
          },
        },
      });
    });
    return this.loadReview(id, live);
  }

  async classifyRoute(
    actorUserId: string,
    id: string,
    input: { routeClassification?: unknown; expectedVersion?: unknown },
  ) {
    const version = parseExpectedVersion(input.expectedVersion);
    if (!version.ok) this.bad(version.code, version.message);
    if (typeof input.routeClassification !== 'string') {
      this.bad('INVALID_ROUTE_CLASSIFICATION', 'INVALID_ROUTE_CLASSIFICATION');
    }
    const requestedRoute = input.routeClassification;
    return this.withLiveFinding(id, actorUserId, async (current, live, finding) => {
      const allowed = assertRouteAllowed(finding.code, requestedRoute);
      if (!allowed.ok) this.bad(allowed.code, allowed.message);
      return this.mutateOpen(id, version.version, actorUserId, async (tx) => {
        const updated = await tx.financialReconciliationReview.update({
          where: { id: current.id, rowVersion: current.rowVersion },
          data: {
            routeClassification: allowed.route as FinancialReconciliationReviewRoute,
            currentFingerprint: live.fingerprint,
            rowVersion: { increment: 1 },
          },
        });
        await tx.financialReconciliationReviewEvent.create({
          data: {
            reviewId: current.id,
            type: FinancialReconciliationReviewEventType.ROUTE_CLASSIFIED,
            actorAdminUserId: actorUserId,
            payload: { routeClassification: allowed.route },
          },
        });
        return updated.id;
      }, live);
    });
  }

  async waitOnParty(
    actorUserId: string,
    id: string,
    input: {
      waitingPartyType?: unknown;
      expectedVersion?: unknown;
      reason?: unknown;
    },
  ) {
    const version = parseExpectedVersion(input.expectedVersion);
    if (!version.ok) this.bad(version.code, version.message);
    if (
      typeof input.waitingPartyType !== 'string' ||
      !(WAITING_PARTY_VALUES as readonly string[]).includes(input.waitingPartyType)
    ) {
      this.bad('INVALID_WAITING_PARTY', 'INVALID_WAITING_PARTY');
    }
    const party = input.waitingPartyType as ReviewWaitingParty;
    let reason: string | undefined;
    if (input.reason != null) {
      const parsed = validateReason(input.reason);
      if (!parsed.ok) this.bad(parsed.code, parsed.message);
      reason = parsed.reason;
    }
    return this.withLiveFinding(id, actorUserId, async (current, live) => {
      const routeCheck = assertRouteAllowed(current.findingCode, 'WAITING_ON_PARTY');
      if (!routeCheck.ok) this.bad(routeCheck.code, routeCheck.message);
      return this.mutateOpen(id, version.version, actorUserId, async (tx) => {
        const updated = await tx.financialReconciliationReview.update({
          where: { id: current.id, rowVersion: current.rowVersion },
          data: {
            status: FinancialReconciliationReviewStatus.WAITING_ON_PARTY,
            waitingPartyType: party as FinancialReconciliationReviewWaitingParty,
            routeClassification: FinancialReconciliationReviewRoute.WAITING_ON_PARTY,
            currentFingerprint: live.fingerprint,
            rowVersion: { increment: 1 },
          },
        });
        await tx.financialReconciliationReviewEvent.create({
          data: {
            reviewId: current.id,
            type: FinancialReconciliationReviewEventType.WAITING_ON_PARTY,
            actorAdminUserId: actorUserId,
            payload: { waitingPartyType: party, reason: reason ?? null },
          },
        });
        return updated.id;
      }, live);
    });
  }

  async escalate(
    actorUserId: string,
    id: string,
    input: { reason?: unknown; expectedVersion?: unknown },
  ) {
    const version = parseExpectedVersion(input.expectedVersion);
    if (!version.ok) this.bad(version.code, version.message);
    const reason = validateReason(input.reason);
    if (!reason.ok) this.bad(reason.code, reason.message);
    return this.withLiveFinding(id, actorUserId, async (current, live) => {
      return this.mutateOpen(id, version.version, actorUserId, async (tx) => {
        const updated = await tx.financialReconciliationReview.update({
          where: { id: current.id, rowVersion: current.rowVersion },
          data: {
            status: FinancialReconciliationReviewStatus.ESCALATED_ENGINEERING,
            routeClassification: FinancialReconciliationReviewRoute.ENGINEERING,
            currentFingerprint: live.fingerprint,
            rowVersion: { increment: 1 },
          },
        });
        await tx.financialReconciliationReviewEvent.create({
          data: {
            reviewId: current.id,
            type: FinancialReconciliationReviewEventType.ESCALATED_ENGINEERING,
            actorAdminUserId: actorUserId,
            payload: { reason: reason.reason },
          },
        });
        return updated.id;
      }, live);
    });
  }

  async close(
    actorUserId: string,
    id: string,
    input: { mode?: unknown; reason?: unknown; expectedVersion?: unknown },
  ) {
    const version = parseExpectedVersion(input.expectedVersion);
    if (!version.ok) this.bad(version.code, version.message);
    const reason = validateReason(input.reason);
    if (!reason.ok) this.bad(reason.code, reason.message);
    if (input.mode !== 'CONDITION_CLEARED' && input.mode !== 'REVIEW_ONLY') {
      this.bad('INVALID_CLOSE_MODE', 'INVALID_CLOSE_MODE');
    }
    const current = await this.requireReview(id);
    if (isTerminalReviewStatus(current.status)) {
      this.conflict('REVIEW_ALREADY_CLOSED', 'REVIEW_ALREADY_CLOSED');
    }
    const live = await this.liveSnapshot(current.wkOrderId);
    const findingActive = live.order.findings.some(
      (finding) => finding.findingKey === current.findingKey,
    );
    if (input.mode === 'CONDITION_CLEARED') {
      if (findingActive) {
        await this.recordStale(current.id, actorUserId, live.fingerprint);
        this.conflict('FINDING_STILL_ACTIVE', 'FINDING_STILL_ACTIVE');
      }
      return this.mutateOpen(id, version.version, actorUserId, async (tx) => {
        const updated = await tx.financialReconciliationReview.update({
          where: { id: current.id, rowVersion: current.rowVersion },
          data: {
            status: FinancialReconciliationReviewStatus.CLOSED_CONDITION_CLEARED,
            closeClassification:
              FinancialReconciliationReviewStatus.CLOSED_CONDITION_CLEARED,
            closeReason: reason.reason,
            currentFingerprint: live.fingerprint,
            closedAt: new Date(),
            rowVersion: { increment: 1 },
          },
        });
        await tx.financialReconciliationReviewEvent.create({
          data: {
            reviewId: current.id,
            type: FinancialReconciliationReviewEventType.CLOSED_CONDITION_CLEARED,
            actorAdminUserId: actorUserId,
            payload: { reason: reason.reason },
          },
        });
        return updated.id;
      }, live);
    }
    if (!isReviewOnlyCloseCode(current.findingCode)) {
      this.bad('REVIEW_ONLY_NOT_ALLOWED', 'REVIEW_ONLY_NOT_ALLOWED');
    }
    if (!findingActive) {
      this.conflict(
        'FINDING_ALREADY_CLEARED',
        'FINDING_ALREADY_CLEARED: use CONDITION_CLEARED',
      );
    }
    return this.mutateOpen(id, version.version, actorUserId, async (tx) => {
      const updated = await tx.financialReconciliationReview.update({
        where: { id: current.id, rowVersion: current.rowVersion },
        data: {
          status: FinancialReconciliationReviewStatus.CLOSED_REVIEW_ONLY,
          closeClassification: FinancialReconciliationReviewStatus.CLOSED_REVIEW_ONLY,
          closeReason: reason.reason,
          currentFingerprint: live.fingerprint,
          closedAt: new Date(),
          rowVersion: { increment: 1 },
        },
      });
      await tx.financialReconciliationReviewEvent.create({
        data: {
          reviewId: current.id,
          type: FinancialReconciliationReviewEventType.CLOSED_REVIEW_ONLY,
          actorAdminUserId: actorUserId,
          payload: { reason: reason.reason },
        },
      });
      return updated.id;
    }, live);
  }

  private async withLiveFinding<T>(
    id: string,
    actorUserId: string,
    fn: (
      current: Awaited<ReturnType<FinancialReconciliationReviewService['requireReview']>>,
      live: LiveSnapshot,
      finding: NonNullable<ReturnType<typeof locateLiveFinding>>,
    ) => Promise<T>,
  ): Promise<T> {
    const current = await this.requireReview(id);
    if (isTerminalReviewStatus(current.status)) {
      this.conflict('REVIEW_ALREADY_CLOSED', 'REVIEW_ALREADY_CLOSED');
    }
    const live = await this.liveSnapshot(current.wkOrderId);
    const finding = locateLiveFinding(live.order.findings, current.findingKey);
    if (!finding) {
      await this.recordStale(current.id, actorUserId, live.fingerprint);
      this.conflict('STALE_FINDING', 'STALE_FINDING');
    }
    return fn(current, live, finding);
  }

  private async mutateOpen(
    id: string,
    expectedVersion: number,
    _actorUserId: string,
    writer: (
      tx: Prisma.TransactionClient,
      current: Awaited<ReturnType<FinancialReconciliationReviewService['requireReview']>>,
    ) => Promise<string>,
    live?: LiveSnapshot,
  ) {
    const current = await this.requireReview(id);
    if (isTerminalReviewStatus(current.status) && live == null) {
      this.conflict('REVIEW_ALREADY_CLOSED', 'REVIEW_ALREADY_CLOSED');
    }
    if (current.rowVersion !== expectedVersion) {
      this.conflict('REVIEW_VERSION_CONFLICT', 'REVIEW_VERSION_CONFLICT');
    }
    try {
      const updatedId = await this.prisma.$transaction(async (tx) =>
        writer(tx, current),
      );
      return this.loadReview(updatedId, live);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        this.conflict('REVIEW_VERSION_CONFLICT', 'REVIEW_VERSION_CONFLICT');
      }
      throw err;
    }
  }

  private async recordStale(
    reviewId: string,
    actorUserId: string,
    fingerprint: string,
  ): Promise<void> {
    await this.prisma.financialReconciliationReviewEvent.create({
      data: {
        reviewId,
        type: FinancialReconciliationReviewEventType.STALE_FINDING_REJECTED,
        actorAdminUserId: actorUserId,
        payload: { fingerprint },
      },
    });
  }

  private async requireReview(id: string) {
    const review = await this.prisma.financialReconciliationReview.findUnique({
      where: { id },
    });
    if (!review) {
      throw new NotFoundException({
        code: 'REVIEW_NOT_FOUND',
        message: 'REVIEW_NOT_FOUND',
      });
    }
    return review;
  }

  private async loadReview(id: string, live?: LiveSnapshot) {
    const review = await this.requireReview(id);
    const snapshot = live ?? (await this.liveSnapshot(review.wkOrderId));
    const [notes, events] = await Promise.all([
      this.prisma.financialReconciliationReviewNote.findMany({
        where: { reviewId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.financialReconciliationReviewEvent.findMany({
        where: { reviewId: id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const findingActive = snapshot.order.findings.some(
      (finding) => finding.findingKey === review.findingKey,
    );
    const terminal = isTerminalReviewStatus(review.status);
    const stale = review.openingFingerprint !== snapshot.fingerprint;
    const needsRefresh =
      !terminal &&
      (review.currentFingerprint == null ||
        review.currentFingerprint !== snapshot.fingerprint);
    return {
      id: review.id,
      wkOrderId: review.wkOrderId,
      findingKey: review.findingKey,
      findingCode: review.findingCode,
      status: review.status,
      assignedAdminUserId: review.assignedAdminUserId,
      routeClassification: review.routeClassification,
      waitingPartyType: review.waitingPartyType,
      closeClassification: review.closeClassification,
      closeReason: review.closeReason,
      priorReviewId: review.priorReviewId,
      rowVersion: review.rowVersion,
      createdByAdminUserId: review.createdByAdminUserId,
      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
      closedAt: review.closedAt?.toISOString() ?? null,
      openingFingerprint: review.openingFingerprint,
      currentFingerprint: terminal
        ? (review.currentFingerprint ?? review.openingFingerprint)
        : snapshot.fingerprint,
      findingActive,
      stale,
      needsRefresh,
      allowedRouteClassifications: allowedRouteClassifications(review.findingCode),
      reviewOnlyClosePermitted: isReviewOnlyCloseCode(review.findingCode),
      notes: notes.map((note) => ({
        id: note.id,
        authorAdminUserId: note.authorAdminUserId,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
      })),
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        payload: event.payload,
        actorAdminUserId: event.actorAdminUserId,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  private listItem(row: {
    id: string;
    wkOrderId: number;
    findingKey: string;
    findingCode: string;
    status: FinancialReconciliationReviewStatus;
    assignedAdminUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
    rowVersion: number;
  }) {
    return {
      id: row.id,
      wkOrderId: row.wkOrderId,
      findingKey: row.findingKey,
      findingCode: row.findingCode,
      status: row.status,
      assignedAdminUserId: row.assignedAdminUserId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      rowVersion: row.rowVersion,
    };
  }
}
