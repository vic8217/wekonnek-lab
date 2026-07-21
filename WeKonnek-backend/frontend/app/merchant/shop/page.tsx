'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';
import Link from 'next/link';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ─── Types ───────────────────────────────────────────────

interface ShopInfo {
  id: number;
  name: string;
  logo_url: string | null;
  rating: number;
  followers: number;
  status: 'active' | 'under_review' | 'suspended';
  description: string;
  slug: string;
  response_rate: number;
  total_sales: number;
}

interface Product {
  id: number;
  name: string;
  price: number;
  stock: number;
  status: 'active' | 'draft' | 'out_of_stock';
  category: string;
  sales: number;
  image_url: string | null;
}

interface ShopOrder {
  id: number;
  order_code: string;
  buyer_name: string;
  items: string[];
  total: number;
  status: 'to_ship' | 'shipping' | 'delivered' | 'returned';
  created_at: string;
}

interface ShopSettings {
  description: string;
  categories: string[];
  free_shipping_threshold: number;
  shipping_fee: number;
  estimated_delivery_days: number;
  return_policy: '7_days' | '15_days' | '30_days' | 'no_returns';
  auto_reply: string;
}

type Tab = 'products' | 'orders' | 'settings';
type ProductView = 'grid' | 'list';
type ProductStatusFilter = 'all' | 'active' | 'draft' | 'out_of_stock';

// ─── Mock Data ───────────────────────────────────────────

const MOCK_SHOP: ShopInfo = {
  id: 1,
  name: 'Maranao Crafts & Goods',
  logo_url: null,
  rating: 4.8,
  followers: 1243,
  status: 'active',
  description: 'Authentic Filipino handcrafted goods from Mindanao. Weaving heritage into every product.',
  slug: 'maranao-crafts',
  response_rate: 96,
  total_sales: 3847,
};

const MOCK_PRODUCTS: Product[] = [
  { id: 1, name: 'Malong Scarf – Rainbow Weave', price: 1250, stock: 45, status: 'active', category: 'Textiles', sales: 312, image_url: null },
  { id: 2, name: 'Capiz Shell Lamp – Hanging', price: 2890, stock: 12, status: 'active', category: 'Home Decor', sales: 87, image_url: null },
  { id: 3, name: 'Barong Tagalog – Jusi Fabric', price: 3450, stock: 8, status: 'active', category: 'Apparel', sales: 156, image_url: null },
  { id: 4, name: 'Banig Mat – Queen Size', price: 1800, stock: 0, status: 'out_of_stock', category: 'Home Decor', sales: 204, image_url: null },
  { id: 5, name: 'Tinalak Clutch Bag', price: 980, stock: 30, status: 'active', category: 'Accessories', sales: 445, image_url: null },
  { id: 6, name: 'Wooden Sarimanok Figure', price: 1650, stock: 5, status: 'active', category: 'Home Decor', sales: 93, image_url: null },
  { id: 7, name: 'Pandan Basket – Large', price: 750, stock: 22, status: 'draft', category: 'Home Decor', sales: 0, image_url: null },
  { id: 8, name: 'Inabel Blanket – Heritage Pattern', price: 2200, stock: 15, status: 'active', category: 'Textiles', sales: 178, image_url: null },
];

const MOCK_ORDERS: ShopOrder[] = [
  { id: 101, order_code: 'WK-SH-20250629-001', buyer_name: 'Maria Santos', items: ['Malong Scarf – Rainbow Weave', 'Tinalak Clutch Bag'], total: 2230, status: 'to_ship', created_at: '2025-06-29T08:30:00Z' },
  { id: 102, order_code: 'WK-SH-20250628-045', buyer_name: 'Juan Dela Cruz', items: ['Barong Tagalog – Jusi Fabric'], total: 3450, status: 'shipping', created_at: '2025-06-28T14:20:00Z' },
  { id: 103, order_code: 'WK-SH-20250627-112', buyer_name: 'Fatima Macarambon', items: ['Capiz Shell Lamp – Hanging', 'Wooden Sarimanok Figure'], total: 4540, status: 'delivered', created_at: '2025-06-27T09:15:00Z' },
  { id: 104, order_code: 'WK-SH-20250626-087', buyer_name: 'Carlos Reyes', items: ['Inabel Blanket – Heritage Pattern'], total: 2200, status: 'delivered', created_at: '2025-06-26T11:45:00Z' },
  { id: 105, order_code: 'WK-SH-20250625-033', buyer_name: 'Aisha Pangandaman', items: ['Banig Mat – Queen Size'], total: 1800, status: 'returned', created_at: '2025-06-25T16:00:00Z' },
];

