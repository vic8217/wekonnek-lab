import jsPDF from 'jspdf';
import {
  Invoice, InvoiceLineItem, formatCurrency, formatInvoiceDate,
  getDocTypeLabel, getTaxTypeLabel, getChannelLabel,
} from './e-invoice';

// ════════════════════════════════════════════════════════════════════
// BIR-Compliant E-Invoice PDF Generator
// Two layouts: Thermal Receipt (80mm) + A4 Full Page
// ════════════════════════════════════════════════════════════════════

// ── Shared helpers ──
const r = (n: number) => parseFloat(n.toFixed(2));

function pdfHelpers(doc: jsPDF, pageWidth: number, margin: number) {
  const cw = pageWidth - margin * 2;
  return {
    center: (text: string, y: number, size: number, style: 'normal' | 'bold' = 'normal') => {
      doc.setFontSize(size); doc.setFont('helvetica', style);
      doc.text(text, (pageWidth - doc.getTextWidth(text)) / 2, y);
    },
    left: (text: string, y: number, size: number, style: 'normal' | 'bold' = 'normal') => {
      doc.setFontSize(size); doc.setFont('helvetica', style);
      doc.text(text, margin, y);
    },
    right: (text: string, y: number, size: number, style: 'normal' | 'bold' = 'normal') => {
      doc.setFontSize(size); doc.setFont('helvetica', style);
      doc.text(text, pageWidth - margin - doc.getTextWidth(text), y);
    },
    lr: (l: string, rv: string, y: number, size: number, ls: 'normal' | 'bold' = 'normal', rs: 'normal' | 'bold' = 'normal') => {
      doc.setFontSize(size); doc.setFont('helvetica', ls); doc.text(l, margin, y);
      doc.setFont('helvetica', rs); doc.text(rv, pageWidth - margin - doc.getTextWidth(rv), y);
    },
    dash: (y: number) => {
      doc.setDrawColor(180); doc.setLineDashPattern([1, 1], 0);
      doc.line(margin, y, pageWidth - margin, y); doc.setLineDashPattern([], 0);
    },
    solid: (y: number) => { doc.setDrawColor(200); doc.line(margin, y, pageWidth - margin, y); },
    cw,
  };
}

// ════════════════════════════════════════════════════════════════════
// THERMAL RECEIPT (80mm × variable height) — like Grab / POS receipt
// ════════════════════════════════════════════════════════════════════

