'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { ArrowLeft, FileText, ReceiptText, Search, ShoppingBag, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

type Branch = { id: number; name: string; address?: string | null; city?: string | null; shop_id?: string | null; store_id?: string | null };
type OrderItem = { id: number; product_name?: string; productName?: string; quantity: number; price: number; subtotal: number };
type SalesOrder = {
  id: number; order_code?: string; orderCode?: string; shop_id?: number; shopId?: number; status: string;
  order_type?: string; orderType?: string; total_amount?: number; totalAmount?: number; table_number?: string;
  payment_method?: string; payment_status?: string; payment_ref?: string; discount_type?: string | null;
  discount_amount?: number; discount_details?: Record<string, unknown> | null; voucher_id?: string | null;
  notes?: string | null; created_at?: string; createdAt?: string; customer?: { first_name?: string; last_name?: string; phone?: string; email?: string };
  order_items?: OrderItem[]; orderItems?: OrderItem[]; items?: OrderItem[];
};
type InvoiceRecord = {
  id: string; serialNumber: string; status: string; invoiceDate: string; lineItems?: unknown;
  subtotal: number; discount: number; discountDescription?: string | null; vatableSales: number; vatAmount: number;
  vatExemptSales: number; totalAmount: number; paymentMethod?: string; paymentReference?: string | null;
  customerName?: string; customerPhone?: string; customerEmail?: string; metadata?: unknown;
};

const peso = (value: number) => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const orderTotal = (order: SalesOrder) => Number(order.total_amount ?? order.totalAmount ?? 0);
const orderItems = (order: SalesOrder) => order.order_items || order.orderItems || order.items || [];

