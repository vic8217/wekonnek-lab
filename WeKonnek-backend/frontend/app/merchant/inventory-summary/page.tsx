'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { inventoryApi, MerchantInventorySummary } from '@/lib/api';

export default function MerchantInventorySummaryPage() {
  const [data, setData] = useState<MerchantInventorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedShop, setSelectedShop] = useState<number | 'all'>('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const requestedShopId = Number(new URLSearchParams(window.location.search).get('shopId'));
    inventoryApi.getMerchantSummary()
      .then(summary => {
        setData(summary);
        if (Number.isInteger(requestedShopId) && summary.shops.some(shop => shop.id === requestedShopId)) setSelectedShop(requestedShopId);
      })
      .catch(error => setError(error instanceof Error ? error.message : 'Unable to load inventory'))
      .finally(() => setLoading(false));
  }, []);
  const rows = useMemo(() => {
    if (!data) return [];
    const source = selectedShop === 'all' ? data.shops.flatMap(shop => shop.inventory.map(item => ({ ...item, shopName: shop.name }))) : (data.shops.find(shop => shop.id === selectedShop)?.inventory || []).map(item => ({ ...item, shopName: data.shops.find(shop => shop.id === selectedShop)?.name || '' }));
    const query = search.trim().toLowerCase();
    return source.filter(row => (!query || [row.productName, row.variantName, row.sku, row.categoryName, row.shopName].filter(Boolean).join(' ').toLowerCase().includes(query)) && (stockFilter === 'all' || stockFilter === 'low' && row.stockStatus === 'Low Stock' || stockFilter === 'out' && row.stockStatus === 'Out of Stock'));
  }, [data, search, selectedShop, stockFilter]);
  if (loading) return <div className="py-16 text-center text-gray-500">Loading inventory across all shops…</div>;
  if (error || !data) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">{error || 'Inventory summary is unavailable.'}</div>;
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl font-bold text-gray-900">Inventory</h1><p className="mt-1 text-gray-600">Read-only stock balances across your merchant shops. Stock changes can only be made in the shop interface.</p></div><Link href="/merchant/branches" className="rounded-lg border border-red-600 px-4 py-2 font-semibold text-red-600">Back to Shops</Link></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card label="Total Shops" value={data.totals.shops} /><Card label="Inventory Items" value={data.totals.items} /><Card label="Available Quantity" value={data.totals.available} /><Card label="Inventory Value" value={`₱${data.totals.inventoryValue.toLocaleString()}`} /><Card label="Shops Needing Restock" value={data.totals.shopsNeedingRestock} warning /><Card label="Low Stock Items" value={data.totals.lowStockItems} warning /><Card label="Out of Stock Items" value={data.totals.outOfStockItems} danger /><Card label="Reserved Quantity" value={data.totals.reserved} /></div>
    <section><h2 className="mb-3 text-xl font-bold text-gray-900">Shop Summary</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.shops.map(shop => <button key={shop.id} onClick={() => setSelectedShop(shop.id)} className={`rounded-xl border bg-white p-5 text-left shadow-sm ${selectedShop === shop.id ? 'border-red-500 ring-2 ring-red-100' : 'border-gray-200'}`}><div className="flex justify-between gap-3"><div><p className="font-bold text-gray-900">{shop.name}</p><p className="mt-1 text-xs text-gray-500">{shop.shopId || `Shop #${shop.id}`}{shop.isDefault ? ' · Default' : ''}</p></div><span className={`h-fit rounded-full px-2.5 py-1 text-xs font-bold ${shop.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{shop.isActive ? 'Active' : 'Inactive'}</span></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><Mini label="Items" value={shop.itemCount} /><Mini label="Low" value={shop.lowStockCount} warning /><Mini label="Out" value={shop.outOfStockCount} danger /></div><p className="mt-3 text-sm text-gray-600">Value: <strong className="text-gray-900">₱{shop.inventoryValue.toLocaleString()}</strong></p></button>)}</div></section>
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b p-5 lg:flex-row lg:items-center"><button onClick={() => setSelectedShop('all')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${selectedShop === 'all' ? 'bg-red-600 text-white' : 'border text-gray-700'}`}>All Shops</button><select value={selectedShop} onChange={event => setSelectedShop(event.target.value === 'all' ? 'all' : Number(event.target.value))} className="rounded-lg border px-3 py-2 text-sm"><option value="all">All shops</option>{data.shops.map(shop => <option key={shop.id} value={shop.id}>{shop.name}</option>)}</select><select value={stockFilter} onChange={event => setStockFilter(event.target.value as typeof stockFilter)} className="rounded-lg border px-3 py-2 text-sm"><option value="all">All stock statuses</option><option value="low">Low stock</option><option value="out">Out of stock</option></select><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search product, SKU, category, or shop" className="min-w-0 flex-1 rounded-lg border px-4 py-2" /></div><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-gray-900 text-white"><tr>{['Shop', 'Product', 'Variant', 'SKU', 'On Hand', 'Reserved', 'Available', 'Reorder Level', 'Status', 'Value'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y">{rows.map(row => <tr key={`${row.shopId}-${row.id}`}><td className="px-4 py-3 font-semibold">{row.shopName}</td><td className="px-4 py-3"><p className="font-semibold">{row.productName}</p><p className="text-xs text-gray-500">{row.categoryName || 'Uncategorized'}</p></td><td className="px-4 py-3">{row.variantName}</td><td className="px-4 py-3 font-mono text-xs">{row.sku || '—'}</td><td className="px-4 py-3 font-bold">{row.quantity}</td><td className="px-4 py-3">{row.reservedQuantity}</td><td className="px-4 py-3 font-bold">{row.availableQuantity}</td><td className="px-4 py-3">{row.reorderLevel}</td><td className="px-4 py-3"><Status value={row.stockStatus} /></td><td className="px-4 py-3">₱{row.inventoryValue.toLocaleString()}</td></tr>)}{!rows.length && <tr><td colSpan={10} className="px-5 py-12 text-center text-gray-500">No inventory balances match this view.</td></tr>}</tbody></table></div></section>
  </div>;
}

function Card({ label, value, warning, danger }: { label: string; value: string | number; warning?: boolean; danger?: boolean }) { return <div className={`rounded-xl border bg-white p-5 shadow-sm ${danger ? 'border-red-200' : warning ? 'border-amber-200' : 'border-gray-200'}`}><p className="text-sm text-gray-500">{label}</p><p className={`mt-2 text-2xl font-bold ${danger ? 'text-red-600' : warning ? 'text-amber-600' : 'text-gray-900'}`}>{value}</p></div>; }
function Mini({ label, value, warning, danger }: { label: string; value: number; warning?: boolean; danger?: boolean }) { return <div className="rounded-lg bg-gray-50 p-2"><p className="text-[10px] uppercase text-gray-500">{label}</p><p className={`font-bold ${danger ? 'text-red-600' : warning ? 'text-amber-600' : 'text-gray-900'}`}>{value}</p></div>; }
function Status({ value }: { value: string }) { return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${value === 'In Stock' ? 'bg-green-100 text-green-700' : value === 'Low Stock' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{value}</span>; }