export function generateThermalPDF(invoice: Invoice): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, 300] });
  const pw = 80, m = 4;
  const h = pdfHelpers(doc, pw, m);
  let y = 6;

  // ── Header ──
  doc.setFillColor(219, 0, 2);
  doc.rect(0, 0, pw, 13, 'F');
  doc.setTextColor(255, 255, 255);
  h.center('WeKonnek', 5.5, 11, 'bold');
  h.center(getDocTypeLabel(invoice.document_type).toUpperCase(), 10.5, 5.5);
  doc.setTextColor(0, 0, 0);
  y = 16;

  // Reprint tag
  if (invoice.is_reprint) {
    doc.setTextColor(200, 0, 0);
    h.center('*** REPRINT ***', y, 6, 'bold');
    doc.setTextColor(0, 0, 0);
    y += 3.5;
  }

  // ── Seller ──
  h.center(invoice.seller_registered_name, y, 7, 'bold'); y += 3.5;
  if (invoice.seller_trade_name && invoice.seller_trade_name !== invoice.seller_registered_name) {
    doc.setTextColor(100); h.center(`(${invoice.seller_trade_name})`, y, 5.5); doc.setTextColor(0); y += 2.5;
  }
  if (invoice.seller_tin) { h.center(`TIN: ${invoice.seller_tin}`, y, 5.5); y += 2.5; }
  if (invoice.seller_address) {
    doc.setFontSize(5); doc.setFont('helvetica', 'normal');
    const lines = doc.splitTextToSize(invoice.seller_address, h.cw);
    lines.forEach((l: string) => { doc.text(l, (pw - doc.getTextWidth(l)) / 2, y); y += 2.2; });
  }
  if (invoice.seller_phone) { h.center(`Tel: ${invoice.seller_phone}`, y, 5); y += 2.2; }
  if (invoice.seller_bir_accreditation) { h.center(`Accred: ${invoice.seller_bir_accreditation}`, y, 4.5); y += 2.2; }
  if (invoice.seller_bir_permit) { h.center(`PTU: ${invoice.seller_bir_permit}`, y, 4.5); y += 2.2; }

  // Tax classification label per BIR sample formats
  const taxLabel = invoice.tax_type === 'vat' ? 'VAT Registered'
    : invoice.tax_type === 'vat_exempt' ? 'VAT-EXEMPT SALE'
    : invoice.tax_type === 'zero_rated' ? 'ZERO-RATED SALE'
    : invoice.tax_type === 'mixed' ? 'MIXED TRANSACTION'
    : 'Non-VAT Registered';
  h.center(taxLabel, y, 5, 'bold'); y += 3;

  if (invoice.tax_type === 'non_vat') {
    doc.setFontSize(4); doc.setTextColor(150);
    h.center('This document is not valid for claim of input tax', y, 4);
    doc.setTextColor(0); y += 2.5;
  }

  h.dash(y); y += 2.5;

  // ── Document Type + Invoice Details ──
  h.center(`${getDocTypeLabel(invoice.document_type).toUpperCase()}`, y, 6.5, 'bold'); y += 3.5;
  h.lr('Invoice No:', invoice.invoice_number, y, 5, 'normal', 'bold'); y += 2.5;
  h.lr('Serial No:', invoice.serial_number, y, 5); y += 2.5;
  if (invoice.order_code) { h.lr('Order Code:', invoice.order_code, y, 5); y += 2.5; }
  h.lr('Date:', formatInvoiceDate(invoice.invoice_date), y, 5); y += 2.5;
  if (invoice.branch_code && invoice.branch_code !== 'MAIN') {
    h.lr('Branch:', invoice.branch_code, y, 5); y += 2.5;
  }
  h.lr('Channel:', getChannelLabel(invoice.channel), y, 5); y += 2.5;
  h.lr('Payment:', invoice.payment_type === 'cash' ? 'CASH SALE' : invoice.payment_type.toUpperCase() + ' SALE', y, 5); y += 2.5;
  if (invoice.parent_invoice_id) {
    h.lr('Ref Invoice:', `#${invoice.parent_invoice_id}`, y, 5); y += 2.5;
  }
  y += 0.5; h.dash(y); y += 2.5;

  // ── Buyer ──
  h.left('Sold to:', y, 5, 'bold'); y += 2.5;
  h.left(invoice.buyer_name, y, 5); y += 2.5;
  if (invoice.buyer_tin) { h.left(`TIN: ${invoice.buyer_tin}`, y, 5); y += 2.5; }
  if (invoice.buyer_address) {
    doc.setFontSize(4.5);
    const al = doc.splitTextToSize(invoice.buyer_address, h.cw);
    al.forEach((l: string) => { doc.text(l, m, y); y += 2; });
  }
  y += 0.5; h.dash(y); y += 2.5;

  // ── Items Table ──
  doc.setFontSize(5); doc.setFont('helvetica', 'bold');
  doc.text('Description', m, y);
  doc.text('Qty', m + 38, y);
  doc.text('Price', m + 46, y);
  h.right('Amount', y, 5, 'bold');
  y += 1; h.solid(y); y += 2;

  doc.setFont('helvetica', 'normal');
  (invoice.items || []).forEach((item: InvoiceLineItem) => {
    doc.setFontSize(5);
    const dl = doc.splitTextToSize(item.description, 36);
    doc.text(dl[0], m, y);
    doc.text(String(item.quantity), m + 38, y);
    doc.text(formatCurrency(item.unit_price), m + 46, y);
    h.right(formatCurrency(item.net_amount), y, 5);
    y += 2.5;
    if (dl.length > 1) { for (let i = 1; i < dl.length; i++) { doc.text(dl[i], m, y); y += 2; } }
    if (item.discount_amount > 0) {
      doc.setFontSize(4); doc.setTextColor(0, 128, 0);
      doc.text(`  Disc (${item.discount_type?.toUpperCase()}): -${formatCurrency(item.discount_amount)}`, m, y);
      doc.setTextColor(0); y += 2;
    }
  });

  y += 0.5; h.dash(y); y += 2.5;

  // ── Totals ──
  h.lr('Gross Sales:', formatCurrency(invoice.gross_sales), y, 5.5); y += 2.5;
  if (invoice.total_discount > 0) {
    h.lr('Less: Discount', `-${formatCurrency(invoice.total_discount)}`, y, 5.5); y += 2.5;
    // Show regulated discount breakdown
    if (invoice.sc_discount > 0) {
      h.lr(`  SC Discount (${invoice.sc_id_no || ''})`, `-${formatCurrency(invoice.sc_discount)}`, y, 4.5); y += 2;
    }
    if (invoice.pwd_discount > 0) {
      h.lr(`  PWD Discount (${invoice.pwd_id_no || ''})`, `-${formatCurrency(invoice.pwd_discount)}`, y, 4.5); y += 2;
    }
    if (invoice.naac_discount > 0) {
      h.lr(`  NAAC Discount`, `-${formatCurrency(invoice.naac_discount)}`, y, 4.5); y += 2;
    }
    if (invoice.solo_parent_discount > 0) {
      h.lr(`  Solo Parent Discount`, `-${formatCurrency(invoice.solo_parent_discount)}`, y, 4.5); y += 2;
    }
    if (invoice.promo_discount > 0) {
      h.lr(`  Promo Discount`, `-${formatCurrency(invoice.promo_discount)}`, y, 4.5); y += 2;
    }
  }
  h.lr('Net Sales:', formatCurrency(invoice.net_sales), y, 5.5); y += 2.5;
  if (invoice.delivery_fee > 0) { h.lr('Delivery Fee:', formatCurrency(invoice.delivery_fee), y, 5.5); y += 2.5; }
  if (invoice.service_charge > 0) { h.lr('Service Charge:', formatCurrency(invoice.service_charge), y, 5.5); y += 2.5; }
  if (invoice.withholding_tax > 0) { h.lr('W/holding Tax:', `-${formatCurrency(invoice.withholding_tax)}`, y, 5.5); y += 2.5; }

  h.solid(y); y += 2.5;

  // Grand total
  doc.setFillColor(245, 245, 245);
  doc.rect(m, y - 1.5, h.cw, 6, 'F');
  h.lr('TOTAL AMOUNT DUE:', formatCurrency(invoice.total_amount_due), y + 1.5, 7, 'bold', 'bold');
  y += 8;

  // Payment details
  if (invoice.amount_tendered) {
    h.lr('Amount Tendered:', formatCurrency(invoice.amount_tendered), y, 5.5); y += 2.5;
  }
  if (invoice.change_amount) {
    h.lr('Change:', formatCurrency(invoice.change_amount), y, 5.5); y += 2.5;
  }

  h.dash(y); y += 2.5;

  // ── VAT Breakdown ──
  h.center('TAX BREAKDOWN', y, 5.5, 'bold'); y += 2.5;
  if (invoice.vatable_sales > 0) { h.lr('VATable Sales:', formatCurrency(invoice.vatable_sales), y, 5); y += 2.5; }
  if (invoice.vat_amount > 0) { h.lr('VAT (12%):', formatCurrency(invoice.vat_amount), y, 5); y += 2.5; }
  if (invoice.vat_exempt_sales > 0) { h.lr('VAT-Exempt Sales:', formatCurrency(invoice.vat_exempt_sales), y, 5); y += 2.5; }
  if (invoice.zero_rated_sales > 0) { h.lr('Zero-Rated Sales:', formatCurrency(invoice.zero_rated_sales), y, 5); y += 2.5; }
  if (invoice.vatable_sales === 0 && invoice.vat_amount === 0 && invoice.vat_exempt_sales === 0 && invoice.zero_rated_sales === 0) {
    h.lr('VAT-Exempt Sales:', formatCurrency(invoice.net_sales), y, 5); y += 2.5;
  }

  h.dash(y); y += 3;

  // ── Footer ──
  doc.setTextColor(120);
  h.center('THIS SERVES AS AN', y, 4.5);
  y += 2;
  doc.setTextColor(0);
  h.center(`OFFICIAL ${getDocTypeLabel(invoice.document_type).toUpperCase()}`, y, 5.5, 'bold');
  y += 3;
  doc.setTextColor(120);
  h.center('Generated electronically by WeKonnek', y, 4);
  y += 2;
  h.center('www.wekonnek.com', y, 4);
  y += 3;

  // QR placeholder
  doc.setDrawColor(200);
  doc.rect(pw / 2 - 8, y, 16, 16);
  doc.setFontSize(3.5); doc.setTextColor(150);
  const qrLines = doc.splitTextToSize(invoice.invoice_number, 14);
  qrLines.forEach((l: string, i: number) => { doc.text(l, (pw - doc.getTextWidth(l)) / 2, y + 6 + i * 1.8); });
  y += 19;

  doc.setTextColor(140);
  h.center('Thank you for your purchase!', y, 4.5);
  y += 2;
  h.center(`Generated: ${new Date().toLocaleDateString('en-PH')}`, y, 3.5);

  return doc;
}

