'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { getToken } from '@/hooks/use-auth';
import { Category, Product, categoriesApi, productsApi } from '@/lib/api';
import ProductCsvTools from '@/components/ProductCsvTools';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const STATUSES = ['Available', 'Unavailable', 'Draft', 'Archived'];

export default function ProductCataloguePage() {
  const router = useRouter();
  const pathname = usePathname();
  const basePath = pathname.startsWith('/shop') ? '/shop' : '/merchant';
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ category: '', brand: '', variants: '', tracking: '', status: '' });

  const load = useCallback(async () => {
    try {
      const token = getToken();
      if (!token) return router.push('/auth/login');
      const merchantResponse = await fetch(`${API}/api/merchants/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!merchantResponse.ok) throw new Error('Unable to load merchant profile');
      const merchant = await merchantResponse.json();
      const [allProducts, allCategories] = await Promise.all([productsApi.getAll(), categoriesApi.getAll(false)]);
      setProducts(allProducts.filter(product => product.merchantId === merchant.id));
      setCategories(allCategories || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to load products');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const brands = useMemo(() => [...new Set(products.map(product => product.brand).filter(Boolean) as string[])].sort(), [products]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter(product => {
      const searchable = [product.name, product.baseSku, product.barcode, product.brand, product.category?.name,
        ...(product.variants || []).flatMap(variant => [variant.sku, variant.barcode])]
        .filter(Boolean).join(' ').toLowerCase();
      return (!query || searchable.includes(query))
        && (!filters.category || String(product.categoryId || '') === filters.category)
        && (!filters.brand || product.brand === filters.brand)
        && (!filters.variants || product.hasVariants === (filters.variants === 'true'))
        && (!filters.tracking || product.trackInventory === (filters.tracking === 'true'))
        && (!filters.status || product.availabilityStatus === filters.status);
    });
  }, [filters, products, search]);

  const remove = async (id: number) => {
    if (!window.confirm('Delete this product or service?')) return;
    try {
      setDeleting(id);
      await productsApi.delete(id);
      setProducts(current => current.filter(product => product.id !== id));
      toast.success('Product deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to delete product');
    } finally { setDeleting(null); }
  };

  if (loading) return <div className="py-12 text-center text-gray-500">Loading product catalogue...</div>;

  return <div className="space-y-6">
    <div><h1 className="text-3xl font-bold text-gray-900">Products</h1><p className="mt-1 text-gray-600">Manage your products and services catalogue.</p></div>
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="space-y-4 border-b border-gray-200 p-5">
        <div className="flex flex-col justify-between gap-3 lg:flex-row">
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, SKU, variant SKU, barcode, brand, or category" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-4 py-2.5 outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
          <div className="flex flex-wrap gap-2"><ProductCsvTools onImported={load} /><Link href={`${basePath}/products/new`} className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700">Add Product</Link></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Filter value={filters.category} set={value => setFilters(current => ({ ...current, category: value }))} label="All categories" options={categories.map(category => ({ value: String(category.id), label: category.name }))} />
          <Filter value={filters.brand} set={value => setFilters(current => ({ ...current, brand: value }))} label="All brands" options={brands} />
          <Filter value={filters.variants} set={value => setFilters(current => ({ ...current, variants: value }))} label="Variants" options={[{ value: 'true', label: 'Has variants' }, { value: 'false', label: 'Standard' }]} />
          <Filter value={filters.tracking} set={value => setFilters(current => ({ ...current, tracking: value }))} label="Inventory tracking" options={[{ value: 'true', label: 'Enabled' }, { value: 'false', label: 'Disabled' }]} />
          <Filter value={filters.status} set={value => setFilters(current => ({ ...current, status: value }))} label="All availability" options={STATUSES} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-red-600 text-white"><tr>{['Product', 'Category', 'SKU', 'Variants', 'Price', 'Inventory Tracking', 'Availability', 'Action'].map(label => <th key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(product => <tr key={product.id} className="hover:bg-gray-50">
              <td className="px-4 py-4"><div className="flex items-center gap-3"><div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">{product.imageUrl ? <Image src={product.imageUrl} alt="" fill unoptimized className="object-cover" /> : <span className="flex h-full items-center justify-center text-lg text-gray-400">□</span>}</div><div><p className="font-semibold text-gray-900">{product.name}</p>{product.description && <p className="mt-0.5 max-w-64 truncate text-xs text-gray-500">{product.description}</p>}</div></div></td>
              <td className="px-4 py-4 text-gray-700">{product.category?.name || 'Uncategorized'}</td>
              <td className="px-4 py-4 font-mono text-xs text-gray-700">{product.baseSku || '—'}</td>
              <td className="px-4 py-4 text-gray-700">{variantLabel(product)}</td>
              <td className="px-4 py-4 text-right font-semibold text-gray-900">₱{Number(product.discountPrice ?? product.sellingPrice ?? product.price ?? 0).toLocaleString()}</td>
              <td className="px-4 py-4"><Badge active={Boolean(product.trackInventory)} yes="Enabled" no="Disabled" /></td>
              <td className="px-4 py-4"><Availability status={product.availabilityStatus || (product.isAvailable ? 'Available' : 'Unavailable')} /></td>
              <td className="px-4 py-4"><div className="flex gap-2"><Link href={`${basePath}/products/${product.id}/edit`} className="font-semibold text-blue-600 hover:text-blue-800">Edit</Link><button disabled={deleting === product.id} onClick={() => void remove(product.id)} className="font-semibold text-red-600 hover:text-red-800 disabled:opacity-50">Delete</button></div></td>
            </tr>)}
            {!filtered.length && <tr><td colSpan={8} className="px-5 py-12 text-center text-gray-500">{search || Object.values(filters).some(Boolean) ? 'No products match your search and filters.' : 'No products found. Add your first product or service to start building your catalogue.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}

function Filter({ value, set, label, options }: { value: string; set: (value: string) => void; label: string; options: Array<string | { value: string; label: string }> }) {
  return <select value={value} onChange={event => set(event.target.value)} aria-label={label} className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"><option value="">{label}</option>{options.map(option => { const value = typeof option === 'string' ? option : option.value; return <option key={value} value={value}>{typeof option === 'string' ? option : option.label}</option>; })}</select>;
}
function Badge({ active, yes, no }: { active: boolean; yes: string; no: string }) { return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${active ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{active ? yes : no}</span>; }
function Availability({ status }: { status: string }) { const color = status === 'Available' ? 'bg-green-100 text-green-700' : status === 'Unavailable' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-700'; return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${color}`}>{status}</span>; }
function variantLabel(product: Product) { if (!product.hasVariants || !product.variants?.length) return 'Standard'; const optionText = product.options?.map(option => option.values.map(value => value.value).join(' / ')).join(' • '); return optionText || `${product.variants.length} Variants`; }
