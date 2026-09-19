/**
 * Stage13B-3B search service unit tests: scan cap, skip, exact-key.
 * Prisma and forOrder are mocked — no database.
 */
import { NotFoundException } from '@nestjs/common';
import { FinancialReconciliationSearchService } from './financial-reconciliation-search.service';
import {
  CANDIDATE_SCAN_MAX,
  parseSearchQuery,
} from './financial-reconciliation-search.policy';
import { FinancialReconciliationService } from './financial-reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  OrderFinancialReconciliation,
  RAIL_RIDER_ADVANCE_REIMBURSEMENT,
  RECONCILIATION_FINDING_CODES,
} from './financial-reconciliation.types';

function emptyView(wkOrderId: number): OrderFinancialReconciliation {
  return {
    wkOrderId,
    items: [],
    directionalGroups: [],
    findings: [],
    relatedItems: [],
    hasOutstanding: false,
    hasDispute: false,
    hasReconciliationIssue: false,
  };
}

function row(wkOrderId: number, at: Date) {
  return { wkOrderId, createdAt: at, updatedAt: at };
}

describe('Stage13B-3B search service', () => {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  let prisma: {
    riderAdvance: { findMany: jest.Mock; findUnique: jest.Mock };
    returnFinancialDetermination: { findMany: jest.Mock };
    returnFinancialObligation: { findUnique: jest.Mock };
    exceptionFinancialObligation: { findMany: jest.Mock; findUnique: jest.Mock };
  };
  let forOrder: jest.Mock;
  let service: FinancialReconciliationSearchService;

  beforeEach(() => {
    prisma = {
      riderAdvance: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
      returnFinancialDetermination: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      returnFinancialObligation: { findUnique: jest.fn() },
      exceptionFinancialObligation: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
    };
    forOrder = jest.fn();
    service = new FinancialReconciliationSearchService(
      prisma as unknown as PrismaService,
      { forOrder } as unknown as FinancialReconciliationService,
    );
  });

  it('never evaluates more than CANDIDATE_SCAN_MAX=50 even with 0 matches', async () => {
    const t = new Date('2026-09-18T12:00:00.000Z');
    const candidates = Array.from({ length: 80 }, (_, i) =>
      row(1000 + i, t),
    );
    prisma.riderAdvance.findMany.mockResolvedValue(candidates);
    forOrder.mockImplementation(async (id: number) => emptyView(id));
    const parsed = parseSearchQuery({
      since,
      findingCode: RECONCILIATION_FINDING_CODES.CURRENCY_MISMATCH,
      limit: '20',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await service.search(parsed.value);
    expect(forOrder).toHaveBeenCalledTimes(CANDIDATE_SCAN_MAX);
    expect(result.scanned).toBe(50);
    expect(result.items).toEqual([]);
    expect(result.nextCursor).not.toBeNull();
    expect(result.exhausted).toBe(false);
  });

  it('client candidateScanMax query does not raise the hard cap', async () => {
    const t = new Date('2026-09-18T12:00:00.000Z');
    prisma.riderAdvance.findMany.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => row(2000 + i, t)),
    );
    forOrder.mockImplementation(async (id: number) => emptyView(id));
    const parsed = parseSearchQuery({
      since,
      ...( { candidateScanMax: '500', limit: '20' } as Record<string, string> ),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await service.search(parsed.value);
    expect(forOrder.mock.calls.length).toBeLessThanOrEqual(50);
    expect(forOrder).toHaveBeenCalledTimes(50);
  });

  it('exact wkOrderId evaluates at most that order', async () => {
    prisma.riderAdvance.findMany.mockResolvedValue([]);
    prisma.returnFinancialDetermination.findMany.mockResolvedValue([]);
    prisma.exceptionFinancialObligation.findMany.mockResolvedValue([]);
    forOrder.mockResolvedValue(emptyView(42));
    const parsed = parseSearchQuery({ wkOrderId: '42' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await service.search(parsed.value);
    expect(forOrder).toHaveBeenCalledTimes(1);
    expect(forOrder).toHaveBeenCalledWith(42);
    expect(prisma.riderAdvance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { wkOrderId: 42 },
      }),
    );
    expect(result.items).toEqual([]);
    expect(result.scanned).toBe(1);
    expect(result.exhausted).toBe(true);
    expect(result.nextCursor).toBeNull();
  });

  it('rail+obligationId resolves one order then forOrder once', async () => {
    prisma.riderAdvance.findUnique.mockResolvedValue({ wkOrderId: 77 });
    prisma.riderAdvance.findMany.mockResolvedValue([]);
    prisma.returnFinancialDetermination.findMany.mockResolvedValue([]);
    prisma.exceptionFinancialObligation.findMany.mockResolvedValue([]);
    forOrder.mockResolvedValue(emptyView(77));
    const parsed = parseSearchQuery({
      rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
      obligationId: 'ra-77',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await service.search(parsed.value);
    expect(prisma.riderAdvance.findUnique).toHaveBeenCalledWith({
      where: { id: 'ra-77' },
      select: { wkOrderId: true },
    });
    expect(forOrder).toHaveBeenCalledTimes(1);
    expect(forOrder).toHaveBeenCalledWith(77);
    expect(result.scanned).toBe(1);
  });

  it('missing obligation key returns empty without forOrder', async () => {
    prisma.riderAdvance.findUnique.mockResolvedValue(null);
    const parsed = parseSearchQuery({
      rail: RAIL_RIDER_ADVANCE_REIMBURSEMENT,
      obligationId: 'missing',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await service.search(parsed.value);
    expect(forOrder).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      nextCursor: null,
      scanned: 0,
      exhausted: true,
    });
  });

  it('skips a candidate that disappears before forOrder without failing the search', async () => {
    const t = new Date('2026-09-18T12:00:00.000Z');
    prisma.riderAdvance.findMany.mockResolvedValue([
      row(1, t),
      row(2, t),
    ]);
    forOrder.mockImplementation(async (id: number) => {
      if (id === 1) throw new NotFoundException('gone');
      return emptyView(id);
    });
    const parsed = parseSearchQuery({ since });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await service.search(parsed.value);
    expect(result.scanned).toBe(2);
    expect(result.items).toEqual([]);
  });
});
