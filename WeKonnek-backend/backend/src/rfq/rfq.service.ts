import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CommerceDomain, Prisma, QuotationStatus, RfqStatus } from '@prisma/client';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';

type CreateRfqInput = { merchantId: number; shopId: number; productId: number; productVariantId?: number; quantity: number; specifications?: string; size?: string; color?: string; customization?: string; requiredDate?: string; deliveryAddress?: string; notes?: string; submit?: boolean };
type QuoteInput = { unitPrice: number; discount?: number; tax?: number; deliveryCharge?: number; otherCharges?: number; leadTime?: string; promisedDate?: string; validUntil: string; paymentTerms?: string; merchantNotes?: string; returnCancellationTerms?: string; send?: boolean };

@Injectable()
export class RfqService {
  constructor(private readonly prisma: PrismaService, private readonly orders: OrdersService) {}
  private number(prefix: string) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`; }
  private async merchantFor(userId: string) { const merchant = await this.prisma.merchant.findFirst({ where: { userId } }); if (!merchant) throw new ForbiddenException('No merchant profile is linked to this account'); return merchant; }
  private eligible(merchantDomain: CommerceDomain | null, productDomain: CommerceDomain | null) { return merchantDomain === CommerceDomain.NON_FOOD || (merchantDomain === CommerceDomain.MIXED && productDomain === CommerceDomain.NON_FOOD); }

  async create(buyerId: string, input: CreateRfqInput) {
    if (!Number.isInteger(input.quantity) || input.quantity < 1) throw new BadRequestException('Quantity must be at least one');
    const product = await this.prisma.product.findFirst({ where: { id: input.productId, merchantId: input.merchantId }, include: { merchant: true, variants: { where: { id: input.productVariantId } } } });
    if (!product || !this.eligible(product.merchant.commerceDomain, product.commerceDomain)) throw new ForbiddenException('Request Quote is unavailable for this product');
    const shop = await this.prisma.branch.findFirst({ where: { id: input.shopId, merchantId: input.merchantId, isActive: true } });
    if (!shop || (input.productVariantId && !product.variants[0])) throw new BadRequestException('The selected product or shop is unavailable');
    const submitted = input.submit !== false;
    return this.prisma.requestForQuotation.create({ data: { rfqNumber: this.number('RFQ'), buyerId, merchantId: input.merchantId, shopId: shop.id, productId: product.id, productVariantId: input.productVariantId ?? null, quantity: input.quantity, specifications: input.specifications, size: input.size, color: input.color, customization: input.customization, requiredDate: input.requiredDate ? new Date(input.requiredDate) : null, deliveryAddress: input.deliveryAddress, notes: input.notes, status: submitted ? RfqStatus.SUBMITTED : RfqStatus.DRAFT, submittedAt: submitted ? new Date() : null, snapshot: { product: { id: product.id, name: product.name, sku: product.sku, imageUrl: product.imageUrl, commerceDomain: product.commerceDomain }, variant: product.variants[0] ? { id: product.variants[0].id, sku: product.variants[0].sku } : null, merchant: { id: product.merchant.id, name: product.merchant.name }, shop: { id: shop.id, name: shop.name }, buyerId, quantity: input.quantity, submittedAt: new Date().toISOString() } } });
  }
  async buyerList(buyerId: string) { return this.prisma.requestForQuotation.findMany({ where: { buyerId }, orderBy: { createdAt: 'desc' }, include: { quotations: { orderBy: { version: 'desc' } } } }); }
  async merchantList(userId: string) { const merchant = await this.merchantFor(userId); return this.prisma.requestForQuotation.findMany({ where: { merchantId: merchant.id }, orderBy: { createdAt: 'desc' }, include: { quotations: { orderBy: { version: 'desc' } } } }); }
  async buyerDetail(buyerId: string, id: string) { const rfq = await this.prisma.requestForQuotation.findFirst({ where: { id, buyerId }, include: { quotations: { orderBy: { version: 'desc' } } } }); if (!rfq) throw new NotFoundException('RFQ not found'); return rfq; }
  async merchantDetail(userId: string, id: string) { const merchant = await this.merchantFor(userId); const rfq = await this.prisma.requestForQuotation.findFirst({ where: { id, merchantId: merchant.id }, include: { quotations: { orderBy: { version: 'desc' } } } }); if (!rfq) throw new NotFoundException('RFQ not found'); if (rfq.status === RfqStatus.SUBMITTED) return this.prisma.requestForQuotation.update({ where: { id }, data: { status: RfqStatus.VIEWED, viewedAt: new Date() }, include: { quotations: { orderBy: { version: 'desc' } } } }); return rfq; }
  async cancel(buyerId: string, id: string) { const rfq = await this.prisma.requestForQuotation.findFirst({ where: { id, buyerId } }); if (!rfq) throw new NotFoundException('RFQ not found'); if (!(['DRAFT', 'SUBMITTED', 'VIEWED', 'QUOTED', 'REVISED'] as string[]).includes(rfq.status)) throw new BadRequestException('RFQ cannot be cancelled'); return this.prisma.requestForQuotation.update({ where: { id }, data: { status: RfqStatus.CANCELLED, cancelledAt: new Date() } }); }
  async quote(userId: string, rfqId: string, input: QuoteInput) { const merchant = await this.merchantFor(userId); const rfq = await this.prisma.requestForQuotation.findFirst({ where: { id: rfqId, merchantId: merchant.id }, include: { quotations: true } }); if (!rfq) throw new NotFoundException('RFQ not found'); if (!(['SUBMITTED', 'VIEWED', 'QUOTED', 'REVISED'] as string[]).includes(rfq.status)) throw new BadRequestException('RFQ cannot be quoted'); const unitPrice = new Prisma.Decimal(input.unitPrice); const discount = new Prisma.Decimal(input.discount ?? 0); const tax = new Prisma.Decimal(input.tax ?? 0); const deliveryCharge = new Prisma.Decimal(input.deliveryCharge ?? 0); const otherCharges = new Prisma.Decimal(input.otherCharges ?? 0); if ([unitPrice, discount, tax, deliveryCharge, otherCharges].some(value => value.isNegative())) throw new BadRequestException('Quotation amounts cannot be negative'); const subtotal = unitPrice.mul(rfq.quantity); const total = subtotal.minus(discount).plus(tax).plus(deliveryCharge).plus(otherCharges); const sent = input.send === true; const version = Math.max(0, ...rfq.quotations.map(quotation => quotation.version)) + 1; if (rfq.quotations.some(quotation => quotation.status === QuotationStatus.SENT)) await this.prisma.merchantQuotation.updateMany({ where: { rfqId, status: QuotationStatus.SENT }, data: { status: QuotationStatus.REVISED } }); const quotation = await this.prisma.merchantQuotation.create({ data: { quotationNumber: this.number('QT'), rfqId, merchantId: merchant.id, shopId: rfq.shopId, buyerId: rfq.buyerId, version, status: sent ? QuotationStatus.SENT : QuotationStatus.DRAFT, unitPrice, subtotal, discount, tax, deliveryCharge, otherCharges, total, leadTime: input.leadTime, promisedDate: input.promisedDate ? new Date(input.promisedDate) : null, validUntil: new Date(input.validUntil), paymentTerms: input.paymentTerms, merchantNotes: input.merchantNotes, returnCancellationTerms: input.returnCancellationTerms, sentAt: sent ? new Date() : null } }); if (sent) await this.prisma.requestForQuotation.update({ where: { id: rfqId }, data: { status: rfq.quotations.length ? RfqStatus.REVISED : RfqStatus.QUOTED } }); return quotation; }
  async acceptQuotationAndCreateOrder(buyerId: string, quotationId: string) {
    const result = await this.prisma.$transaction(async tx => {
      const quotation = await tx.merchantQuotation.findUnique({ where: { id: quotationId }, include: { rfq: { include: { product: { include: { merchant: true } } } } } });
      if (!quotation || quotation.buyerId !== buyerId) throw new NotFoundException('Quotation not found');
      if (quotation.wkOrderId) return { order: await tx.wkOrder.findUniqueOrThrow({ where: { id: quotation.wkOrderId } }), createdNow: false };
      const rfq = quotation.rfq;
      if (quotation.status !== QuotationStatus.SENT || rfq.status === RfqStatus.CANCELLED || new Date(quotation.validUntil) <= new Date() || !this.eligible(rfq.product.merchant.commerceDomain, rfq.product.commerceDomain)) throw new BadRequestException('Quotation is not available for acceptance');
      const latest = await tx.merchantQuotation.findFirst({ where: { rfqId: rfq.id }, orderBy: { version: 'desc' } });
      if (!latest || latest.id !== quotation.id) throw new BadRequestException('Only the latest quotation may be accepted');
      const claim = await tx.merchantQuotation.updateMany({ where: { id: quotation.id, status: QuotationStatus.SENT, wkOrderId: null }, data: { status: QuotationStatus.ACCEPTED, acceptedAt: new Date() } });
      if (claim.count !== 1) throw new BadRequestException('Quotation is no longer available for acceptance');
      const snapshot = { buyerId, merchantId: quotation.merchantId, shopId: quotation.shopId, deliveryAddress: rfq.deliveryAddress, notes: rfq.notes, total: Number(quotation.total), deliveryCharge: Number(quotation.deliveryCharge), discount: Number(quotation.discount), tax: Number(quotation.tax), otherCharges: Number(quotation.otherCharges), items: [{ productId: rfq.productId, variantId: rfq.productVariantId, productName: rfq.product.name, quantity: rfq.quantity, unitPrice: Number(quotation.unitPrice), lineTotal: Number(quotation.subtotal) }] };
      const order = await this.orders.createFromAcceptedQuotation(tx, snapshot);
      await tx.merchantQuotation.update({ where: { id: quotation.id }, data: { wkOrderId: order.id, status: QuotationStatus.CONVERTED_TO_ORDER, acceptedSnapshot: snapshot, convertedAt: new Date() } });
      await tx.requestForQuotation.update({ where: { id: rfq.id }, data: { status: RfqStatus.CONVERTED_TO_ORDER, acceptedAt: new Date() } });
      return { order, createdNow: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result.createdNow) await this.orders.runOrderCreatedPostCommitEffects(result.order);
    return result;
  }
  async declineQuotation(buyerId: string, quotationId: string) {
    const quotation = await this.prisma.merchantQuotation.findUnique({ where: { id: quotationId }, include: { rfq: true } });
    if (!quotation || quotation.rfq.buyerId !== buyerId) throw new NotFoundException('Quotation not found');
    if (quotation.status === QuotationStatus.DECLINED) return quotation;
    const latest = await this.prisma.merchantQuotation.findFirst({ where: { rfqId: quotation.rfqId }, orderBy: { version: 'desc' } });
    if (!latest || latest.id !== quotation.id || quotation.wkOrderId || quotation.status !== QuotationStatus.SENT || quotation.rfq.status === RfqStatus.CONVERTED_TO_ORDER) throw new BadRequestException('Quotation cannot be declined');
    return this.prisma.merchantQuotation.update({ where: { id: quotationId }, data: { status: QuotationStatus.DECLINED, declinedAt: new Date() } });
  }
  async requestQuotationRevision(buyerId: string, quotationId: string, note: string) {
    const revisionRequest = note.trim();
    if (!revisionRequest || revisionRequest.length > 2000) throw new BadRequestException('A revision request of up to 2,000 characters is required');
    const quotation = await this.prisma.merchantQuotation.findUnique({ where: { id: quotationId }, include: { rfq: true } });
    if (!quotation || quotation.rfq.buyerId !== buyerId) throw new NotFoundException('Quotation not found');
    const latest = await this.prisma.merchantQuotation.findFirst({ where: { rfqId: quotation.rfqId }, orderBy: { version: 'desc' } });
    if (!latest || latest.id !== quotation.id || quotation.wkOrderId || quotation.status !== QuotationStatus.SENT || new Date(quotation.validUntil) <= new Date() || quotation.rfq.status === RfqStatus.CONVERTED_TO_ORDER) throw new BadRequestException('Quotation cannot be revised');
    await this.prisma.requestForQuotation.update({ where: { id: quotation.rfqId }, data: { status: RfqStatus.REVISED } });
    return this.prisma.merchantQuotation.update({ where: { id: quotationId }, data: { status: QuotationStatus.REVISED, revisionRequest } });
  }
}
