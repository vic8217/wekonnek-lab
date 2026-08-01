'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Tags } from 'lucide-react';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const IGNORED_WORDS = new Set([
  'and', 'are', 'for', 'from', 'into', 'the', 'this', 'that', 'with', 'your',
]);

interface Product {
  id: number;
  name: string;
  description?: string | null;
  category?: { name?: string | null } | null;
  subCategory?: { name?: string | null } | null;
}

interface KeywordRow {
  keyword: string;
  products: string[];
}

function terms(value?: string | null) {
  return (value || '')
    .toLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)
    ?.filter((word) => word.length > 2 && !IGNORED_WORDS.has(word)) || [];
}

export default function MerchantKeywordsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const token = getToken();
        if (!token) throw new Error('Please sign in again.');
        const headers = { Authorization: `Bearer ${token}` };
        const merchantResponse = await fetch(`${API}/api/merchants/me`, { headers });
        if (!merchantResponse.ok) throw new Error('Unable to load merchant account.');
        const merchant = await merchantResponse.json();
        const productsResponse = await fetch(`${API}/api/products?merchantId=${merchant.id}`, { headers });
        if (!productsResponse.ok) throw new Error('Unable to load keywords.');
        setProducts(await productsResponse.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load keywords.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const keywords = useMemo(() => {
    const index = new Map<string, Set<string>>();
    products.forEach((product) => {
      const values = [product.name, product.description, product.category?.name, product.subCategory?.name];
      new Set(values.flatMap(terms)).forEach((keyword) => {
        const matches = index.get(keyword) || new Set<string>();
        matches.add(product.name);
        index.set(keyword, matches);
      });
    });
    return Array.from(index, ([keyword, matches]): KeywordRow => ({
      keyword,
      products: Array.from(matches).sort(),
    })).sort((a, b) => a.keyword.localeCompare(b.keyword));
  }, [products]);

  const filtered = keywords.filter((row) =>
    row.keyword.includes(query.trim().toLowerCase()) ||
    row.products.some((product) => product.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return <div className="space-y-6">
    <div>
      <h1 className="text-2xl font-black text-gray-900">Keywords</h1>
      <p className="mt-1 text-sm text-gray-600">Searchable terms found across your product names, descriptions, categories, and subcategories.</p>
    </div>

    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-gray-500">Total keywords</p>
        <p className="mt-1 text-3xl font-black text-gray-900">{keywords.length}</p>
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium text-gray-500">Catalog products</p>
        <p className="mt-1 text-3xl font-black text-gray-900">{products.length}</p>
      </div>
    </div>

    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 p-5">
        <label className="relative block max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search keywords or products" className="h-11 w-full rounded-lg border border-gray-300 pl-10 pr-4 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" />
        </label>
      </div>
      {loading ? <p className="p-8 text-center text-gray-500">Loading keywords…</p> : error ? <p className="p-8 text-center text-red-600">{error}</p> : filtered.length === 0 ? (
        <div className="p-10 text-center text-gray-500"><Tags className="mx-auto mb-3" size={30} /><p className="font-semibold">No keywords found</p><p className="mt-1 text-sm">Add product names, descriptions, and categories to populate this list.</p></div>
      ) : <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50"><tr><th className="px-5 py-3 text-left font-bold text-gray-600">Keyword</th><th className="px-5 py-3 text-left font-bold text-gray-600">Used by</th><th className="px-5 py-3 text-right font-bold text-gray-600">Products</th></tr></thead>
        <tbody className="divide-y divide-gray-100">{filtered.map((row) => <tr key={row.keyword}><td className="px-5 py-4 font-semibold text-gray-900">{row.keyword}</td><td className="max-w-xl px-5 py-4 text-gray-600">{row.products.join(', ')}</td><td className="px-5 py-4 text-right font-bold text-gray-700">{row.products.length}</td></tr>)}</tbody>
      </table></div>}
    </section>
  </div>;
}
