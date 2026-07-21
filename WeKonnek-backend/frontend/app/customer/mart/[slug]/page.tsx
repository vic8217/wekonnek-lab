'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { merchantsApi, productsApi, type Merchant, type Product } from '@/lib/api';
import { addToCart, getCart, updateQuantity, onCartChange, type CartItem } from '@/lib/cart';

const PRODUCT_EMOJIS = ['🥬', '🍎', '🧴', '🥛', '🍞', '💊', '🧊', '🥤', '🧹', '🍳'];

const SAMPLE_PRODUCTS: Product[] = [
  { id: 201, merchantId: 10, name: 'Whole Chicken (1kg)', description: 'Fresh whole chicken, locally sourced', productCode: 'GR01', price: 185, quantity: 100, isAvailable: true, createdAt: '', updatedAt: '' },
  { id: 202, merchantId: 10, name: 'Jasmine Rice (5kg)', description: 'Premium Thai jasmine rice', productCode: 'GR02', price: 320, quantity: 100, isAvailable: true, createdAt: '', updatedAt: '' },
  { id: 203, merchantId: 10, name: 'Coke 1.5L', description: 'Coca-Cola original taste', productCode: 'GR03', price: 68, quantity: 100, isAvailable: true, createdAt: '', updatedAt: '' },
  { id: 204, merchantId: 10, name: 'Safeguard Soap 3-pack', description: 'Antibacterial bar soap', productCode: 'GR04', price: 89, quantity: 100, isAvailable: true, createdAt: '', updatedAt: '' },
  { id: 205, merchantId: 10, name: 'Biogesic 500mg (20 tabs)', description: 'Paracetamol for fever and pain relief', productCode: 'GR05', price: 45, quantity: 100, isAvailable: true, createdAt: '', updatedAt: '' },
  { id: 206, merchantId: 10, name: 'Fresh Eggs (12pcs)', description: 'Free-range chicken eggs', productCode: 'GR06', price: 110, quantity: 100, isAvailable: true, createdAt: '', updatedAt: '' },
];

