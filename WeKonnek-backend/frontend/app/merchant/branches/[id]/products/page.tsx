'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Product, ShopProductAssignment, inventoryApi } from '@/lib/api';

type Row = {
  product: Product;
  assignment: Omit<ShopProductAssignment, 'product' | 'inventory' | 'effectivePrice'> | null;
};

export default function MerchantShopProductsPage() {
  const params = useParams<{ id: string }>();
  const shopId = Number(params.id);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!Number.isInteger(shopId)) return;
    inventoryApi.getShopProducts(shopId)
      .then(data => setRows(data.filter(row => row.assignment)))
      .catch(error => setError(error instanceof Error ? error.message : 'Unable to load shop products'))
      .finally(() => setLoading(false));
  }, [shopId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(({ product }) => !query || [product.name, product.baseSku, product.brand, product.category?.name]
      .filter(Boolean).join(' ').toLowerCase().includes(query));
  }, [rows, search]);

  if (!Number.isInteger(shopId)) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">Invalid shop.</div>;
  if (loading) return <div className="py-12 text-center text-gray-500">Loading shop products…</div>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">{error}</div>;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-3xl font-bold text-gray-900">Shop Products</h1><p className="mt-1 text-gray-600">Read-only view. Product assignments, pricing, and availability can only be changed in the shop interface.</p></div>
      <Link href="/merchant/branches" className="rounded-lg border border-red-600 px-4 py-2 font-semibold text-red-600">Back to Shops</Link>
    </div>
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b p-5"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search product, SKU, brand, or category" className="w-full rounded-lg border border-gray-300 px-4 py-2.5 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" /></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm">
        <thead className="bg-red-600 text-white"><tr>{['Product', 'Category', 'SKU', 'Catalogue Price', 'Shop Price', 'Inventory Tracking', 'Available in Shop'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-100">{filtered.map(({ product, assignment }) => {
          const cataloguePrice = Number(product.discountPrice ?? product.sellingPrice ?? product.price ?? 0);
          return <tr key={product.id}><td className="px-4 py-4 font-semibold">{product.name}</td><td className="px-4 py-4">{product.category?.name || '—'}</td><td className="px-4 py-4 font-mono text-xs">{product.baseSku || '—'}</td><td className="px-4 py-4">₱{cataloguePrice.toLocaleString()}</td><td className="px-4 py-4">{assignment?.priceOverride == null ? 'Catalogue price' : `₱${Number(assignment.priceOverride).toLocaleString()}`}</td><td className="px-4 py-4">{product.trackInventory ? 'Enabled' : 'Disabled'}</td><td className="px-4 py-4">{assignment?.isEnabled ? 'Enabled' : 'Disabled'}</td></tr>;
        })}{!filtered.length && <tr><td colSpan={7} className="px-5 py-12 text-center text-gray-500">{search ? 'No shop products match your search.' : 'No products are assigned to this shop.'}</td></tr>}</tbody>
      </table></div>
    </section>
  </div>;
}
