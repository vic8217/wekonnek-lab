import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Invoice,
  BillingProfile,
  InvoiceType,
  InvoiceStatus,
  Order,
} from '@prisma/client';

/**
 * Invoice Service — BIR-compliant e-invoice/e-receipt generation.
 *
 * Auto-generates an invoice for every completed order.
 * Supports:
 *   - JSON format (internal API use)
 *   - XML format (BIR compliance / EIS integration)
 *   - PDF format (Grab-style e-receipt for customer download)
 */
@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════════════════════════════════════════════
  //  BILLING PROFILE SETTINGS (Dynamic company info)
  // ═══════════════════════════════════════════════════

  async getDefaultBillingProfile(): Promise<BillingProfile> {
    let profile = await this.prisma.billingProfile.findFirst({
      where: { isDefault: true },
    });

    if (!profile) {
      profile = await this.prisma.billingProfile.create({
        data: {
          businessName: 'WEKONNEK TECHNOLOGIES INC.',
          tradeName: 'WeKonnek',
          tin: '000-000-000-000',
          businessAddress:
            'Unit XXX, Building Name, Street, City, Metro Manila',
          city: 'Manila',
          zipCode: '1000',
          phone: '+63 XXX XXX XXXX',
          email: 'billing@wekonnek.app',
          website: 'https://wekonnek.app',
          isVatRegistered: true,
          vatRate: 12.0,
          birPermitNumber: 'ATP-XXXXXXXX',
          rdoCode: 'XXX',
          invoicePrefix: 'WHP',
          invoiceCounter: 0,
          receiptFooter:
            'This serves as your official receipt.\nThank you for choosing WeKonnek!',
          isDefault: true,
        },
      });
    }

    return profile;
  }

  async updateBillingProfile(
    id: string,
    data: Partial<BillingProfile>,
  ): Promise<BillingProfile> {
    const profile = await this.prisma.billingProfile.findUnique({
      where: { id },
    });
    if (!profile) throw new NotFoundException('Billing profile not found');

    return this.prisma.billingProfile.update({ where: { id }, data });
  }

  // ═══════════════════════════════════════════════════
  //  INVOICE GENERATION (from Order)
  // ═══════════════════════════════════════════════════

  /**
   * Generate an invoice for a completed order.
   * Called automatically when order status changes to DELIVERED.
   */
  async generateFromOrder(order: Order): Promise<Invoice> {
    const existing = await this.prisma.invoice.findFirst({
      where: { orderId: order.id },
    });
    if (existing) return existing;

    const profile = await this.getDefaultBillingProfile();
    const serialNumber = await this.generateSerialNumber(profile);

    const orderItems = order.items as any[];
    const lineItems = this.buildLineItems(
      orderItems,
      profile.isVatRegistered,
      profile.vatRate,
    );

    const vatBreakdown = this.calculateVatBreakdown(
      lineItems,
      order.deliveryFee || 0,
      order.discount || 0,
      profile.isVatRegistered,
      profile.vatRate,
    );

    const additionalCharges: {
      description: string;
      amount: number;
      vatAmount: number;
    }[] = [];

    if (order.deliveryFee && order.deliveryFee > 0) {
      const deliveryVat = profile.isVatRegistered
        ? (order.deliveryFee / 1.12) * 0.12
        : 0;
      additionalCharges.push({
        description: 'Delivery Fee',
        amount: profile.isVatRegistered
          ? order.deliveryFee / 1.12
          : order.deliveryFee,
        vatAmount: Math.round(deliveryVat * 100) / 100,
      });
    }

    const invoiceType =
      order.type === 'express'
        ? InvoiceType.official_receipt
        : InvoiceType.sales_invoice;

    const deliveryAddress = order.deliveryAddress as any;

    return this.prisma.invoice.create({
      data: {
        serialNumber,
        type: invoiceType,
        status: InvoiceStatus.issued,
        invoiceDate: new Date(),

        merchantBusinessName: profile.businessName,
        merchantTin: profile.tin,
        merchantAddress: profile.businessAddress,
        merchantIsVat: profile.isVatRegistered,
        merchantBirPermit: profile.birPermitNumber || '',
        merchantRdoCode: profile.rdoCode || '',

        customerId: order.customerId,
        customerName: deliveryAddress?.contactName || '',
        customerPhone: deliveryAddress?.contactPhone || '',
        customerAddress: deliveryAddress?.address || '',

        orderId: order.id,
        orderNumber: order.orderNumber,
        orderType: order.type,

        lineItems,
        additionalCharges,

        subtotal: vatBreakdown.subtotal,
        deliveryFee: order.deliveryFee || 0,
        serviceFee: 0,
        discount: order.discount || 0,

        vatableSales: vatBreakdown.vatableSales,
        vatAmount: vatBreakdown.vatAmount,
        vatExemptSales: vatBreakdown.vatExemptSales,
        zeroRatedSales: vatBreakdown.zeroRatedSales,

        totalAmount: order.total,

        paymentMethod: order.paymentMethod,
        paymentReference: order.paymentRef,
        amountPaid: order.total,
        changeAmount: 0,

        pickupZone: order.pickupZoneName || '',
        deliveryZone: order.deliveryZoneName || '',
      },
    });
  }

  async generateFromDineInOrder(orderId: number): Promise<Invoice> {
    const reference = `wk-order:${orderId}`;
    const existing = await this.prisma.invoice.findFirst({ where: { orderId: reference } });
    if (existing) return existing;
    const order = await this.prisma.wkOrder.findUnique({
      where: { id: orderId },
      include: { orderItems: true, merchant: true, shop: true },
    });
    if (!order || !['dine_in', 'in_store'].includes(order.orderType)) throw new NotFoundException('Dine-in order not found');
    if (order.status !== 'completed') throw new BadRequestException('Complete the transaction before issuing the invoice');
    const profile = await this.getDefaultBillingProfile();
    const customer = await this.prisma.user.findUnique({ where: { id: order.userId } });
    const serialNumber = await this.generateSerialNumber(profile);
    const gross = order.orderItems.reduce((sum, item) => sum + Number(item.subtotal), 0);
    const discount = Number(order.discountAmount || 0);
    const details = (order.discountDetails || {}) as any;
    const ratio = details.totalDiners ? Number(details.eligibleDiners || 0) / Number(details.totalDiners) : 0;
    const eligibleGross = gross * ratio;
    const eligibleVatExclusive = eligibleGross / 1.12;
    const nonEligibleGross = gross - eligibleGross;
    const vatableSales = nonEligibleGross / 1.12;
    const vatAmount = nonEligibleGross - vatableSales;
    return this.prisma.$transaction(async tx => {
      // Backfill and page polling can request the same receipt concurrently. Lock
      // by order reference so exactly one request is allowed to create it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reference}))`;
      const lockedExisting = await tx.invoice.findFirst({ where: { orderId: reference } });
      if (lockedExisting) return lockedExisting;
      return tx.invoice.create({ data: {
        serialNumber, type: InvoiceType.sales_invoice, status: InvoiceStatus.issued, invoiceDate: new Date(),
        merchantBusinessName: order.shop?.registeredBusinessName || order.merchant.registeredBusinessName || order.merchant.name,
        merchantTin: order.shop?.tin || order.merchant.tin || '',
        merchantAddress: order.shop?.address || order.merchant.address || '', merchantIsVat: true,
        merchantBirPermit: profile.birPermitNumber || '', merchantRdoCode: profile.rdoCode || '',
        customerId: order.userId, customerName: [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || 'Cash Customer',
        customerPhone: customer?.phone || '', customerEmail: customer?.email || '', orderId: reference,
        orderNumber: order.orderCode, orderType: order.orderType,
        lineItems: order.orderItems.map(item => ({ description: item.productName, quantity: item.quantity, unit: 'pc', unitPrice: Number(item.price), amount: Number(item.subtotal), vatAmount: 0, totalAmount: Number(item.subtotal) })),
        subtotal: gross, discount, discountDescription: order.discountType || null,
        vatableSales, vatAmount, vatExemptSales: ratio ? eligibleVatExclusive : 0, zeroRatedSales: 0,
        totalAmount: Number(order.totalAmount), paymentMethod: order.paymentMethod, paymentReference: order.paymentRef,
        amountPaid: Number(order.totalAmount), changeAmount: 0,
        metadata: { tableNumber: order.tableNumber, discountDetails: order.discountDetails },
      }});
    });
  }

  async findMineById(id: string, customerId: string): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findFirst({ where: { id, customerId } });
    if (!invoice) throw new NotFoundException('E-receipt not found');
    return invoice;
  }

  async ensureCustomerDineInReceipts(customerId: string): Promise<void> {
    const completed = await this.prisma.wkOrder.findMany({
      where: { userId: customerId, status: 'completed', orderType: { in: ['dine_in', 'in_store'] } },
      select: { id: true },
    });
    for (const order of completed) await this.generateFromDineInOrder(order.id);
  }

  // ═══════════════════════════════════════════════════
  //  JSON FORMAT (Internal API)
  // ═══════════════════════════════════════════════════

  async getInvoiceJson(invoiceId: string) {
    const invoice = await this.findById(invoiceId);
    return this.formatAsJson(invoice);
  }

  private formatAsJson(invoice: Invoice) {
    const lineItems = invoice.lineItems as any[];
    const additionalCharges = invoice.additionalCharges as any[];

    return {
      invoice: {
        serialNumber: invoice.serialNumber,
        type: invoice.type,
        status: invoice.status,
        date: invoice.invoiceDate,

        seller: {
          businessName: invoice.merchantBusinessName,
          tin: invoice.merchantTin,
          address: invoice.merchantAddress,
          vatRegistered: invoice.merchantIsVat,
          birPermit: invoice.merchantBirPermit,
          rdoCode: invoice.merchantRdoCode,
        },

        buyer: {
          name: invoice.customerName,
          phone: invoice.customerPhone,
          email: invoice.customerEmail,
          address: invoice.customerAddress,
          tin: invoice.customerTin,
        },

        order: {
          id: invoice.orderId,
          number: invoice.orderNumber,
          type: invoice.orderType,
        },

        items: lineItems.map((item: any) => ({
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          amount: item.amount,
          vat: item.vatAmount,
          total: item.totalAmount,
        })),

        additionalCharges: additionalCharges || [],

        summary: {
          subtotal: invoice.subtotal,
          deliveryFee: invoice.deliveryFee,
          serviceFee: invoice.serviceFee,
          discount: invoice.discount,
          discountDescription: invoice.discountDescription,
          vatableSales: invoice.vatableSales,
          vatAmount: invoice.vatAmount,
          vatExemptSales: invoice.vatExemptSales,
          zeroRatedSales: invoice.zeroRatedSales,
          totalAmount: invoice.totalAmount,
        },

        payment: {
          method: invoice.paymentMethod,
          reference: invoice.paymentReference,
          amountPaid: invoice.amountPaid,
          change: invoice.changeAmount,
        },

        zones: {
          pickup: invoice.pickupZone,
          delivery: invoice.deliveryZone,
        },
      },
    };
  }

  // ═══════════════════════════════════════════════════
  //  XML FORMAT (BIR Compliance / EIS)
  // ═══════════════════════════════════════════════════

  async getInvoiceXml(invoiceId: string): Promise<string> {
    const invoice = await this.findById(invoiceId);
    return this.formatAsXml(invoice);
  }

  private formatAsXml(invoice: Invoice): string {
    const escXml = (str: string | null | undefined): string =>
      (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const lineItems = invoice.lineItems as any[];
    const additionalCharges = (invoice.additionalCharges || []) as any[];

    const itemsXml = lineItems
      .map(
        (item: any, idx: number) => `
    <LineItem sequence="${idx + 1}">
      <Description>${escXml(item.description)}</Description>
      <Quantity>${item.quantity}</Quantity>
      <Unit>${escXml(item.unit)}</Unit>
      <UnitPrice>${item.unitPrice.toFixed(2)}</UnitPrice>
      <Amount>${item.amount.toFixed(2)}</Amount>
      <VATAmount>${item.vatAmount.toFixed(2)}</VATAmount>
      <TotalAmount>${item.totalAmount.toFixed(2)}</TotalAmount>
    </LineItem>`,
      )
      .join('');

    const chargesXml = additionalCharges
      .map(
        (charge: any) => `
    <AdditionalCharge>
      <Description>${escXml(charge.description)}</Description>
      <Amount>${charge.amount.toFixed(2)}</Amount>
      <VATAmount>${charge.vatAmount.toFixed(2)}</VATAmount>
    </AdditionalCharge>`,
      )
      .join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<EInvoice xmlns="urn:wekonnek:einvoice:v1" version="1.0">
  <Header>
    <SerialNumber>${escXml(invoice.serialNumber)}</SerialNumber>
    <InvoiceType>${invoice.type}</InvoiceType>
    <Status>${invoice.status}</Status>
    <InvoiceDate>${invoice.invoiceDate.toISOString()}</InvoiceDate>
    <CreatedAt>${invoice.createdAt.toISOString()}</CreatedAt>
  </Header>

  <Seller>
    <BusinessName>${escXml(invoice.merchantBusinessName)}</BusinessName>
    <TIN>${escXml(invoice.merchantTin)}</TIN>
    <Address>${escXml(invoice.merchantAddress)}</Address>
    <VATRegistered>${invoice.merchantIsVat}</VATRegistered>
    <BIRPermitNumber>${escXml(invoice.merchantBirPermit)}</BIRPermitNumber>
    <RDOCode>${escXml(invoice.merchantRdoCode)}</RDOCode>
  </Seller>

  <Buyer>
    <Name>${escXml(invoice.customerName)}</Name>
    <Phone>${escXml(invoice.customerPhone)}</Phone>
    <Email>${escXml(invoice.customerEmail)}</Email>
    <Address>${escXml(invoice.customerAddress)}</Address>
    <TIN>${escXml(invoice.customerTin)}</TIN>
  </Buyer>

  <OrderReference>
    <OrderId>${escXml(invoice.orderId)}</OrderId>
    <OrderNumber>${escXml(invoice.orderNumber)}</OrderNumber>
    <OrderType>${escXml(invoice.orderType)}</OrderType>
  </OrderReference>

  <LineItems>${itemsXml}
  </LineItems>

  <AdditionalCharges>${chargesXml}
  </AdditionalCharges>

  <TaxSummary>
    <VATableSales>${invoice.vatableSales.toFixed(2)}</VATableSales>
    <VATAmount>${invoice.vatAmount.toFixed(2)}</VATAmount>
    <VATExemptSales>${invoice.vatExemptSales.toFixed(2)}</VATExemptSales>
    <ZeroRatedSales>${invoice.zeroRatedSales.toFixed(2)}</ZeroRatedSales>
  </TaxSummary>

  <Totals>
    <Subtotal>${invoice.subtotal.toFixed(2)}</Subtotal>
    <DeliveryFee>${invoice.deliveryFee.toFixed(2)}</DeliveryFee>
    <ServiceFee>${invoice.serviceFee.toFixed(2)}</ServiceFee>
    <Discount>${invoice.discount.toFixed(2)}</Discount>
    <TotalAmount>${invoice.totalAmount.toFixed(2)}</TotalAmount>
  </Totals>

  <Payment>
    <Method>${escXml(invoice.paymentMethod)}</Method>
    <Reference>${escXml(invoice.paymentReference)}</Reference>
    <AmountPaid>${invoice.amountPaid.toFixed(2)}</AmountPaid>
    <Change>${invoice.changeAmount.toFixed(2)}</Change>
  </Payment>
</EInvoice>`;
  }

  // ═══════════════════════════════════════════════════
  //  PDF GENERATION (Grab-style e-receipt)
  // ═══════════════════════════════════════════════════

  async generatePdf(invoiceId: string): Promise<Buffer> {
    const invoice = await this.findById(invoiceId);
    return this.buildPdf(invoice);
  }

  private async buildPdf(invoice: Invoice): Promise<Buffer> {
    const PDFDocument = (await import('pdfkit')).default;
    const lineItems = invoice.lineItems as any[];
    const additionalCharges = (invoice.additionalCharges || []) as any[];

    return new Promise<Buffer>((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: [226.77, 800],
          margin: 10,
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));

        const w = 206.77;
        let y = 10;

        // ─── HEADER ─────────────────────────────
        doc.fontSize(12).font('Helvetica-Bold');
        doc.text(invoice.merchantBusinessName, 10, y, {
          width: w,
          align: 'center',
        });
        y += 18;

        doc.fontSize(7).font('Helvetica');
        doc.text(invoice.merchantAddress, 10, y, {
          width: w,
          align: 'center',
        });
        y += 12;

        doc.text(`TIN: ${invoice.merchantTin}`, 10, y, {
          width: w,
          align: 'center',
        });
        y += 10;

        if (invoice.merchantBirPermit) {
          doc.text(`BIR Permit: ${invoice.merchantBirPermit}`, 10, y, {
            width: w,
            align: 'center',
          });
          y += 10;
        }

        y += 4;
        doc
          .moveTo(10, y)
          .lineTo(10 + w, y)
          .dash(2, { space: 2 })
          .stroke();
        y += 8;

        // ─── INVOICE INFO ───────────────────────
        doc.fontSize(10).font('Helvetica-Bold');
        const typeLabel =
          invoice.type === InvoiceType.sales_invoice
            ? 'SALES INVOICE'
            : 'OFFICIAL RECEIPT';
        doc.text(typeLabel, 10, y, { width: w, align: 'center' });
        y += 14;

        doc.fontSize(7).font('Helvetica');
        doc.text(`No: ${invoice.serialNumber}`, 10, y);
        y += 10;
        doc.text(
          `Date: ${invoice.invoiceDate.toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}`,
          10,
          y,
        );
        y += 10;
        doc.text(`Order: ${invoice.orderNumber}`, 10, y);
        y += 10;

        if (invoice.customerName) {
          doc.text(`Customer: ${invoice.customerName}`, 10, y);
          y += 10;
        }

        y += 4;
        doc
          .moveTo(10, y)
          .lineTo(10 + w, y)
          .undash()
          .stroke();
        y += 6;

        // ─── LINE ITEMS ─────────────────────────
        doc.fontSize(7).font('Helvetica-Bold');
        doc.text('Item', 10, y, { width: 100 });
        doc.text('Qty', 110, y, { width: 30, align: 'center' });
        doc.text('Price', 140, y, { width: 35, align: 'right' });
        doc.text('Amt', 175, y, { width: w - 165, align: 'right' });
        y += 10;

        doc.font('Helvetica').fontSize(7);
        for (const item of lineItems) {
          const descHeight = doc.heightOfString(item.description, {
            width: 100,
          });
          doc.text(item.description, 10, y, { width: 100 });
          doc.text(`${item.quantity}`, 110, y, {
            width: 30,
            align: 'center',
          });
          doc.text(`₱${item.unitPrice.toFixed(2)}`, 140, y, {
            width: 35,
            align: 'right',
          });
          doc.text(`₱${item.totalAmount.toFixed(2)}`, 175, y, {
            width: w - 165,
            align: 'right',
          });
          y += Math.max(descHeight, 10) + 2;
        }

        if (additionalCharges.length) {
          for (const charge of additionalCharges) {
            doc.text(charge.description, 10, y, { width: 165 });
            doc.text(
              `₱${(charge.amount + charge.vatAmount).toFixed(2)}`,
              175,
              y,
              { width: w - 165, align: 'right' },
            );
            y += 10;
          }
        }

        y += 4;
        doc
          .moveTo(10, y)
          .lineTo(10 + w, y)
          .stroke();
        y += 6;

        // ─── TOTALS ─────────────────────────────
        doc.fontSize(7).font('Helvetica');

        const addTotalLine = (label: string, value: number, bold = false) => {
          if (bold) doc.font('Helvetica-Bold');
          doc.text(label, 10, y, { width: 130 });
          doc.text(`₱${value.toFixed(2)}`, 140, y, {
            width: w - 130,
            align: 'right',
          });
          if (bold) doc.font('Helvetica');
          y += 10;
        };

        addTotalLine('Subtotal', invoice.subtotal);
        if (invoice.deliveryFee > 0) {
          addTotalLine('Delivery Fee', invoice.deliveryFee);
        }
        if (invoice.serviceFee > 0) {
          addTotalLine('Service Fee', invoice.serviceFee);
        }
        if (invoice.discount > 0) {
          addTotalLine('Discount', -invoice.discount);
        }

        y += 2;
        doc
          .moveTo(10, y)
          .lineTo(10 + w, y)
          .stroke();
        y += 6;

        doc.fontSize(10).font('Helvetica-Bold');
        doc.text('TOTAL', 10, y, { width: 100 });
        doc.text(`₱${invoice.totalAmount.toFixed(2)}`, 110, y, {
          width: w - 100,
          align: 'right',
        });
        y += 16;

        // ─── VAT BREAKDOWN ──────────────────────
        doc.fontSize(6).font('Helvetica');
        if (invoice.merchantIsVat) {
          addTotalLine('VATable Sales', invoice.vatableSales);
          addTotalLine('VAT (12%)', invoice.vatAmount);
          if (invoice.vatExemptSales > 0) {
            addTotalLine('VAT-Exempt Sales', invoice.vatExemptSales);
          }
          if (invoice.zeroRatedSales > 0) {
            addTotalLine('Zero-Rated Sales', invoice.zeroRatedSales);
          }
        } else {
          doc.text('NON-VAT REGISTERED', 10, y, {
            width: w,
            align: 'center',
          });
          y += 10;
        }

        // ─── PAYMENT ────────────────────────────
        y += 4;
        doc
          .moveTo(10, y)
          .lineTo(10 + w, y)
          .dash(2, { space: 2 })
          .stroke();
        y += 6;

        doc.fontSize(7).font('Helvetica');
        doc.text(
          `Payment: ${(invoice.paymentMethod || 'cash').toUpperCase()}`,
          10,
          y,
        );
        y += 10;

        if (invoice.paymentReference) {
          doc.text(`Ref: ${invoice.paymentReference}`, 10, y);
          y += 10;
        }

        // ─── ZONE INFO ─────────────────────────
        if (invoice.pickupZone || invoice.deliveryZone) {
          y += 4;
          doc.fontSize(6).font('Helvetica');
          if (invoice.pickupZone) {
            doc.text(`Pickup Zone: ${invoice.pickupZone}`, 10, y);
            y += 8;
          }
          if (invoice.deliveryZone) {
            doc.text(`Delivery Zone: ${invoice.deliveryZone}`, 10, y);
            y += 8;
          }
        }

        // ─── FOOTER ─────────────────────────────
        y += 8;
        doc
          .moveTo(10, y)
          .lineTo(10 + w, y)
          .undash()
          .stroke();
        y += 8;

        doc.fontSize(7).font('Helvetica');
        doc.text('This serves as your OFFICIAL E-RECEIPT', 10, y, {
          width: w,
          align: 'center',
        });
        y += 10;

        doc.fontSize(6);
        doc.text(
          'This e-receipt is system-generated and is valid',
          10,
          y,
          { width: w, align: 'center' },
        );
        y += 8;
        doc.text('without the need for a signature.', 10, y, {
          width: w,
          align: 'center',
        });
        y += 10;
        doc.text('Thank you for choosing WeKonnek!', 10, y, {
          width: w,
          align: 'center',
        });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  // ═══════════════════════════════════════════════════
  //  CRUD & QUERIES
  // ═══════════════════════════════════════════════════

  async findById(id: string): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async findBySerialNumber(serialNumber: string): Promise<Invoice> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { serialNumber },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async findByOrderId(orderId: string): Promise<Invoice | null> {
    return this.prisma.invoice.findFirst({ where: { orderId } });
  }

  async findByCustomer(
    customerId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Invoice[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
    const unique = Array.from(
      new Map(invoices.map(invoice => [invoice.orderId, invoice])).values(),
    );
    const offset = options?.offset || 0;
    return unique.slice(offset, offset + (options?.limit || 20));
  }

  async findAll(filters?: {
    type?: InvoiceType;
    status?: InvoiceStatus;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
  }): Promise<Invoice[]> {
    const where: any = {};
    if (filters?.type) where.type = filters.type;
    if (filters?.status) where.status = filters.status;
    if (filters?.dateFrom || filters?.dateTo) {
      where.invoiceDate = {};
      if (filters?.dateFrom) where.invoiceDate.gte = new Date(filters.dateFrom);
      if (filters?.dateTo) where.invoiceDate.lte = new Date(filters.dateTo);
    }

    return this.prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters?.limit || 50,
      skip: filters?.offset || 0,
    });
  }

  /** Void an invoice (BIR requires voided invoices to be kept, not deleted) */
  async voidInvoice(
    invoiceId: string,
    reason: string,
    voidedBy: string,
  ): Promise<Invoice> {
    const invoice = await this.findById(invoiceId);

    if (invoice.status === InvoiceStatus.voided) {
      throw new BadRequestException('Invoice is already voided');
    }

    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: InvoiceStatus.voided,
        voidReason: reason,
        voidedBy,
        voidedAt: new Date(),
      },
    });
  }

  // ─── Sales summary for reporting ──────────────
  async getSalesSummary(dateFrom: string, dateTo: string) {
    const result = await this.prisma.$queryRaw<
      {
        totalInvoices: bigint;
        totalSales: number;
        totalVat: number;
        totalVatableSales: number;
        totalVatExemptSales: number;
        totalDeliveryFees: number;
        totalDiscounts: number;
      }[]
    >`
      SELECT
        COUNT(id) AS "totalInvoices",
        COALESCE(SUM(total_amount), 0) AS "totalSales",
        COALESCE(SUM(vat_amount), 0) AS "totalVat",
        COALESCE(SUM(vatable_sales), 0) AS "totalVatableSales",
        COALESCE(SUM(vat_exempt_sales), 0) AS "totalVatExemptSales",
        COALESCE(SUM(delivery_fee), 0) AS "totalDeliveryFees",
        COALESCE(SUM(discount), 0) AS "totalDiscounts"
      FROM invoices
      WHERE status = 'issued'
        AND invoice_date >= ${new Date(dateFrom)}
        AND invoice_date <= ${new Date(dateTo)}
    `;

    const row = result[0];
    return {
      period: { from: dateFrom, to: dateTo },
      totalInvoices: Number(row?.totalInvoices) || 0,
      totalSales: Number(row?.totalSales) || 0,
      totalVat: Number(row?.totalVat) || 0,
      totalVatableSales: Number(row?.totalVatableSales) || 0,
      totalVatExemptSales: Number(row?.totalVatExemptSales) || 0,
      totalDeliveryFees: Number(row?.totalDeliveryFees) || 0,
      totalDiscounts: Number(row?.totalDiscounts) || 0,
    };
  }

  // ═══════════════════════════════════════════════════
  //  HELPER METHODS
  // ═══════════════════════════════════════════════════

  private async generateSerialNumber(profile: BillingProfile): Promise<string> {
    const updated = await this.prisma.billingProfile.update({
      where: { id: profile.id },
      data: { invoiceCounter: profile.invoiceCounter + 1 },
    });

    const padded = String(updated.invoiceCounter).padStart(7, '0');
    return `${updated.invoicePrefix}-${padded}`;
  }

  private buildLineItems(
    orderItems: {
      productId: string;
      name: string;
      quantity: number;
      price: number;
      options?: string[];
    }[],
    isVat: boolean,
    vatRate: number,
  ) {
    return orderItems.map((item) => {
      const description = item.options?.length
        ? `${item.name} (${item.options.join(', ')})`
        : item.name;

      let unitPrice: number;
      let amount: number;
      let vatAmount: number;
      let totalAmount: number;

      if (isVat) {
        totalAmount = item.price * item.quantity;
        amount = totalAmount / (1 + vatRate / 100);
        vatAmount = totalAmount - amount;
        unitPrice = item.price / (1 + vatRate / 100);
      } else {
        unitPrice = item.price;
        amount = item.price * item.quantity;
        vatAmount = 0;
        totalAmount = amount;
      }

      return {
        description,
        quantity: item.quantity,
        unit: 'pcs',
        unitPrice: Math.round(unitPrice * 100) / 100,
        amount: Math.round(amount * 100) / 100,
        vatAmount: Math.round(vatAmount * 100) / 100,
        totalAmount: Math.round(totalAmount * 100) / 100,
      };
    });
  }

  private calculateVatBreakdown(
    lineItems: { amount: number; vatAmount: number; totalAmount: number }[],
    deliveryFee: number,
    discount: number,
    isVat: boolean,
    vatRate: number,
  ) {
    const itemSubtotal = lineItems.reduce((sum, i) => sum + i.amount, 0);
    const itemVat = lineItems.reduce((sum, i) => sum + i.vatAmount, 0);

    let deliveryVat = 0;
    let deliveryNet = deliveryFee;
    if (isVat && deliveryFee > 0) {
      deliveryNet = deliveryFee / (1 + vatRate / 100);
      deliveryVat = deliveryFee - deliveryNet;
    }

    const subtotal = itemSubtotal + deliveryNet;
    const totalVat = itemVat + deliveryVat;

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      vatableSales: isVat ? Math.round(subtotal * 100) / 100 : 0,
      vatAmount: Math.round(totalVat * 100) / 100,
      vatExemptSales: isVat ? 0 : Math.round(subtotal * 100) / 100,
      zeroRatedSales: 0,
    };
  }
}
