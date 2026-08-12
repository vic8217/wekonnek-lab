'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';
import { publicAssetUrl } from '@/lib/public-asset-url';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type DiscountType = 'percentage' | 'fixed' | 'bogo' | 'flash_sale' | 'bundle';
type PromoStatus = 'active' | 'scheduled' | 'expired';

interface Promotion {
  id: number;
  title: string;
  description: string;
  discount_type: DiscountType;
  discount_value: number;
  min_order_amount: number;
  start_date: string | null;
  end_date: string | null;
  status: PromoStatus;
  views: number;
  claims: number;
  vouchers_to_issue: number;
  redemptions: number;
  applicable_categories: string[];
  applies_to_total_bill?: boolean;
  category_ids?: number[];
  bundle_items?: Array<{ productId: number; productName: string; quantity: number }>;
  bundle_price?: number;
}

interface MerchantProduct {
  id: number;
  name: string;
  categoryId?: number;
  category?: { id: number; name: string };
}

interface MerchantBrand {
  name: string;
  logoUrl?: string;
  coverImageUrl?: string;
}

const DISCOUNT_TYPE_LABELS: Record<DiscountType, { label: string; color: string }> = {
  percentage: { label: '% OFF', color: 'bg-orange-100 text-orange-800' },
  fixed: { label: 'FIXED', color: 'bg-blue-100 text-blue-800' },
  bogo: { label: 'BOGO', color: 'bg-purple-100 text-purple-800' },
  flash_sale: { label: 'FLASH SALE', color: 'bg-red-100 text-red-800' },
  bundle: { label: 'BUNDLE', color: 'bg-purple-100 text-purple-800' },
};

const STATUS_COLORS: Record<PromoStatus, string> = {
  active: 'bg-green-100 text-green-800',
  scheduled: 'bg-blue-100 text-blue-800',
  expired: 'bg-gray-100 text-gray-600',
};