const ALL_CATEGORIES = ['Textiles', 'Home Decor', 'Apparel', 'Accessories', 'Food & Delicacies', 'Health & Beauty', 'Electronics'];

const INITIAL_SETTINGS: ShopSettings = {
  description: MOCK_SHOP.description,
  categories: ['Textiles', 'Home Decor', 'Apparel', 'Accessories'],
  free_shipping_threshold: 2000,
  shipping_fee: 120,
  estimated_delivery_days: 5,
  return_policy: '15_days',
  auto_reply: 'Salamat po sa pagbili! We will process your order within 24 hours. Message us for any concerns.',
};

// ─── Main Component ──────────────────────────────────────

export default function MerchantShopPage() {
  const [shop, setShop] = useState<ShopInfo>(MOCK_SHOP);
  const [products, setProducts] = useState<Product[]>(MOCK_PRODUCTS);
  const [orders] = useState<ShopOrder[]>(MOCK_ORDERS);
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<Tab>('products');
  const [productView, setProductView] = useState<ProductView>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<ProductStatusFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [settings, setSettings] = useState<ShopSettings>(INITIAL_SETTINGS);
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    const fetchShop = async () => {
      try {
        const token = getToken();
        if (!token) { setLoading(false); return; }
        const res = await fetch(`${API}/api/merchants/me/shop`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data) setShop(data);
        }
      } catch {
        // fall back to mock data
      } finally {
        setLoading(false);
      }
    };
    fetchShop();
  }, []);

  // ─── Product Filtering ──────────────────────────────────

  const filteredProducts = products.filter((p) => {
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false;
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    return true;
  });

  const uniqueCategories = [...new Set(products.map((p) => p.category))];

  // ─── Selection helpers ──────────────────────────────────

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredProducts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProducts.map((p) => p.id)));
    }
  };

  const bulkDeactivate = () => {
    setProducts((prev) =>
      prev.map((p) => (selectedIds.has(p.id) ? { ...p, status: 'draft' as const } : p)),
    );
    setSelectedIds(new Set());
    toast.success(`${selectedIds.size} product(s) deactivated`);
  };

  const bulkDelete = () => {
    if (!window.confirm(`Delete ${selectedIds.size} product(s)? This cannot be undone.`)) return;
    setProducts((prev) => prev.filter((p) => !selectedIds.has(p.id)));
    toast.success(`${selectedIds.size} product(s) deleted`);
    setSelectedIds(new Set());
  };

  // ─── Settings helpers ───────────────────────────────────

  const toggleCategory = (cat: string) => {
    setSettings((prev) => ({
      ...prev,
      categories: prev.categories.includes(cat)
        ? prev.categories.filter((c) => c !== cat)
        : [...prev.categories, cat],
    }));
  };

  const saveSettings = async () => {
    try {
      const token = getToken();
      if (!token) {
        toast.error('Please log in to save settings');
        return;
      }

      const meRes = await fetch(`${API}/api/merchants/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!meRes.ok) throw new Error('Could not fetch merchant profile');
      const meData = await meRes.json();
      const merchantId = meData?.id;
      if (!merchantId) throw new Error('Merchant ID not found');

      const res = await fetch(`${API}/api/merchants/${merchantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          description: settings.description,
          categories: settings.categories,
          free_shipping_threshold: settings.free_shipping_threshold,
          shipping_fee: settings.shipping_fee,
          estimated_delivery_days: settings.estimated_delivery_days,
          return_policy: settings.return_policy,
          auto_reply: settings.auto_reply,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to save settings');
      }

      toast.success('Shop settings saved!');
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2500);
    } catch (error: any) {
      console.error('Error saving settings:', error);
      toast.error(error.message || 'Failed to save settings');
    }
  };

  // ─── Status helpers ─────────────────────────────────────

  const statusBadge = (s: ShopInfo['status']) => {
    const map: Record<string, string> = {
      active: 'bg-green-100 text-green-800',
      under_review: 'bg-yellow-100 text-yellow-800',
      suspended: 'bg-red-100 text-red-800',
    };
    const labels: Record<string, string> = {
      active: 'Active',
      under_review: 'Under Review',
      suspended: 'Suspended',
    };
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[s] || 'bg-gray-100 text-gray-700'}`}>
        {labels[s] || s}
      </span>
    );
  };

  const productStatusBadge = (s: Product['status']) => {
    const map: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      draft: 'bg-gray-100 text-gray-600',
      out_of_stock: 'bg-red-100 text-red-700',
    };
    const labels: Record<string, string> = {
      active: 'Active',
      draft: 'Draft',
      out_of_stock: 'Out of Stock',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] lg:text-xs font-semibold ${map[s]}`}>
        {labels[s]}
      </span>
    );
  };

  const orderStatusBadge = (s: ShopOrder['status']) => {
    const map: Record<string, string> = {
      to_ship: 'bg-orange-100 text-orange-800',
      shipping: 'bg-blue-100 text-blue-800',
      delivered: 'bg-green-100 text-green-800',
      returned: 'bg-red-100 text-red-800',
    };
    const labels: Record<string, string> = {
      to_ship: 'To Ship',
      shipping: 'Shipping',
      delivered: 'Delivered',
      returned: 'Returned',
    };
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${map[s]}`}>
        {labels[s]}
      </span>
    );
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // ─── Loading ────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading shop…</p>
        </div>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* ═══ SHOP HEADER / BANNER ═══ */}
      <div className="bg-gradient-to-r from-[#DB0002] to-[#A30001] rounded-xl p-4 lg:p-6 text-white shadow-lg">
        <div className="flex items-start gap-4">
          {/* Logo */}
          {shop.logo_url ? (
            <img src={shop.logo_url} alt={shop.name} className="w-16 h-16 lg:w-20 lg:h-20 rounded-xl border-2 border-white/40 object-cover flex-shrink-0" />
          ) : (
            <div className="w-16 h-16 lg:w-20 lg:h-20 bg-white/20 rounded-xl flex items-center justify-center text-2xl lg:text-3xl font-bold flex-shrink-0">
              {shop.name.charAt(0)}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg lg:text-2xl font-bold truncate">{shop.name}</h1>
              {statusBadge(shop.status)}
            </div>
            <p className="text-white/70 text-xs lg:text-sm mt-0.5 truncate">wekonnek.com/shop/{shop.slug}</p>

            <div className="flex items-center gap-3 mt-2 flex-wrap text-xs lg:text-sm">
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4 text-yellow-300" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                {shop.rating.toFixed(1)}
              </span>
              <span className="text-white/60">|</span>
              <span>{shop.followers.toLocaleString()} followers</span>
            </div>
          </div>

          <Link
            href="/merchant/profile"
            className="hidden sm:flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white px-3 py-2 rounded-lg text-xs lg:text-sm font-medium transition-colors flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            Edit Shop
          </Link>
        </div>
      </div>

      {/* ═══ STATS ROW ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3">
        {[
          { label: 'Total Products', value: products.length, icon: '📦' },
          { label: 'Total Sales', value: shop.total_sales.toLocaleString(), icon: '🛒' },
          { label: 'Shop Rating', value: shop.rating.toFixed(1), icon: '⭐' },
          { label: 'Response Rate', value: `${shop.response_rate}%`, icon: '💬' },
          { label: 'Followers', value: shop.followers.toLocaleString(), icon: '👥' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl p-3 lg:p-4 border border-gray-200 shadow-sm text-center">
            <p className="text-xl lg:text-2xl mb-0.5">{stat.icon}</p>
            <p className="text-lg lg:text-xl font-bold text-gray-900">{stat.value}</p>
            <p className="text-[10px] lg:text-xs text-gray-500 font-medium uppercase tracking-wide">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* ═══ TABS ═══ */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="flex border-b border-gray-200">
          {([
            { key: 'products' as Tab, label: 'Products' },
            { key: 'orders' as Tab, label: 'Orders' },
            { key: 'settings' as Tab, label: 'Shop Settings' },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 sm:flex-none px-4 lg:px-6 py-3 text-sm font-semibold transition-colors ${
                activeTab === tab.key
                  ? 'text-[#DB0002] border-b-2 border-[#DB0002]'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ═══ PRODUCTS TAB ═══ */}
        {activeTab === 'products' && (
          <div className="p-4 lg:p-6 space-y-4">
            {/* Search + Filter Bar */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input
                  type="text"
                  placeholder="Search products…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30"
              >
                <option value="all">All Categories</option>
                {uniqueCategories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as ProductStatusFilter)}
                className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="out_of_stock">Out of Stock</option>
              </select>

              {/* View toggle */}
              <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                <button
                  onClick={() => setProductView('grid')}
                  className={`px-3 py-2 ${productView === 'grid' ? 'bg-[#DB0002] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  title="Grid view"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                </button>
                <button
                  onClick={() => setProductView('list')}
                  className={`px-3 py-2 ${productView === 'list' ? 'bg-[#DB0002] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  title="List view"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                </button>
              </div>
            </div>

            {/* Bulk actions + Add Product */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filteredProducts.length > 0 && selectedIds.size === filteredProducts.length}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-gray-300 text-[#DB0002] focus:ring-[#DB0002]"
                  />
                  Select All
                </label>
                {selectedIds.size > 0 && (
                  <>
                    <span className="text-xs text-gray-400">|</span>
                    <span className="text-xs text-gray-500">{selectedIds.size} selected</span>
                    <button onClick={bulkDeactivate} className="px-3 py-1.5 bg-yellow-50 text-yellow-700 rounded-lg text-xs font-medium hover:bg-yellow-100 transition-colors">
                      Deactivate
                    </button>
                    <button onClick={bulkDelete} className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors">
                      Delete
                    </button>
                  </>
                )}
              </div>
              <Link
                href="/merchant/products/new"
                className="flex items-center gap-1.5 bg-[#DB0002] text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#B80002] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Add Product
              </Link>
            </div>

            {/* Product Grid */}
            {filteredProducts.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-4xl mb-2">📦</p>
                <p className="text-gray-600 font-semibold">No products found</p>
                <p className="text-gray-400 text-sm mt-1">Try adjusting your filters or add a new product</p>
              </div>
            ) : productView === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 lg:gap-4">
                {filteredProducts.map((p) => (
                  <div key={p.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow group">
                    {/* Image / Placeholder */}
                    <div className="relative aspect-square bg-gray-100 flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="absolute top-2 left-2 w-4 h-4 rounded border-gray-300 text-[#DB0002] focus:ring-[#DB0002] z-10"
                      />
                      {p.image_url ? (
                        <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="text-4xl text-gray-300 group-hover:scale-110 transition-transform">
                          {p.category === 'Textiles' ? '🧣' : p.category === 'Apparel' ? '👔' : p.category === 'Accessories' ? '👜' : '🏠'}
                        </div>
                      )}
                      <div className="absolute top-2 right-2">{productStatusBadge(p.status)}</div>
                    </div>
                    <div className="p-3">
                      <h3 className="text-sm font-semibold text-gray-900 truncate">{p.name}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{p.category}</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-base font-bold text-[#DB0002]">₱{p.price.toLocaleString()}</span>
                        <span className="text-[10px] text-gray-400">Stock: {p.stock}</span>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1">{p.sales} sold</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* List View */
              <div className="space-y-2">
                {filteredProducts.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 bg-white border border-gray-200 rounded-lg p-3 hover:shadow-sm transition-shadow">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      className="w-4 h-4 rounded border-gray-300 text-[#DB0002] focus:ring-[#DB0002] flex-shrink-0"
                    />
                    <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 text-xl">
                      {p.category === 'Textiles' ? '🧣' : p.category === 'Apparel' ? '👔' : p.category === 'Accessories' ? '👜' : '🏠'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-900 truncate">{p.name}</h3>
                        {productStatusBadge(p.status)}
                      </div>
                      <p className="text-xs text-gray-500">{p.category} · {p.sales} sold</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-[#DB0002]">₱{p.price.toLocaleString()}</p>
                      <p className="text-[10px] text-gray-400">Stock: {p.stock}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ ORDERS TAB ═══ */}
        {activeTab === 'orders' && (
          <div className="p-4 lg:p-6 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base lg:text-lg font-bold text-gray-900">Recent Marketplace Orders</h2>
              <span className="text-xs text-gray-400">{orders.length} orders</span>
            </div>

            {orders.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-4xl mb-2">🛒</p>
                <p className="text-gray-600 font-semibold">No orders yet</p>
                <p className="text-gray-400 text-sm mt-1">Marketplace orders will appear here</p>
              </div>
            ) : (
              <div className="space-y-3">
                {orders.map((o) => (
                  <div key={o.id} className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-bold text-gray-900">{o.order_code}</h3>
                          {orderStatusBadge(o.status)}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          <span className="font-medium text-gray-700">{o.buyer_name}</span>
                          <span className="mx-1">·</span>
                          {formatDate(o.created_at)}
                        </p>
                        <div className="mt-2 space-y-0.5">
                          {o.items.map((item, i) => (
                            <p key={i} className="text-xs text-gray-600 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 bg-gray-300 rounded-full flex-shrink-0" />
                              {item}
                            </p>
                          ))}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-base font-bold text-gray-900">₱{o.total.toLocaleString()}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                      {o.status === 'to_ship' && (
                        <button className="px-4 py-1.5 bg-[#DB0002] text-white rounded-lg text-xs font-semibold hover:bg-[#B80002] transition-colors">
                          Ship Order
                        </button>
                      )}
                      <button className="px-4 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors">
                        View Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ SETTINGS TAB ═══ */}
        {activeTab === 'settings' && (
          <div className="p-4 lg:p-6 space-y-6">
            {/* Shop Description */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Shop Description</label>
              <textarea
                rows={4}
                value={settings.description}
                onChange={(e) => setSettings((s) => ({ ...s, description: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002] resize-none"
                placeholder="Tell customers about your shop…"
              />
            </div>

            {/* Shop Categories */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Shop Categories</label>
              <div className="flex flex-wrap gap-2">
                {ALL_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      settings.categories.includes(cat)
                        ? 'bg-[#DB0002] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Shipping Settings */}
            <div className="bg-gray-50 rounded-xl p-4 lg:p-5 space-y-4">
              <h3 className="text-sm font-bold text-gray-800">Shipping Settings</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Free Shipping Threshold (₱)</label>
                  <input
                    type="number"
                    value={settings.free_shipping_threshold}
                    onChange={(e) => setSettings((s) => ({ ...s, free_shipping_threshold: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Shipping Fee (₱)</label>
                  <input
                    type="number"
                    value={settings.shipping_fee}
                    onChange={(e) => setSettings((s) => ({ ...s, shipping_fee: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Est. Delivery (days)</label>
                  <input
                    type="number"
                    value={settings.estimated_delivery_days}
                    onChange={(e) => setSettings((s) => ({ ...s, estimated_delivery_days: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
                  />
                </div>
              </div>
            </div>

            {/* Return Policy */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Return Policy</label>
              <select
                value={settings.return_policy}
                onChange={(e) => setSettings((s) => ({ ...s, return_policy: e.target.value as ShopSettings['return_policy'] }))}
                className="w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
              >
                <option value="7_days">7 Days</option>
                <option value="15_days">15 Days</option>
                <option value="30_days">30 Days</option>
                <option value="no_returns">No Returns</option>
              </select>
            </div>

            {/* Auto-Reply */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Auto-Reply Message</label>
              <textarea
                rows={3}
                value={settings.auto_reply}
                onChange={(e) => setSettings((s) => ({ ...s, auto_reply: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002] resize-none"
                placeholder="Automatic reply when a buyer messages your shop…"
              />
            </div>

            {/* Save */}
            <div className="flex items-center gap-3">
              <button
                onClick={saveSettings}
                className="px-6 py-2.5 bg-[#DB0002] text-white rounded-lg text-sm font-semibold hover:bg-[#B80002] transition-colors"
              >
                Save Settings
              </button>
              {settingsSaved && (
                <span className="text-sm text-green-600 font-medium animate-pulse">Settings saved!</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
