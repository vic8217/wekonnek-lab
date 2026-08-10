'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { inventoryApi, Product } from '@/lib/api';

type Row = { product: Product; assignment: { isEnabled: boolean; priceOverride?: number | null } | null };

export default function ShopProductsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const load = useCallback(async () => {
    setLoadError('');
    try {
      let catalogue = await inventoryApi.getShopProducts();
      if (!catalogue.length) {
        const activeShop = JSON.parse(sessionStorage.getItem('wk_active_shop') || '{}') as { merchant_id?: number; merchantId?: number };
        const merchantId = activeShop.merchant_id ?? activeShop.merchantId;
        if (merchantId) {
          const response = await fetch(`/api/products?merchantId=${merchantId}`, { cache: 'no-store' });
          if (response.ok) catalogue = ((await response.json()) as Product[]).map(product => ({ product, assignment: null }));
        }
      }
      setRows(catalogue);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load products';
      setLoadError(message);
      toast.error(message);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const update = async (row: Row, enabled: boolean, changePrice = false) => {
    let priceOverride = row.assignment?.priceOverride ?? null;
    if (changePrice) {
      const raw = window.prompt('Shop price override (leave blank for catalogue price)', priceOverride == null ? '' : String(priceOverride));
      if (raw == null) return;
      priceOverride = raw.trim() ? Number(raw) : null;
      if (priceOverride != null && (!Number.isFinite(priceOverride) || priceOverride < 0)) return toast.error('Enter a valid price');
    }
    try { await inventoryApi.assignProduct(row.product.id, { isEnabled: enabled, priceOverride }); await load(); toast.success(row.assignment ? 'Shop product updated' : 'Product assigned to shop'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to update shop product'); }
  };

  if (loading) return <div className="py-12 text-center text-gray-500">Loading shop products...</div>;
  return <div className="space-y-6"><div><h1 className="text-3xl font-bold text-gray-900">Products</h1><p className="mt-1 text-gray-600">Choose which products from the merchant catalogue this shop sells. Product details remain centrally managed.</p></div>
    {loadError && <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><span>{loadError}</span><button type="button" onClick={() => void load()} className="font-bold underline">Retry</button></div>}
    <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-red-600 text-white"><tr>{['Product', 'Category', 'Catalogue Price', 'Shop Price', 'Assigned', 'Available in Shop', 'Action'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{rows.map(row => {
      const cataloguePrice = Number(row.product.discountPrice ?? row.product.sellingPrice ?? row.product.price ?? 0);
      const variantPrices = row.product.hasVariants ? (row.product.variants || []).map(variant => variant.price).filter((price): price is number => price != null).map(Number) : [];
      const completeVariantPricing = Boolean(variantPrices.length && variantPrices.length === row.product.variants?.length);
      const minimum = completeVariantPricing ? Math.min(...variantPrices) : cataloguePrice;
      const maximum = completeVariantPricing ? Math.max(...variantPrices) : cataloguePrice;
      const cataloguePriceLabel = minimum === maximum ? `₱${minimum.toLocaleString()}` : `₱${minimum.toLocaleString()}–₱${maximum.toLocaleString()}`;
      return <tr key={row.product.id}><td className="px-4 py-4 font-semibold">{row.product.name}</td><td className="px-4 py-4">{row.product.category?.name || '—'}</td><td className="px-4 py-4">{cataloguePriceLabel}</td><td className="px-4 py-4">{row.assignment?.priceOverride == null ? 'Catalogue price' : `₱${Number(row.assignment.priceOverride).toLocaleString()}`}</td><td className="px-4 py-4">{row.assignment ? 'Yes' : 'No'}</td><td className="px-4 py-4">{row.assignment?.isEnabled ? 'Enabled' : 'Disabled'}</td><td className="px-4 py-4"><div className="flex gap-3"><button onClick={() => void update(row, !row.assignment?.isEnabled)} className="font-semibold text-red-600">{row.assignment?.isEnabled ? 'Disable' : row.assignment ? 'Enable' : 'Assign'}</button>{row.assignment && <button onClick={() => void update(row, row.assignment!.isEnabled, true)} className="font-semibold text-blue-600">Set Price</button>}</div></td></tr>;
    })}{!rows.length && <tr><td colSpan={7} className="px-5 py-12 text-center text-gray-500">The merchant catalogue has no products yet.</td></tr>}</tbody></table></section>
  </div>;
}
