'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth, getToken } from '@/hooks/use-auth';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
import Link from 'next/link';
import { generateInvoice, getInvoiceByOrder, Invoice as InvoiceType } from '@/lib/e-invoice';
import EInvoiceView from '@/components/EInvoiceView';
import FloorPlanEditor from '@/components/FloorPlanEditor';

interface MerchantData {
  id: number;
  name: string;
  logo_url: string | null;
  category_id: number | null;
  is_active: boolean;
  status: string;
  subscription_tier?: string;
  category?: { name?: string | null } | null;
}

interface Order {
  id: number;
  shop_id?: number;
  order_code: string;
  customer_name: string;
  table_number?: string;
  status: string;
  order_type: string;
  items_count: number;
  total_amount: number;
  delivery_address?: string;
  delivery_zone_name?: string;
  customer_barangay?: string;
  delivery_fee?: number;
  created_at: string;
  time_ago: string;
  items: OrderItem[];
}

interface OrderItem {
  id: number;
  product_name: string;
  quantity: number;
  price: number;
  subtotal: number;
}

interface Reservation {
  id: number;
  reservation_code: string;
  customer_name: string;
  table_number?: string;
  status: string;
  reservation_date: string;
  reservation_time: string;
  number_of_guests: number;
}

interface TableData {
  tableNumber: string;
  status: 'served' | 'pending' | 'request' | 'bill_out' | 'open' | 'reserved';
  orderId?: number;
  customerName?: string;
  orderCode?: string;
  totalAmount?: number;
}

type BusinessViewMode = 'restaurant' | 'retail';
type OrderTabFilter = 'in_store' | 'pickup' | 'delivery' | 'reservations';

