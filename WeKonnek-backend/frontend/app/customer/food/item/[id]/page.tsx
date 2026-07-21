'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { productsApi, type Product } from '@/lib/api';
import { addToCart } from '@/lib/cart';

const SAMPLE_PRODUCT: Product = {
  id: 101,
  merchantId: 1,
  name: 'Sizzling Sisig',
  description: 'Crispy pork sisig served on a sizzling hot plate with a perfectly fried egg on top. Made with chopped pig face and ears seasoned with calamansi, chili peppers, and onions.',
  productCode: 'SS01',
  price: 189,
  quantity: 100,
  isAvailable: true,
  createdAt: '',
  updatedAt: '',
};

export default function ItemDetailPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const productId = Number(params.id);
  const merchantId = Number(searchParams.get('merchantId') || '0');
  const merchantSlug = searchParams.get('merchantSlug') || '';

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const p = await productsApi.getById(productId);
        if (!cancelled) setProduct(p);
      } catch {
        if (!cancelled) setProduct({ ...SAMPLE_PRODUCT, id: productId, merchantId: merchantId || 1 });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [productId, merchantId]);

  const totalPrice = product ? product.price * quantity : 0;

  const handleAddToCart = () => {
    if (!product) return;
    const mid = product.merchantId || merchantId;
    addToCart(mid, {
      product_id: product.id,
      product_name: product.name,
      price: product.price,
      image_url: product.imageUrl,
      merchant_id: mid,
      quantity,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#FFFAF3]">
        <div className="w-10 h-10 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#FFFAF3] px-4">
        <div className="text-5xl mb-4">😕</div>
        <h2 className="text-lg font-bold text-gray-900 mb-1">Item not found</h2>
        <button onClick={() => router.back()} className="mt-4 px-5 py-2.5 bg-[#DB0002] text-white rounded-xl font-semibold text-sm">
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFAF3] flex flex-col">
      {/* Added toast */}
      {added && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg">
          {product.name} added to cart
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-auto">
        {/* Product Image Hero */}
        <div className="relative">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.imageUrl} alt={product.name} className="w-full h-64 md:h-80 object-cover" />
          ) : (
            <div className="w-full h-64 md:h-80 bg-gradient-to-br from-[#DB0002]/15 via-orange-50 to-amber-50 flex items-center justify-center">
              <span className="text-8xl opacity-40">🍔</span>
            </div>
          )}

          {/* Back button */}
          <button
            onClick={() => router.back()}
            className="absolute top-4 left-4 w-10 h-10 bg-white/90 backdrop-blur-sm rounded-full flex items-center justify-center shadow-md"
          >
            <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* Product Details */}
        <div className="max-w-2xl mx-auto">
          <div className="bg-white px-4 py-5 -mt-4 relative rounded-t-3xl">
            <h1 className="text-2xl font-bold text-gray-900">{product.name}</h1>
            {product.description && (
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">{product.description}</p>
            )}
            <div className="mt-4">
              <span className="text-2xl font-bold text-[#DB0002]">₱{product.price.toFixed(2)}</span>
            </div>
            {!product.isAvailable && (
              <div className="mt-3 inline-flex items-center gap-1 px-3 py-1 bg-red-50 text-red-500 text-xs font-semibold rounded-lg">
                Currently unavailable
              </div>
            )}
          </div>

          {/* Quantity Selector */}
          <div className="bg-white px-4 py-4 mt-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-900">Quantity</span>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="w-10 h-10 border border-gray-200 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                  disabled={quantity <= 1}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                </button>
                <span className="text-xl font-bold text-gray-900 w-8 text-center">{quantity}</span>
                <button
                  onClick={() => setQuantity((q) => q + 1)}
                  className="w-10 h-10 bg-[#DB0002] text-white rounded-xl flex items-center justify-center active:bg-[#B80002] transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Back to store link */}
          {merchantSlug && (
            <div className="px-4 py-3">
              <button
                onClick={() => router.push(`/customer/food/${merchantSlug}`)}
                className="text-sm text-[#DB0002] font-medium flex items-center gap-1 hover:underline"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to menu
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        <div className="max-w-2xl mx-auto flex gap-3">
          <button
            onClick={handleAddToCart}
            disabled={!product.isAvailable}
            className="flex-1 py-3.5 bg-white border-2 border-[#DB0002] text-[#DB0002] rounded-2xl font-semibold text-[15px] active:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add to Cart
          </button>
          <button
            onClick={() => {
              handleAddToCart();
              router.push('/customer/cart');
            }}
            disabled={!product.isAvailable}
            className="flex-[2] py-3.5 bg-[#DB0002] text-white rounded-2xl font-semibold text-[15px] flex items-center justify-center gap-2 active:bg-[#B80002] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Order Now
            <span className="font-bold">₱{totalPrice.toFixed(0)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
