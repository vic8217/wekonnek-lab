'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { ClipboardList, PackageCheck, RefreshCw, Settings2, ShoppingBag, Truck } from 'lucide-react';
import { getToken } from '@/hooks/use-auth';
import { inventoryApi, Product, ShopProductAssignment } from '@/lib/api';
import FloorPlanEditor from '@/components/FloorPlanEditor';
import { io } from 'socket.io-client';

type ActiveShop = { id: number; merchant_id?: number; merchantId?: number; name?: string; branch_name?: string };
type OrderItem = { id?: number; product_name?: string; quantity?: number; price?: number; subtotal?: number; status?: 'preparing' | 'served' | null };
type ServiceRequest = { id: number; type: string; details?: string | null; status: string; assigned_staff_id?: number | null; assigned_staff_name?: string | null; created_at?: string };
type Order = { id: number; shop_id?: number; order_code?: string; order_type?: string; status?: string; customer_name?: string; total_amount?: number; delivery_fee?: number; created_at?: string; delivery_address?: string; table_number?: string; notes?: string; payment_method?: string; payment_status?: string; discount_type?: string | null; discount_amount?: number; discount_details?: { draft?: boolean; totalDiners?: number; eligibleDiners?: number; vatExemption?: number; scPwdDiscount?: number; cards?: Array<{ type?: string; reference?: string; name?: string; address?: string }> } | null; merchant?: { name?: string; registeredBusinessName?: string; tin?: string; address?: string; city?: string; zipCode?: string; taxClassification?: string }; order_items?: OrderItem[]; items?: OrderItem[]; service_requests?: ServiceRequest[] };
type CartLine = { key: string; product: Product; variantId: number | null; variantName: string; price: number; quantity: number; available: number | null };