export default function MartStoreDetailPage() {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;

  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('All');
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const refreshCart = useCallback((merchantId: number) => {
    setCartItems(getCart(merchantId));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const m = await merchantsApi.getBySlug(slug);
        if (cancelled) return;
        setMerchant(m);
        refreshCart(m.id);

        try {
          const allProducts = await productsApi.getAll();
          const storeProducts = allProducts.filter((p) => p.merchantId === m.id);
          if (!cancelled) setProducts(storeProducts.length > 0 ? storeProducts : SAMPLE_PRODUCTS);
        } catch {
          if (!cancelled) setProducts(SAMPLE_PRODUCTS);
        }
      } catch {
        if (!cancelled) {
          setMerchant({
            id: 10, name: 'Mart Store', slug, rating: 4.3, totalReviews: 200,
            isActive: true, isVerified: true, country: 'PH', businessType: 'storefront',
            address: 'Makati City', createdAt: '', updatedAt: '',
          });
          setProducts(SAMPLE_PRODUCTS);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [slug, refreshCart]);

  useEffect(() => {
    if (!merchant) return;
    return onCartChange(() => refreshCart(merchant.id));
  }, [merchant, refreshCart]);

  const categories = ['All', ...new Set(
    products
      .map((p) => p.category?.name || p.subCategory?.name)
      .filter(Boolean) as string[]
  )];

  const filteredProducts = activeCategory === 'All'
    ? products
    : products.filter((p) => {
        const cat = p.category?.name || p.subCategory?.name || '';
        return cat === activeCategory;
      });

  const getItemQty = (productId: number): number => {
    return cartItems.find((i) => i.product_id === productId)?.quantity || 0;
  };

  const handleAdd = (product: Product) => {
    if (!merchant) return;
    addToCart(merchant.id, {
      product_id: product.id,
      product_name: product.name,
      price: product.price,
      image_url: product.imageUrl,
      merchant_id: merchant.id,
    });
    setToast(`${product.name} added`);
    setTimeout(() => setToast(null), 1200);
  };

  const handleQtyChange = (productId: number, delta: number) => {
    if (!merchant) return;
    const current = getItemQty(productId);
    updateQuantity(merchant.id, productId, current + delta);
  };

  const cartCount = cartItems.reduce((s, i) => s + i.quantity, 0);
  const cartTotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#FFFAF3]">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!merchant) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#FFFAF3] px-4">
        <div className="text-5xl mb-4">😕</div>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Store not found</h2>
        <button onClick={() => router.back()} className="mt-4 px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-semibold text-sm">
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFAF3] pb-24">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* Hero */}
      <div className="relative">
        {merchant.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={merchant.coverImageUrl} alt={merchant.name} className="w-full h-48 md:h-64 object-cover" />
        ) : (
          <div className="w-full h-48 md:h-64 bg-gradient-to-br from-emerald-500/20 to-teal-100 flex items-center justify-center">
            <span className="text-7xl opacity-40">🛒</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />

        <button
          onClick={() => router.back()}
          className="absolute top-4 left-4 w-10 h-10 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-md"
        >
          <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{merchant.name}</h1>
              {merchant.isVerified && (
                <span className="bg-green-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">VERIFIED</span>
              )}
            </div>
            <p className="text-sm text-white/80 mt-1">
              {merchant.category?.name || 'Store'} {merchant.address ? `· ${merchant.address}` : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Info bar */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1 bg-amber-50 px-3 py-1.5 rounded-lg">
            <span className="text-sm">⭐</span>
            <span className="text-sm font-bold text-gray-900">{Number(merchant.rating).toFixed(1)}</span>
          </div>
          <span className="text-sm text-gray-500">{merchant.totalReviews} reviews</span>
          <span className="text-gray-300">|</span>
          <div className="flex items-center gap-1 text-sm text-gray-500">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            25-45 min
          </div>
        </div>
      </div>

      {/* Category Tabs */}
      {categories.length > 1 && (
        <div className="sticky top-0 z-10 bg-white border-b border-gray-100">
          <div className="max-w-4xl mx-auto px-4 overflow-x-auto scrollbar-hide">
            <div className="flex gap-2 py-3 min-w-max">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                    activeCategory === cat
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Products */}
      <div className="max-w-4xl mx-auto px-4 mt-4">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Products</h2>

        {filteredProducts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <div className="text-5xl mb-3">📦</div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">No products yet</h3>
            <p className="text-sm text-gray-500">This store hasn&apos;t added any products.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {filteredProducts.map((product, idx) => {
              const qty = getItemQty(product.id);
              return (
                <div
                  key={product.id}
                  className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm"
                >
                  {/* Product image */}
                  <div className="aspect-square relative overflow-hidden">
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center">
                        <span className="text-4xl">{PRODUCT_EMOJIS[idx % PRODUCT_EMOJIS.length]}</span>
                      </div>
                    )}
                    {!product.isAvailable && (
                      <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                        <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded">OUT OF STOCK</span>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-3">
                    <h3 className="font-semibold text-sm text-gray-900 line-clamp-2 leading-tight min-h-[2.5rem]">
                      {product.name}
                    </h3>
                    <p className="text-base font-bold text-emerald-700 mt-1">
                      ₱{product.price.toFixed(2)}
                    </p>

                    {/* Inline quantity controls */}
                    <div className="mt-2">
                      {qty > 0 ? (
                        <div className="flex items-center justify-between bg-emerald-50 rounded-lg px-1 py-0.5">
                          <button
                            onClick={() => handleQtyChange(product.id, -1)}
                            className="w-8 h-8 flex items-center justify-center text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
                            </svg>
                          </button>
                          <span className="text-sm font-bold text-gray-900">{qty}</span>
                          <button
                            onClick={() => handleQtyChange(product.id, 1)}
                            className="w-8 h-8 flex items-center justify-center bg-emerald-600 text-white rounded-lg transition-colors active:bg-emerald-700"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleAdd(product)}
                          disabled={!product.isAvailable}
                          className="w-full py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg active:bg-emerald-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Add to Cart
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Cart Bar */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 p-3 bg-white/80 backdrop-blur-lg border-t border-gray-100">
          <Link
            href="/customer/cart"
            className="max-w-4xl mx-auto flex items-center gap-3 bg-emerald-600 text-white rounded-2xl px-4 py-3.5 shadow-lg active:bg-emerald-700 transition-colors"
          >
            <span className="bg-white/20 text-sm font-bold px-2.5 py-1 rounded-lg">
              {cartCount}
            </span>
            <span className="flex-1 font-semibold text-[15px]">View Cart</span>
            <span className="font-bold text-[15px]">₱{cartTotal.toFixed(0)}</span>
          </Link>
        </div>
      )}
    </div>
  );
}