// ════════════════════════════════════════════════════════════════════
// A4 FULL PAGE PDF — for formal/business use, printable, archivable
// ════════════════════════════════════════════════════════════════════

export function generateA4PDF(invoice: Invoice): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = 210, m = 15;
  const h = pdfHelpers(doc, pw, m);
  let y = 15;

  // ── Header ──
  doc.setFillColor(219, 0, 2);
  doc.rect(0, 0, pw, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('WeKonnek', m, 10);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(getDocTypeLabel(invoice.document_type).toUpperCase(), m, 17);

  // Invoice number on right
  doc.setFontSize(9);
  const invNoText = invoice.invoice_number;
  doc.text(invNoText, pw - m - doc.getTextWidth(invNoText), 10);
  const serialText = `SN: ${invoice.serial_number}`;
  doc.text(serialText, pw - m - doc.getTextWidth(serialText), 17);

  doc.setTextColor(0, 0, 0);
  y = 28;

  // Reprint
  if (invoice.is_reprint) {
    doc.setTextColor(200, 0, 0);
    doc.setFontSize(10); doc.setFont('helvetica', 'bold');
    doc.text('*** REPRINT ***', pw - m - doc.getTextWidth('*** REPRINT ***'), y);
    doc.setTextColor(0); y += 5;
  }

  // ── Seller & Buyer side by side ──
  const colW = (pw - 2 * m - 10) / 2;
  const sellerX = m;
  const buyerX = m + colW + 10;

  // Seller box
  doc.setFillColor(248, 248, 248);
  doc.rect(sellerX, y, colW, 38, 'F');
  doc.setDrawColor(220); doc.rect(sellerX, y, colW, 38);

  doc.setFontSize(7); doc.setTextColor(150);
  doc.text('SELLER', sellerX + 3, y + 4);
  doc.setTextColor(0);
  doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text(invoice.seller_registered_name, sellerX + 3, y + 9);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  let sy = y + 13;
  if (invoice.seller_trade_name && invoice.seller_trade_name !== invoice.seller_registered_name) {
    doc.text(`Trade Name: ${invoice.seller_trade_name}`, sellerX + 3, sy); sy += 3.5;
  }
  if (invoice.seller_tin) { doc.text(`TIN: ${invoice.seller_tin}`, sellerX + 3, sy); sy += 3.5; }
  if (invoice.seller_address) {
    const al = doc.splitTextToSize(invoice.seller_address, colW - 6);
    al.forEach((l: string) => { doc.text(l, sellerX + 3, sy); sy += 3; });
  }
  if (invoice.seller_phone) { doc.text(`Tel: ${invoice.seller_phone}`, sellerX + 3, sy); sy += 3; }
  if (invoice.seller_bir_accreditation) { doc.text(`Accred No: ${invoice.seller_bir_accreditation}`, sellerX + 3, sy); sy += 3; }

  // Buyer box
  doc.setFillColor(248, 248, 248);
  doc.rect(buyerX, y, colW, 38, 'F');
  doc.setDrawColor(220); doc.rect(buyerX, y, colW, 38);

  doc.setFontSize(7); doc.setTextColor(150);
  doc.text('BUYER / SOLD TO', buyerX + 3, y + 4);
  doc.setTextColor(0);
  doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text(invoice.buyer_name, buyerX + 3, y + 9);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  let by = y + 13;
  if (invoice.buyer_tin) { doc.text(`TIN: ${invoice.buyer_tin}`, buyerX + 3, by); by += 3.5; }
  if (invoice.buyer_address) {
    const bl = doc.splitTextToSize(invoice.buyer_address, colW - 6);
    bl.forEach((l: string) => { doc.text(l, buyerX + 3, by); by += 3; });
  }
  if (invoice.buyer_phone) { doc.text(`Tel: ${invoice.buyer_phone}`, buyerX + 3, by); by += 3; }
  if (invoice.buyer_email) { doc.text(invoice.buyer_email, buyerX + 3, by); by += 3; }

  y += 42;

  // ── Invoice Meta ──
  doc.setFontSize(7.5);
  const metaItems = [
    ['Date:', formatInvoiceDate(invoice.invoice_date)],
    ['Tax Type:', getTaxTypeLabel(invoice.tax_type)],
    ['Channel:', getChannelLabel(invoice.channel)],
    ['Payment:', invoice.payment_type === 'cash' ? 'Cash Sale' : `${invoice.payment_type} Sale`],
    ['Order Code:', invoice.order_code || 'N/A'],
  ];
  if (invoice.branch_code && invoice.branch_code !== 'MAIN') metaItems.push(['Branch:', invoice.branch_code]);

  const metaPerRow = 3;
  const metaColW = (pw - 2 * m) / metaPerRow;
  metaItems.forEach((item, idx) => {
    const col = idx % metaPerRow;
    const row = Math.floor(idx / metaPerRow);
    const x = m + col * metaColW;
    const my = y + row * 5;
    doc.setTextColor(150); doc.text(item[0], x, my);
    doc.setTextColor(0); doc.setFont('helvetica', 'bold');
    doc.text(item[1], x + doc.getTextWidth(item[0]) + 2, my);
    doc.setFont('helvetica', 'normal');
  });
  y += Math.ceil(metaItems.length / metaPerRow) * 5 + 3;

  // ── Items Table ──
  const cols = [
    { label: '#', x: m, w: 8 },
    { label: 'Description', x: m + 8, w: 60 },
    { label: 'Qty', x: m + 68, w: 15 },
    { label: 'Unit Price', x: m + 83, w: 25 },
    { label: 'Gross', x: m + 108, w: 25 },
    { label: 'Discount', x: m + 133, w: 22 },
    { label: 'Net Amount', x: m + 155, w: 25 },
  ];

  // Header
  doc.setFillColor(50, 50, 50);
  doc.rect(m, y, pw - 2 * m, 6, 'F');
  doc.setTextColor(255); doc.setFontSize(7); doc.setFont('helvetica', 'bold');
  cols.forEach(c => doc.text(c.label, c.x + 1, y + 4));
  doc.setTextColor(0); doc.setFont('helvetica', 'normal');
  y += 8;

  // Rows
  (invoice.items || []).forEach((item: InvoiceLineItem, idx: number) => {
    if (idx % 2 === 0) {
      doc.setFillColor(250, 250, 250);
      doc.rect(m, y - 3, pw - 2 * m, 5, 'F');
    }
    doc.setFontSize(7);
    doc.text(String(item.line_no), cols[0].x + 1, y);
    const descLines = doc.splitTextToSize(item.description, cols[1].w - 2);
    doc.text(descLines[0], cols[1].x + 1, y);
    doc.text(String(item.quantity), cols[2].x + 1, y);
    doc.text(formatCurrency(item.unit_price), cols[3].x + 1, y);
    doc.text(formatCurrency(item.gross_amount), cols[4].x + 1, y);
    doc.text(item.discount_amount > 0 ? `-${formatCurrency(item.discount_amount)}` : '-', cols[5].x + 1, y);
    doc.text(formatCurrency(item.net_amount), cols[6].x + 1, y);
    y += 5;
    if (descLines.length > 1) {
      for (let i = 1; i < descLines.length; i++) { doc.text(descLines[i], cols[1].x + 1, y); y += 3.5; }
    }
  });

  y += 3;
  doc.setDrawColor(50); doc.line(m, y, pw - m, y); y += 4;

  // ── Totals (right-aligned) ──
  const totX = pw - m - 70;
  const printTotalRow = (label: string, value: string, bold = false) => {
    doc.setFontSize(8); doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, totX, y);
    const vw = doc.getTextWidth(value);
    doc.text(value, pw - m - vw, y);
    y += 4;
  };

  printTotalRow('Gross Sales:', formatCurrency(invoice.gross_sales));
  if (invoice.total_discount > 0) {
    printTotalRow('Less: Discounts:', `-${formatCurrency(invoice.total_discount)}`);
    if (invoice.sc_discount > 0) { doc.setFontSize(7); doc.text(`  SC (${invoice.sc_id_no || 'N/A'})`, totX, y); doc.text(`-${formatCurrency(invoice.sc_discount)}`, pw - m - doc.getTextWidth(`-${formatCurrency(invoice.sc_discount)}`), y); y += 3.5; }
    if (invoice.pwd_discount > 0) { doc.setFontSize(7); doc.text(`  PWD (${invoice.pwd_id_no || 'N/A'})`, totX, y); doc.text(`-${formatCurrency(invoice.pwd_discount)}`, pw - m - doc.getTextWidth(`-${formatCurrency(invoice.pwd_discount)}`), y); y += 3.5; }
    if (invoice.solo_parent_discount > 0) { doc.setFontSize(7); doc.text('  Solo Parent', totX, y); doc.text(`-${formatCurrency(invoice.solo_parent_discount)}`, pw - m - doc.getTextWidth(`-${formatCurrency(invoice.solo_parent_discount)}`), y); y += 3.5; }
  }
  printTotalRow('Net Sales:', formatCurrency(invoice.net_sales));
  if (invoice.delivery_fee > 0) printTotalRow('Delivery Fee:', formatCurrency(invoice.delivery_fee));
  if (invoice.service_charge > 0) printTotalRow('Service Charge:', formatCurrency(invoice.service_charge));
  if (invoice.withholding_tax > 0) printTotalRow('Less: W/Tax:', `-${formatCurrency(invoice.withholding_tax)}`);

  // Grand total box
  doc.setFillColor(219, 0, 2);
  doc.rect(totX - 2, y - 1, pw - m - totX + 2, 8, 'F');
  doc.setTextColor(255); doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text('TOTAL AMOUNT DUE:', totX, y + 4);
  const totalStr = formatCurrency(invoice.total_amount_due);
  doc.text(totalStr, pw - m - doc.getTextWidth(totalStr), y + 4);
  doc.setTextColor(0);
  y += 12;

  // ── VAT Summary Box ──
  doc.setFillColor(248, 248, 248);
  const vatBoxH = 22;
  doc.rect(m, y, pw - 2 * m, vatBoxH, 'F');
  doc.setDrawColor(220); doc.rect(m, y, pw - 2 * m, vatBoxH);

  doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(100);
  doc.text('TAX BREAKDOWN', m + 3, y + 4);
  doc.setTextColor(0); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);

  const vatRows = [
    ['VATable Sales', formatCurrency(invoice.vatable_sales)],
    ['VAT (12%)', formatCurrency(invoice.vat_amount)],
    ['VAT-Exempt Sales', formatCurrency(invoice.vat_exempt_sales)],
    ['Zero-Rated Sales', formatCurrency(invoice.zero_rated_sales)],
  ];
  const vatColW = (pw - 2 * m - 6) / 4;
  vatRows.forEach((vr, i) => {
    const vx = m + 3 + i * vatColW;
    doc.setTextColor(120); doc.setFontSize(6.5);
    doc.text(vr[0], vx, y + 10);
    doc.setTextColor(0); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
    doc.text(vr[1], vx, y + 15);
    doc.setFont('helvetica', 'normal');
  });
  y += vatBoxH + 5;

  // ── Footer ──
  doc.setFontSize(7); doc.setTextColor(120);
  h.center(`THIS SERVES AS AN OFFICIAL ${getDocTypeLabel(invoice.document_type).toUpperCase()}`, y, 7, 'bold');
  y += 4;
  doc.setTextColor(150);
  h.center('Generated electronically by WeKonnek — www.wekonnek.com', y, 6);
  y += 3;
  h.center(`Invoice: ${invoice.invoice_number}  |  Serial: ${invoice.serial_number}  |  Date: ${new Date().toLocaleDateString('en-PH')}`, y, 5.5);

  return doc;
}

// ════════════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════════════

/** Default PDF — thermal receipt */
export function generateInvoicePDF(invoice: Invoice): jsPDF {
  return generateThermalPDF(invoice);
}

export function downloadInvoicePDF(invoice: Invoice, format: 'thermal' | 'a4' = 'thermal') {
  const doc = format === 'a4' ? generateA4PDF(invoice) : generateThermalPDF(invoice);
  doc.save(`${invoice.invoice_number}.pdf`);
}

export function previewInvoicePDF(invoice: Invoice, format: 'thermal' | 'a4' = 'thermal') {
  const doc = format === 'a4' ? generateA4PDF(invoice) : generateThermalPDF(invoice);
  const blob = doc.output('blob');
  window.open(URL.createObjectURL(blob), '_blank');
}

/** Export structured JSON payload (machine-readable) per RMO 24-2023 */
export function exportInvoiceJSON(invoice: Invoice): string {
  const { buildEISPayload } = require('./e-invoice');
  return JSON.stringify(buildEISPayload(invoice), null, 2);
}

export function downloadInvoiceJSON(invoice: Invoice) {
  const json = exportInvoiceJSON(invoice);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${invoice.invoice_number}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