const openStatus = (status = '') => !['completed', 'cancelled', 'delivered'].includes(status.toLowerCase());
const sameTable = (left = '', right = '') => left.trim().toLowerCase().replace(/\s+/g, ' ') === right.trim().toLowerCase().replace(/\s+/g, ' ');
const money = (value: number) => `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const orderTypeLabel = (type?: string) => ({ delivery: 'Delivery', pickup: 'Pick-up', take_out: 'Pick-up / Take-out', dine_in: 'Dine-in', in_store: 'Dine-in' }[type || ''] || 'Order');
const paymentStatusLabel = (order: Pick<Order, 'payment_method' | 'payment_status'>) => order.payment_status === 'paid' ? 'Paid' : order.payment_method === 'qrph' ? 'Waiting for payment' : String(order.payment_status || 'unpaid').replace(/_/g, ' ');

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
  const [activeTickets, setActiveTickets] = useState<'delivery' | 'pickup' | 'in_store' | 'completed' | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState('all');
  const [tableCount, setTableCount] = useState(0);
  const [crew, setCrew] = useState<Array<{ id: number; displayName?: string; role?: string; isActive?: boolean }>>([]);
  const catalogueRef = useRef<HTMLElement | null>(null);
  const tableSectionRef = useRef<HTMLElement | null>(null);
  const syncCursorRef = useRef('0');
  const seenOrderIdsRef = useRef(new Set<number>());

  const load = useCallback(async () => {
    try {
      const saved = sessionStorage.getItem('wk_active_shop');
      const activeShop = saved ? JSON.parse(saved) as ActiveShop : null;
      setShop(activeShop);
      const token = getToken();
      const merchantId = activeShop?.merchant_id ?? activeShop?.merchantId;
      const [shopProducts, inventoryAssignments, orderResponse] = await Promise.all([
        inventoryApi.getShopProducts(),
        inventoryApi.getShopInventory(),
        token && merchantId ? fetch(`/api/backend/orders?merchantId=${merchantId}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }) : Promise.resolve(null),
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
        const rows: Order[] = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
        const shopOrders = rows.filter(order => !order.shop_id || order.shop_id === activeShop?.id);
        seenOrderIdsRef.current = new Set(shopOrders.map(order => order.id));
        setOrders(shopOrders);
      }
      if (token) {
        const crewResponse = await fetch('/api/backend/dine-in-crew/overview', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (crewResponse.ok) { const overview = await crewResponse.json(); setCrew((overview.staff || []).filter((member: any) => member.isActive)); }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load the shop counter');
    } finally {
      setLoading(false);
    }
  }, []);

  const reconcile = useCallback(async (announceNewOrders = false) => {
    const token = getToken(); if (!token) return;
    const response = await fetch(`/api/backend/dine-in-crew/shop/sync?cursor=${encodeURIComponent(syncCursorRef.current)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) return;
    const result = await response.json();
    syncCursorRef.current = result.nextCursor || syncCursorRef.current;
    const newOrders: Order[] = [];
    for (const change of result.changes || []) {
      const row = change.payload?.order;
      if (!row || ['completed', 'cancelled', 'delivered'].includes(String(row.status).toLowerCase()) || seenOrderIdsRef.current.has(Number(row.id))) continue;
      newOrders.push({ id: Number(row.id), order_code: row.orderCode, order_type: row.orderType, status: row.status });
      seenOrderIdsRef.current.add(Number(row.id));
    }
    setOrders(current => {
      let next = [...current];
      for (const change of result.changes || []) {
        const serviceRequest: ServiceRequest | undefined = change.payload?.serviceRequest;
        const requestOrderId = Number(change.payload?.orderId || 0);
        if (serviceRequest && requestOrderId) {
          next = next.map(order => order.id !== requestOrderId ? order : { ...order, service_requests: [serviceRequest, ...(order.service_requests || []).filter(item => item.id !== serviceRequest.id)] });
          continue;
        }
        const row = change.payload?.order;
        if (!row) continue;
        if (['completed', 'cancelled', 'delivered'].includes(row.status)) next = next.filter(order => order.id !== row.id);
        else {
          const adapted: Order = { id: row.id, order_code: row.orderCode, order_type: row.orderType || 'dine_in', status: row.status, table_number: row.tableNumber, total_amount: row.totalAmount, delivery_fee: row.deliveryFee, notes: row.notes, created_at: row.createdAt, payment_method: row.paymentMethod, payment_status: row.paymentStatus, discount_type: row.discountType, discount_amount: row.discountAmount, discount_details: row.discountDetails, order_items: row.items?.map((item: any) => ({ id: item.id, product_name: item.productName, quantity: item.quantity, price: item.price, subtotal: item.subtotal, status: item.status })) || [] };
          seenOrderIdsRef.current.add(adapted.id);
          const index = next.findIndex(order => order.id === adapted.id);
          if (index >= 0) next[index] = { ...next[index], ...adapted }; else next.unshift(adapted);
        }
      }
      return next;
    });
    if (announceNewOrders && newOrders.length) {
      window.dispatchEvent(new CustomEvent('wk:notifications-updated'));
      for (const order of newOrders) {
        const label = order.order_type === 'delivery' ? 'delivery' : order.order_type === 'pickup' ? 'pickup' : 'dine-in';
        const message = `New ${label} order ${order.order_code || ''}`.trim();
        toast.success(message, { id: `shop-order-${order.id}`, duration: 8000 });
        if (document.visibilityState !== 'visible' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const notification = new Notification('New order received', { body: message, icon: '/images/weKonnekLogov1.png', tag: `shop-order-${order.id}` });
          notification.onclick = () => { window.focus(); notification.close(); };
        }
      }
    }
  }, []);

  useEffect(() => { void load().then(() => void reconcile()); }, [load, reconcile]);
  useEffect(() => {
    let timer: number;
    const schedule = () => { timer = window.setTimeout(async () => { if (document.visibilityState === 'visible') await reconcile(); schedule(); }, 55_000 + Math.floor(Math.random() * 10_001)); };
    schedule();
    const foreground = () => { if (document.visibilityState === 'visible') void reconcile(); };
    window.addEventListener('focus', foreground); document.addEventListener('visibilitychange', foreground);
    const accessToken = getToken(); const configured = process.env.NEXT_PUBLIC_API_URL; const origin = configured || `${window.location.protocol}//${window.location.hostname}:3000`;
    const socket = accessToken ? io(`${origin.replace(/\/$/, '')}/dine-in`, { auth: { accessToken }, transports: ['websocket', 'polling'] }) : null;
    socket?.on('dine-in-change', () => void reconcile(true));
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', foreground); document.removeEventListener('visibilitychange', foreground); socket?.disconnect(); };
  }, [reconcile]);

  const categories = useMemo(() => [...new Set(catalogue.map(row => row.product.category?.name).filter(Boolean) as string[])], [catalogue]);
  const filtered = useMemo(() => catalogue.filter(row => {
    const matchesSearch = !search || row.product.name.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (category === 'all' || row.product.category?.name === category);
  }), [catalogue, category, search]);

  const counts = useMemo(() => ({
    delivery: orders.filter(order => order.order_type === 'delivery' && openStatus(order.status)).length,
    pickup: orders.filter(order => order.order_type === 'pickup' && openStatus(order.status)).length,
    inStore: new Set(orders.filter(order => ['in_store', 'dine_in'].includes(order.order_type || '') && openStatus(order.status) && order.table_number).map(order => order.table_number!.trim().toLowerCase().replace(/\s+/g, ' '))).size,
    completed: orders.filter(order => ['completed', 'delivered'].includes((order.status || '').toLowerCase())).length,
  }), [orders]);
  const tableStatuses = useMemo(() => {
    const result: Record<string, { status: string; customerName?: string; orderCode?: string; totalAmount?: number; elapsedMinutes?: number; requestCount?: number }> = {};
    for (const order of orders.filter(row => ['dine_in', 'in_store'].includes(row.order_type || '') && openStatus(row.status) && row.table_number)) {
      const key = order.table_number!.trim().toLowerCase().replace(/\s+/g, ' ');
      const requestCount = (order.service_requests || []).filter(request => request.status !== 'completed').length;
      const existingKey = Object.keys(result).find(label => label.trim().toLowerCase().replace(/\s+/g, ' ') === key);
      if (existingKey) { result[existingKey].requestCount = Number(result[existingKey].requestCount || 0) + requestCount; continue; }
      const status = order.status === 'bill_out' ? 'bill_out' : order.status === 'payment_pending' && order.payment_method === 'cash' ? 'manual_payment' : order.status === 'payment_pending' ? 'payment_pending' : order.discount_details?.draft ? 'bill_draft' : order.status === 'ready' ? 'served' : order.status === 'pending' ? 'placed' : order.status === 'preparing' ? 'preparing' : 'active';
      const elapsedMinutes = order.created_at ? Math.max(0, Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000)) : undefined;
      result[order.table_number!] = { status, customerName: order.customer_name || 'Customer', orderCode: order.order_code, totalAmount: Number(order.total_amount || 0), elapsedMinutes, requestCount };
    }
    return result;
  }, [orders]);
  const dineInCounts = useMemo(() => {
    const statuses = Object.values(tableStatuses);
    return {
      all: tableCount,
      vacant: Math.max(0, tableCount - statuses.length),
      active: statuses.length,
      preparing: statuses.filter(item => item.status === 'preparing').length,
      served: statuses.filter(item => item.status === 'served').length,
      bill_out: statuses.filter(item => ['bill_out', 'payment_pending', 'manual_payment'].includes(item.status)).length,
    };
  }, [tableCount, tableStatuses]);

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
      const response = await fetch(`/api/backend/orders`, {
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
      setActiveTickets('in_store');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to create the order');
    } finally { setSubmitting(false); }
  };

  const updateOrderStatus = async (order: Order, nextStatus: string) => {
    try {
      const response = await fetch(`/api/backend/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ status: nextStatus }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to update the order');
      setOrders(current => current.map(item => item.id === order.id ? { ...item, status: nextStatus } : item));
      toast.success('Order status updated for the customer');
      if (['completed', 'delivered'].includes(nextStatus) && ['dine_in', 'in_store'].includes(order.order_type || '')) {
        setSelectedTable(null);
        setActiveTickets(null);
        await load();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update the order');
    }
  };

  const updateItemStatus = async (order: Order, item: OrderItem, status: 'preparing' | 'served') => {
    if (!item.id) return;
    try {
      const response = await fetch(`/api/backend/orders/${order.id}/items/${item.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to update the item');
      setOrders(current => current.map(row => row.id === order.id ? payload : row));
      toast.success(status === 'served' ? 'Item marked as served' : 'Item returned to preparing');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update the item');
    }
  };

  const confirmBillOut = async (order: Order) => {
    try {
      const response = await fetch(`/api/backend/orders/${order.id}/confirm-bill-out`, { method: 'PATCH', headers: { Authorization: `Bearer ${getToken()}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to confirm bill-out');
      setOrders(current => current.map(row => row.id === order.id ? payload : row));
      toast.success('Bill-out confirmed. Customer payment options are now available.');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to confirm bill-out'); }
  };

  const updateServiceRequest = async (order: Order, request: ServiceRequest, update: { assignedStaffId?: number | null; status?: string }) => {
    try {
      const response = await fetch(`/api/backend/orders/${order.id}/service-requests/${request.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify(update) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to update request');
      setOrders(current => current.map(row => row.id !== order.id ? row : { ...row, service_requests: [payload, ...(row.service_requests || []).filter(item => item.id !== payload.id)] }));
      toast.success(payload.status === 'completed' ? 'Request completed' : 'Request assigned');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to update request'); }
  };

  const ticketAction = (order: Order) => {
    const status = (order.status || 'pending').toLowerCase();
    const dineIn = ['dine_in', 'in_store'].includes(order.order_type || '');
    if (dineIn) {
      if (status === 'pending') return { label: 'Accept Order', next: 'processing' };
      if (status === 'payment_pending' && order.payment_method === 'cash') return { label: 'Complete Transaction', next: 'completed' };
      return null;
    }
    if (status === 'pending') return { label: 'Accept Order', next: 'processing' };
    if (['confirmed', 'processing'].includes(status)) return { label: 'Start Preparing', next: 'preparing' };
    if (status === 'preparing') return { label: order.order_type === 'delivery' ? 'Waiting for Rider' : order.order_type === 'dine_in' ? 'Mark as Served' : 'Ready for Pickup', next: 'ready' };
    if (status === 'ready' && order.order_type !== 'dine_in') return { label: order.order_type === 'delivery' ? 'Order Picked Up' : 'Order Collected', next: order.order_type === 'delivery' ? 'out_for_delivery' : 'completed' };
    if (['out_for_delivery', 'picked_up', 'in_transit'].includes(status)) return { label: 'Mark Delivered', next: 'completed' };
    return null;
  };

  const startTableOrder = (label: string) => {
    setCart([]);
    setOrderType('dine_in');
    setTableNumber(label);
    setCustomerName('Walk-in customer');
    setNotes('');
    setActiveTickets(null);
    setSalesTicketOpen(true);
    window.setTimeout(() => catalogueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  if (loading) return <div className="py-16 text-center text-gray-500">Loading shop counter…</div>;

  const visibleTickets = orders.filter(order => {
    if (!activeTickets) return false;
    if (activeTickets === 'completed') return ['completed', 'delivered'].includes((order.status || '').toLowerCase());
    if (activeTickets === 'in_store') return ['in_store', 'dine_in'].includes(order.order_type || '') && openStatus(order.status) && (!selectedTable || sameTable(order.table_number, selectedTable));
    return order.order_type === activeTickets && openStatus(order.status);
  }).filter((order, index, rows) => activeTickets !== 'in_store' || rows.findIndex(candidate => sameTable(candidate.table_number, order.table_number)) === index);
  const renderTicketCards = (tickets: Order[]) => tickets.length ? tickets.map(order => {
    const items = order.order_items || order.items || [];
    const dineIn = ['dine_in', 'in_store'].includes(order.order_type || '');
    const action = ticketAction(order);
    const subtotal = items.reduce((sum, item) => sum + Number(item.subtotal ?? Number(item.price || 0) * Number(item.quantity || 1)), 0);
    const discount = Number(order.discount_amount || 0);
    const eligibleRatio = order.discount_type === 'sc_pwd' && order.discount_details?.totalDiners
      ? Number(order.discount_details.eligibleDiners || 0) / Number(order.discount_details.totalDiners)
      : 0;
    const eligibleGross = subtotal * eligibleRatio;
    const eligibleVatExclusive = eligibleGross / 1.12;
    const vatExemption = Number(order.discount_details?.vatExemption ?? (eligibleRatio ? eligibleGross - eligibleVatExclusive : 0));
    const scPwdDiscount = Number(order.discount_details?.scPwdDiscount ?? (eligibleRatio ? eligibleVatExclusive * 0.2 : 0));
    const draftReduction = order.discount_details?.draft && order.discount_type === 'sc_pwd' ? Math.round((vatExemption + scPwdDiscount) * 100) / 100 : 0;
    const isBilling = ['bill_out', 'payment_pending'].includes(order.status || '');
    const merchant = order.merchant;
    const registeredName = merchant?.registeredBusinessName || merchant?.name || shop?.name || 'Merchant';
    const registeredAddress = [merchant?.address, merchant?.city, merchant?.zipCode].filter(Boolean).join(', ');
    const isVat = (merchant?.taxClassification || '').toLowerCase().includes('vat');
    const nonEligibleGross = Math.max(0, subtotal - eligibleGross);
    const vatableSales = isVat ? nonEligibleGross / 1.12 : 0;
    const vatAmount = isVat ? nonEligibleGross - vatableSales : 0;
    const vatExemptSales = order.discount_type === 'sc_pwd' ? eligibleVatExclusive : 0;
    return (
      <article key={order.id} className="rounded-xl border p-4">
        <div className="flex items-start justify-between gap-4">
          <div><p className="font-black">Order #{order.order_code || order.id}</p><p className="text-sm text-gray-500">{order.customer_name || 'Customer'}{order.created_at ? ` · Opened ${new Date(order.created_at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}` : ''}</p><p className="mt-1 text-xs font-semibold text-slate-600">Type: {orderTypeLabel(order.order_type)} · Payment: <span className="text-amber-700">{paymentStatusLabel(order)}</span></p></div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold capitalize">{(order.status || 'pending').replaceAll('_', ' ')}</span>
        </div>
        {order.delivery_address && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{order.delivery_address}</p>}
        <div className="mt-3 divide-y rounded-lg border">
          {items.map((item, index) => <div key={item.id || index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 text-sm"><div className="min-w-0"><p><b>{item.quantity || 1}×</b> {item.product_name || 'Product'}</p>{dineIn && <button onClick={() => void updateItemStatus(order, item, item.status === 'served' ? 'preparing' : 'served')} className={`mt-2 inline-flex min-h-8 items-center rounded-full px-3 text-[11px] font-black transition ${item.status === 'served' ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-purple-100 text-purple-700 hover:bg-purple-200'}`}>{item.status === 'served' ? 'Served · Change to preparing' : 'Preparing · Mark served'}</button>}</div><b className="shrink-0">{money(Number(item.subtotal ?? Number(item.price || 0) * Number(item.quantity || 1)))}</b></div>)}
          {!items.length && <p className="p-3 text-sm text-gray-400">No item details returned.</p>}
        </div>
        {dineIn && !!order.service_requests?.length && <section className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3"><div className="flex items-center justify-between"><h4 className="text-sm font-black text-blue-950">Table service requests</h4><span className="rounded-full bg-blue-600 px-2 py-1 text-[10px] font-black text-white">{order.service_requests.filter(request => request.status !== 'completed').length} open</span></div><div className="mt-3 space-y-2">{order.service_requests.map(request => <div key={request.id} className="rounded-xl border bg-white p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black">{{spoon_fork:'Spoon & fork',water_cold:'Cold water',water_hot:'Hot water',condiments:'Condiments',plates_saucers:'Plates / saucers',other:'Other'}[request.type] || request.type}</p>{request.details && <p className="mt-0.5 text-xs text-gray-500">{request.details}</p>}</div><span className={`rounded-full px-2 py-1 text-[10px] font-black capitalize ${request.status === 'completed' ? 'bg-green-100 text-green-700' : request.status === 'assigned' ? 'bg-purple-100 text-purple-700' : 'bg-amber-100 text-amber-700'}`}>{request.status}</span></div>{request.status !== 'completed' && <div className="mt-3 flex gap-2"><select value={request.assigned_staff_id || ''} onChange={event => void updateServiceRequest(order, request, { assignedStaffId: event.target.value ? Number(event.target.value) : null, status: event.target.value ? 'assigned' : 'pending' })} className="min-h-10 min-w-0 flex-1 rounded-lg border bg-white px-2 text-xs"><option value="">Assign crew…</option>{crew.map(member => <option key={member.id} value={member.id}>{member.displayName || `Crew ${member.id}`}{member.role ? ` · ${member.role}` : ''}</option>)}</select><button disabled={!request.assigned_staff_id} onClick={() => void updateServiceRequest(order, request, { status: 'completed' })} className="min-h-10 rounded-lg bg-green-600 px-3 text-xs font-black text-white disabled:bg-gray-300">Complete</button></div>}</div>)}</div></section>}
        {isBilling ? <section className="mt-4 overflow-hidden rounded-xl border-2 border-slate-800 bg-white text-slate-900">
          <header className="border-b-2 border-slate-800 p-4 text-center"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-600">Billing Invoice Preview</p><h3 className="mt-1 text-lg font-black">{registeredName}</h3><p className="text-[10px]">{registeredAddress || 'Registered business address not configured'}</p><p className="mt-1 font-mono text-[10px]">TIN: {merchant?.tin || 'NOT CONFIGURED'} · {isVat ? 'VAT REGISTERED' : 'NON-VAT'}</p></header>
          <div className="grid grid-cols-2 gap-3 border-b p-3 text-[10px]"><div><p className="font-black uppercase text-slate-400">Invoice reference</p><p className="font-mono font-bold">Pending issuance</p><p>Order: {order.order_code}</p></div><div className="text-right"><p className="font-black uppercase text-slate-400">Transaction date</p><p>{new Date(order.created_at || Date.now()).toLocaleString('en-PH')}</p><p>Dine-in · {order.table_number}</p></div><div><p className="font-black uppercase text-slate-400">Sold to</p><p className="font-bold">{order.customer_name || 'Cash customer'}</p></div><div className="text-right"><p className="font-black uppercase text-slate-400">Status</p><p className="font-bold uppercase">{order.status === 'bill_out' ? 'For confirmation' : 'Awaiting payment'}</p></div></div>
          <div className="border-b p-3"><div className="grid grid-cols-[minmax(0,1fr)_35px_70px_75px] gap-2 border-b pb-2 text-[9px] font-black uppercase text-slate-500"><span>Description</span><span className="text-center">Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span></div>{items.map((item,index) => <div key={item.id || index} className="grid grid-cols-[minmax(0,1fr)_35px_70px_75px] gap-2 py-2 text-[10px]"><span className="font-semibold">{item.product_name || 'Product'}</span><span className="text-center">{item.quantity || 1}</span><span className="text-right">{money(Number(item.price || 0))}</span><span className="text-right font-bold">{money(Number(item.subtotal ?? Number(item.price || 0) * Number(item.quantity || 1)))}</span></div>)}</div>
          <div className="space-y-1 p-3 text-[10px]"><div className="flex justify-between"><span>Gross sales (VAT inclusive)</span><b>{money(subtotal)}</b></div>{order.discount_type === 'sc_pwd' && vatExemption > 0 && <div className="flex justify-between text-emerald-700"><span>Less: 12% VAT exemption</span><span>−{money(vatExemption)}</span></div>}{order.discount_type === 'sc_pwd' && scPwdDiscount > 0 && <div className="flex justify-between text-emerald-700"><span>Less: SC/PWD discount (20%)</span><span>−{money(scPwdDiscount)}</span></div>}{discount > 0 && order.discount_type !== 'sc_pwd' && <div className="flex justify-between text-emerald-700"><span>Less: Voucher discount</span><span>−{money(discount)}</span></div>}<div className="mt-2 border-t pt-2 font-bold uppercase text-slate-500">Tax breakdown</div><div className="flex justify-between"><span>VATable sales</span><span>{money(vatableSales)}</span></div><div className="flex justify-between"><span>VAT amount (12%)</span><span>{money(vatAmount)}</span></div><div className="flex justify-between"><span>VAT-exempt sales</span><span>{money(vatExemptSales)}</span></div><div className="flex justify-between"><span>Zero-rated sales</span><span>{money(0)}</span></div>{order.discount_details?.cards?.map((card,index) => <div key={index} className="mt-2 border-t pt-2"><span className="font-bold uppercase">{card.type} ID:</span> {card.reference} · {card.name}</div>)}<div className="mt-2 flex justify-between border-t-2 border-slate-800 pt-2 text-sm font-black"><span>Total amount due</span><span className="text-red-600">{money(Number(order.total_amount || 0))}</span></div></div>
          <footer className="border-t bg-amber-50 p-3 text-[9px] leading-relaxed text-amber-900">This is a billing preview, not yet the issued tax invoice. The registered serial number, BIR permit/ATP details, payment reference, and electronic-invoice/EIS status must come from the registered invoicing system after payment. Missing merchant TIN or registered address must be completed before issuance.</footer>
        </section> : <div className="mt-4 rounded-xl bg-gray-50 p-4"><p className="mb-3 text-xs font-black uppercase tracking-wide text-gray-500">Order summary</p><div className="space-y-2 text-sm"><div className="flex justify-between"><span>Items / Subtotal</span><b>{money(Math.max(0, Number(order.total_amount || 0) - Number(order.delivery_fee || 0)))}</b></div><div className="flex justify-between text-gray-600"><span>Delivery fee</span><span>{money(Number(order.delivery_fee || 0))}</span></div>{draftReduction > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950"><div className="flex justify-between font-bold"><span>Draft SC/PWD estimate</span><span>−{money(draftReduction)}</span></div><p className="mt-1 text-[10px]">{order.discount_details?.eligibleDiners} of {order.discount_details?.totalDiners} diners · Complete all required card details to request bill-out.</p></div>}<div className="flex justify-between border-t pt-3 text-base font-black"><span>{draftReduction > 0 ? 'Estimated amount due' : 'Total'}</span><span className="text-red-600">{money(draftReduction > 0 ? subtotal - draftReduction : Number(order.total_amount || 0))}</span></div></div></div>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">{order.discount_details?.draft && order.status !== 'bill_out' && <div className="w-full rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><p className="font-black">Awaiting customer completion</p><p className="mt-1">Confirm Bill will be enabled after all required SC/PWD card details are completed and the customer submits the bill-out request.</p><button onClick={() => void load()} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-amber-500 bg-white px-5 text-sm font-black text-amber-900"><RefreshCw className="size-4"/>Check customer submission</button></div>}{order.status === 'bill_out' && <button onClick={() => void confirmBillOut(order)} className="min-h-11 rounded-lg bg-red-600 px-5 py-2 text-sm font-black text-white hover:bg-red-700">Confirm Bill</button>}{action && <button onClick={() => void updateOrderStatus(order, action.next)} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-5 py-2 text-sm font-black text-white ${order.status === 'pending' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-red-600 hover:bg-red-700'}`}><PackageCheck className="size-4"/>{action.label}</button>}</div>
      </article>
    );
  }) : <div className="py-10 text-center text-sm text-gray-500">No active order is assigned to this table.</div>;

  const selectTable = (label: string) => {
    setSelectedTable(label);
    setSalesTicketOpen(false);
    const hasOpenOrder = orders.some(order => ['dine_in', 'in_store'].includes(order.order_type || '') && openStatus(order.status) && sameTable(order.table_number, label));
    if (hasOpenOrder) {
      setActiveTickets('in_store');
      return;
    }
    setActiveTickets(null);
  };

  return <div className="space-y-4">
    <div><p className="text-sm font-semibold text-red-600">{shop?.branch_name || shop?.name || 'Active shop'}</p><h1 className="text-3xl font-black text-gray-900">My Shop · Dine-In Order Counter</h1><p className="mt-1 text-gray-600">Manage tables, dine-in orders, serving, billing, and table turnover from one screen.</p></div>

    <section className="grid gap-3 md:grid-cols-3">
      <button onClick={() => { setSalesTicketOpen(false); setSelectedTable(null); setActiveTickets('delivery'); }} className="flex min-h-20 items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-blue-400 hover:shadow-md"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Truck className="size-5"/></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-gray-500">Online delivery</span><span className="block text-lg font-black">{counts.delivery} open</span></span><span className="text-xs font-bold text-blue-700">View →</span></button>
      <button onClick={() => { setSalesTicketOpen(false); setSelectedTable(null); setActiveTickets('pickup'); }} className="flex min-h-20 items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-amber-400 hover:shadow-md"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><ShoppingBag className="size-5"/></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-gray-500">Online pickup</span><span className="block text-lg font-black">{counts.pickup} open</span></span><span className="text-xs font-bold text-amber-700">View →</span></button>
      <button onClick={() => { setSalesTicketOpen(false); setActiveTickets(null); setSelectedTable(null); tableSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="flex min-h-20 items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-fuchsia-400 hover:shadow-md"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-fuchsia-50 text-fuchsia-700"><ClipboardList className="size-5"/></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-gray-500">In-store orders</span><span className="block text-lg font-black">{counts.inStore} open</span></span><span className="text-xs font-bold text-fuchsia-700">Tables →</span></button>
    </section>

    <section className="flex flex-wrap gap-2">{([['all','All Tables'],['vacant','Vacant'],['active','Active'],['preparing','Preparing'],['served','Served'],['bill_out','Bill-out']] as const).map(([key,label]) => <button key={key} onClick={() => setTableFilter(key)} className={`min-h-10 rounded-lg px-3 text-sm font-bold transition ${tableFilter === key ? 'bg-slate-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{label} <span className="ml-1 opacity-70">{dineInCounts[key]}</span></button>)}</section>

    {(shop?.merchant_id || shop?.merchantId) && <section ref={tableSectionRef} className="scroll-mt-5">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-black">Table status</h2><p className="text-sm text-gray-500">Select a table to view its active ticket and food-item statuses.</p></div><div className="flex gap-2"><button onClick={() => void load()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border bg-white px-3 text-sm font-bold shadow-sm"><RefreshCw className="size-4"/>Refresh</button><Link href="/shop/table-configuration" className="inline-flex min-h-10 items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-bold shadow-sm"><Settings2 className="size-4"/>Manage tables</Link></div></div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 rounded-xl border bg-white px-3 py-2 text-[11px] font-bold text-gray-700">{[['bg-gray-300','Vacant'],['bg-orange-500','Order placed'],['bg-purple-600','Accepted / preparing'],['bg-green-500','Served'],['bg-amber-500','Bill-out form incomplete'],['bg-red-600','Bill-out requested'],['bg-yellow-400','Awaiting payment'],['bg-blue-600','Manual payment']].map(([color,label]) => <span key={label} className="inline-flex items-center gap-1.5"><i className={`size-3 rounded-full ${color}`}/>{label}</span>)}</div>
      <div className="grid min-h-[calc(100vh-255px)] gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(380px,2fr)]">
        <div className="min-w-0">
          <div className="max-h-[calc(100vh-290px)] overflow-y-auto overscroll-contain rounded-xl border bg-slate-50 p-2">
            <FloorPlanEditor merchantId={(shop.merchant_id || shop.merchantId)!} editable={false} selectedTableLabel={selectedTable} statusFilter={tableFilter} onTableCountChange={setTableCount} tableStatuses={tableStatuses} onTableClick={selectTable} />
          </div>
        </div>
        <aside className="min-w-0 rounded-xl border bg-white p-4">
          <div className="mb-4 flex items-start justify-between gap-3"><div><h3 className="text-lg font-black">{selectedTable ? `${selectedTable} ticket` : 'Table details'}</h3><p className="text-sm text-gray-500">{selectedTable ? 'Review ordered items and their current status.' : 'Click a table on the left to see its order.'}</p></div>{selectedTable && <button onClick={() => { setSelectedTable(null); setActiveTickets(null); }} className="shrink-0 text-xs font-bold text-red-600">Clear</button>}</div>
          <div className="max-h-[calc(100vh-350px)] space-y-4 overflow-y-auto pr-1">
            {selectedTable && salesTicketOpen && <div className="rounded-xl border border-red-100 bg-red-50 p-5"><p className="font-black text-red-900">New dine-in order for {selectedTable}</p><p className="mt-1 text-sm text-red-700">The table is vacant. Select products from the catalogue to create the staff order.</p><button onClick={() => catalogueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white">Choose products</button></div>}
            {selectedTable && !salesTicketOpen && visibleTickets.length === 0 && <div className="rounded-xl border bg-slate-50 p-5"><span className="inline-flex rounded-full bg-gray-200 px-3 py-1 text-xs font-black text-gray-700">Vacant</span><p className="mt-4 text-lg font-black">{selectedTable} is available</p><p className="mt-1 text-sm text-gray-500">Start a staff-assisted dine-in order for this table.</p><button onClick={() => startTableOrder(selectedTable)} className="mt-5 min-h-12 w-full rounded-xl bg-red-600 px-5 font-black text-white hover:bg-red-700">Start Dine-In Order</button></div>}
            {selectedTable && !salesTicketOpen && visibleTickets.length > 0 && renderTicketCards(visibleTickets)}
          </div>
        </aside>
      </div>
    </section>}

    {activeTickets && activeTickets !== 'in_store' && <section className="rounded-xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-xl font-black capitalize">{activeTickets.replace('_', ' ')} tickets</h2><p className="text-sm text-gray-500">Review the customer order and move it through fulfilment.</p></div><button onClick={() => setActiveTickets(null)} className="rounded-full p-2 text-xl text-gray-500 hover:bg-gray-100" aria-label="Close tickets">×</button></div><div className="grid gap-4 lg:grid-cols-2">{renderTicketCards(visibleTickets)}</div></section>}

    {salesTicketOpen && !activeTickets && <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
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