export default function MerchantPromotionsPage() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<'all' | PromoStatus>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [actionMenuId, setActionMenuId] = useState<number | null>(null);
  const [noExpiration, setNoExpiration] = useState(false);
  const [merchantProducts, setMerchantProducts] = useState<MerchantProduct[]>([]);
  const [merchantBrand, setMerchantBrand] = useState<MerchantBrand | null>(null);

  const [form, setForm] = useState({
    title: '',
    description: '',
    discount_type: 'percentage' as DiscountType,
    discount_value: 0,
    min_order_amount: 0,
    start_date: '',
    end_date: '',
    applicable_categories: '',
    vouchers_to_issue: 1,
    applies_to_total_bill: true,
    category_ids: [] as number[],
    bundle_items: [] as Array<{ productId: number; productName: string; quantity: number }>,
    bundle_price: 0,
  });

  useEffect(() => {
    fetchPromotions();
    const loadProducts = async () => {
      const token = getToken();
      if (!token) return;
      const merchantResponse = await fetch(`${API}/api/merchants/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!merchantResponse.ok) return;
      const merchant = await merchantResponse.json();
      setMerchantBrand({
        name: merchant.name || 'Merchant',
        logoUrl: publicAssetUrl(merchant.logoUrl || merchant.logo_url),
        coverImageUrl: publicAssetUrl(merchant.coverImageUrl || merchant.cover_image_url),
      });
      const response = await fetch(`${API}/api/products?merchantId=${merchant.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return;
      const body = await response.json();
      setMerchantProducts(Array.isArray(body) ? body : body.data || []);
    };
    loadProducts().catch(() => toast.error('Unable to load merchant categories and products'));
  }, []);

  const merchantCategories = Array.from(
    new Map(
      merchantProducts
        .filter(product => product.category?.id || product.categoryId)
        .map(product => [product.category?.id || product.categoryId!, { id: product.category?.id || product.categoryId!, name: product.category?.name || 'Uncategorized' }]),
    ).values(),
  );

  const fetchPromotions = async () => {
    try {
      const token = getToken();
      if (!token) throw new Error('No token');
      const res = await fetch(`${API}/api/promotions/merchant`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      const list: Promotion[] = (Array.isArray(data) ? data : data.data || []).map((p: any) => {
        const now = new Date();
        const start = p.start_date ? new Date(p.start_date) : null;
        const end = p.end_date ? new Date(p.end_date) : null;
        let status: PromoStatus = 'active';
        if (start && now < start) status = 'scheduled';
        else if ((end && now > end) || !p.is_active) status = 'expired';
        return {
          id: p.id,
          title: p.title,
          description: p.description || '',
          discount_type: p.discount_type || 'percentage',
          discount_value: parseFloat(p.discount_value) || 0,
          min_order_amount: parseFloat(p.min_order_amount) || 0,
          start_date: p.start_date,
          end_date: p.end_date,
          status,
          views: p.views || 0,
          claims: p.claims || 0,
          vouchers_to_issue: Number(p.vouchers_to_issue || 0),
          redemptions: p.redemptions || 0,
          applicable_categories: p.applicable_categories || [],
        };
      });
      setPromotions(list);
    } catch {
      setPromotions([]);
      toast.error('Unable to load promotions');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    const newPromo: Promotion = {
      id: Date.now(),
      title: form.title,
      description: form.description,
      discount_type: form.discount_type,
      discount_value: form.discount_value,
      min_order_amount: form.min_order_amount,
      start_date: noExpiration ? null : form.start_date || null,
      end_date: noExpiration ? null : form.end_date || null,
      status: !noExpiration && form.start_date && new Date(form.start_date) > new Date() ? 'scheduled' : 'active',
      views: 0,
      claims: 0,
      vouchers_to_issue: form.vouchers_to_issue,
      redemptions: 0,
      applicable_categories: form.applicable_categories.split(',').map((s) => s.trim()).filter(Boolean),
      applies_to_total_bill: form.applies_to_total_bill,
      category_ids: form.category_ids,
      bundle_items: form.bundle_items,
      bundle_price: form.bundle_price,
    };

    try {
      const token = getToken();
      const res = await fetch(`${API}/api/promotions/merchant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(newPromo),
      });
      if (res.ok) {
        const created = await res.json();
        setPromotions((prev) => [{ ...newPromo, ...created }, ...prev]);
        toast.success('Promotion created!');
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.message || 'Failed to create promotion on server');
        setPromotions((prev) => [newPromo, ...prev]);
      }
    } catch {
      toast.error('Network error — promotion saved locally only');
      setPromotions((prev) => [newPromo, ...prev]);
    }

    setShowCreateModal(false);
    setNoExpiration(false);
    setForm({ title: '', description: '', discount_type: 'percentage', discount_value: 0, min_order_amount: 0, start_date: '', end_date: '', applicable_categories: '', vouchers_to_issue: 1, applies_to_total_bill: true, category_ids: [], bundle_items: [], bundle_price: 0 });
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Delete this promotion? This cannot be undone.')) return;
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/promotions/merchant/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        toast('Coming soon! Delete saved locally.', { icon: '🚧' });
      } else {
        toast.success('Promotion deleted');
      }
    } catch {
      toast('Coming soon! Delete saved locally.', { icon: '🚧' });
    }
    setPromotions((prev) => prev.filter((p) => p.id !== id));
    setActionMenuId(null);
  };

  const handleTogglePause = async (id: number) => {
    const promo = promotions.find((p) => p.id === id);
    const newStatus = promo?.status === 'active' ? 'expired' : 'active';
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/promotions/merchant/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ is_active: newStatus === 'active' }),
      });
      if (!res.ok) {
        toast('Coming soon! Status saved locally.', { icon: '🚧' });
      } else {
        toast.success(newStatus === 'active' ? 'Promotion resumed' : 'Promotion paused');
      }
    } catch {
      toast('Coming soon! Status saved locally.', { icon: '🚧' });
    }
    setPromotions((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        return { ...p, status: newStatus as PromoStatus };
      }),
    );
    setActionMenuId(null);
  };

  const filtered = promotions.filter((p) => activeFilter === 'all' || p.status === activeFilter);

  const stats = {
    active: promotions.filter((p) => p.status === 'active').length,
    totalReach: promotions.reduce((s, p) => s + p.views, 0),
    redemptions: promotions.reduce((s, p) => s + p.redemptions, 0),
    revenue: promotions.reduce((s, p) => s + p.redemptions * (p.discount_type === 'fixed' ? p.discount_value : p.discount_value * 2.5), 0),
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  const formatNumber = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading promotions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Promotions &amp; Campaigns</h1>
          <p className="text-sm text-gray-600 mt-1">Create and manage promotional offers to boost your sales</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-[#DB0002] text-white px-5 py-2.5 rounded-lg hover:bg-red-700 transition-colors font-semibold text-sm shadow-sm self-start sm:self-auto"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Create Promotion
        </button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Active Promotions', value: stats.active, icon: '🔥', color: 'text-green-600' },
          { label: 'Total Reach', value: formatNumber(stats.totalReach), icon: '👁️', color: 'text-blue-600' },
          { label: 'Redemptions', value: formatNumber(stats.redemptions), icon: '🎟️', color: 'text-purple-600' },
          { label: 'Revenue from Promos', value: `₱${formatNumber(stats.revenue)}`, icon: '💰', color: 'text-orange-600' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-xl lg:text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[11px] lg:text-xs text-gray-500 mt-0.5 font-medium">{s.label}</p>
              </div>
              <span className="text-2xl">{s.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {(
          [
            { key: 'all', label: 'All' },
            { key: 'active', label: 'Active' },
            { key: 'scheduled', label: 'Scheduled' },
            { key: 'expired', label: 'Expired' },
          ] as const
        ).map((f) => {
          const count = f.key === 'all' ? promotions.length : promotions.filter((p) => p.status === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`flex-shrink-0 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                activeFilter === f.key
                  ? 'bg-[#DB0002] text-white shadow-sm'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
              }`}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Promotions List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center border border-gray-200 shadow-sm">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            <p className="text-gray-600 font-semibold text-lg">No promotions found</p>
            <p className="text-gray-400 text-sm mt-1">Create your first promotion to start attracting customers</p>
          </div>
        ) : (
          filtered.map((promo) => (
            <div key={promo.id} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all overflow-hidden">
              <div className="p-4 lg:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base lg:text-lg font-bold text-gray-900 truncate">{promo.title}</h3>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] lg:text-xs font-semibold ${DISCOUNT_TYPE_LABELS[promo.discount_type].color}`}>
                        {promo.discount_type === 'percentage' && `${promo.discount_value}% OFF`}
                        {promo.discount_type === 'fixed' && `₱${promo.discount_value} OFF`}
                        {promo.discount_type === 'bogo' && 'BOGO'}
                        {promo.discount_type === 'flash_sale' && `⚡ ${promo.discount_value}% FLASH`}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] lg:text-xs font-semibold ${STATUS_COLORS[promo.status]}`}>
                        {promo.status.charAt(0).toUpperCase() + promo.status.slice(1)}
                      </span>
                    </div>
                    <p className="text-xs lg:text-sm text-gray-500 mt-1 line-clamp-1">{promo.description}</p>
                    <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-2">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>
                        {promo.start_date ? formatDate(promo.start_date) : 'Available now'} &ndash;{' '}
                        {promo.end_date ? formatDate(promo.end_date) : 'No expiration'}
                      </span>
                      {promo.min_order_amount > 0 && (
                        <span className="ml-2 text-gray-400">Min. ₱{promo.min_order_amount}</span>
                      )}
                    </div>
                  </div>
                  {/* Actions */}
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={() => setActionMenuId(actionMenuId === promo.id ? null : promo.id)}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                      </svg>
                    </button>
                    {actionMenuId === promo.id && (
                      <div className="absolute right-0 top-10 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20 w-40">
                        <button
                          onClick={() => { toast('Coming soon!', { icon: '🚧' }); setActionMenuId(null); }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Edit
                        </button>
                        <button
                          onClick={() => handleTogglePause(promo.id)}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                        >
                          {promo.status === 'active' ? (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Pause
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              </svg>
                              Resume
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(promo.id)}
                          className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-gray-100">
                  <div className="text-center">
                    <p className="text-sm lg:text-base font-bold text-gray-900">{formatNumber(promo.views)}</p>
                    <p className="text-[10px] lg:text-xs text-gray-400">Views</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm lg:text-base font-bold text-gray-900">
                      {formatNumber(promo.claims)} / {formatNumber(promo.vouchers_to_issue)}
                    </p>
                    <p className="text-[10px] lg:text-xs text-gray-400">Vouchers issued</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm lg:text-base font-bold text-gray-900">{formatNumber(promo.redemptions)}</p>
                    <p className="text-[10px] lg:text-xs text-gray-400">Redemptions</p>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Promotion Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowCreateModal(false)}>
          <div
            className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <h2 className="text-lg font-bold text-gray-900">Create Promotion</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Merienda Madness 50% OFF"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Describe your promotion..."
                  rows={3}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Discount Type</label>
                  <select
                    value={form.discount_type}
                    onChange={(e) => setForm({ ...form, discount_type: e.target.value as DiscountType })}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm bg-white"
                  >
                    <option value="percentage">Percentage OFF</option>
                    <option value="fixed">Fixed Amount OFF</option>
                    <option value="bogo">Buy One Get One</option>
                    <option value="flash_sale">Flash Sale</option>
                    <option value="bundle">Product Bundle</option>
                  </select>
                </div>
                {form.discount_type !== 'bundle' && <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {form.discount_type === 'bogo' ? 'Free Items' : form.discount_type === 'percentage' || form.discount_type === 'flash_sale' ? 'Discount (%)' : 'Discount (₱)'}
                  </label>
                  <input
                    type="number"
                    value={form.discount_value}
                    onChange={(e) => setForm({ ...form, discount_value: Number(e.target.value) })}
                    min={0}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm"
                  />
                </div>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Min. Order Amount (₱)</label>
                <input
                  type="number"
                  value={form.min_order_amount}
                  onChange={(e) => setForm({ ...form, min_order_amount: Number(e.target.value) })}
                  min={0}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Number of vouchers to issue
                </label>
                <input
                  type="number"
                  value={form.vouchers_to_issue}
                  onChange={(e) => setForm({ ...form, vouchers_to_issue: Number(e.target.value) })}
                  min={1}
                  step={1}
                  required
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm"
                />
                <p className="mt-1 text-[11px] text-gray-400">
                  Each customer may claim this voucher code only once.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date <span className="font-normal text-gray-400">(optional for no expiration)</span></label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    disabled={noExpiration}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date <span className="font-normal text-gray-400">(optional)</span></label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    disabled={noExpiration}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm"
                  />
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-600">
                    <input
                      type="checkbox"
                      checked={noExpiration}
                      onChange={(e) => {
                        setNoExpiration(e.target.checked);
                        if (e.target.checked) setForm({ ...form, start_date: '', end_date: '' });
                      }}
                      className="size-4 accent-[#DB0002]"
                    />
                    No expiration date
                  </label>
                </div>
              </div>

              {form.discount_type === 'bundle' ? (
                <div className="space-y-3 rounded-xl border border-purple-200 bg-purple-50 p-4">
                  <label className="block text-sm font-bold">Bundle price (₱)
                    <input type="number" min={1} value={form.bundle_price} onChange={e => setForm({ ...form, bundle_price: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 font-normal" />
                  </label>
                  <div><p className="text-sm font-bold">Bundle items</p><p className="text-[11px] text-gray-500">Select at least two products, such as food and a beverage.</p></div>
                  <div className="max-h-48 space-y-2 overflow-y-auto">
                    {merchantProducts.map(product => {
                      const selected = form.bundle_items.find(item => item.productId === product.id);
                      return <div key={product.id} className="flex items-center gap-3 rounded-lg bg-white p-2.5">
                        <input type="checkbox" checked={Boolean(selected)} onChange={event => setForm(current => ({ ...current, bundle_items: event.target.checked ? [...current.bundle_items, { productId: product.id, productName: product.name, quantity: 1 }] : current.bundle_items.filter(item => item.productId !== product.id) }))} className="size-4 accent-purple-600" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{product.name}</span>
                        {selected && <input aria-label={`${product.name} quantity`} type="number" min={1} value={selected.quantity} onChange={event => setForm(current => ({ ...current, bundle_items: current.bundle_items.map(item => item.productId === product.id ? { ...item, quantity: Math.max(1, Number(event.target.value)) } : item) }))} className="w-16 rounded-md border px-2 py-1 text-sm" />}
                      </div>;
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-gray-200 p-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-bold">
                    <input type="checkbox" checked={form.applies_to_total_bill} onChange={event => setForm({ ...form, applies_to_total_bill: event.target.checked, category_ids: event.target.checked ? [] : form.category_ids })} className="size-4 accent-[#DB0002]" /> Applies to the total bill
                  </label>
                  {!form.applies_to_total_bill && <div className="mt-3 grid grid-cols-2 gap-2">
                    {merchantCategories.map(category => <label key={category.id} className="flex items-center gap-2 rounded-lg bg-gray-50 p-2 text-xs font-medium"><input type="checkbox" checked={form.category_ids.includes(category.id)} onChange={event => setForm(current => ({ ...current, category_ids: event.target.checked ? [...current.category_ids, category.id] : current.category_ids.filter(id => id !== category.id) }))} className="accent-[#DB0002]" />{category.name}</label>)}
                    {!merchantCategories.length && <p className="col-span-2 text-xs text-gray-500">No merchant product categories configured.</p>}
                  </div>}
                </div>
              )}

              {/* Preview Card */}
              {form.title && (
                <div className="overflow-hidden rounded-xl border border-red-100 bg-white">
                  <div className="relative aspect-[3/1] min-h-28 overflow-hidden bg-gradient-to-r from-red-950 to-orange-900">
                    {merchantBrand?.coverImageUrl && <img src={merchantBrand.coverImageUrl} alt={`${merchantBrand.name} banner`} className="absolute inset-0 h-full w-full object-cover" />}
                    <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/45 to-black/20" />
                    <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-3 text-white">
                      <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border-2 border-white bg-white text-lg font-black text-gray-800 shadow">
                        {merchantBrand?.logoUrl ? <img src={merchantBrand.logoUrl} alt={`${merchantBrand.name} logo`} className="h-full w-full object-contain" /> : merchantBrand?.name?.charAt(0).toUpperCase() || 'M'}
                      </div>
                      <div className="min-w-0"><p className="text-[9px] font-black uppercase tracking-widest text-red-200">Promotion preview</p><p className="truncate text-sm font-black">{merchantBrand?.name || 'Your store'}</p></div>
                    </div>
                  </div>
                  <div className="bg-gradient-to-r from-red-50 to-orange-50 p-4">
                  <h4 className="font-bold text-gray-900">{form.title}</h4>
                  {form.description && <p className="text-xs text-gray-500 mt-0.5">{form.description}</p>}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${DISCOUNT_TYPE_LABELS[form.discount_type].color}`}>
                      {form.discount_type === 'percentage' && `${form.discount_value}% OFF`}
                      {form.discount_type === 'fixed' && `₱${form.discount_value} OFF`}
                      {form.discount_type === 'bogo' && 'BOGO'}
                      {form.discount_type === 'flash_sale' && `⚡ ${form.discount_value}% FLASH`}
                      {form.discount_type === 'bundle' && `BUNDLE ₱${form.bundle_price.toFixed(2)}`}
                    </span>
                    {form.min_order_amount > 0 && (
                      <span className="text-[10px] text-gray-400">Min. ₱{form.min_order_amount}</span>
                    )}
                    <span className="text-[10px] text-gray-400">
                      {form.vouchers_to_issue} voucher{form.vouchers_to_issue === 1 ? '' : 's'} available
                    </span>
                    {(form.start_date || noExpiration) && (
                      <span className="text-[10px] text-gray-400">
                        {noExpiration ? 'Available immediately · No expiration' : `${formatDate(form.start_date)} – ${form.end_date ? formatDate(form.end_date) : 'No expiration'}`}
                      </span>
                    )}
                  </div>
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-gray-200 px-5 py-4 flex gap-3">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.title || form.vouchers_to_issue < 1 || !Number.isInteger(form.vouchers_to_issue) || (!noExpiration && (!form.start_date || !form.end_date)) || (form.discount_type !== 'bundle' && !form.applies_to_total_bill && form.category_ids.length === 0) || (form.discount_type === 'bundle' && (form.bundle_items.length < 2 || form.bundle_price <= 0))}
                className="flex-1 px-4 py-2.5 bg-[#DB0002] text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create Promotion
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