export default function ShopSalesLedger() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const portalRoot = pathname.startsWith('/shop/') ? '/shop' : '/merchant';
  const branchId = Number(params.id);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SalesOrder | null>(null);
  const [invoice, setInvoice] = useState<InvoiceRecord | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const headers = { Authorization: `Bearer ${getToken()}` };
        const merchantResponse = await fetch('/api/backend/merchants/me', { headers, cache: 'no-store' });
        if (!merchantResponse.ok) throw new Error('Unable to load merchant profile');
        const merchant = await merchantResponse.json();
        const [branchesResponse, ordersResponse] = await Promise.all([
          fetch(`/api/backend/merchants/${merchant.id}/branches`, { headers, cache: 'no-store' }),
          fetch(`/api/backend/orders?merchantId=${merchant.id}`, { headers, cache: 'no-store' }),
        ]);
        if (!branchesResponse.ok || !ordersResponse.ok) throw new Error('Unable to load shop sales');
        const branches: Branch[] = await branchesResponse.json();
        const body = await ordersResponse.json();
        setBranch(branches.find(item => item.id === branchId) || null);
        setOrders((Array.isArray(body) ? body : body?.data || []).filter((order: SalesOrder) => Number(order.shop_id ?? order.shopId) === branchId && ['completed', 'delivered'].includes(order.status)));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Unable to load shop sales');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [branchId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter(order => [order.order_code, order.orderCode, order.table_number, order.customer?.first_name, order.customer?.last_name, order.voucher_id].filter(Boolean).join(' ').toLowerCase().includes(needle));
  }, [orders, query]);
  const totals = useMemo(() => ({
    sales: orders.reduce((sum, order) => sum + orderTotal(order), 0),
    discounts: orders.reduce((sum, order) => sum + Number(order.discount_amount || 0), 0),
    items: orders.reduce((sum, order) => sum + orderItems(order).reduce((count, item) => count + item.quantity, 0), 0),
  }), [orders]);

  const openOrder = async (order: SalesOrder) => {
    setSelected(order); setInvoice(null); setInvoiceLoading(true);
    try {
      const response = await fetch(`/api/backend/invoices/order/${encodeURIComponent(`wk-order:${order.id}`)}`, { headers: { Authorization: `Bearer ${getToken()}` }, cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.id) setInvoice(body);
    } finally { setInvoiceLoading(false); }
  };

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center text-slate-500">Loading shop sales ledger…</div>;
  if (!branch) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">Shop not found or unavailable.</div>;
  const cards: Array<{ label: string; value: string | number; Icon: LucideIcon }> = [
    { label: 'Completed transactions', value: orders.length, Icon: ShoppingBag },
    { label: 'Net sales', value: peso(totals.sales), Icon: ReceiptText },
    { label: 'Discounts applied', value: peso(totals.discounts), Icon: FileText },
    { label: 'Items sold', value: totals.items, Icon: ShoppingBag },
  ];

  return <div className="space-y-5">
    <div><Link href={`${portalRoot}/branches`} className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-red-600"><ArrowLeft size={17}/> Back to Shops</Link><div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-wide text-red-600">Shop sales ledger</p><h1 className="mt-1 text-3xl font-black text-slate-900">{branch.name}</h1><p className="mt-1 text-sm text-slate-500">{[branch.address, branch.city].filter(Boolean).join(', ') || branch.shop_id || branch.store_id}</p></div><Link href={`${portalRoot}/invoices`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-5 text-sm font-bold text-red-600"><ReceiptText size={18}/> All E-Invoices</Link></div></div>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, Icon }) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><Icon className="text-red-600" size={22}/><p className="mt-4 text-xs font-bold uppercase text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-slate-900">{value}</p></div>)}</div>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 p-4"><label className="flex h-12 items-center gap-3 rounded-xl border border-slate-300 px-4"><Search size={18} className="text-slate-400"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search order, table, customer, or voucher…" className="min-w-0 flex-1 outline-none"/></label></div><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-[#ef0015] text-xs uppercase text-white"><tr>{['Date','Order','Table / customer','Items','Gross','Discount / voucher','Net sale','Payment','E-Invoice'].map(label => <th key={label} className="px-4 py-4">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{filtered.map(order => { const items = orderItems(order); const customer = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || 'Walk-in customer'; return <tr key={order.id} className="hover:bg-slate-50"><td className="px-4 py-4 text-slate-600">{new Date(order.created_at || order.createdAt || '').toLocaleString('en-PH')}</td><td className="px-4 py-4"><button onClick={() => void openOrder(order)} className="font-black text-blue-700 hover:underline">{order.order_code || order.orderCode}</button><p className="mt-1 text-xs capitalize text-slate-500">{(order.order_type || order.orderType || '').replaceAll('_',' ')}</p></td><td className="px-4 py-4"><p className="font-bold">{order.table_number || 'Counter'}</p><p className="text-xs text-slate-500">{customer}</p></td><td className="px-4 py-4">{items.reduce((sum,item) => sum + item.quantity,0)}</td><td className="px-4 py-4 font-bold">{peso(orderTotal(order) + Number(order.discount_amount || 0))}</td><td className="px-4 py-4"><p className="font-bold text-red-600">-{peso(Number(order.discount_amount || 0))}</p><p className="text-xs text-slate-500">{order.voucher_id || order.discount_type || 'None'}</p></td><td className="px-4 py-4 font-black text-emerald-700">{peso(orderTotal(order))}</td><td className="px-4 py-4"><p className="font-bold uppercase">{order.payment_method || 'cash'}</p><p className="text-xs capitalize text-slate-500">{order.payment_status || 'paid'}</p></td><td className="px-4 py-4"><button onClick={() => void openOrder(order)} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700">View details</button></td></tr>;})}{filtered.length === 0 && <tr><td colSpan={9} className="p-14 text-center text-slate-500">No completed sales found for this shop.</td></tr>}</tbody></table></div></section>
    {selected && <OrderDetail order={selected} invoice={invoice} invoiceLoading={invoiceLoading} onClose={() => { setSelected(null); setInvoice(null); }}/>} 
  </div>;
}

function OrderDetail({ order, invoice, invoiceLoading, onClose }: { order: SalesOrder; invoice: InvoiceRecord | null; invoiceLoading: boolean; onClose: () => void }) {
  const items = orderItems(order); const customer = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || 'Walk-in customer';
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 p-3" onMouseDown={event => event.target === event.currentTarget && onClose()}><div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><header className="sticky top-0 z-10 flex items-start justify-between border-b bg-white px-6 py-5"><div><p className="text-xs font-black uppercase text-red-600">Completed sale</p><h2 className="mt-1 text-2xl font-black">{order.order_code || order.orderCode}</h2><p className="text-sm text-slate-500">{new Date(order.created_at || order.createdAt || '').toLocaleString('en-PH')} · {order.table_number || 'Counter'}</p></div><button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X/></button></header><div className="space-y-6 p-6"><div className="grid gap-3 sm:grid-cols-3"><Info label="Customer" value={customer}/><Info label="Contact" value={order.customer?.phone || order.customer?.email || 'Not supplied'}/><Info label="Payment" value={`${order.payment_method || 'cash'} · ${order.payment_status || 'paid'}`}/></div><section><h3 className="mb-3 font-black">Transaction items</h3><div className="overflow-hidden rounded-xl border"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Item</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Subtotal</th></tr></thead><tbody className="divide-y">{items.map(item => <tr key={item.id}><td className="p-3 font-bold">{item.product_name || item.productName}</td><td className="p-3 text-right">{item.quantity}</td><td className="p-3 text-right">{peso(item.price)}</td><td className="p-3 text-right font-bold">{peso(item.subtotal)}</td></tr>)}</tbody></table></div></section><div className="grid gap-3 sm:grid-cols-2"><Info label="Discount type" value={order.discount_type || 'None'}/><Info label="Discount amount" value={peso(Number(order.discount_amount || 0))}/><Info label="Voucher applied" value={order.voucher_id || 'None'}/><Info label="Payment reference" value={order.payment_ref || 'None'}/></div>{order.discount_details && <section><h3 className="mb-2 font-black">Discount details</h3><pre className="overflow-x-auto rounded-xl bg-slate-50 p-4 text-xs text-slate-700">{JSON.stringify(order.discount_details, null, 2)}</pre></section>}<section className="rounded-xl border border-blue-200 bg-blue-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-black uppercase text-blue-700">E-Invoice</p>{invoiceLoading ? <p className="mt-1 text-sm text-slate-600">Loading invoice…</p> : invoice ? <><p className="mt-1 font-black">{invoice.serialNumber}</p><p className="text-xs text-slate-600">VAT {peso(invoice.vatAmount)} · Total {peso(invoice.totalAmount)}</p></> : <p className="mt-1 text-sm text-slate-600">No generated e-invoice was found for this transaction.</p>}</div>{invoice && <a href={`/api/backend/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white">Open PDF invoice</a>}</div></section><div className="flex justify-end"><p className="text-xl font-black">Net sale: <span className="text-emerald-700">{peso(orderTotal(order))}</span></p></div></div></div></div>;
}
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-50 p-4"><p className="text-[10px] font-black uppercase text-slate-500">{label}</p><p className="mt-1 break-words font-bold capitalize text-slate-900">{value}</p></div>; }
