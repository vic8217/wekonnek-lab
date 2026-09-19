/**
 * Stage13B-3B two-phase admin discovery.
 * Phase 1: bounded Prisma rail candidate IDs (discovery clock only).
 * Phase 2: frozen FinancialReconciliationService.forOrder.
 * Never writes. Never duplicates financial math or detectors.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ReturnFinancialDeterminationStatus,
  RiderAdvanceStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialReconciliationSearchResponseDto, FinancialReconciliationSearchResultDto } from './financial-reconciliation-search.dto';
import {
  applyCursor,
  CANDIDATE_SCAN_MAX,
  matchesDerivedFilters,
  mapSearchCard,
  mergeSourceCandidates,
  nextCursorFor,
  ParsedSearchQuery,
  SourceCandidate,
} from './financial-reconciliation-search.policy';
import { FinancialReconciliationService } from './financial-reconciliation.service';
import {
  RAIL_EXCEPTION_FINANCIAL,
  RAIL_RETURN_FINANCIAL,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
} from './financial-reconciliation.types';

function activityWindow(since: Date, until: Date | null): Prisma.DateTimeFilter {
  const range: Prisma.DateTimeFilter = { gte: since };
  if (until) range.lte = until;
  return range;
}

function activityOr(
  since: Date,
  until: Date | null,
): { OR: Array<{ createdAt: Prisma.DateTimeFilter } | { updatedAt: Prisma.DateTimeFilter }> } {
  const range = activityWindow(since, until);
  return { OR: [{ createdAt: range }, { updatedAt: range }] };
}

function pickActivity(row: { createdAt: Date; updatedAt: Date }): Date {
  return row.updatedAt.getTime() >= row.createdAt.getTime()
    ? row.updatedAt
    : row.createdAt;
}

@Injectable()
export class FinancialReconciliationSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliation: FinancialReconciliationService,
  ) {}

  async search(
    parsed: ParsedSearchQuery,
  ): Promise<FinancialReconciliationSearchResponseDto> {
    const { filters, cursor, fingerprint } = parsed;

    if (filters.wkOrderId != null) {
      return this.evaluateExactOrder(filters.wkOrderId, parsed, null);
    }
    if (filters.obligationId != null && filters.rail != null) {
      const wkOrderId = await this.resolveObligationOrder(
        filters.rail,
        filters.obligationId,
      );
      if (wkOrderId == null) {
        return { items: [], nextCursor: null, scanned: 0, exhausted: true };
      }
      return this.evaluateExactOrder(wkOrderId, parsed, null);
    }

    const since = filters.since;
    if (since == null) {
      return { items: [], nextCursor: null, scanned: 0, exhausted: true };
    }
    const candidates = applyCursor(
      mergeSourceCandidates(await this.discoverCandidates(parsed)),
      cursor,
    );

    const items: FinancialReconciliationSearchResultDto[] = [];
    let scanned = 0;
    let lastEvaluated: SourceCandidate | null = null;
    for (const candidate of candidates) {
      if (scanned >= CANDIDATE_SCAN_MAX) break;
      scanned += 1;
      lastEvaluated = candidate;
      const card = await this.evaluateCandidate(candidate, parsed);
      if (card != null) items.push(card);
      if (items.length >= filters.limit) break;
    }

    const moreCandidates = scanned < candidates.length;
    const exhausted = !moreCandidates;
    const nextCursor =
      lastEvaluated != null && !exhausted
        ? nextCursorFor(lastEvaluated, fingerprint)
        : null;

    return { items, nextCursor, scanned, exhausted };
  }

  private async evaluateExactOrder(
    wkOrderId: number,
    parsed: ParsedSearchQuery,
    knownActivity: Date | null,
  ): Promise<FinancialReconciliationSearchResponseDto> {
    const activity = knownActivity ?? (await this.sourceActivityForOrder(wkOrderId));
    const candidate: SourceCandidate = {
      wkOrderId,
      sourceActivityAt: activity ?? new Date(0),
    };
    const card = await this.evaluateCandidate(candidate, parsed);
    return {
      items: card ? [card] : [],
      nextCursor: null,
      scanned: 1,
      exhausted: true,
    };
  }

  private async evaluateCandidate(
    candidate: SourceCandidate,
    parsed: ParsedSearchQuery,
  ) {
    let view;
    try {
      view = await this.reconciliation.forOrder(candidate.wkOrderId);
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
    if (!matchesDerivedFilters(view, parsed.filters)) return null;
    return mapSearchCard(view, candidate.sourceActivityAt);
  }

  private async resolveObligationOrder(
    rail: string,
    obligationId: string,
  ): Promise<number | null> {
    if (rail === RAIL_RIDER_ADVANCE_REIMBURSEMENT) {
      const row = await this.prisma.riderAdvance.findUnique({
        where: { id: obligationId },
        select: { wkOrderId: true },
      });
      return row?.wkOrderId ?? null;
    }
    if (rail === RAIL_RETURN_FINANCIAL) {
      const row = await this.prisma.returnFinancialObligation.findUnique({
        where: { id: obligationId },
        select: { wkOrderId: true },
      });
      return row?.wkOrderId ?? null;
    }
    if (rail === RAIL_EXCEPTION_FINANCIAL) {
      const row = await this.prisma.exceptionFinancialObligation.findUnique({
        where: { id: obligationId },
        select: { wkOrderId: true },
      });
      return row?.wkOrderId ?? null;
    }
    return null;
  }

  private async sourceActivityForOrder(wkOrderId: number): Promise<Date | null> {
    const [ra, ret, ex] = await Promise.all([
      this.prisma.riderAdvance.findMany({
        where: { wkOrderId },
        select: { createdAt: true, updatedAt: true },
      }),
      this.prisma.returnFinancialDetermination.findMany({
        where: { wkOrderId },
        select: { createdAt: true, updatedAt: true },
      }),
      this.prisma.exceptionFinancialObligation.findMany({
        where: { wkOrderId },
        select: { createdAt: true, updatedAt: true },
      }),
    ]);
    const times = [...ra, ...ret, ...ex].map(pickActivity);
    if (times.length === 0) return null;
    return times.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b));
  }

  private async discoverCandidates(
    parsed: ParsedSearchQuery,
  ): Promise<SourceCandidate[][]> {
    const since = parsed.filters.since!;
    const until = parsed.filters.until;
    const window = activityOr(since, until);
    const rail = parsed.filters.rail;
    const streams: SourceCandidate[][] = [];

    const wantRa =
      rail == null || rail === RAIL_RIDER_ADVANCE_REIMBURSEMENT;
    const wantReturn = rail == null || rail === RAIL_RETURN_FINANCIAL;
    const wantEx = rail == null || rail === RAIL_EXCEPTION_FINANCIAL;

    const [raRows, retRows, exRows] = await Promise.all([
      wantRa
        ? this.prisma.riderAdvance.findMany({
            where: {
              AND: [
                window,
                { status: { not: RiderAdvanceStatus.CANCELLED } },
                { reimbursementPrincipal: { gt: 0 } },
              ],
            },
            select: { wkOrderId: true, createdAt: true, updatedAt: true },
          })
        : Promise.resolve([]),
      wantReturn
        ? this.prisma.returnFinancialDetermination.findMany({
            where: {
              AND: [
                window,
                { status: ReturnFinancialDeterminationStatus.FINALIZED },
              ],
            },
            select: { wkOrderId: true, createdAt: true, updatedAt: true },
          })
        : Promise.resolve([]),
      wantEx
        ? this.prisma.exceptionFinancialObligation.findMany({
            where: window,
            select: { wkOrderId: true, createdAt: true, updatedAt: true },
          })
        : Promise.resolve([]),
    ]);

    if (wantRa) {
      streams.push(
        raRows.map((row) => ({
          wkOrderId: row.wkOrderId,
          sourceActivityAt: pickActivity(row),
        })),
      );
    }
    if (wantReturn) {
      streams.push(
        retRows.map((row) => ({
          wkOrderId: row.wkOrderId,
          sourceActivityAt: pickActivity(row),
        })),
      );
    }
    if (wantEx) {
      streams.push(
        exRows.map((row) => ({
          wkOrderId: row.wkOrderId,
          sourceActivityAt: pickActivity(row),
        })),
      );
    }
    return streams;
  }
}
