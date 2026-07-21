'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Order {
  id: number;
  order_code: string;
  user_id: string;
  merchant_id: number;
  status: string;
  total_amount: number;
  delivery_address: string;
  delivery_fee: number;
  table_number: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  customer_name: string;
  merchant_name: string;
  item_count: number;
}

interface MerchantOption {
  id: number;
  name: string;
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<any[]>([]);
  const [merchantFilter, setMerchantFilter] = useState<string>('all');
  const [merchantOptions, setMerchantOptions] = useState<MerchantOption[]>([]);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const itemsPerPage = 15;

  useEffect(() => {
    fetchOrders();
    fetchMerchantOptions();

    const interval = setInterval(() => {
      fetchOrders();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchMerchantOptions = async () => {
    const token = getToken();
    const res = await fetch(`${API}/api/merchants`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      const list = Array.isArray(data) ? data : data.data || [];
      setMerchantOptions(list.map((m: any) => ({ id: m.id, name: m.name })));
    }
  };

  const fetchOrders = async () => {
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/orders?admin=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch orders');
      const data = await res.json();
      const ordersArr = Array.isArray(data) ? data : data.data || [];

      const transformedOrders: Order[] = ordersArr.map((o: any) => ({
        id: o.id,
        order_code: o.order_code || o.orderCode,
        user_id: o.user_id || o.userId,
        merchant_id: o.merchant_id || o.merchantId,
        status: o.status,
        total_amount: o.total_amount || o.totalAmount,
        delivery_address: o.delivery_address || o.deliveryAddress,
        delivery_fee: o.delivery_fee || o.deliveryFee,
        table_number: o.table_number || o.tableNumber,
        notes: o.notes,
        created_at: o.created_at || o.createdAt,
        updated_at: o.updated_at || o.updatedAt,
        customer_name: o.customer_name || o.customerName || `${o.users?.first_name || o.user?.firstName || ''} ${o.users?.last_name || o.user?.lastName || ''}`.trim() || 'Unknown',
        merchant_name: o.merchant_name || o.merchantName || o.merchants?.name || o.merchant?.name || 'Unknown',
        item_count: o.item_count || o.itemCount || o.order_items?.length || o.orderItems?.length || 0,
      }));

      setOrders(transformedOrders);
    } catch (error) {
      console.error('Error fetching orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrderItems = async (orderId: number) => {
    const token = getToken();
    const res = await fetch(`${API}/api/orders/${orderId}/items`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setOrderItems(Array.isArray(data) ? data : data.data || []);
    }
  };

  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);

  const updateOrderStatus = async (orderId: number, newStatus: string) => {
    try {
      setUpdatingOrderId(orderId);
      const token = getToken();
      const res = await fetch(`${API}/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update order status');
      toast.success('Order status updated');
      fetchOrders();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(prev => prev ? { ...prev, status: newStatus } : null);
      }
    } catch (error) {
      console.error('Error updating order:', error);
      toast.error('Failed to update order status');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      preparing: 'bg-indigo-100 text-indigo-800',
      ready: 'bg-purple-100 text-purple-800',
      out_for_delivery: 'bg-cyan-100 text-cyan-800',
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      bill_out: 'bg-orange-100 text-orange-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  // Stats
  const stats = {
    total: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    processing: orders.filter(o => ['processing', 'preparing'].includes(o.status)).length,
    completed: orders.filter(o => o.status === 'completed').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length,
    revenue: orders.filter(o => o.status === 'completed').reduce((sum, o) => sum + o.total_amount, 0),
  };

  // Filtering and search
  const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
  const toTs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;

  const filteredOrders = orders
    .filter(o => statusFilter === 'all' || o.status === statusFilter)
    .filter(o => merchantFilter === 'all' || String(o.merchant_id) === merchantFilter)
    .filter(o => {
      if (!fromTs && !toTs) return true;
      const created = new Date(o.created_at).getTime();
      if (fromTs && created < fromTs) return false;
      if (toTs && created > toTs) return false;
      return true;
    })
    .filter(o =>
      searchQuery === '' ||
      o.order_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.merchant_name.toLowerCase().includes(searchQuery.toLowerCase())
    );

  const clearFilters = () => {
    setStatusFilter('all');
    setMerchantFilter('all');
    setDateFrom('');
    setDateTo('');
    setSearchQuery('');
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const paginatedOrders = filteredOrders.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-12 h-12 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Order Monitoring</h1>
        <p className="text-gray-600">Track and manage all orders across the platform</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Total Orders</p>
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Pending</p>
          <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Processing</p>
          <p className="text-2xl font-bold text-blue-600">{stats.processing}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Completed</p>
          <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Cancelled</p>
          <p className="text-2xl font-bold text-red-600">{stats.cancelled}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Revenue</p>
          <p className="text-2xl font-bold text-green-600">₱{stats.revenue.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200 space-y-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              placeholder="Search by order code, customer, or merchant..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
            />
          </div>
          <select
            value={merchantFilter}
            onChange={(e) => { setMerchantFilter(e.target.value); setCurrentPage(1); }}
            className="w-full md:w-auto md:min-w-[200px] px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
            title="Filter by merchant"
          >
            <option value="all">All merchants</option>
            {merchantOptions.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {m.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setCurrentPage(1); }}
              max={dateTo || undefined}
              className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              title="From date"
              aria-label="From date"
            />
            <span className="text-gray-400 text-sm">→</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setCurrentPage(1); }}
              min={dateFrom || undefined}
              className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              title="To date"
              aria-label="To date"
            />
          </div>
          {(statusFilter !== 'all' || merchantFilter !== 'all' || dateFrom || dateTo || searchQuery) && (
            <button
              onClick={clearFilters}
              className="px-3 py-2.5 text-sm font-medium text-[#DB0002] hover:bg-red-50 rounded-lg"
            >
              Reset
            </button>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {['all', 'pending', 'processing', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled', 'bill_out'].map((status) => (
            <button
              key={status}
              onClick={() => { setStatusFilter(status); setCurrentPage(1); }}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
                statusFilter === status
                  ? 'bg-[#DB0002] text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {status === 'all' ? 'All' : status.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#DB0002] text-white">
                <th className="px-4 py-3 text-left font-semibold text-sm">Order Code</th>
                <th className="px-4 py-3 text-left font-semibold text-sm">Customer</th>
                <th className="px-4 py-3 text-left font-semibold text-sm">Merchant</th>
                <th className="px-4 py-3 text-left font-semibold text-sm">Items</th>
                <th className="px-4 py-3 text-left font-semibold text-sm">Total</th>
                <th className="px-4 py-3 text-left font-semibold text-sm">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-sm">Date</th>
                <th className="px-4 py-3 text-left font-semibold text-sm">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    No orders found
                  </td>
                </tr>
              ) : (
                paginatedOrders.map((order) => (
                  <tr key={order.id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-sm font-medium text-gray-900">{order.order_code}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{order.customer_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{order.merchant_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{order.item_count}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">₱{Number(order.total_amount).toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(order.status)}`}>
                        {order.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(order.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { setSelectedOrder(order); fetchOrderItems(order.id); }}
                        className="text-[#DB0002] hover:underline text-sm font-medium"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-gray-200 flex justify-between items-center">
            <p className="text-sm text-gray-500">
              Showing {(currentPage - 1) * itemsPerPage + 1}-{Math.min(currentPage * itemsPerPage, filteredOrders.length)} of {filteredOrders.length}
            </p>
            <div className="flex gap-1">
              <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50 hover:bg-gray-100">Previous</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const page = currentPage <= 3 ? i + 1 : currentPage + i - 2;
                if (page > totalPages || page < 1) return null;
                return (
                  <button key={page} onClick={() => setCurrentPage(page)}
                    className={`px-3 py-1.5 rounded text-sm ${currentPage === page ? 'bg-[#DB0002] text-white' : 'border border-gray-300 hover:bg-gray-100'}`}>
                    {page}
                  </button>
                );
              })}
              <button onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50 hover:bg-gray-100">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Order {selectedOrder.order_code}</h3>
                <p className="text-sm text-gray-500">
                  {new Date(selectedOrder.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="p-2 hover:bg-gray-100 rounded-lg" title="Close">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-6">
              {/* Status */}
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-600">Status:</span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${getStatusColor(selectedOrder.status)}`}>
                  {selectedOrder.status.replace(/_/g, ' ')}
                </span>
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Customer</p>
                  <p className="font-medium text-gray-900">{selectedOrder.customer_name}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Merchant</p>
                  <p className="font-medium text-gray-900">{selectedOrder.merchant_name}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Total Amount</p>
                  <p className="font-bold text-gray-900 text-lg">₱{Number(selectedOrder.total_amount).toFixed(2)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Delivery Fee</p>
                  <p className="font-medium text-gray-900">₱{Number(selectedOrder.delivery_fee ?? 0).toFixed(2)}</p>
                </div>
                {selectedOrder.table_number && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-xs text-gray-500 mb-1">Table Number</p>
                    <p className="font-medium text-gray-900">{selectedOrder.table_number}</p>
                  </div>
                )}
                {selectedOrder.delivery_address && (
                  <div className="bg-gray-50 rounded-lg p-4 col-span-2">
                    <p className="text-xs text-gray-500 mb-1">Delivery Address</p>
                    <p className="font-medium text-gray-900">{selectedOrder.delivery_address}</p>
                  </div>
                )}
              </div>

              {/* Order Items */}
              <div>
                <h4 className="font-semibold text-gray-900 mb-3">Order Items</h4>
                {orderItems.length === 0 ? (
                  <p className="text-gray-500 text-sm">No items found</p>
                ) : (
                  <div className="space-y-2">
                    {orderItems.map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
                        <div>
                          <p className="font-medium text-gray-900">{item.product_name}</p>
                          <p className="text-sm text-gray-500">Qty: {item.quantity}</p>
                        </div>
                        <p className="font-medium text-gray-900">₱{Number(item.subtotal ?? 0).toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Notes */}
              {selectedOrder.notes && (
                <div>
                  <h4 className="font-semibold text-gray-900 mb-2">Notes</h4>
                  <p className="text-gray-600 text-sm bg-gray-50 rounded-lg p-3">{selectedOrder.notes}</p>
                </div>
              )}

              {/* Status Actions */}
              <div>
                <h4 className="font-semibold text-gray-900 mb-3">Update Status</h4>
                <div className="flex gap-2 flex-wrap">
                  {['pending', 'processing', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled', 'bill_out'].map((status) => (
                    <button
                      key={status}
                      onClick={() => updateOrderStatus(selectedOrder.id, status)}
                      disabled={selectedOrder.status === status || updatingOrderId === selectedOrder.id}
                      className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-colors ${
                        selectedOrder.status === status
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : updatingOrderId === selectedOrder.id
                          ? 'bg-gray-200 text-gray-400 cursor-wait'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {status.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
