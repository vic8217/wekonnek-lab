'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { CheckCircle2, ClipboardList, PackageCheck, ShoppingBag, Truck } from 'lucide-react';
import { getToken } from '@/hooks/use-auth';
import { inventoryApi, Product, ShopProductAssignment } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type ActiveShop = { id: number; merchant_id?: number; merchantId?: number; name?: string; branch_name?: string };
type OrderItem = { id?: number; product_name?: string; quantity?: number; price?: number; subtotal?: number };
type Order = { id: number; order_code?: string; order_type?: string; status?: string; customer_name?: string; total_amount?: number; created_at?: string; delivery_address?: string; table_number?: string; notes?: string; order_items?: OrderItem[]; items?: OrderItem[] };
type CartLine = { key: string; product: Product; variantId: number | null; variantName: string; price: number; quantity: number; available: number | null };

const openStatus = (status = '') => !['completed', 'cancelled', 'delivered'].includes(status.toLowerCase());
const money = (value: number) => `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ShopOrderTakingPage() {
  const [shop, setShop] = useState<ActiveShop | null>(null);
  const [catalogue, setCatalogue] = useState<ShopProductAssignment[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [orderType, setOrderType] = useState<'dine_in' | 'pickup'>('dine_in');
  const [tableNumber, setTableNumber] = useState('');
  const [customerName, setCustomerName] = useState('Walk-in customer');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [salesTicketOpen, setSalesTicketOpen] = useState(false);
  const [activeTickets, setActiveTickets] = useState<'delivery' | 'pickup' | 'completed' | null>(null);
  const catalogueRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const saved = sessionStorage.getItem('wk_active_shop');
      const activeShop = saved ? JSON.parse(saved) as ActiveShop : null;
      setShop(activeShop);
      const token = getToken();
      const [shopProducts, inventoryAssignments, orderResponse] = await Promise.all([
        inventoryApi.getShopProducts(),
        inventoryApi.getShopInventory(),
        token ? fetch(`${API}/api/orders`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }) : Promise.resolve(null),
      ]);
      const inventoryByProduct = new Map(inventoryAssignments.map(item => [item.productId, item]));
      setCatalogue(shopProducts.flatMap(row => {
        if (!row.assignment?.isEnabled || row.product.isAvailable === false) return [];
        const stocked = inventoryByProduct.get(row.product.id);
        const basePrice = Number(row.product.discountPrice ?? row.product.sellingPrice ?? row.product.price ?? 0);
        return [{
          ...row.assignment,
          productId: row.product.id,
          product: row.product,
          inventory: stocked?.inventory || [],
          effectivePrice: Number(row.assignment.priceOverride ?? basePrice),
        } as ShopProductAssignment];
      }));
      if (orderResponse?.ok) {
        const payload = await orderResponse.json();
        setOrders(Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : []);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load the shop counter');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => [...new Set(catalogue.map(row => row.product.category?.name).filter(Boolean) as string[])], [catalogue]);
  const filtered = useMemo(() => catalogue.filter(row => {
    const matchesSearch = !search || row.product.name.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (category === 'all' || row.product.category?.name === category);
  }), [catalogue, category, search]);

  const counts = useMemo(() => ({
    delivery: orders.filter(order => order.order_type === 'delivery' && openStatus(order.status)).length,
    pickup: orders.filter(order => order.order_type === 'pickup' && openStatus(order.status)).length,
    inStore: orders.filter(order => ['in_store', 'dine_in'].includes(order.order_type || '') && openStatus(order.status)).length,
    completed: orders.filter(order => ['completed', 'delivered'].includes((order.status || '').toLowerCase())).length,
  }), [orders]);

  const addProduct = (assignment: ShopProductAssignment, variantId: number | null) => {
    const product = assignment.product;
    const variant = product.variants?.find(item => item.id === variantId);
    const balance = assignment.inventory.find(item => (item.variantId ?? null) === variantId);
    const available = product.trackInventory ? (balance?.availableQuantity ?? 0) : null;
    if (available !== null && available <= 0) return toast.error('This item is out of stock');
    const key = `${product.id}:${variantId ?? 'base'}`;
    const price = Number(assignment.priceOverride ?? variant?.price ?? assignment.effectivePrice ?? product.sellingPrice ?? product.price ?? 0);
    const variantName = variant?.optionValues?.map(value => value.optionValue.value).join(' / ') || variant?.sku || 'Standard';
    setCart(current => {
      const existing = current.find(item => item.key === key);
      if (existing) {
        if (available !== null && existing.quantity >= available) return current;
        return current.map(item => item.key === key ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...current, { key, product, variantId, variantName, price, quantity: 1, available }];
    });
  };

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const submitOrder = async () => {
    if (!cart.length) return toast.error('Add at least one catalogue item');
    if (orderType === 'dine_in' && !tableNumber.trim()) return toast.error('Enter a table or counter number');
    const merchantId = shop?.merchant_id ?? shop?.merchantId;
    if (!merchantId || !shop?.id) return toast.error('No active shop is selected');
    setSubmitting(true);
    try {
      const response = await fetch(`${API}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          merchant_id: merchantId,
          shop_id: shop.id,
          order_type: orderType,
          table_number: orderType === 'dine_in' ? tableNumber.trim() : null,
          customer_name: customerName.trim() || 'Walk-in customer',
          notes: notes.trim() || null,
          payment_method: 'cash',
          total_amount: total,
          items: cart.map(item => ({ product_id: item.product.id, product_name: item.product.name, variant_id: item.variantId, quantity: item.quantity, price: item.price, subtotal: item.price * item.quantity })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to create the order');
      toast.success('Order sent to the store queue');
      setCart([]); setTableNumber(''); setNotes('');
      setSalesTicketOpen(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create the order');
    } finally { setSubmitting(false); }
  };

  const updateOrderStatus = async (order: Order, nextStatus: string) => {
    try {
      const response = await fetch(`${API}/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to update the order');
      setOrders(current => current.map(item => item.id === order.id ? { ...item, status: nextStatus } : item));
      toast.success('Order status updated for the customer');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update the order');
    }
  };

  const ticketAction = (order: Order) => {
    const status = (order.status || 'pending').toLowerCase();
    if (status === 'pending') return { label: 'Accept Order', next: 'processing' };
    if (['confirmed', 'processing'].includes(status)) return { label: 'Start Preparing', next: 'preparing' };
    if (status === 'preparing') return { label: order.order_type === 'delivery' ? 'Waiting for Rider' : 'Ready for Pickup', next: 'ready' };
    if (status === 'ready') return { label: order.order_type === 'delivery' ? 'Order Picked Up' : 'Order Collected', next: order.order_type === 'delivery' ? 'out_for_delivery' : 'completed' };
    if (['out_for_delivery', 'picked_up', 'in_transit'].includes(status)) return { label: 'Mark Delivered', next: 'completed' };
    return null;
  };

  if (loading) return <div className="py-16 text-center text-gray-500">Loading shop counter…</div>;

  const cards = [
    { label: 'Orders for Delivery', count: counts.delivery, view: 'delivery' as const, color: 'bg-blue-50 text-blue-700', Icon: Truck },
    { label: 'Orders for Pickup', count: counts.pickup, view: 'pickup' as const, color: 'bg-amber-50 text-amber-700', Icon: ShoppingBag },
    { label: 'In-Store Orders', count: counts.inStore, view: 'in_store' as const, color: 'bg-purple-50 text-purple-700', Icon: ClipboardList },
    { label: 'Completed Orders', count: counts.completed, view: 'completed' as const, color: 'bg-green-50 text-green-700', Icon: CheckCircle2 },
  ];
  const visibleTickets = orders.filter(order => {
    if (!activeTickets) return false;
    if (activeTickets === 'completed') return ['completed', 'delivered'].includes((order.status || '').toLowerCase());
    return order.order_type === activeTickets && openStatus(order.status);
  });

  return <div className="space-y-6">
    <div><p className="text-sm font-semibold text-red-600">{shop?.branch_name || shop?.name || 'Active shop'}</p><h1 className="text-3xl font-black text-gray-900">My Shop · Order Counter</h1><p className="mt-1 text-gray-600">Take walk-in and pickup orders, and monitor every active order from one screen.</p></div>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, count, view, color, Icon }) => <article key={label} className="rounded-xl border bg-white p-5 shadow-sm"><div className={`mb-4 flex size-11 items-center justify-center rounded-xl ${color}`}><Icon className="size-6" strokeWidth={2}/></div><p className="text-sm font-semibold text-gray-600">{label}</p><p className="mt-1 text-3xl font-black">{count}</p>{view === 'in_store' ? <button onClick={() => { setOrderType('dine_in'); setSalesTicketOpen(true); window.setTimeout(() => catalogueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); }} className="mt-5 block w-full rounded-lg border px-4 py-2 text-center text-sm font-bold hover:border-red-600 hover:text-red-600">Open sales ticket</button> : <button onClick={() => setActiveTickets(current => current === view ? null : view)} className="mt-5 block w-full rounded-lg border px-4 py-2 text-center text-sm font-bold hover:border-red-600 hover:text-red-600">Open ticket</button>}</article>)}</section>

    {activeTickets && <section className="rounded-xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-xl font-black capitalize">{activeTickets.replace('_', ' ')} tickets</h2><p className="text-sm text-gray-500">Review the customer order and move it through fulfilment.</p></div><button onClick={() => setActiveTickets(null)} className="rounded-full p-2 text-xl text-gray-500 hover:bg-gray-100" aria-label="Close tickets">×</button></div><div className="grid gap-4 lg:grid-cols-2">{visibleTickets.map(order => { const items = order.order_items || order.items || []; const action = ticketAction(order); return <article key={order.id} className="rounded-xl border p-4"><div className="flex items-start justify-between gap-4"><div><p className="font-black">{order.order_code || `Order #${order.id}`}</p><p className="text-sm text-gray-500">{order.customer_name || 'Customer'}{order.table_number ? ` · Table ${order.table_number}` : ''}</p></div><span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold capitalize">{(order.status || 'pending').replaceAll('_', ' ')}</span></div>{order.delivery_address && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{order.delivery_address}</p>}<div className="mt-3 divide-y rounded-lg border">{items.map((item, index) => <div key={item.id || index} className="flex justify-between gap-3 px-3 py-2 text-sm"><span><b>{item.quantity || 1}×</b> {item.product_name || 'Product'}</span><b>{money(Number(item.subtotal ?? Number(item.price || 0) * Number(item.quantity || 1)))}</b></div>)}{!items.length && <p className="p-3 text-sm text-gray-400">No item details returned.</p>}</div><div className="mt-4 flex items-center justify-between"><b>{money(Number(order.total_amount || 0))}</b>{action && <button onClick={() => void updateOrderStatus(order, action.next)} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-black text-white hover:bg-red-700"><PackageCheck className="size-4"/>{action.label}</button>}</div></article>; })}{!visibleTickets.length && <div className="col-span-full py-10 text-center text-gray-500">No orders are currently in this queue.</div>}</div></section>}

    {salesTicketOpen && <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section ref={catalogueRef} className="scroll-mt-5 rounded-xl border bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><h2 className="text-xl font-black">Product catalogue</h2><p className="text-sm text-gray-500">Inventory shown is the available quantity for this branch.</p></div><Link href="/shop/products" className="text-sm font-bold text-red-600">Manage catalogue →</Link></div>
        <div className="mb-5 flex gap-3"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search catalogue…" className="min-w-0 flex-1 rounded-lg border px-4 py-2.5"/><select value={category} onChange={event => setCategory(event.target.value)} className="rounded-lg border bg-white px-3"><option value="all">All categories</option>{categories.map(item => <option key={item}>{item}</option>)}</select></div>
        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">{filtered.map(assignment => {
          const product = assignment.product;
          const variants = product.hasVariants ? (product.variants || []).filter(item => item.isActive) : [];
          const stock = assignment.inventory.reduce((sum, item) => sum + item.availableQuantity, 0);
          return <article key={product.id} className="overflow-hidden rounded-xl border bg-white"><div className="flex h-32 items-center justify-center bg-gray-100">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover"/> : <span className="text-4xl">📦</span>}</div><div className="p-4"><div className="flex justify-between gap-3"><div><h3 className="font-black">{product.name}</h3><p className="text-xs text-gray-500">{product.category?.name || 'Uncategorised'}</p></div><span className={`h-fit rounded-full px-2 py-1 text-[10px] font-bold ${!product.trackInventory || stock > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{product.trackInventory ? `${stock} available` : 'Not tracked'}</span></div>{variants.length ? <div className="mt-3 space-y-2">{variants.map(variant => { const balance = assignment.inventory.find(item => item.variantId === variant.id); const name = variant.optionValues?.map(value => value.optionValue.value).join(' / ') || variant.sku; return <button key={variant.id} onClick={() => addProduct(assignment, variant.id)} disabled={product.trackInventory && !balance?.availableQuantity} className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:border-red-500 disabled:opacity-40"><span>{name} <small className="text-gray-400">({product.trackInventory ? balance?.availableQuantity || 0 : '∞'})</small></span><b>{money(Number(assignment.priceOverride ?? variant.price ?? assignment.effectivePrice))}</b></button>})}</div> : <button onClick={() => addProduct(assignment, null)} disabled={product.trackInventory && stock <= 0} className="mt-4 w-full rounded-lg bg-red-600 px-3 py-2 font-bold text-white disabled:bg-gray-300">Add · {money(Number(assignment.effectivePrice))}</button>}</div></article>;
        })}{!filtered.length && <div className="col-span-full py-12 text-center text-gray-500">No enabled catalogue products match this filter.</div>}</div>
      </section>

      <aside className="sticky top-5 rounded-xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black">Current order</h2><button onClick={() => { setCart([]); setTableNumber(''); setNotes(''); setSalesTicketOpen(false); }} className="text-sm font-bold text-gray-500 hover:text-red-600">Close ticket</button></div><div className="mt-4 grid grid-cols-2 rounded-lg bg-gray-100 p-1"><button onClick={() => setOrderType('dine_in')} className={`rounded-md py-2 text-sm font-bold ${orderType === 'dine_in' ? 'bg-white text-red-600 shadow' : ''}`}>Dine-in</button><button onClick={() => setOrderType('pickup')} className={`rounded-md py-2 text-sm font-bold ${orderType === 'pickup' ? 'bg-white text-red-600 shadow' : ''}`}>Pickup</button></div><input value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="Customer name" className="mt-4 w-full rounded-lg border px-3 py-2"/>{orderType === 'dine_in' && <input value={tableNumber} onChange={event => setTableNumber(event.target.value)} placeholder="Table / counter number" className="mt-3 w-full rounded-lg border px-3 py-2"/>}<div className="my-4 max-h-72 space-y-3 overflow-y-auto">{cart.map(item => <div key={item.key} className="rounded-lg border p-3"><div className="flex justify-between gap-3"><div><p className="font-bold">{item.product.name}</p><p className="text-xs text-gray-500">{item.variantName}</p></div><button onClick={() => setCart(current => current.filter(line => line.key !== item.key))} className="text-red-600">×</button></div><div className="mt-2 flex items-center justify-between"><div className="flex items-center gap-2"><button onClick={() => setCart(current => current.map(line => line.key === item.key ? { ...line, quantity: Math.max(1, line.quantity - 1) } : line))} className="size-7 rounded border">−</button><b>{item.quantity}</b><button onClick={() => setCart(current => current.map(line => line.key === item.key && (line.available === null || line.quantity < line.available) ? { ...line, quantity: line.quantity + 1 } : line))} className="size-7 rounded border">+</button></div><b>{money(item.price * item.quantity)}</b></div></div>)}{!cart.length && <p className="py-8 text-center text-sm text-gray-400">Select a product to begin an order.</p>}</div><textarea value={notes} onChange={event => setNotes(event.target.value)} placeholder="Order notes (optional)" className="w-full rounded-lg border px-3 py-2" rows={2}/><div className="mt-4 flex justify-between text-lg"><b>Total</b><b>{money(total)}</b></div><button onClick={() => void submitOrder()} disabled={submitting || !cart.length} className="mt-4 w-full rounded-lg bg-red-600 py-3 font-black text-white disabled:bg-gray-300">{submitting ? 'Sending order…' : 'Place order'}</button></aside>
    </div>}
  </div>;
}
