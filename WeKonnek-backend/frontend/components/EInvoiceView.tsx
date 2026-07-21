'use client';

import { useState } from 'react';
import {
  Invoice, InvoiceLineItem,
  formatCurrency, formatInvoiceDate,
  getDocTypeLabel, getTaxTypeLabel, getChannelLabel,
} from '@/lib/e-invoice';
import { downloadInvoicePDF, downloadInvoiceJSON } from '@/lib/invoice-pdf';

interface EInvoiceViewProps {
  invoice: Invoice;
  onClose?: () => void;
}

export default function EInvoiceView({ invoice, onClose }: EInvoiceViewProps) {
  const [downloading, setDownloading] = useState(false);
  const [pdfFormat, setPdfFormat] = useState<'thermal' | 'a4'>('thermal');

  const handleDownload = () => {
    setDownloading(true);
    try { downloadInvoicePDF(invoice, pdfFormat); }
    catch (e) { console.error(e); alert('PDF download failed'); }
    finally { setDownloading(false); }
  };

  const handleJSON = () => {
    try { downloadInvoiceJSON(invoice); }
    catch (e) { console.error(e); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3" onClick={onClose}>
      <div
        className="bg-white w-full max-w-md max-h-[94vh] overflow-y-auto rounded-3xl shadow-2xl animate-slideUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ═══ Header ═══ */}
        <div className="bg-gradient-to-br from-[#DB0002] to-[#9B0001] px-5 py-4 rounded-t-3xl text-white relative">
          {onClose && (
            <button onClick={onClose} className="absolute top-3 right-3 p-1 bg-white/20 rounded-full hover:bg-white/30" title="Close">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
          <div className="text-center">
            <p className="text-white/70 text-[9px] font-semibold tracking-[3px] uppercase">WeKonnek</p>
            <h2 className="text-base font-bold mt-0.5">{getDocTypeLabel(invoice.document_type)}</h2>
            <div className="flex items-center justify-center gap-2 mt-1">
              <span className={`text-[8px] px-2 py-0.5 rounded-full font-bold ${
                invoice.status === 'voided' ? 'bg-red-200 text-red-900' :
                invoice.status === 'generated' ? 'bg-green-200 text-green-900' :
                'bg-white/30 text-white'
              }`}>{invoice.status.toUpperCase()}</span>
              <span className="text-[8px] px-2 py-0.5 rounded-full bg-white/20">{getTaxTypeLabel(invoice.tax_type)}</span>
              {invoice.is_reprint && <span className="text-[8px] px-2 py-0.5 rounded-full bg-yellow-200 text-yellow-900">REPRINT</span>}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 space-y-3">
          {/* ═══ Seller ═══ */}
          <div className="text-center">
            <h3 className="font-bold text-gray-900 text-sm">{invoice.seller_registered_name}</h3>
            {invoice.seller_trade_name && invoice.seller_trade_name !== invoice.seller_registered_name && (
              <p className="text-[10px] text-gray-400">({invoice.seller_trade_name})</p>
            )}
            {invoice.seller_tin && <p className="text-[10px] text-gray-600 font-mono">TIN: {invoice.seller_tin}</p>}
            {invoice.seller_address && <p className="text-[9px] text-gray-400">{invoice.seller_address}</p>}
            {invoice.seller_phone && <p className="text-[9px] text-gray-400">Tel: {invoice.seller_phone}</p>}
            {invoice.seller_bir_accreditation && <p className="text-[9px] text-gray-400">Accred: {invoice.seller_bir_accreditation}</p>}
            <span className={`inline-block mt-1 text-[8px] px-2 py-0.5 rounded-full font-semibold ${
              invoice.tax_type === 'vat' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}>{getTaxTypeLabel(invoice.tax_type)}</span>
          </div>

          <div className="border-t border-dashed border-gray-200" />

          {/* ═══ Invoice Details ═══ */}
          <div className="space-y-1">
            <Row label="Invoice No." value={invoice.invoice_number} mono bold />
            <Row label="Serial No." value={invoice.serial_number} mono />
            {invoice.order_code && <Row label="Order Code" value={invoice.order_code} bold />}
            <Row label="Date" value={formatInvoiceDate(invoice.invoice_date)} />
            {invoice.branch_code !== 'MAIN' && <Row label="Branch" value={invoice.branch_code} />}
            <Row label="Channel" value={getChannelLabel(invoice.channel)} />
            <Row label="Payment" value={invoice.payment_type === 'cash' ? 'Cash Sale' : `${invoice.payment_type} Sale`} />
            {invoice.parent_invoice_id && <Row label="Ref Invoice" value={`#${invoice.parent_invoice_id}`} />}
          </div>

          <div className="border-t border-dashed border-gray-200" />

          {/* ═══ Buyer ═══ */}
          <div>
            <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mb-0.5">Sold To</p>
            <p className="text-xs font-medium text-gray-900">{invoice.buyer_name}</p>
            {invoice.buyer_tin && <p className="text-[9px] text-gray-600 font-mono">TIN: {invoice.buyer_tin}</p>}
            {invoice.buyer_address && <p className="text-[9px] text-gray-400">{invoice.buyer_address}</p>}
            {invoice.buyer_phone && <p className="text-[9px] text-gray-400">{invoice.buyer_phone}</p>}
          </div>

          <div className="border-t border-dashed border-gray-200" />

          {/* ═══ Items ═══ */}
          <div>
            <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mb-1.5">Items</p>
            <div className="flex text-[8px] text-gray-400 font-semibold uppercase mb-1">
              <span className="flex-1">Description</span>
              <span className="w-7 text-center">Qty</span>
              <span className="w-14 text-right">Price</span>
              <span className="w-14 text-right">Amount</span>
            </div>
            {(invoice.items || []).map((item: InvoiceLineItem, idx: number) => (
              <div key={idx} className="mb-1.5">
                <div className="flex items-start text-[10px]">
                  <span className="flex-1 text-gray-800">{item.description}</span>
                  <span className="w-7 text-center text-gray-500">{item.quantity}</span>
                  <span className="w-14 text-right text-gray-500">{formatCurrency(item.unit_price)}</span>
                  <span className="w-14 text-right font-medium text-gray-900">{formatCurrency(item.net_amount)}</span>
                </div>
                {item.discount_amount > 0 && (
                  <p className="text-[8px] text-green-600 ml-1">
                    Disc ({item.discount_type?.toUpperCase()}): -{formatCurrency(item.discount_amount)}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-gray-200" />

          {/* ═══ Totals ═══ */}
          <div className="space-y-1">
            <Row label="Gross Sales" value={formatCurrency(invoice.gross_sales)} />
            {invoice.total_discount > 0 && (
              <>
                <Row label="Less: Discounts" value={`-${formatCurrency(invoice.total_discount)}`} green />
                {invoice.sc_discount > 0 && <Row label={`  SC (${invoice.sc_id_no || 'N/A'})`} value={`-${formatCurrency(invoice.sc_discount)}`} small green />}
                {invoice.pwd_discount > 0 && <Row label={`  PWD (${invoice.pwd_id_no || 'N/A'})`} value={`-${formatCurrency(invoice.pwd_discount)}`} small green />}
                {invoice.naac_discount > 0 && <Row label="  NAAC/MOV" value={`-${formatCurrency(invoice.naac_discount)}`} small green />}
                {invoice.solo_parent_discount > 0 && <Row label="  Solo Parent" value={`-${formatCurrency(invoice.solo_parent_discount)}`} small green />}
                {invoice.promo_discount > 0 && <Row label="  Promo" value={`-${formatCurrency(invoice.promo_discount)}`} small green />}
              </>
            )}
            <Row label="Net Sales" value={formatCurrency(invoice.net_sales)} />
            {invoice.delivery_fee > 0 && <Row label="Delivery Fee" value={formatCurrency(invoice.delivery_fee)} />}
            {invoice.service_charge > 0 && <Row label="Service Charge" value={formatCurrency(invoice.service_charge)} />}
            {invoice.platform_fee > 0 && <Row label="Platform Fee" value={formatCurrency(invoice.platform_fee)} />}
            {invoice.withholding_tax > 0 && <Row label="Less: W/Tax" value={`-${formatCurrency(invoice.withholding_tax)}`} />}

            <div className="border-t border-gray-200 pt-1.5">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-gray-900">TOTAL AMOUNT DUE</span>
                <span className="text-base font-bold text-[#DB0002]">{formatCurrency(invoice.total_amount_due)}</span>
              </div>
            </div>

            {invoice.amount_tendered && (
              <Row label="Amount Tendered" value={formatCurrency(invoice.amount_tendered)} />
            )}
            {invoice.change_amount && invoice.change_amount > 0 && (
              <Row label="Change" value={formatCurrency(invoice.change_amount)} />
            )}
          </div>

          <div className="border-t border-dashed border-gray-200" />

          {/* ═══ VAT Breakdown ═══ */}
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider mb-1.5">Tax Breakdown</p>
            <div className="space-y-0.5">
              {invoice.vatable_sales > 0 && <Row label="VATable Sales" value={formatCurrency(invoice.vatable_sales)} />}
              {invoice.vat_amount > 0 && <Row label="VAT (12%)" value={formatCurrency(invoice.vat_amount)} />}
              {invoice.vat_exempt_sales > 0 && <Row label="VAT-Exempt Sales" value={formatCurrency(invoice.vat_exempt_sales)} />}
              {invoice.zero_rated_sales > 0 && <Row label="Zero-Rated Sales" value={formatCurrency(invoice.zero_rated_sales)} />}
              {invoice.tax_type === 'non_vat' && (
                <p className="text-[8px] text-amber-600 italic mt-1">This document is not valid for claim of input tax</p>
              )}
            </div>
          </div>

          {/* ═══ EIS Status ═══ */}
          {invoice.eis_status !== 'not_required' && (
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-[9px] text-blue-600 font-semibold uppercase tracking-wider mb-1">BIR EIS Status</p>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  invoice.eis_status === 'acknowledged' ? 'bg-green-500' :
                  invoice.eis_status === 'transmitted' ? 'bg-blue-500' :
                  invoice.eis_status === 'failed' ? 'bg-red-500' :
                  'bg-yellow-500 animate-pulse'
                }`} />
                <span className="text-[10px] font-medium text-gray-700 capitalize">{invoice.eis_status.replace('_', ' ')}</span>
                {invoice.eis_unique_id && <span className="text-[8px] text-gray-400 font-mono">ID: {invoice.eis_unique_id}</span>}
              </div>
            </div>
          )}

          {/* ═══ Void reason ═══ */}
          {invoice.status === 'voided' && invoice.voided_reason && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-[9px] text-red-600 font-semibold uppercase">Void Reason</p>
              <p className="text-[10px] text-red-700 mt-0.5">{invoice.voided_reason}</p>
              {invoice.voided_at && <p className="text-[8px] text-red-400 mt-0.5">{formatInvoiceDate(invoice.voided_at)}</p>}
            </div>
          )}

          {/* ═══ Footer ═══ */}
          <div className="text-center space-y-1 pt-1">
            <p className="text-[9px] text-gray-400 font-semibold">THIS SERVES AS AN</p>
            <p className="text-[10px] text-gray-900 font-bold">OFFICIAL {getDocTypeLabel(invoice.document_type).toUpperCase()}</p>
            <p className="text-[8px] text-gray-400">Generated electronically by WeKonnek</p>
            <div className="mt-2 inline-block border border-gray-200 rounded-lg px-3 py-1.5">
              <p className="text-[7px] text-gray-400 uppercase tracking-widest">Verification</p>
              <p className="text-[9px] font-mono font-bold text-gray-700">{invoice.invoice_number}</p>
            </div>
          </div>

          {/* ═══ Actions ═══ */}
          <div className="space-y-2 pt-1 pb-1">
            {/* Format toggle */}
            <div className="flex items-center justify-center gap-1">
              <button onClick={() => setPdfFormat('thermal')}
                className={`text-[9px] px-3 py-1 rounded-full font-semibold transition ${
                  pdfFormat === 'thermal' ? 'bg-[#DB0002] text-white' : 'bg-gray-100 text-gray-500'
                }`}>Receipt (80mm)</button>
              <button onClick={() => setPdfFormat('a4')}
                className={`text-[9px] px-3 py-1 rounded-full font-semibold transition ${
                  pdfFormat === 'a4' ? 'bg-[#DB0002] text-white' : 'bg-gray-100 text-gray-500'
                }`}>A4 Full Page</button>
            </div>

            <div className="flex gap-2">
              <button onClick={handleDownload} disabled={downloading}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-[#DB0002] text-white rounded-xl font-semibold text-xs hover:bg-[#B80002] transition disabled:opacity-50 active:scale-[0.98]">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {downloading ? 'Generating...' : 'Download PDF'}
              </button>
              <button onClick={handleJSON}
                className="px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-semibold text-xs hover:bg-gray-50 transition active:scale-[0.98]" title="Download JSON">
                JSON
              </button>
              {onClose && (
                <button onClick={onClose}
                  className="px-4 py-2.5 border border-gray-200 text-gray-700 rounded-xl font-semibold text-xs hover:bg-gray-50 transition active:scale-[0.98]">
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small key-value row */
function Row({ label, value, mono, bold, small, green }: {
  label: string; value: string; mono?: boolean; bold?: boolean; small?: boolean; green?: boolean;
}) {
  return (
    <div className={`flex justify-between ${small ? 'text-[9px]' : 'text-[10px]'}`}>
      <span className="text-gray-500">{label}</span>
      <span className={[
        mono ? 'font-mono' : '',
        bold ? 'font-bold text-gray-900' : 'text-gray-700',
        green ? 'text-green-600' : '',
        small ? 'text-[9px]' : 'text-[10px]',
      ].filter(Boolean).join(' ')}>{value}</span>
    </div>
  );
}
