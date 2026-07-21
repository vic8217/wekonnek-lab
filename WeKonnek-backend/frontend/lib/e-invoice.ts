import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

async function apiFetch(path: string, options?: RequestInit) {
  const token = getToken();
  const headers: Record<string, string> = { ...((options?.headers as Record<string, string>) || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options?.body && typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  return fetch(`${API}${path}`, { ...options, headers });
}

// ════════════════════════════════════════════════════════════════════
// TYPES — Full BIR-compliant invoice model
// ════════════════════════════════════════════════════════════════════

export type DocumentType = 'invoice' | 'receipt' | 'credit_memo' | 'debit_memo' | 'payment_receipt';
export type TaxType = 'vat' | 'non_vat' | 'vat_exempt' | 'zero_rated' | 'mixed';
export type InvoiceStatus = 'draft' | 'generated' | 'sent' | 'printed' | 'voided' | 'replaced';
export type EISStatus = 'not_required' | 'pending' | 'transmitted' | 'acknowledged' | 'failed' | 'retrying';
export type PaymentType = 'cash' | 'charge' | 'gcash' | 'maya' | 'card' | 'bank_transfer' | 'cod' | 'mixed';
export type DiscountType = 'sc' | 'pwd' | 'naac' | 'solo_parent' | 'promo';
export type Channel = 'in_store' | 'pickup' | 'dine_in' | 'reservation' | 'delivery' | 'marketplace';
export type AuditAction =
  | 'created' | 'sent' | 'printed' | 'reprinted' | 'voided'
  | 'replaced' | 'eis_transmitted' | 'eis_acknowledged' | 'eis_failed'
  | 'eis_retried' | 'edited' | 'credit_memo_issued' | 'debit_memo_issued'
  | 'payment_received' | 'exported' | 'email_sent';

export interface InvoiceLineItem {
  line_no: number;
  product_id: number | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  gross_amount: number;
  discount_amount: number;
  discount_type: DiscountType | null;
  discount_id_no: string | null;
  net_amount: number;
  tax_type: TaxType;
  vat_amount: number;
  withholding_tax: number;
}

export interface Invoice {
  id: number;
  invoice_number: string;
  serial_number: string;
  branch_code: string;
  approved_series: string | null;
  document_type: DocumentType;
  tax_type: TaxType;
  order_id: number | null;
  order_code: string | null;
  parent_invoice_id: number | null;
  channel: Channel;

  // Seller
  merchant_id: number;
  seller_registered_name: string;
  seller_trade_name: string | null;
  seller_tin: string | null;
  seller_branch_code: string | null;
  seller_address: string;
  seller_city: string | null;
  seller_phone: string | null;
  seller_email: string | null;
  seller_bir_accreditation: string | null;
  seller_bir_permit: string | null;

  // Buyer
  customer_id: string | null;
  buyer_name: string;
  buyer_tin: string | null;
  buyer_address: string | null;
  buyer_phone: string | null;
  buyer_email: string | null;

  invoice_date: string;
  due_date: string | null;
  items: InvoiceLineItem[];

  // Amounts
  gross_sales: number;
  total_discount: number;
  sc_discount: number;
  pwd_discount: number;
  naac_discount: number;
  solo_parent_discount: number;
  promo_discount: number;
  sc_id_no: string | null;
  pwd_id_no: string | null;
  naac_id_no: string | null;
  solo_parent_id_no: string | null;
  net_sales: number;
  delivery_fee: number;
  service_charge: number;
  platform_fee: number;

  // VAT
  vatable_sales: number;
  vat_amount: number;
  vat_exempt_sales: number;
  zero_rated_sales: number;
  withholding_tax: number;
  total_amount_due: number;

  // Payment
  payment_type: PaymentType;
  amount_tendered: number | null;
  change_amount: number | null;

  // Status
  status: InvoiceStatus;
  is_reprint: boolean;
  reprint_count: number;
  voided_at: string | null;
  voided_by: string | null;
  voided_reason: string | null;
  replaced_by_id: number | null;

  // EIS
  eis_unique_id: string | null;
  eis_status: EISStatus;
  eis_transmitted_at: string | null;
  eis_acknowledged_at: string | null;
  eis_retry_count: number;
  eis_payload: object | null;

  notes: string | null;
  internal_notes: string | null;
  idempotency_key: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: number;
  invoice_id: number;
  action: AuditAction;
  performed_by: string | null;
  channel: string | null;
  details: object | null;
  created_at: string;
}

export interface DailySalesSummary {
  id: number;
  merchant_id: number;
  branch_code: string;
  summary_date: string;
  total_invoices: number;
  total_voided: number;
  total_credit_memos: number;
  total_debit_memos: number;
  gross_sales: number;
  total_discounts: number;
  sc_discounts: number;
  pwd_discounts: number;
  net_sales: number;
  vatable_sales: number;
  vat_amount: number;
  vat_exempt_sales: number;
  zero_rated_sales: number;
  total_amount: number;
  delivery_fees: number;
  service_charges: number;
  platform_fees: number;
  is_reconciled: boolean;
}

// ════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════

const VAT_RATE = 0.12;
const SC_PWD_DISCOUNT_RATE = 0.20; // 20% for SC and PWD per RA 9994 / RA 10754

// ════════════════════════════════════════════════════════════════════
// TAX CLASSIFICATION ENGINE
// ════════════════════════════════════════════════════════════════════

export interface TaxBreakdown {
  tax_type: TaxType;
  vatable_sales: number;
  vat_amount: number;
  vat_exempt_sales: number;
  zero_rated_sales: number;
}

/** Compute full VAT breakdown for a given subtotal */
export function calculateTax(subtotal: number, taxType: TaxType): TaxBreakdown {
  const r = (n: number) => parseFloat(n.toFixed(2));

  switch (taxType) {
    case 'vat': {
      // VAT-inclusive pricing (standard PH)
      const vatable = subtotal / (1 + VAT_RATE);
      return { tax_type: 'vat', vatable_sales: r(vatable), vat_amount: r(subtotal - vatable), vat_exempt_sales: 0, zero_rated_sales: 0 };
    }
    case 'non_vat':
      return { tax_type: 'non_vat', vatable_sales: 0, vat_amount: 0, vat_exempt_sales: r(subtotal), zero_rated_sales: 0 };
    case 'vat_exempt':
      return { tax_type: 'vat_exempt', vatable_sales: 0, vat_amount: 0, vat_exempt_sales: r(subtotal), zero_rated_sales: 0 };
    case 'zero_rated':
      return { tax_type: 'zero_rated', vatable_sales: 0, vat_amount: 0, vat_exempt_sales: 0, zero_rated_sales: r(subtotal) };
    case 'mixed':
      // For mixed: caller should provide per-item tax_type and aggregate
      return { tax_type: 'mixed', vatable_sales: 0, vat_amount: 0, vat_exempt_sales: 0, zero_rated_sales: 0 };
    default:
      return { tax_type: 'non_vat', vatable_sales: 0, vat_amount: 0, vat_exempt_sales: r(subtotal), zero_rated_sales: 0 };
  }
}

/** Determine tax type from merchant's VAT status */
export function merchantTaxType(isVatRegistered: boolean): TaxType {
  return isVatRegistered ? 'vat' : 'non_vat';
}

// ════════════════════════════════════════════════════════════════════
// DISCOUNT ENGINE — SC, PWD, NAAC/MOV, Solo Parent, Promo
// ════════════════════════════════════════════════════════════════════

export interface DiscountInput {
  type: DiscountType;
  id_no?: string;            // SC/PWD/NAAC/Solo Parent ID number
  custom_rate?: number;       // for promo discounts (0-1)
  custom_amount?: number;     // fixed amount discount
}

export interface DiscountResult {
  type: DiscountType;
  rate: number;
  amount: number;
  id_no: string | null;
}

/** Calculate regulated discount amount */
export function calculateDiscount(grossAmount: number, discount: DiscountInput): DiscountResult {
  let rate = 0;
  let amount = 0;

  switch (discount.type) {
    case 'sc':
    case 'pwd':
      // RA 9994 / RA 10754: 20% discount on VAT-exclusive amount
      // SC/PWD are also VAT-exempt per BIR
      rate = SC_PWD_DISCOUNT_RATE;
      // VAT-exclusive base for SC/PWD
      const vatExclusiveBase = grossAmount / (1 + VAT_RATE);
      amount = parseFloat((vatExclusiveBase * rate).toFixed(2));
      break;
    case 'naac':
      rate = SC_PWD_DISCOUNT_RATE; // 20% same as SC/PWD
      const naacBase = grossAmount / (1 + VAT_RATE);
      amount = parseFloat((naacBase * rate).toFixed(2));
      break;
    case 'solo_parent':
      rate = 0.10; // 10% per RA 11861
      const spBase = grossAmount / (1 + VAT_RATE);
      amount = parseFloat((spBase * rate).toFixed(2));
      break;
    case 'promo':
      if (discount.custom_amount) {
        amount = discount.custom_amount;
        rate = grossAmount > 0 ? amount / grossAmount : 0;
      } else {
        rate = discount.custom_rate || 0;
        amount = parseFloat((grossAmount * rate).toFixed(2));
      }
      break;
  }

  return {
    type: discount.type,
    rate,
    amount,
    id_no: discount.id_no || null,
  };
}

/** Calculate discounts for line items (handles SC/PWD VAT exemption) */
export function applyLineItemDiscount(
  item: { unit_price: number; quantity: number; tax_type: TaxType },
  discount: DiscountInput
): { discount_amount: number; new_tax_type: TaxType } {
  const grossAmount = item.unit_price * item.quantity;
  const result = calculateDiscount(grossAmount, discount);

  // SC/PWD/NAAC transactions become VAT-exempt per BIR rules
  let newTaxType = item.tax_type;
  if (['sc', 'pwd', 'naac'].includes(discount.type) && item.tax_type === 'vat') {
    newTaxType = 'vat_exempt';
  }

  return { discount_amount: result.amount, new_tax_type: newTaxType };
}

// ════════════════════════════════════════════════════════════════════
// INVOICE NUMBER GENERATION — branch-based, gap-free
// ════════════════════════════════════════════════════════════════════

async function generateInvoiceNumber(
  merchantId: number,
  branchCode: string = 'MAIN',
  docType: DocumentType = 'invoice'
): Promise<string> {
  try {
    const res = await apiFetch('/api/invoices/generate-number', {
      method: 'POST',
      body: JSON.stringify({ merchantId, branchCode, docType }),
    });
    if (!res.ok) throw new Error('Failed to generate invoice number');
    const data = await res.json();
    return data.invoiceNumber || data;
  } catch {
    const year = new Date().getFullYear();
    const prefix = { invoice: 'INV', receipt: 'OR', credit_memo: 'CM', debit_memo: 'DM', payment_receipt: 'PR' }[docType] || 'INV';
    const rand = Math.floor(Math.random() * 999999).toString().padStart(6, '0');
    return `WK-${prefix}-${branchCode}-${year}-${rand}`;
  }
}

async function generateSerialNumber(): Promise<string> {
  try {
    const res = await apiFetch('/api/invoices/generate-serial');
    if (!res.ok) throw new Error('Failed to generate serial number');
    const data = await res.json();
    return data.serialNumber || data;
  } catch {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `WK-SN-${d}-${Math.floor(Math.random() * 999999).toString().padStart(6, '0')}`;
  }
}

/** Generate idempotency key for an order */
function makeIdempotencyKey(orderId: number, docType: DocumentType): string {
  return `order-${orderId}-${docType}-${Date.now()}`;
}

// ════════════════════════════════════════════════════════════════════
// AUDIT TRAIL — immutable log for every invoice action
// ════════════════════════════════════════════════════════════════════

export async function logAudit(
  invoiceId: number,
  action: AuditAction,
  details?: Record<string, unknown>,
  channel?: string,
): Promise<void> {
  try {
    await apiFetch(`/api/invoices/${invoiceId}/audit`, {
      method: 'POST',
      body: JSON.stringify({ action, channel: channel || null, details: details || null }),
    });
  } catch (err) {
    console.error('Audit log error (non-blocking):', err);
  }
}

// ════════════════════════════════════════════════════════════════════
// INVOICE GENERATION
// ════════════════════════════════════════════════════════════════════

export interface GenerateInvoiceParams {
  orderId: number;
  documentType?: DocumentType;
  channel?: Channel;
  discounts?: DiscountInput[];  // optional regulated discounts
  serviceFee?: number;
  platformFee?: number;
}

export async function generateInvoice(orderId: number, params?: Partial<GenerateInvoiceParams>): Promise<Invoice | null> {
  try {
    const res = await apiFetch('/api/invoices/generate', {
      method: 'POST',
      body: JSON.stringify({ orderId, ...params }),
    });
    if (!res.ok) {
      console.error('Invoice generation error:', await res.text());
      return null;
    }
    return await res.json() as Invoice;
  } catch (error) {
    console.error('Invoice generation error:', error);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════
// VOID INVOICE — with audit and replacement support
// ════════════════════════════════════════════════════════════════════

export async function voidInvoice(invoiceId: number, reason: string): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/invoices/${invoiceId}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    return res.ok;
  } catch { return false; }
}

// ════════════════════════════════════════════════════════════════════
// CREDIT MEMO — issued against a parent invoice
// ════════════════════════════════════════════════════════════════════

export async function issueCreditMemo(
  parentInvoiceId: number,
  items: InvoiceLineItem[],
  reason: string,
): Promise<Invoice | null> {
  try {
    const res = await apiFetch(`/api/invoices/${parentInvoiceId}/credit-memo`, {
      method: 'POST',
      body: JSON.stringify({ items, reason }),
    });
    if (!res.ok) { console.error('Credit memo error:', await res.text()); return null; }
    return await res.json() as Invoice;
  } catch (err) { console.error('Credit memo error:', err); return null; }
}

// ════════════════════════════════════════════════════════════════════
// DEBIT MEMO
// ════════════════════════════════════════════════════════════════════

export async function issueDebitMemo(
  parentInvoiceId: number,
  items: InvoiceLineItem[],
  reason: string,
): Promise<Invoice | null> {
  try {
    const res = await apiFetch(`/api/invoices/${parentInvoiceId}/debit-memo`, {
      method: 'POST',
      body: JSON.stringify({ items, reason }),
    });
    if (!res.ok) { console.error('Debit memo error:', await res.text()); return null; }
    return await res.json() as Invoice;
  } catch (err) { console.error('Debit memo error:', err); return null; }
}

// ════════════════════════════════════════════════════════════════════
// REPRINT TRACKING
// ════════════════════════════════════════════════════════════════════

export async function markReprinted(invoiceId: number): Promise<void> {
  await apiFetch(`/api/invoices/${invoiceId}/reprint`, { method: 'POST' });
}

// ════════════════════════════════════════════════════════════════════
// EIS TRANSMISSION READINESS (RMO 24-2023)
// ════════════════════════════════════════════════════════════════════

/** Build JSON payload for BIR EIS transmission */
export function buildEISPayload(invoice: Invoice): object {
  return {
    eis_version: '1.0',
    invoice_number: invoice.invoice_number,
    serial_number: invoice.serial_number,
    document_type: invoice.document_type,
    tax_type: invoice.tax_type,
    seller: {
      registered_name: invoice.seller_registered_name,
      trade_name: invoice.seller_trade_name,
      tin: invoice.seller_tin,
      branch_code: invoice.seller_branch_code,
      address: invoice.seller_address,
      bir_accreditation: invoice.seller_bir_accreditation,
      bir_permit: invoice.seller_bir_permit,
    },
    buyer: {
      name: invoice.buyer_name,
      tin: invoice.buyer_tin,
      address: invoice.buyer_address,
    },
    invoice_date: invoice.invoice_date,
    items: invoice.items.map(item => ({
      line_no: item.line_no,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
      gross_amount: item.gross_amount,
      discount_amount: item.discount_amount,
      net_amount: item.net_amount,
      tax_type: item.tax_type,
      vat_amount: item.vat_amount,
    })),
    amounts: {
      gross_sales: invoice.gross_sales,
      total_discount: invoice.total_discount,
      sc_discount: invoice.sc_discount,
      pwd_discount: invoice.pwd_discount,
      net_sales: invoice.net_sales,
      vatable_sales: invoice.vatable_sales,
      vat_amount: invoice.vat_amount,
      vat_exempt_sales: invoice.vat_exempt_sales,
      zero_rated_sales: invoice.zero_rated_sales,
      withholding_tax: invoice.withholding_tax,
      total_amount_due: invoice.total_amount_due,
    },
    payment: {
      type: invoice.payment_type,
    },
    channel: invoice.channel,
    generated_at: invoice.created_at,
  };
}

/** Queue EIS transmission (stores payload, marks pending) */
export async function queueEISTransmission(invoiceId: number): Promise<boolean> {
  try {
    const res = await apiFetch(`/api/invoices/${invoiceId}/eis-queue`, { method: 'POST' });
    return res.ok;
  } catch (err) {
    console.error('EIS queue error:', err);
    return false;
  }
}

// ════════════════════════════════════════════════════════════════════
// FETCH HELPERS
// ════════════════════════════════════════════════════════════════════

export async function getInvoiceByOrder(orderId: number): Promise<Invoice | null> {
  const res = await apiFetch(`/api/invoices?orderId=${orderId}&docType=invoice`);
  if (!res.ok) return null;
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.data || [];
  return list[0] || null;
}

export async function getMerchantInvoices(merchantId: number, filters?: {
  status?: InvoiceStatus;
  docType?: DocumentType;
  dateFrom?: string;
  dateTo?: string;
}): Promise<Invoice[]> {
  const params = new URLSearchParams({ merchantId: String(merchantId) });
  if (filters?.status) params.set('status', filters.status);
  if (filters?.docType) params.set('docType', filters.docType);
  if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters?.dateTo) params.set('dateTo', filters.dateTo);

  const res = await apiFetch(`/api/invoices?${params}`);
  if (!res.ok) { console.error('Merchant invoices error'); return []; }
  const data = await res.json();
  return Array.isArray(data) ? data : data.data || [];
}

export async function getCustomerInvoices(customerId: string): Promise<Invoice[]> {
  const res = await apiFetch(`/api/invoices?customerId=${customerId}`);
  if (!res.ok) { console.error('Customer invoices error'); return []; }
  const data = await res.json();
  return Array.isArray(data) ? data : data.data || [];
}

export async function getInvoiceAuditLog(invoiceId: number): Promise<AuditLogEntry[]> {
  const res = await apiFetch(`/api/invoices/${invoiceId}/audit`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : data.data || [];
}

// ════════════════════════════════════════════════════════════════════
// DAILY SALES SUMMARY — reconciliation hook
// ════════════════════════════════════════════════════════════════════

export async function generateDailySummary(merchantId: number, date: string): Promise<DailySalesSummary | null> {
  try {
    const res = await apiFetch('/api/invoices/daily-summary', {
      method: 'POST',
      body: JSON.stringify({ merchantId, date }),
    });
    if (!res.ok) { console.error('Daily summary error'); return null; }
    return await res.json() as DailySalesSummary;
  } catch (err) { console.error('Daily summary error:', err); return null; }
}

// ════════════════════════════════════════════════════════════════════
// EXPORT HELPERS — sales journal, VAT summary, customer ledger
// ════════════════════════════════════════════════════════════════════

export function exportSalesJournalCSV(invoices: Invoice[]): string {
  const headers = [
    'Invoice No', 'Serial No', 'Date', 'Doc Type', 'Tax Type', 'Channel',
    'Buyer Name', 'Buyer TIN', 'Gross Sales', 'Discount', 'Net Sales',
    'VATable Sales', 'VAT 12%', 'VAT Exempt', 'Zero Rated',
    'Delivery Fee', 'Service Charge', 'Total Due', 'Payment', 'Status',
  ];
  const rows = invoices.map(i => [
    i.invoice_number, i.serial_number, i.invoice_date, i.document_type, i.tax_type, i.channel,
    i.buyer_name, i.buyer_tin || '', i.gross_sales, i.total_discount, i.net_sales,
    i.vatable_sales, i.vat_amount, i.vat_exempt_sales, i.zero_rated_sales,
    i.delivery_fee, i.service_charge, i.total_amount_due, i.payment_type, i.status,
  ].join(','));
  return [headers.join(','), ...rows].join('\n');
}

export function exportVATSummaryCSV(invoices: Invoice[]): string {
  const active = invoices.filter(i => i.status !== 'voided' && ['invoice', 'receipt'].includes(i.document_type));
  const totalVatable = active.reduce((s, i) => s + i.vatable_sales, 0);
  const totalVAT = active.reduce((s, i) => s + i.vat_amount, 0);
  const totalExempt = active.reduce((s, i) => s + i.vat_exempt_sales, 0);
  const totalZero = active.reduce((s, i) => s + i.zero_rated_sales, 0);
  return [
    'Category,Amount',
    `VATable Sales,${totalVatable.toFixed(2)}`,
    `VAT (12%),${totalVAT.toFixed(2)}`,
    `VAT-Exempt Sales,${totalExempt.toFixed(2)}`,
    `Zero-Rated Sales,${totalZero.toFixed(2)}`,
    `Total Invoices,${active.length}`,
  ].join('\n');
}

// ════════════════════════════════════════════════════════════════════
// FORMAT HELPERS
// ════════════════════════════════════════════════════════════════════

export function formatCurrency(amount: number): string {
  return `₱${Math.abs(amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatInvoiceDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function getDocTypeLabel(dt: DocumentType): string {
  return { invoice: 'Sales Invoice', receipt: 'Official Receipt', credit_memo: 'Credit Memo', debit_memo: 'Debit Memo', payment_receipt: 'Payment Receipt' }[dt] || dt;
}

export function getTaxTypeLabel(tt: TaxType): string {
  return { vat: 'VAT', non_vat: 'Non-VAT', vat_exempt: 'VAT-Exempt', zero_rated: 'Zero-Rated', mixed: 'Mixed' }[tt] || tt;
}

export function getChannelLabel(ch: Channel): string {
  return { in_store: 'In-Store', pickup: 'Pick-up', dine_in: 'Dine-In', reservation: 'Reservation', delivery: 'Delivery', marketplace: 'Marketplace' }[ch] || ch;
}
