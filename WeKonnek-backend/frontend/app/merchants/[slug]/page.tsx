'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
import {
  addToCart as cartAdd,
  getCart,
  getCartCount,
  onCartChange,
  removeFromCart,
  updateQuantity as cartUpdateQty,
  CartItem,
} from '@/lib/cart';

interface Merchant {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  category_id: number | null;
  sub_category_id: number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  is_active: boolean;
  is_verified: boolean;
  rating: number | null;
  total_reviews: number | null;
  branches?: Array<{ id: number; name: string; address?: string | null; city?: string | null; isDefault: boolean }>;
}

interface Product {
  id: number;
  merchant_id: number;
  name: string;
  description: string | null;
  notes?: Array<{ title: string; text?: string; iconUrl?: string }>;
  price: number;
  image_url: string | null;
  is_available: boolean;
  quantity: number | null;
  availabilityStatus?: 'Available' | 'Out of Stock' | 'Temporarily Unavailable';
  hasVariants?: boolean;
  variants?: Array<{ id: number; sku: string; price?: number | null; availabilityStatus?: 'Available' | 'Out of Stock' | 'Temporarily Unavailable'; optionValues?: Array<{ optionValue: { value: string } }> }>;
  category_id: number | null;
  sub_category_id: number | null;
  menuBadge?: 'BESTSELLER' | 'NEW' | 'PROMO' | 'FEATURED' | null;
  menuFeatured?: boolean;
  menuCategory?: string;
}

type SortMode = 'newest' | 'price_asc' | 'price_desc' | 'popularity';