export default function MerchantOrdersPage() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab') as OrderTabFilter | null;
  const requestedStatus = searchParams.get('status');
  const requestedOrderId = Number(searchParams.get('orderId')) || null;
  const requestedShopId = Number(searchParams.get('shopId')) || null;
  const requestedReservationId = Number(searchParams.get('reservationId')) || null;
  const [merchant, setMerchant] = useState<MerchantData | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<BusinessViewMode>('restaurant');
  const [activeTab, setActiveTab] = useState<OrderTabFilter>(
    requestedTab && ['in_store', 'pickup', 'delivery', 'reservations'].includes(requestedTab)
      ? requestedTab
      : 'in_store',
  );
  const [storeOpen, setStoreOpen] = useState(true);
  const [totalTables] = useState(18);
  const [editingLayout, setEditingLayout] = useState(false);
  const [floorTablesReady, setFloorTablesReady] = useState(false);

  // Retail view filters
  const [retailFilter, setRetailFilter] = useState<'all' | 'pending' | 'preparing' | 'ready' | 'bill_out' | 'history'>('all');

  // E-Invoice
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceType | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const handleViewInvoice = async (orderId: number) => {
    setInvoiceLoading(true);
    try {
      // First try to get existing invoice
      let invoice = await getInvoiceByOrder(orderId);
      // If none exists, generate one
      if (!invoice) {
        invoice = await generateInvoice(orderId);
      }
      if (invoice) {
        setSelectedInvoice(invoice);
      } else {
        toast.error('Unable to generate invoice for this order.');
      }
    } catch (err) {
      console.error('Error loading invoice:', err);
      toast.error('Error loading invoice');
    } finally {
      setInvoiceLoading(false);
    }
  };

  // ─── ORDER STATUS ACTIONS ─────────────────────────────
  // Update an order's status from the merchant dashboard. We keep
  // the allowed transitions client-side for UX; the DB CHECK constraint
  // already restricts the underlying values. When an order is cancelled,
  // we also restock the items so inventory stays accurate.
  const handleOrderStatusChange = async (
    orderId: number,
    nextStatus: string,
    confirmMsg?: string,
  ) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to update order status');
      }

      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: nextStatus } : o)),
      );
      setSelectedOrder((current) =>
        current?.id === orderId ? { ...current, status: nextStatus } : current,
      );
      toast.success('Order status updated');
    } catch (err: any) {
      console.error('Failed to update order status:', err);
      toast.error(err.message || 'Failed to update order status. Please try again.');
    }
  };

  // ─── RESERVATION STATUS ACTIONS ───────────────────────
  const handleReservationStatusChange = async (
    reservationId: number,
    nextStatus: string,
  ) => {
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/reservations/${reservationId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error('Failed to update reservation');
      setReservations((prev) =>
        prev.map((r) =>
          r.id === reservationId ? { ...r, status: nextStatus } : r,
        ),
      );
      toast.success('Reservation status updated');
    } catch (err: any) {
      console.error('Failed to update reservation status:', err);
      toast.error(err.message || 'Failed to update reservation. Please try again.');
    }
  };

  const fetchMerchantData = useCallback(async () => {
    try {
      const token = getToken();
      if (!token) return;

      const res = await fetch(`${API}/api/merchants/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const merchantData = await res.json();

      if (merchantData) {
        setMerchant(merchantData);
        setActiveTab((currentTab) =>
          merchantData.subscription_tier?.toLowerCase() !== 'platinum' &&
          currentTab === 'in_store'
            ? 'delivery'
            : currentTab,
        );
        setStoreOpen(merchantData.is_active);
        if (merchantData.category_id === 1) {
          setViewMode('restaurant');
        } else if (merchantData.category_id === 4) {
          setViewMode('retail');
        }
      }
    } catch (error) {
      console.error('Error fetching merchant:', error);
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    if (!merchant) return;
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/orders?merchantId=${merchant.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch orders');
      const ordersData = await res.json();

      const transformedOrders: Order[] = (Array.isArray(ordersData) ? ordersData : ordersData.data || []).map((order: any) => {
        const customerName = order.customer_name
          || (order.customer ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() : '')
          || (order.users ? `${order.users.first_name || ''} ${order.users.last_name || ''}`.trim() : '')
          || 'Guest';
        const timeAgo = getTimeAgo(new Date(order.created_at));

        let orderType = 'in_store';
        if (order.delivery_address) {
          orderType = 'delivery';
        } else if (!order.table_number) {
          orderType = 'pickup';
        }

        const items: OrderItem[] = (order.order_items || order.orderItems || order.items || []).map((item: any) => ({
          id: Number(item.id),
          product_name: item.product_name || item.productName || 'Item',
          quantity: Number(item.quantity || 1),
          price: Number(item.price || 0),
          subtotal: Number(item.subtotal ?? Number(item.price || 0) * Number(item.quantity || 1)),
        }));

        return {
          id: order.id,
          shop_id: Number(order.shop_id ?? order.shopId) || undefined,
          order_code: order.order_code,
          customer_name: customerName,
          table_number: order.table_number,
          status: order.status,
          order_type: order.order_type || orderType,
          items_count: items.reduce((total, item) => total + item.quantity, 0),
          items,
          total_amount: parseFloat(order.total_amount) || 0,
          delivery_address: order.delivery_address || undefined,
          delivery_zone_name: order.delivery_zone_name || undefined,
          customer_barangay: order.customer_barangay || undefined,
          delivery_fee: parseFloat(order.delivery_fee) || 0,
          created_at: order.created_at,
          time_ago: timeAgo,
        };
      });

      const shopOrders = requestedShopId
        ? transformedOrders.filter(order => Number(order.shop_id) === requestedShopId)
        : transformedOrders;
      setOrders(shopOrders);
      if (requestedOrderId) {
        const requestedOrder = shopOrders.find(order => order.id === requestedOrderId);
        if (requestedOrder) {
          setActiveTab(requestedOrder.order_type === 'delivery' ? 'delivery' : requestedOrder.order_type === 'pickup' ? 'pickup' : 'in_store');
          setSelectedOrder(requestedOrder);
        }
      }
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  }, [merchant, requestedOrderId, requestedShopId]);

  const fetchReservations = useCallback(async () => {
    if (!merchant) return;
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/reservations?merchantId=${merchant.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch reservations');
      const reservationsData = await res.json();

      const transformedReservations: Reservation[] = (Array.isArray(reservationsData) ? reservationsData : reservationsData.data || []).map((r: any) => {
        const customerName = r.customer_name
          || (r.users ? `${r.users.first_name || ''} ${r.users.last_name || ''}`.trim() : '')
          || 'Guest';

        return {
          id: r.id,
          reservation_code: r.reservation_code,
          customer_name: customerName,
          table_number: r.table_number,
          status: r.status,
          reservation_date: r.reservation_date,
          reservation_time: r.reservation_time,
          number_of_guests: r.number_of_guests,
        };
      });

      setReservations(transformedReservations);
    } catch (error) {
      console.error('Error fetching reservations:', error);
    }
  }, [merchant]);

  useEffect(() => {
    const init = async () => {
      await fetchMerchantData();
      setLoading(false);
    };
    init();
  }, [fetchMerchantData]);

  useEffect(() => {
    if (merchant) {
      fetchOrders();
      fetchReservations();
    }
  }, [merchant, fetchOrders, fetchReservations]);

  // Poll for updates (replaces realtime subscriptions)
  useEffect(() => {
    if (!merchant) return;
    const interval = setInterval(() => {
      fetchOrders();
      fetchReservations();
    }, 30000);
    return () => clearInterval(interval);
  }, [merchant, fetchOrders, fetchReservations]);

  // Auto-generate default floor tables if merchant has none
  useEffect(() => {
    if (!merchant) return;
    const seedDefaults = async () => {
      try {
        const token = getToken();
        const res = await fetch(`${API}/api/merchants/${merchant.id}/floor-tables`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const existing = await res.json();
        if (existing.length > 0) {
          setFloorTablesReady(true);
          return;
        }
        const defaults = Array.from({ length: totalTables }, (_, i) => ({
          label: `Table ${i + 1}`,
          shape: 'square' as const,
          capacity: 4,
          posX: (i % 4) * 180 + 40,
          posY: Math.floor(i / 4) * 140 + 30,
          width: 100,
          height: 100,
          rotation: 0,
          isActive: true,
          sortOrder: i,
        }));
        await fetch(`${API}/api/merchants/${merchant.id}/floor-tables/bulk`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ tables: defaults }),
        });
        setFloorTablesReady(true);
      } catch (err) {
        console.error('Error seeding floor tables:', err);
        setFloorTablesReady(true);
      }
    };
    seedDefaults();
  }, [merchant, totalTables]);

  // Build table status map for the floor plan editor view mode
  const tableStatusMap = (() => {
    const map: Record<string, { status: string; customerName?: string; orderCode?: string; totalAmount?: number }> = {};
    for (let i = 1; i <= 50; i++) {
      const tableNum = String(i);
      const label = `Table ${i}`;
      const tableOrder = orders.find(
        (o) =>
          (o.table_number === tableNum || o.table_number === label) &&
          ['in_store', 'dine_in'].includes(o.order_type) &&
          !['completed', 'cancelled'].includes(o.status),
      );
      const tableReservation = reservations.find(
        (r) => (r.table_number === tableNum || r.table_number === label) && ['pending', 'confirmed'].includes(r.status),
      );

      if (tableOrder) {
        let status = 'pending';
        if (tableOrder.status === 'processing' || tableOrder.status === 'preparing') status = 'served';
        else if (tableOrder.status === 'ready') status = 'served';
        else if (tableOrder.status === 'pending') status = 'pending';
        else if (tableOrder.status === 'bill_out' || tableOrder.status === 'completed') status = 'bill_out';
        map[label] = { status, customerName: tableOrder.customer_name, orderCode: tableOrder.order_code, totalAmount: tableOrder.total_amount };
      } else if (tableReservation) {
        map[label] = { status: 'reserved', customerName: tableReservation.customer_name };
      } else {
        map[label] = { status: 'open' };
      }
    }
    return map;
  })();

  const getTimeAgo = (date: Date): string => {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
  };

  const toggleStoreStatus = async () => {
    if (!merchant) return;
    const newStatus = !storeOpen;
    setStoreOpen(newStatus);
    const token = getToken();
    await fetch(`${API}/api/merchants/${merchant.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ is_active: newStatus }),
    });
  };

  // ============ TABLE DATA FOR RESTAURANT VIEW ============
  const generateTableData = (): TableData[] => {
    const tables: TableData[] = [];

    for (let i = 1; i <= totalTables; i++) {
      const tableNum = String(i);
      const label = `Table ${i}`;
      // Check if this table has an active order (match bare number or "Table N" label)
      const tableOrder = orders.find(
        (o) =>
          (o.table_number === tableNum || o.table_number === label) &&
          ['in_store', 'dine_in'].includes(o.order_type) &&
          !['completed', 'cancelled'].includes(o.status)
      );
      // Check if this table has a reservation
      const tableReservation = reservations.find(
        (r) => (r.table_number === tableNum || r.table_number === label) && ['pending', 'confirmed'].includes(r.status)
      );

      if (tableOrder) {
        let status: TableData['status'] = 'pending';
        if (tableOrder.status === 'processing' || tableOrder.status === 'preparing') status = 'served';
        else if (tableOrder.status === 'ready') status = 'served';
        else if (tableOrder.status === 'pending') status = 'pending';
        else if (tableOrder.status === 'bill_out' || tableOrder.status === 'completed') status = 'bill_out';

        tables.push({
          tableNumber: tableNum,
          status,
          orderId: tableOrder.id,
          customerName: tableOrder.customer_name,
          orderCode: tableOrder.order_code,
          totalAmount: tableOrder.total_amount,
        });
      } else if (tableReservation) {
        tables.push({
          tableNumber: tableNum,
          status: 'reserved',
          customerName: tableReservation.customer_name,
        });
      } else {
        tables.push({
          tableNumber: tableNum,
          status: 'open',
        });
      }
    }
    return tables;
  };

  const getTableColor = (status: TableData['status']) => {
    switch (status) {
      case 'served': return 'bg-green-500';
      case 'pending': return 'bg-cyan-400';
      case 'request': return 'bg-yellow-400';
      case 'bill_out': return 'bg-fuchsia-500';
      case 'reserved': return 'bg-red-500';
      case 'open': return 'bg-gray-200';
      default: return 'bg-gray-200';
    }
  };

  const getTableTextColor = (status: TableData['status']) => {
    switch (status) {
      case 'open': return 'text-gray-500';
      default: return 'text-white';
    }
  };

  const getStatusLabel = (status: TableData['status']) => {
    switch (status) {
      case 'served': return 'Served';
      case 'pending': return 'Pending';
      case 'request': return 'Request';
      case 'bill_out': return 'Bill-Out';
      case 'reserved': return 'Reserved';
      case 'open': return 'Open';
      default: return status;
    }
  };

  // ============ COUNTS ============
  const inStoreOrders = orders.filter((o) => ['in_store', 'dine_in'].includes(o.order_type) && !['completed', 'cancelled'].includes(o.status));
  const pickupOrders = orders.filter((o) => o.order_type === 'pickup' && !['completed', 'cancelled'].includes(o.status));
  const deliveryOrders = orders.filter((o) => o.order_type === 'delivery' && !['completed', 'cancelled'].includes(o.status));
  const activeReservations = reservations.filter((r) => ['pending', 'confirmed'].includes(r.status));
  const completedOrders = orders.filter((o) => o.status.toLowerCase() === 'completed');

  const tableData = generateTableData();
  const closedTables = tableData.filter((t) => t.status !== 'open').length;
  const openTables = tableData.filter((t) => t.status === 'open').length;
  const reservedTables = tableData.filter((t) => t.status === 'reserved').length;

  // Retail view helpers
  const getRetailStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending': return 'bg-purple-100 text-purple-800';
      case 'processing': case 'preparing': return 'bg-orange-100 text-orange-800';
      case 'ready': return 'bg-green-100 text-green-800';
      case 'out_for_delivery': return 'bg-indigo-100 text-indigo-800';
      case 'completed': case 'bill_out': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getRetailStatusLabel = (status: string) => {
    switch (status.toLowerCase()) {
      case 'processing': return 'Preparing';
      case 'completed': return 'Completed';
      case 'out_for_delivery': return 'Out for delivery';
      default:
        return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }
  };

  const filteredRetailOrders = orders.filter((o) => {
    if (retailFilter === 'all') return ['pending', 'processing'].includes(o.status);
    if (retailFilter === 'history') return ['completed', 'cancelled'].includes(o.status);
    if (retailFilter === 'preparing') return o.status === 'processing';
    if (retailFilter === 'bill_out') return o.status === 'bill_out';
    return o.status === retailFilter;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading orders...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0 lg:space-y-6">
      {requestedStatus === 'completed' && (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Completed Orders</h2>
              <p className="text-sm text-gray-600">{completedOrders.length} completed orders</p>
            </div>
            <Link href="/merchant/orders?tab=delivery" className="text-sm font-semibold text-red-600 hover:underline">
              Back to active orders
            </Link>
          </div>
          {completedOrders.length === 0 ? (
            <EmptyState icon="✓" message="No completed orders" subtext="Completed orders will appear here." />
          ) : (
            completedOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onViewDetails={setSelectedOrder}
                onViewInvoice={handleViewInvoice}
                onStatusChange={handleOrderStatusChange}
              />
            ))
          )}
        </section>
      )}

      {/* ============ RESTAURANT VIEW ============ */}
      {requestedStatus !== 'completed' && viewMode === 'restaurant' && (
        <div className="space-y-3 lg:space-y-4">
          {/* Gateway Header */}
          <div className="bg-gradient-to-r from-[#DB0002] to-[#CC0000] rounded-xl p-3 lg:p-4 text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Image
                  src="/logo/weKonnekLogov1.png"
                  alt="WeKonnek"
                  width={54}
                  height={36}
                  className="w-12 h-8 lg:w-14 lg:h-9 bg-white rounded-lg p-0.5 object-contain"
                />
                <div className="hidden sm:block">
                  <p className="text-[10px] lg:text-xs font-bold uppercase tracking-wider opacity-90">Merchant Admin Gateway</p>
                  <p className="text-sm lg:text-base font-bold">{merchant?.category?.name || 'Merchant'}</p>
                </div>
                <div className="sm:hidden">
                  <p className="text-[9px] font-bold uppercase tracking-wider opacity-90">Admin Gateway</p>
                  <p className="text-xs font-bold">{merchant?.category?.name || 'Merchant'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {merchant?.logo_url ? (
                  <Image
                    src={merchant.logo_url}
                    alt={merchant?.name || 'Store'}
                    width={36}
                    height={36}
                    className="w-8 h-8 lg:w-9 lg:h-9 rounded-lg border-2 border-white/50"
                  />
                ) : (
                  <div className="w-8 h-8 lg:w-9 lg:h-9 bg-white/20 rounded-lg flex items-center justify-center text-sm font-bold">
                    {merchant?.name?.charAt(0) || 'M'}
                  </div>
                )}
                <span className="text-xs lg:text-sm font-bold max-w-[100px] lg:max-w-[150px] truncate">
                  {merchant?.name || 'My Store'}
                </span>
              </div>
            </div>
          </div>

          {/* Stats Row */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <div className="flex-shrink-0 bg-red-500 text-white rounded-lg px-3 py-2 text-center min-w-[90px]">
              <p className="text-[9px] lg:text-[10px] font-bold uppercase tracking-wider">Close Table</p>
              <p className="text-xl lg:text-2xl font-black">{closedTables}</p>
            </div>
            <div className="flex-shrink-0 bg-green-500 text-white rounded-lg px-3 py-2 text-center min-w-[90px]">
              <p className="text-[9px] lg:text-[10px] font-bold uppercase tracking-wider">Open Table</p>
              <p className="text-xl lg:text-2xl font-black">{openTables}</p>
            </div>
            <div className="flex-shrink-0 bg-green-500 text-white rounded-lg px-3 py-2 text-center min-w-[90px]">
              <p className="text-[9px] lg:text-[10px] font-bold uppercase tracking-wider">Reserved</p>
              <p className="text-xl lg:text-2xl font-black">{reservedTables}</p>
            </div>
            {/* Store Status Toggle */}
            <div className="flex-shrink-0 ml-auto bg-white rounded-lg px-3 py-2 border border-gray-200 shadow-sm">
              <p className="text-[9px] lg:text-[10px] font-bold text-gray-500 uppercase tracking-wider">Store Status</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-xs font-medium ${!storeOpen ? 'text-red-600' : 'text-gray-400'}`}>Close</span>
                <button
                  onClick={toggleStoreStatus}
                  className={`relative w-10 h-5 rounded-full transition-colors ${storeOpen ? 'bg-green-500' : 'bg-gray-300'}`}
                  title="Toggle Store Status"
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${storeOpen ? 'left-5.5 translate-x-0.5' : 'left-0.5'}`}></span>
                </button>
                <span className={`text-xs font-medium ${storeOpen ? 'text-green-600' : 'text-gray-400'}`}>Open</span>
              </div>
            </div>
          </div>

          {/* Order Type Tabs with Badges */}
          <div className="grid grid-cols-4 gap-1.5 lg:gap-2">
            {[
              { key: 'in_store' as OrderTabFilter, label: 'In-Store Orders', count: inStoreOrders.length, color: 'bg-red-500' },
              { key: 'pickup' as OrderTabFilter, label: 'Pick-up Orders', count: pickupOrders.length, color: 'bg-green-500' },
              { key: 'delivery' as OrderTabFilter, label: 'Deliveries', count: deliveryOrders.length, color: 'bg-green-500' },
              { key: 'reservations' as OrderTabFilter, label: 'Reservations', count: activeReservations.length, color: 'bg-green-500' },
            ].map((tab) => {
              const locked = tab.key === 'in_store' && merchant?.subscription_tier?.toLowerCase() !== 'platinum';
              return (
              <button
                key={tab.key}
                onClick={() => {
                  if (locked) {
                    window.location.assign('/merchant/subscription/upgrade?required=platinum');
                    return;
                  }
                  setActiveTab(tab.key);
                }}
                title={locked ? 'Available on the Platinum plan' : undefined}
                className={`relative rounded-lg px-2 py-2.5 text-white font-bold text-[10px] lg:text-xs text-center transition-all ${
                  activeTab === tab.key
                    ? `${tab.color} shadow-lg scale-[1.02]`
                    : `${tab.color} opacity-70 hover:opacity-90`
                }`}
              >
                {tab.count > 0 && (
                  <span className="absolute -top-1.5 -right-1 w-5 h-5 bg-yellow-400 text-gray-900 rounded-full text-[10px] font-black flex items-center justify-center shadow-md border-2 border-white">
                    {tab.count}
                  </span>
                )}
                {tab.label}{locked ? ' · Platinum' : ''}
              </button>
            )})}
          </div>

          {/* ============ IN-STORE FLOOR PLAN (Restaurant) ============ */}
          {activeTab === 'in_store' && (
            <div className="space-y-3">
              {/* Edit Layout Toggle */}
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-700">
                  {editingLayout ? 'Editing Floor Plan' : 'Floor Plan'}
                </h3>
                <button
                  onClick={() => setEditingLayout(!editingLayout)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    editingLayout
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={editingLayout
                      ? 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z'
                      : 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z'
                    } />
                  </svg>
                  {editingLayout ? 'View Mode' : 'Edit Layout'}
                </button>
              </div>

              {/* Floor Plan Editor */}
              {merchant && floorTablesReady && (
                <FloorPlanEditor
                  merchantId={merchant.id}
                  editable={editingLayout}
                  tableStatuses={tableStatusMap}
                  onTableClick={(label) => {
                    const entry = tableStatusMap[label];
                    if (entry && entry.orderCode) {
                      toast(`${label}: ${entry.orderCode} – ${entry.customerName || 'Guest'}`, { icon: '🍽️' });
                    }
                  }}
                />
              )}

              {/* Fallback grid if floor tables not ready */}
              {merchant && !floorTablesReady && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 lg:gap-3">
                  {tableData.map((table) => (
                    <button
                      key={table.tableNumber}
                      className={`${getTableColor(table.status)} ${getTableTextColor(table.status)} rounded-xl p-3 lg:p-4 text-left transition-all hover:scale-[1.02] hover:shadow-lg active:scale-95 min-h-[80px] lg:min-h-[100px]`}
                      title={`Table #${table.tableNumber} - ${getStatusLabel(table.status)}`}
                    >
                      <p className="text-sm lg:text-base font-black">Table # {table.tableNumber}</p>
                      {table.customerName && (
                        <p className="text-[10px] lg:text-xs opacity-80 truncate">{table.customerName}</p>
                      )}
                      <p className="text-[10px] lg:text-xs font-semibold mt-1 opacity-90">
                        {getStatusLabel(table.status)}
                      </p>
                      {table.totalAmount && table.totalAmount > 0 && (
                        <p className="text-xs lg:text-sm font-bold mt-0.5">₱{Number(table.totalAmount).toFixed(2)}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ============ PICKUP ORDERS (Restaurant) ============ */}
          {activeTab === 'pickup' && (
            <div className="space-y-2">
              {pickupOrders.length === 0 ? (
                <EmptyState icon="🛍️" message="No pick-up orders" subtext="Pick-up orders will appear here" />
              ) : (
                pickupOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    onViewDetails={setSelectedOrder}
                    onViewInvoice={handleViewInvoice}
                    onStatusChange={handleOrderStatusChange}
                  />
                ))
              )}
            </div>
          )}

          {/* ============ DELIVERY ORDERS (Restaurant) ============ */}
          {activeTab === 'delivery' && (
            <div className="space-y-2">
              {deliveryOrders.length === 0 ? (
                <EmptyState icon="🚚" message="No delivery orders" subtext="Delivery orders will appear here" />
              ) : (
                deliveryOrders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    onViewDetails={setSelectedOrder}
                    onViewInvoice={handleViewInvoice}
                    onStatusChange={handleOrderStatusChange}
                  />
                ))
              )}
            </div>
          )}

          {/* ============ RESERVATIONS (Restaurant) ============ */}
          {activeTab === 'reservations' && (
            <div className="space-y-2">
              {activeReservations.length === 0 ? (
                <EmptyState icon="📅" message="No reservation requests" subtext="Reservation requests from customers will appear here in real-time" />
              ) : (
                activeReservations.map((reservation) => (
                  <div key={reservation.id} id={`reservation-${reservation.id}`} className={`scroll-mt-4 rounded-xl ${requestedReservationId === reservation.id ? 'ring-2 ring-[#DB0002]' : ''}`}>
                    <ReservationCard
                      reservation={reservation}
                      onStatusChange={handleReservationStatusChange}
                    />
                  </div>
                ))
              )}
            </div>
          )}

          {/* Table Status Legend */}
          {activeTab === 'in_store' && (
            <div className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm">
              <p className="text-xs font-bold text-gray-600 mb-2 uppercase tracking-wider">Table Status Legend</p>
              <div className="flex flex-wrap gap-3">
                {[
                  { color: 'bg-green-500', label: 'Served' },
                  { color: 'bg-cyan-400', label: 'Pending' },
                  { color: 'bg-yellow-400', label: 'Request' },
                  { color: 'bg-fuchsia-500', label: 'Bill-Out' },
                  { color: 'bg-red-500', label: 'Reserved' },
                  { color: 'bg-gray-200', label: 'Open' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-1.5">
                    <span className={`w-3 h-3 rounded ${item.color}`}></span>
                    <span className="text-[10px] lg:text-xs text-gray-600 font-medium">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============ RETAIL STORE VIEW ============ */}
      {requestedStatus !== 'completed' && viewMode === 'retail' && (
        <div className="space-y-4">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#165BB8] to-[#1048A0] rounded-xl p-3 lg:p-4 text-white shadow-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Image
                  src="/logo/weKonnekLogov1.png"
                  alt="WeKonnek"
                  width={54}
                  height={36}
                  className="w-12 h-8 lg:w-14 lg:h-9 bg-white rounded-lg p-0.5 object-contain"
                />
                <div>
                  <p className="text-[10px] lg:text-xs font-bold uppercase tracking-wider opacity-90">Merchant Admin Gateway</p>
                  <p className="text-sm lg:text-base font-bold">{merchant?.category?.name || 'Merchant'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs lg:text-sm font-bold max-w-[150px] truncate">
                  {merchant?.name || 'My Store'}
                </span>
                {/* Store Status */}
                <div className="flex items-center gap-1 bg-white/20 rounded-full px-2 py-1">
                  <span className={`w-2 h-2 rounded-full ${storeOpen ? 'bg-green-400' : 'bg-red-400'}`}></span>
                  <span className="text-[10px] font-bold">{storeOpen ? 'Open' : 'Closed'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white rounded-lg p-3 border border-gray-200 text-center shadow-sm">
              <p className="text-[10px] text-gray-500 font-bold uppercase">Pending</p>
              <p className="text-2xl font-black text-orange-600">{orders.filter(o => o.status === 'pending').length}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-200 text-center shadow-sm">
              <p className="text-[10px] text-gray-500 font-bold uppercase">Processing</p>
              <p className="text-2xl font-black text-blue-600">{orders.filter(o => o.status === 'processing').length}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-200 text-center shadow-sm">
              <p className="text-[10px] text-gray-500 font-bold uppercase">Ready</p>
              <p className="text-2xl font-black text-green-600">{orders.filter(o => o.status === 'ready').length}</p>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { key: 'all' as const, label: 'All Active' },
              { key: 'pending' as const, label: 'Pending' },
              { key: 'preparing' as const, label: 'Preparing' },
              { key: 'ready' as const, label: 'Ready' },
              { key: 'bill_out' as const, label: 'Bill Out' },
              { key: 'history' as const, label: 'History' },
            ].map((filter) => (
              <button
                key={filter.key}
                onClick={() => setRetailFilter(filter.key)}
                className={`px-3 py-1.5 rounded-lg font-medium text-xs transition-colors ${
                  retailFilter === filter.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {/* Orders List */}
          {filteredRetailOrders.length === 0 ? (
            <EmptyState icon="📦" message="No orders found" subtext="Orders will appear here when customers place them" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredRetailOrders.map((order) => (
                <div key={order.id} className="bg-white rounded-lg shadow-sm p-4 border border-gray-200 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-base font-bold text-gray-900">{order.order_code}</h3>
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${getRetailStatusColor(order.status)}`}>
                        {getRetailStatusLabel(order.status)}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">{order.time_ago}</span>
                  </div>
                  <div className="space-y-1.5 mb-3">
                    <div className="flex items-center gap-2 text-gray-600">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span className="text-xs">{order.customer_name} · {order.items_count} item{order.items_count === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-gray-100 gap-2 flex-wrap">
                    <span className="text-lg font-bold text-gray-900">₱{Number(order.total_amount).toFixed(2)}</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => setSelectedOrder(order)} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
                        View Details
                      </button>
                      <button
                        onClick={() => handleViewInvoice(order.id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-100 transition-colors"
                        title="View E-Invoice"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                        </svg>
                        Invoice
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-2">
                    <OrderStatusActions order={order} onStatusChange={handleOrderStatusChange} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Invoice Loading Overlay */}
      {invoiceLoading && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl p-6 flex flex-col items-center gap-3 shadow-xl">
            <div className="w-8 h-8 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm text-gray-600 font-medium">Generating invoice...</p>
          </div>
        </div>
      )}

      {/* Invoice Preview Modal */}
      {selectedInvoice && (
        <EInvoiceView
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
        />
      )}

      {selectedOrder && (
        <OrderDetailsModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onStatusChange={handleOrderStatusChange}
        />
      )}
    </div>
  );
}

// ============ SUB-COMPONENTS ============

function EmptyState({ icon, message, subtext }: { icon: string; message: string; subtext: string }) {
  return (
    <div className="bg-white rounded-xl p-8 text-center border border-gray-200 shadow-sm">
      <span className="text-4xl mb-3 block">{icon}</span>
      <p className="text-gray-700 font-semibold">{message}</p>
      <p className="text-gray-400 text-sm mt-1">{subtext}</p>
    </div>
  );
}

/**
 * Allowed forward status transitions per current status.
 * "cancelled" is always offered while the order is still actionable.
 */
const ORDER_NEXT_STATUS: Record<string, Array<{ value: string; label: string; tone: 'primary' | 'success' | 'danger' | 'neutral' }>> = {
  pending: [
    { value: 'processing', label: 'Accept', tone: 'success' },
    { value: 'cancelled', label: 'Reject', tone: 'danger' },
  ],
  processing: [
    { value: 'preparing', label: 'Mark Preparing', tone: 'primary' },
    { value: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  preparing: [
    { value: 'ready', label: 'Mark Ready', tone: 'success' },
    { value: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  ready: [
    { value: 'out_for_delivery', label: 'Out for Delivery', tone: 'primary' },
    { value: 'completed', label: 'Complete', tone: 'success' },
  ],
  out_for_delivery: [
    { value: 'completed', label: 'Mark Delivered', tone: 'success' },
  ],
  bill_out: [
    { value: 'completed', label: 'Complete', tone: 'success' },
  ],
  completed: [],
  cancelled: [],
};

const ACTION_TONE_CLASS: Record<'primary' | 'success' | 'danger' | 'neutral', string> = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white',
  success: 'bg-green-600 hover:bg-green-700 text-white',
  danger: 'bg-red-100 hover:bg-red-200 text-red-700',
  neutral: 'bg-gray-100 hover:bg-gray-200 text-gray-700',
};

function OrderStatusActions({
  order,
  onStatusChange,
  readyEnabled = false,
}: {
  order: Order;
  readyEnabled?: boolean;
  onStatusChange?: (
    orderId: number,
    nextStatus: string,
    confirmMsg?: string,
  ) => void;
}) {
  if (!onStatusChange) return null;
  const next = ORDER_NEXT_STATUS[order.status] || [];
  if (next.length === 0) return null;
  return (
    <>
      {next.map((action) => (
        <button
          key={action.value}
          disabled={action.value === 'ready' && !readyEnabled}
          title={action.value === 'ready' && !readyEnabled ? 'Open order details and check every prepared item first' : undefined}
          onClick={() =>
            onStatusChange(
              order.id,
              action.value,
              action.value === 'cancelled'
                ? `Cancel order ${order.order_code}? This cannot be undone.`
                : undefined,
            )
          }
          className={`px-3 py-1.5 rounded-lg text-[10px] lg:text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 ${ACTION_TONE_CLASS[action.tone]}`}
        >
          {action.label}
        </button>
      ))}
    </>
  );
}

function OrderCard({
  order,
  onViewInvoice,
  onStatusChange,
  onViewDetails,
}: {
  order: Order;
  onViewInvoice?: (orderId: number) => void;
  onStatusChange?: (
    orderId: number,
    nextStatus: string,
    confirmMsg?: string,
  ) => void;
  onViewDetails?: (order: Order) => void;
}) {
  const statusColors: Record<string, string> = {
    pending: 'bg-orange-100 text-orange-800 border-orange-200',
    processing: 'bg-blue-100 text-blue-800 border-blue-200',
    preparing: 'bg-blue-100 text-blue-800 border-blue-200',
    ready: 'bg-green-100 text-green-800 border-green-200',
    out_for_delivery: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    bill_out: 'bg-purple-100 text-purple-800 border-purple-200',
    completed: 'bg-gray-100 text-gray-600 border-gray-200',
  };

  const orderTypeIcons: Record<string, string> = {
    delivery: '🚚',
    pickup: '🏪',
    dine_in: '🍽️',
    in_store: '🍽️',
  };

  return (
    <div className="bg-white rounded-xl p-3 lg:p-4 border border-gray-200 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm lg:text-base font-bold text-gray-900">{order.order_code}</h4>
            <span className={`px-2 py-0.5 rounded-full text-[10px] lg:text-xs font-semibold border ${statusColors[order.status] || 'bg-gray-100 text-gray-600'}`}>
              {order.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
            <span className="text-[10px] text-gray-400">{orderTypeIcons[order.order_type] || ''}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {order.customer_name} · {order.items_count} item{order.items_count === 1 ? '' : 's'} · {order.time_ago}
          </p>
          {/* Delivery Zone Info */}
          {order.order_type === 'delivery' && (order.customer_barangay || order.delivery_zone_name) && (
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {order.customer_barangay && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  </svg>
                  {order.customer_barangay}
                </span>
              )}
              {order.delivery_zone_name && (
                <span className="text-[10px] bg-gray-50 text-gray-500 px-2 py-0.5 rounded-full">
                  {order.delivery_zone_name}
                </span>
              )}
              {order.delivery_fee && order.delivery_fee > 0 && (
                <span className="text-[10px] text-green-600 font-semibold">
                  +₱{Number(order.delivery_fee).toFixed(0)} delivery
                </span>
              )}
            </div>
          )}
        </div>
        <div className="text-right flex-shrink-0 ml-2">
          <p className="text-base lg:text-lg font-bold text-gray-900">₱{Number(order.total_amount).toFixed(2)}</p>
          <div className="flex items-center gap-2 mt-1 justify-end">
            {onViewDetails && (
              <button onClick={() => onViewDetails(order)} className="rounded-md bg-red-600 px-2.5 py-1 text-[10px] font-semibold text-white transition hover:bg-red-700 lg:text-xs">
                View Details
              </button>
            )}
            {onViewInvoice && (
              <button
                onClick={() => onViewInvoice(order.id)}
                className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md text-[10px] lg:text-xs font-semibold hover:bg-blue-100 transition-colors"
                title="View E-Invoice"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                </svg>
                Invoice
              </button>
            )}
          </div>
        </div>
      </div>
      {/* Status action row */}
      {onStatusChange && (ORDER_NEXT_STATUS[order.status]?.length || 0) > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
          <OrderStatusActions order={order} onStatusChange={onStatusChange} />
        </div>
      )}
    </div>
  );
}

function OrderDetailsModal({
  order,
  onClose,
  onStatusChange,
}: {
  order: Order;
  onClose: () => void;
  onStatusChange: (orderId: number, nextStatus: string, confirmMsg?: string) => void;
}) {
  const canStartPreparing = order.status === 'pending' || order.status === 'processing';
  const [preparedItemIds, setPreparedItemIds] = useState<Set<number>>(new Set());
  useEffect(() => setPreparedItemIds(new Set()), [order.id, order.status]);
  const allItemsPrepared = order.items.length > 0 && order.items.every(item => preparedItemIds.has(item.id));
  const togglePrepared = (itemId: number) => {
    setPreparedItemIds(current => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="order-details-title">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-start justify-between border-b border-gray-200 bg-white p-5">
          <div><h2 id="order-details-title" className="text-xl font-black text-gray-900">Order {order.order_code}</h2><p className="mt-1 text-sm text-gray-500">{order.customer_name} · {order.items_count} item{order.items_count === 1 ? '' : 's'}</p></div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-500 hover:bg-gray-100" aria-label="Close order details">✕</button>
        </div>
        <div className="space-y-5 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-gray-50 p-3"><p className="text-[10px] font-bold uppercase text-gray-500">Fulfillment</p><p className="mt-1 font-semibold capitalize">{order.order_type.replaceAll('_', ' ')}</p></div>
            <div className="rounded-xl bg-gray-50 p-3"><p className="text-[10px] font-bold uppercase text-gray-500">Status</p><p className="mt-1 font-semibold capitalize">{order.status.replaceAll('_', ' ')}</p></div>
            <div className="rounded-xl bg-gray-50 p-3"><p className="text-[10px] font-bold uppercase text-gray-500">Order total</p><p className="mt-1 font-black">₱{Number(order.total_amount).toFixed(2)}</p></div>
          </div>
          {order.delivery_address && <div className="rounded-xl border border-blue-100 bg-blue-50 p-4"><p className="text-xs font-bold uppercase text-blue-700">Delivery address</p><p className="mt-1 text-sm text-blue-900">{order.delivery_address}</p></div>}
          <section><h3 className="mb-3 font-black text-gray-900">Items ordered</h3>{order.items.length === 0 ? <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">No item details were returned for this order.</div> : <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">{order.items.map(item => <label key={item.id} className={`flex items-center gap-4 p-4 transition-colors ${order.status === 'preparing' ? 'cursor-pointer' : ''} ${preparedItemIds.has(item.id) ? 'bg-green-50' : order.status === 'preparing' ? 'hover:bg-gray-50' : ''}`}>{order.status === 'preparing' && <input type="checkbox" checked={preparedItemIds.has(item.id)} onChange={() => togglePrepared(item.id)} className="size-5 shrink-0 accent-green-600" aria-label={`Mark ${item.product_name} as prepared`} />}<div className="min-w-0 flex-1"><p className={`font-semibold ${preparedItemIds.has(item.id) ? 'text-green-800 line-through' : 'text-gray-900'}`}>{item.product_name}</p><p className="mt-1 text-xs text-gray-500">₱{item.price.toFixed(2)} × {item.quantity}</p></div><p className="font-black text-gray-900">₱{item.subtotal.toFixed(2)}</p></label>)}</div>}</section>
        </div>
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-gray-200 bg-white p-5">
          {canStartPreparing && <button onClick={() => onStatusChange(order.id, 'preparing')} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700">Start Preparing Order</button>}
          {!canStartPreparing && <OrderStatusActions order={order} onStatusChange={onStatusChange} readyEnabled={allItemsPrepared} />}
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  );
}

function ReservationCard({
  reservation,
  onStatusChange,
}: {
  reservation: Reservation;
  onStatusChange?: (reservationId: number, nextStatus: string) => void;
}) {
  const statusColors: Record<string, string> = {
    pending: 'bg-orange-500',
    confirmed: 'bg-green-500',
    checked_in: 'bg-blue-500',
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  return (
    <div className="bg-white rounded-xl p-3 lg:p-4 border border-gray-200 shadow-sm hover:shadow-md transition-all">
      <div className="flex items-start gap-3">
        {/* Status Indicator */}
        <div className={`w-2 h-full min-h-[48px] rounded-full ${statusColors[reservation.status] || 'bg-gray-400'}`}></div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm lg:text-base font-bold text-gray-900">{reservation.reservation_code}</h4>
              <p className="text-xs text-gray-500">{reservation.customer_name}</p>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[10px] lg:text-xs font-semibold text-white ${statusColors[reservation.status] || 'bg-gray-400'}`}>
              {reservation.status.charAt(0).toUpperCase() + reservation.status.slice(1)}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {formatDate(reservation.reservation_date)}
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {formatTime(reservation.reservation_time)}
            </span>
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              {reservation.number_of_guests} guests
            </span>
            {reservation.table_number && (
              <span className="flex items-center gap-1">
                Table #{reservation.table_number}
              </span>
            )}
          </div>
          {onStatusChange && reservation.status === 'pending' && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => onStatusChange(reservation.id, 'confirmed')}
                className="px-3 py-1 bg-green-600 text-white rounded-lg text-[10px] lg:text-xs font-semibold hover:bg-green-700 transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => onStatusChange(reservation.id, 'cancelled')}
                className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-[10px] lg:text-xs font-semibold hover:bg-red-200 transition-colors"
              >
                Decline
              </button>
            </div>
          )}
          {onStatusChange && reservation.status === 'confirmed' && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => onStatusChange(reservation.id, 'checked_in')}
                className="px-3 py-1 bg-blue-600 text-white rounded-lg text-[10px] lg:text-xs font-semibold hover:bg-blue-700 transition-colors"
              >
                Check-in
              </button>
              <button
                onClick={() => onStatusChange(reservation.id, 'cancelled')}
                className="px-3 py-1 bg-red-100 text-red-700 rounded-lg text-[10px] lg:text-xs font-semibold hover:bg-red-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
          {onStatusChange && reservation.status === 'checked_in' && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => onStatusChange(reservation.id, 'completed')}
                className="px-3 py-1 bg-green-600 text-white rounded-lg text-[10px] lg:text-xs font-semibold hover:bg-green-700 transition-colors"
              >
                Mark Complete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
