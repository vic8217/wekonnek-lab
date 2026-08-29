import { NotFoundException } from '@nestjs/common';
import { QuotationStatus, RfqStatus } from '@prisma/client';
import { RfqService } from './rfq.service';

describe('RfqService buyer quotation actions', () => {
  const quotation = { id: 'quote-1', rfqId: 'rfq-1', buyerId: 'buyer-a', wkOrderId: null, version: 1, status: QuotationStatus.SENT, validUntil: new Date(Date.now() + 60_000), rfq: { buyerId: 'buyer-a', status: RfqStatus.QUOTED } };
  const prisma = { merchantQuotation: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() }, requestForQuotation: { update: jest.fn() } };
  const service = new RfqService(prisma as never, {} as never);
  beforeEach(() => jest.clearAllMocks());
  it('blocks a different buyer from declining or requesting revision', async () => {
    prisma.merchantQuotation.findUnique.mockResolvedValue(quotation);
    await expect(service.declineQuotation('buyer-b', 'quote-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.requestQuotationRevision('buyer-b', 'quote-1', 'Please revise')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.merchantQuotation.update).not.toHaveBeenCalled();
  });
  it('declines the current sent quotation idempotently', async () => {
    prisma.merchantQuotation.findUnique.mockResolvedValue(quotation);
    prisma.merchantQuotation.findFirst.mockResolvedValue(quotation);
    prisma.merchantQuotation.update.mockResolvedValue({ ...quotation, status: QuotationStatus.DECLINED });
    await expect(service.declineQuotation('buyer-a', 'quote-1')).resolves.toMatchObject({ status: QuotationStatus.DECLINED });
  });
  it('records a revision request without changing commercial values', async () => {
    prisma.merchantQuotation.findUnique.mockResolvedValue(quotation);
    prisma.merchantQuotation.findFirst.mockResolvedValue(quotation);
    prisma.merchantQuotation.update.mockResolvedValue({ ...quotation, status: QuotationStatus.REVISED, revisionRequest: 'Please revise' });
    await expect(service.requestQuotationRevision('buyer-a', 'quote-1', '  Please revise  ')).resolves.toMatchObject({ status: QuotationStatus.REVISED, revisionRequest: 'Please revise' });
    expect(prisma.requestForQuotation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: RfqStatus.REVISED } }));
  });
});