export default function CustomerMerchantDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = params.slug as string;
  // Table tag from a scanned dine-in QR code (e.g. "Table 5"). When present we
  // surface a banner and carry it through to checkout.
  const tableTag = searchParams.get('table');
  const requestedTransactionType = searchParams.get('transactionType') || searchParams.get('orderType');
  const isDineInTransaction = Boolean(tableTag) || ['dine_in', 'in_store'].includes(requestedTransactionType || '');

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeMenuCategory, setActiveMenuCategory] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [cartCount, setCartCount] = useState(0);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<number | null>(null);
  const [selectedVariants, setSelectedVariants] = useState<Record<number, number>>({});

  // Load merchant + products
  useEffect(() => {
    if (!slug) return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const merchantRes = await fetch(`${API}/api/merchants/slug/${slug}`);
        if (!merchantRes.ok) throw new Error('Merchant not found');
        const merchantData = await merchantRes.json();
        if (cancelled) return;
        setMerchant(merchantData as Merchant);
        const requestedShop = Number(searchParams.get('shop'));
        const selectedShop = merchantData.branches?.find((branch: { id: number }) => branch.id === requestedShop) || merchantData.branches?.[0];
        if (!selectedShop) throw new Error('This merchant has no available shop');
        setSelectedShopId(selectedShop.id);
        const productsRes = await fetch(`${API}/api/products?merchantId=${merchantData.id}&shopId=${selectedShop.id}`);
        if (!productsRes.ok) throw new Error('Failed to load products');
        const productsRaw = await productsRes.json();
        if (cancelled) return;
        const productsArr = Array.isArray(productsRaw) ? productsRaw : productsRaw.data || [];
        const normalized: Product[] = productsArr.map((p: any) => ({
          ...p,
          price: Number(p.price) || 0,
          quantity: p.quantity == null ? null : Number(p.quantity),
        }));
        setProducts(normalized);

      } catch (err: any) {
        console.error('Error loading merchant:', err);
        if (!cancelled) setError(err.message || 'Failed to load merchant');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [slug, searchParams]);

  // Sync cart count & items whenever the cart changes
  useEffect(() => {
    if (!merchant) return;
    const refresh = () => {
      setCartCount(getCartCount(merchant.id));
      setCart(getCart(merchant.id));
    };
    refresh();
    return onCartChange(refresh);
  }, [merchant]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (activeMenuCategory != null) {
      list = list.filter((p) => p.menuCategory === activeMenuCategory);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q),
      );
    }
    const sorted = [...list];
    switch (sortMode) {
      case 'price_asc':
        sorted.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        sorted.sort((a, b) => b.price - a.price);
        break;
      case 'popularity':
        // Proxy: items already in any cart bubble up first, then newest.
        sorted.sort((a, b) => {
          const aInCart = cart.some((c) => c.product_id === a.id) ? 1 : 0;
          const bInCart = cart.some((c) => c.product_id === b.id) ? 1 : 0;
          return bInCart - aInCart;
        });
        break;
      case 'newest':
      default:
        // already returned in created_at DESC from API
        break;
    }
    return sorted;
  }, [products, activeMenuCategory, search, sortMode, cart]);

  const menuCategoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      if (p.menuCategory) {
        counts.set(p.menuCategory, (counts.get(p.menuCategory) || 0) + 1);
      }
    }
    return counts;
  }, [products]);

  const cartTotal = useMemo(
    () => cart.reduce((s, c) => s + c.price * c.quantity, 0),
    [cart],
  );

  const handleAdd = (product: Product) => {
    if (!merchant) return;
    const variantId = product.hasVariants ? selectedVariants[product.id] : undefined;
    if (product.hasVariants && !variantId) { alert('Select an available variant.'); return; }
    const variant = product.variants?.find(item => item.id === variantId);
    if (variant && variant.availabilityStatus !== 'Available') { alert('This variant is out of stock.'); return; }
    if (product.availabilityStatus !== 'Available') {
      alert('This item is out of stock.');
      return;
    }
    cartAdd(merchant.id, {
      product_id: product.id,
      product_name: product.name,
      price: Number(variant?.price ?? product.price),
      image_url: product.image_url || undefined,
      merchant_id: merchant.id,
      shop_id: selectedShopId || undefined,
      variant_id: variantId,
      variant_name: variant?.optionValues?.map(link => link.optionValue.value).filter(Boolean).join(' / ') || undefined,
    });
  };

  const handleInc = (productId: number) => {
    if (!merchant) return;
    const current = cart.find((c) => c.product_id === productId);
    const product = products.find((p) => p.id === productId);
    const nextQty = (current?.quantity || 0) + 1;
    cartUpdateQty(merchant.id, productId, nextQty);
  };

  const handleDec = (productId: number) => {
    if (!merchant) return;
    const current = cart.find((c) => c.product_id === productId);
    const nextQty = (current?.quantity || 0) - 1;
    if (nextQty <= 0) {
      removeFromCart(merchant.id, productId);
    } else {
      cartUpdateQty(merchant.id, productId, nextQty);
    }
  };

  const getInCartQty = (productId: number): number =>
    cart.find((c) => c.product_id === productId)?.quantity || 0;

  const goToCheckout = () => {
    if (!merchant) return;
    const query = tableTag
      ? `?merchant=${merchant.id}&table=${encodeURIComponent(tableTag)}`
      : `?merchant=${merchant.id}`;
    router.push(`/customer/checkout${query}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto p-4 space-y-3">
          <div className="h-40 bg-gray-200 rounded-2xl animate-pulse" />
          <div className="h-10 bg-gray-200 rounded-xl animate-pulse w-1/2" />
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-44 bg-gray-200 rounded-xl animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !merchant) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-gray-700 font-medium mb-1">Merchant not found</p>
          <p className="text-sm text-gray-500 mb-4">
            {error || 'This merchant may have been removed or is inactive.'}
          </p>
          <Link
            href="/customer/categories"
            className="inline-block px-5 py-2 rounded-full bg-[#DB0002] text-white text-sm font-semibold"
          >
            Browse Categories
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      {/* Merchant marketplace header */}
      <div className="mx-auto max-w-3xl px-4 pt-4">
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#171313] via-[#60200c] to-[#1a1717] p-5 text-white shadow-xl sm:p-7">
          <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(#fff_1px,transparent_1px)] [background-size:28px_28px]" />
          <button
            onClick={() => router.back()}
            className="relative z-10 mb-5 flex size-10 items-center justify-center rounded-full bg-white text-gray-700 shadow-md"
            title="Go back"
          >
            <svg
              className="w-5 h-5 text-gray-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <div className="relative flex items-center gap-4 sm:gap-6">
            <div className="relative size-20 shrink-0 overflow-hidden rounded-2xl border-4 border-white bg-white sm:size-28">
              {merchant.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={merchant.logo_url}
                  alt={merchant.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-3xl font-black text-gray-500">
                  {merchant.name.charAt(0)}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="truncate text-2xl font-black sm:text-3xl">
                  {merchant.name}
                </h1>
                {merchant.is_verified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-1 text-[10px] font-bold text-white">
                    <svg
                      className="w-3 h-3"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Verified
                  </span>
                )}
              </div>
              {merchant.description && (
                <p className="mt-1 line-clamp-2 text-xs text-white/80 sm:text-sm">
                  {merchant.description}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-white/80">
                {merchant.rating != null && Number(merchant.rating) > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="text-yellow-400">⭐</span>
                    <span className="font-bold text-white">
                      {Number(merchant.rating).toFixed(1)}
                    </span>
                    {merchant.total_reviews != null &&
                      Number(merchant.total_reviews) > 0 && (
                        <span className="text-white/60">
                          ({merchant.total_reviews})
                        </span>
                      )}
                  </span>
                )}
                {merchant.city && (
                  <span className="flex items-center gap-1">📍 {merchant.city}</span>
                )}
                {merchant.phone && (
                  <a
                    href={`tel:${merchant.phone}`}
                    className="flex items-center gap-1 font-semibold text-white"
                  >
                    📞 {merchant.phone}
                  </a>
                )}
              </div>
              {!isDineInTransaction && (
                <div className="mt-4">
                  <Link
                    href={`/customer/reserve?merchant=${merchant.id}`}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-bold text-red-600 transition-transform active:scale-95"
                  >
                    🍽️ Reserve a Table
                  </Link>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Dine-in table banner (from scanned QR) */}
      {tableTag && (
        <div className="max-w-3xl mx-auto px-4 mt-3">
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-xl px-4 py-2.5">
            <span className="text-lg">🍽️</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Dine-in · {tableTag}</p>
              <p className="text-[11px] text-green-700">
                Your order will be sent to the kitchen for this table.
              </p>
            </div>
          </div>
        </div>
      )}

      {merchant.branches && merchant.branches.length > 1 && (
        <div className="mx-auto mt-3 max-w-3xl px-4">
          <label className="block rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">Shopping from
            <select value={selectedShopId || ''} onChange={event => { const params = new URLSearchParams(searchParams.toString()); params.set('shop', event.target.value); router.replace(`/merchants/${slug}?${params.toString()}`); }} className="mt-2 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 font-medium text-gray-900">
              {merchant.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}{branch.city ? ` · ${branch.city}` : ''}</option>)}
            </select>
          </label>
        </div>
      )}

      {/* Filters */}
      <div className="max-w-3xl mx-auto px-4 mt-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products..."
              className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl bg-white border border-gray-200 focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
            />
          </div>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="px-3 py-2.5 text-sm rounded-xl bg-white border border-gray-200 focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
            title="Sort by"
          >
            <option value="newest">Newest</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="popularity">Popularity</option>
          </select>
        </div>

        {menuCategoryCounts.size > 0 && (
          <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
            <button
              onClick={() => setActiveMenuCategory(null)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                activeMenuCategory === null
                  ? 'bg-[#DB0002] text-white shadow-sm'
                  : 'bg-white text-gray-700 border border-gray-200'
              }`}
            >
              All ({products.length})
            </button>
            {[...menuCategoryCounts.entries()].map(([name, count]) => {
              return (
                <button
                  key={name}
                  onClick={() =>
                    setActiveMenuCategory(activeMenuCategory === name ? null : name)
                  }
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    activeMenuCategory === name
                      ? 'bg-[#DB0002] text-white shadow-sm'
                      : 'bg-white text-gray-700 border border-gray-200'
                  }`}
                >
                  {name} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Products grid */}
      <div className="max-w-3xl mx-auto px-4 mt-3">
        {filteredProducts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 py-12 text-center">
            <span className="text-4xl mb-3 block">🛍️</span>
            <p className="text-gray-700 font-medium">No products available</p>
            <p className="text-xs text-gray-500 mt-1">
              {search || activeMenuCategory
                ? 'Try clearing your filters'
                : 'This merchant hasn\u2019t added items yet'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredProducts.map((product) => {
              const inCart = getInCartQty(product.id);
              const selectedVariant = product.variants?.find(item => item.id === selectedVariants[product.id]);
              const outOfStock = product.hasVariants ? Boolean(selectedVariant && selectedVariant.availabilityStatus !== 'Available') : product.availabilityStatus !== 'Available';
              return (
                <div
                  key={product.id}
                  className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm flex flex-col"
                >
                  <div className="relative aspect-square bg-gray-100">
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image_url}
                        alt={product.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl text-gray-300">
                        🍽️
                      </div>
                    )}
                    {product.menuBadge && !outOfStock && (
                      <span className="absolute left-2 top-2 rounded-full bg-red-600 px-2 py-1 text-[9px] font-black text-white">
                        {product.menuBadge}
                      </span>
                    )}
                    {outOfStock && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <span className="text-xs font-bold text-white bg-red-600 px-2 py-1 rounded-full">
                          Out of stock
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="p-3 flex flex-col flex-1">
                    <h3 className="text-sm font-bold text-gray-900 line-clamp-2 min-h-[2.5rem]">
                      {product.name}
                    </h3>
                    {product.description && (
                      <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">
                        {product.description}
                      </p>
                    )}
                    {product.notes?.length ? <div className="mt-2 space-y-1">{product.notes.map((note, noteIndex) => <div key={`${note.title}-${noteIndex}`} className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[10px] text-amber-900">{note.iconUrl ? <img src={note.iconUrl} alt="" className="h-5 w-5 rounded object-cover" /> : <span>📝</span>}<span><strong>{note.title}</strong>{note.text ? ` — ${note.text}` : ''}</span></div>)}</div> : null}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-base font-black text-[#DB0002]">
                        ₱{Number(selectedVariant?.price ?? product.price).toFixed(2)}
                      </span>
                      {product.quantity != null && product.quantity > 0 && (
                        <span className="text-[10px] text-gray-400">
                          {product.quantity} left
                        </span>
                      )}
                    </div>
                    <div className="mt-3">
                      {product.hasVariants && product.variants?.length ? <select value={selectedVariants[product.id] || ''} onChange={event => setSelectedVariants(current => ({ ...current, [product.id]: Number(event.target.value) }))} disabled={inCart > 0} className="mb-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"><option value="">Select variant</option>{product.variants.map(variant => <option key={variant.id} value={variant.id} disabled={variant.availabilityStatus !== 'Available'}>{variant.optionValues?.map(link => link.optionValue.value).join(' / ') || variant.sku} — ₱{Number(variant.price ?? product.price).toFixed(2)}{variant.availabilityStatus !== 'Available' ? ' — Out of Stock' : ''}</option>)}</select> : null}
                      {inCart === 0 ? (
                        <button
                          onClick={() => handleAdd(product)}
                          disabled={outOfStock || Boolean(product.hasVariants && !selectedVariants[product.id])}
                          className="w-full py-2 rounded-xl bg-[#DB0002] text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-transform"
                        >
                          Add to Cart
                        </button>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <button
                            onClick={() => handleDec(product.id)}
                            className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600"
                            title="Decrease"
                          >
                            −
                          </button>
                          <span className="text-sm font-bold text-gray-900">
                            {inCart}
                          </span>
                          <button
                            onClick={() => handleInc(product.id)}
                            className="w-8 h-8 rounded-lg bg-[#DB0002] text-white flex items-center justify-center"
                            title="Increase"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating cart bar */}
      {cartCount > 0 && (
        <div className="fixed bottom-20 lg:bottom-6 left-0 right-0 z-30 px-4 pointer-events-none">
          <button
            onClick={goToCheckout}
            className="pointer-events-auto mx-auto w-full max-w-md flex items-center justify-between gap-3 bg-[#DB0002] text-white rounded-2xl px-5 py-3.5 shadow-xl shadow-red-300/40 active:scale-[0.98] transition-transform"
          >
            <span className="flex items-center gap-2 font-bold">
              <span className="relative">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z"
                  />
                </svg>
                <span className="absolute -top-2 -right-2 bg-yellow-400 text-gray-900 text-[10px] font-black rounded-full w-4 h-4 flex items-center justify-center">
                  {cartCount}
                </span>
              </span>
              View Cart
            </span>
            <span className="font-black">₱{cartTotal.toFixed(2)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
