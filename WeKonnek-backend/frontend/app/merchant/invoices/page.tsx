'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
import {
  Invoice, AuditLogEntry,
  getMerchantInvoices, voidInvoice, markReprinted,
  queueEISTransmission, getInvoiceAuditLog, generateDailySummary,
  exportSalesJournalCSV, exportVATSummaryCSV,
  formatCurrency, formatInvoiceDate,
  getDocTypeLabel, getTaxTypeLabel, getChannelLabel,
  DocumentType, InvoiceStatus,
} from '@/lib/e-invoice';
import { downloadInvoicePDF } from '@/lib/invoice-pdf';
import EInvoiceView from '@/components/EInvoiceView';

type Tab = 'invoices' | 'memos' | 'summary' | 'eis';

export default function MerchantInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [merchantId, setMerchantId] = useState<number | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);

  // Filters
  const [tab, setTab] = useState<Tab>('invoices');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [docTypeFilter, setDocTypeFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Daily summary
  const [summaryDate, setSummaryDate] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const token = getToken();
      if (!token) return;
      const res = await fetch(`${API}/api/merchants/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const merchant = await res.json();
      if (!merchant) return;
      setMerchantId(merchant.id);
      const data = await getMerchantInvoices(merchant.id);
      setInvoices(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filtered view
  const filtered = invoices.filter(inv => {
    if (tab === 'memos') {
      if (!['credit_memo', 'debit_memo'].includes(inv.document_type)) return false;
    } else if (tab === 'invoices') {
      if (['credit_memo', 'debit_memo'].includes(inv.document_type)) return false;
    }
    if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
    if (docTypeFilter !== 'all' && inv.document_type !== docTypeFilter) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return inv.invoice_number.toLowerCase().includes(s) ||
        (inv.order_code || '').toLowerCase().includes(s) ||
        inv.buyer_name.toLowerCase().includes(s);
    }
    return true;
  });

  // Stats
  const active = invoices.filter(i => i.status !== 'voided' && ['invoice', 'receipt'].includes(i.document_type));
  const totalRevenue = active.reduce((s, i) => s + i.total_amount_due, 0);
  const totalVAT = active.reduce((s, i) => s + i.vat_amount, 0);
  const totalDiscounts = active.reduce((s, i) => s + i.total_discount, 0);

  const handleVoid = async (inv: Invoice) => {
    const reason = prompt('Reason for voiding this invoice:');
    if (!reason) return;
    await voidInvoice(inv.id, reason);
    fetchData();
  };

  const handleDownload = (inv: Invoice, format: 'thermal' | 'a4' = 'thermal') => {
    downloadInvoicePDF(inv, format);
    markReprinted(inv.id);
  };

  const handleViewAudit = async (inv: Invoice) => {
    const log = await getInvoiceAuditLog(inv.id);
    setAuditLog(log);
    setShowAudit(true);
  };

  const handleEIS = async (inv: Invoice) => {
    if (!confirm('Queue this invoice for BIR EIS transmission?')) return;
    await queueEISTransmission(inv.id);
    fetchData();
  };

  const handleExport = (type: 'sales_journal' | 'vat_summary') => {
    const csv = type === 'vat_summary' ? exportVATSummaryCSV(invoices) : exportSalesJournalCSV(invoices);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${type}_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const loadSummary = async () => {
    if (!merchantId) return;
    setSummaryLoading(true);
    const s = await generateDailySummary(merchantId, summaryDate);
    setSummary(s);
    setSummaryLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* ═══ Header ═══ */}
      <div className="lg:hidden">
        <div className="bg-gradient-to-br from-[#DB0002] to-[#9B0001] px-4 py-4 -mx-4 -mt-4">
          <h1 className="text-lg font-bold text-white">E-Invoice System</h1>
          <p className="text-white/70 text-[11px]">BIR-Compliant Electronic Invoicing</p>
        </div>
      </div>
      <div className="hidden lg:flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">E-Invoice Management</h1>
          <p className="text-gray-500 text-sm">BIR-compliant invoicing — VAT, non-VAT, exempt, zero-rated, credit/debit memos</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleExport('sales_journal')}
            className="px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition">
            📊 Sales Journal
          </button>
          <button onClick={() => handleExport('vat_summary')}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition">
            📋 VAT Summary
          </button>
        </div>
      </div>

      {/* ═══ Stats ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 lg:gap-3">
        <StatCard label="Total Invoices" value={String(invoices.length)} />
        <StatCard label="Active" value={String(active.length)} color="green" />
        <StatCard label="Revenue" value={formatCurrency(totalRevenue)} color="red" />
        <StatCard label="VAT Collected" value={formatCurrency(totalVAT)} color="blue" />
        <StatCard label="Discounts" value={formatCurrency(totalDiscounts)} color="amber" />
      </div>

      {/* ═══ Tabs ═══ */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl overflow-x-auto no-scrollbar">
        {([
          ['invoices', 'Invoices'],
          ['memos', 'Credit/Debit Memos'],
          ['summary', 'Daily Summary'],
          ['eis', 'EIS Status'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
              tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>{label}</button>
        ))}
      </div>

      {/* ═══ TAB: Invoices & Memos ═══ */}
      {(tab === 'invoices' || tab === 'memos') && (
        <>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input type="text" placeholder="Search invoice, order, customer..."
                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none" />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white">
              <option value="all">All Status</option>
              <option value="generated">Active</option>
              <option value="sent">Sent</option>
              <option value="printed">Printed</option>
              <option value="voided">Voided</option>
            </select>
            {tab === 'invoices' && (
              <select value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white">
                <option value="all">All Types</option>
                <option value="invoice">Sales Invoice</option>
                <option value="receipt">Official Receipt</option>
              </select>
            )}
          </div>

          {/* Mobile export buttons */}
          <div className="flex gap-2 lg:hidden overflow-x-auto no-scrollbar">
            <button onClick={() => handleExport('sales_journal')}
              className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-[10px] font-semibold whitespace-nowrap">
              📊 Export Sales Journal
            </button>
            <button onClick={() => handleExport('vat_summary')}
              className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-semibold whitespace-nowrap">
              📋 Export VAT Summary
            </button>
          </div>

          {/* Invoice List */}
          <div className="space-y-2">
            {filtered.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-4xl mb-3">🧾</p>
                <p className="text-gray-500 font-medium">No {tab === 'memos' ? 'memos' : 'invoices'} found</p>
                <p className="text-gray-400 text-xs mt-1">Invoices are auto-generated when orders are completed</p>
              </div>
            ) : filtered.map((inv) => (
              <div key={inv.id}
                className={`bg-white rounded-xl border p-3 lg:p-4 shadow-sm hover:shadow-md transition-all ${
                  inv.status === 'voided' ? 'opacity-60 border-red-200' : 'border-gray-200'
                }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[10px] lg:text-xs font-bold text-gray-900">{inv.invoice_number}</span>
                      <StatusBadge status={inv.status} />
                      <span className="text-[8px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">
                        {getDocTypeLabel(inv.document_type)}
                      </span>
                      <span className="text-[8px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded-full font-medium">
                        {getTaxTypeLabel(inv.tax_type)}
                      </span>
                      {inv.channel !== 'marketplace' && (
                        <span className="text-[8px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">
                          {getChannelLabel(inv.channel)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                      {inv.order_code && <span>📦 {inv.order_code}</span>}
                      <span>👤 {inv.buyer_name}</span>
                      {inv.buyer_tin && <span className="font-mono">TIN: {inv.buyer_tin}</span>}
                    </div>
                    <p className="text-[9px] text-gray-400 mt-0.5">{formatInvoiceDate(inv.invoice_date)}</p>

                    {/* Discount badges */}
                    {inv.total_discount > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {inv.sc_discount > 0 && <span className="text-[7px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">SC -{formatCurrency(inv.sc_discount)}</span>}
                        {inv.pwd_discount > 0 && <span className="text-[7px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">PWD -{formatCurrency(inv.pwd_discount)}</span>}
                        {inv.promo_discount > 0 && <span className="text-[7px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full">Promo -{formatCurrency(inv.promo_discount)}</span>}
                      </div>
                    )}

                    {/* Items preview */}
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(inv.items || []).slice(0, 3).map((item: any, i: number) => (
                        <span key={i} className="text-[8px] bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded-full">
                          {item.quantity}× {item.description}
                        </span>
                      ))}
                      {(inv.items?.length || 0) > 3 && <span className="text-[8px] text-gray-400">+{(inv.items?.length || 0) - 3}</span>}
                    </div>
                  </div>

                  {/* Right side */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm lg:text-base font-bold text-gray-900">{formatCurrency(inv.total_amount_due)}</p>
                    {inv.vat_amount > 0 && <p className="text-[8px] text-blue-500">VAT: {formatCurrency(inv.vat_amount)}</p>}
                    {inv.eis_status !== 'not_required' && (
                      <span className={`text-[7px] px-1.5 py-0.5 rounded-full ${
                        inv.eis_status === 'acknowledged' ? 'bg-green-100 text-green-700' :
                        inv.eis_status === 'failed' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>EIS: {inv.eis_status}</span>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-1 mt-2 justify-end flex-wrap">
                      <ActionBtn icon="👁️" title="View" onClick={() => setSelectedInvoice(inv)} color="blue" />
                      <ActionBtn icon="📄" title="PDF" onClick={() => handleDownload(inv)} color="green" />
                      <ActionBtn icon="📋" title="Audit" onClick={() => handleViewAudit(inv)} color="purple" />
                      {inv.status === 'generated' && (
                        <>
                          <ActionBtn icon="🌐" title="EIS" onClick={() => handleEIS(inv)} color="blue" />
                          <ActionBtn icon="❌" title="Void" onClick={() => handleVoid(inv)} color="red" />
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {inv.status === 'voided' && inv.voided_reason && (
                  <p className="text-[9px] text-red-500 mt-2 bg-red-50 px-2 py-1 rounded-lg">
                    Void: {inv.voided_reason}
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ═══ TAB: Daily Summary ═══ */}
      {tab === 'summary' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input type="date" value={summaryDate} onChange={(e) => setSummaryDate(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm" />
            <button onClick={loadSummary} disabled={summaryLoading}
              className="px-4 py-2 bg-[#DB0002] text-white rounded-xl text-sm font-semibold hover:bg-[#B80002] disabled:opacity-50 transition">
              {summaryLoading ? 'Loading...' : 'Generate Summary'}
            </button>
          </div>

          {summary && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 lg:p-6 space-y-4">
              <h3 className="text-lg font-bold text-gray-900">Daily Sales Summary — {summary.summary_date}</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <MiniStat label="Total Invoices" value={summary.total_invoices} />
                <MiniStat label="Voided" value={summary.total_voided} />
                <MiniStat label="Credit Memos" value={summary.total_credit_memos} />
                <MiniStat label="Debit Memos" value={summary.total_debit_memos} />
              </div>
              <div className="border-t pt-3 grid grid-cols-2 lg:grid-cols-3 gap-3">
                <MiniStat label="Gross Sales" value={formatCurrency(summary.gross_sales)} />
                <MiniStat label="Discounts" value={`-${formatCurrency(summary.total_discounts)}`} />
                <MiniStat label="SC Discounts" value={`-${formatCurrency(summary.sc_discounts)}`} />
                <MiniStat label="PWD Discounts" value={`-${formatCurrency(summary.pwd_discounts)}`} />
                <MiniStat label="Net Sales" value={formatCurrency(summary.net_sales)} />
                <MiniStat label="Total Amount" value={formatCurrency(summary.total_amount)} />
              </div>
              <div className="border-t pt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
                <MiniStat label="VATable Sales" value={formatCurrency(summary.vatable_sales)} />
                <MiniStat label="VAT (12%)" value={formatCurrency(summary.vat_amount)} />
                <MiniStat label="VAT-Exempt" value={formatCurrency(summary.vat_exempt_sales)} />
                <MiniStat label="Zero-Rated" value={formatCurrency(summary.zero_rated_sales)} />
              </div>
              <div className="border-t pt-3 grid grid-cols-3 gap-3">
                <MiniStat label="Delivery Fees" value={formatCurrency(summary.delivery_fees)} />
                <MiniStat label="Service Charges" value={formatCurrency(summary.service_charges)} />
                <MiniStat label="Platform Fees" value={formatCurrency(summary.platform_fees)} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: EIS Status ═══ */}
      {tab === 'eis' && (
        <div className="space-y-3">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <h3 className="text-sm font-bold text-blue-900">BIR Electronic Invoicing System (EIS)</h3>
            <p className="text-xs text-blue-700 mt-1">
              Per RMO 24-2023, covered taxpayers must transmit sales data in JSON format with EIS Unique ID.
              Use this section to monitor transmission status.
            </p>
          </div>
          {invoices.filter(i => i.eis_status !== 'not_required').length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">🌐</p>
              <p className="text-gray-500 font-medium">No EIS transmissions yet</p>
              <p className="text-gray-400 text-xs mt-1">Queue invoices for EIS transmission from the invoice list</p>
            </div>
          ) : (
            invoices.filter(i => i.eis_status !== 'not_required').map((inv) => (
              <div key={inv.id} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-xs font-bold">{inv.invoice_number}</span>
                    <span className={`ml-2 text-[9px] px-2 py-0.5 rounded-full font-bold ${
                      inv.eis_status === 'acknowledged' ? 'bg-green-100 text-green-700' :
                      inv.eis_status === 'transmitted' ? 'bg-blue-100 text-blue-700' :
                      inv.eis_status === 'failed' ? 'bg-red-100 text-red-700' :
                      inv.eis_status === 'retrying' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>{inv.eis_status.toUpperCase()}</span>
                  </div>
                  <span className="text-xs text-gray-500">{formatCurrency(inv.total_amount_due)}</span>
                </div>
                {inv.eis_unique_id && <p className="text-[9px] font-mono text-gray-400 mt-1">EIS ID: {inv.eis_unique_id}</p>}
                {inv.eis_transmitted_at && <p className="text-[9px] text-gray-400">Transmitted: {formatInvoiceDate(inv.eis_transmitted_at)}</p>}
                <p className="text-[9px] text-gray-400">Retries: {inv.eis_retry_count}</p>
              </div>
            ))
          )}
        </div>
      )}

      {/* ═══ Modals ═══ */}
      {selectedInvoice && (
        <EInvoiceView invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
      )}

      {showAudit && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowAudit(false)}>
          <div className="bg-white w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">📋 Audit Trail</h3>
            {auditLog.length === 0 ? (
              <p className="text-gray-400 text-sm">No audit entries</p>
            ) : (
              <div className="space-y-3">
                {auditLog.map((entry) => (
                  <div key={entry.id} className="flex gap-3 text-xs">
                    <div className="w-2 h-2 mt-1 rounded-full bg-[#DB0002] flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-gray-900 capitalize">{entry.action.replace(/_/g, ' ')}</p>
                      <p className="text-gray-400 text-[10px]">{formatInvoiceDate(entry.created_at)}</p>
                      {entry.details && (
                        <pre className="text-[9px] text-gray-500 bg-gray-50 rounded p-1 mt-1 overflow-x-auto">
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setShowAudit(false)}
              className="mt-4 w-full py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  const c = { green: 'text-green-600', red: 'text-[#DB0002]', blue: 'text-blue-600', amber: 'text-amber-600' }[color || ''] || 'text-gray-900';
  return (
    <div className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm">
      <p className={`text-lg lg:text-xl font-bold ${c}`}>{value}</p>
      <p className="text-[9px] lg:text-xs text-gray-500">{label}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-bold text-gray-900">{String(value)}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    generated: 'bg-green-100 text-green-700',
    sent: 'bg-blue-100 text-blue-700',
    printed: 'bg-gray-100 text-gray-700',
    voided: 'bg-red-100 text-red-700 line-through',
    replaced: 'bg-yellow-100 text-yellow-700',
    draft: 'bg-gray-50 text-gray-400',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold ${styles[status] || 'bg-gray-100 text-gray-500'}`}>
      {status.toUpperCase()}
    </span>
  );
}

function ActionBtn({ icon, title, onClick, color }: { icon: string; title: string; onClick: () => void; color: string }) {
  const bg: Record<string, string> = { blue: 'bg-blue-50 text-blue-600 hover:bg-blue-100', green: 'bg-green-50 text-green-600 hover:bg-green-100', red: 'bg-red-50 text-red-500 hover:bg-red-100', purple: 'bg-purple-50 text-purple-600 hover:bg-purple-100' };
  return (
    <button onClick={onClick} title={title}
      className={`p-1 rounded-lg transition text-[10px] ${bg[color] || 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}>
      {icon}
    </button>
  );
}
