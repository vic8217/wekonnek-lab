'use client';

import { Suspense, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import apiClient, { merchantsApi, productsApi, type Merchant, type Product } from '@/lib/api';
import { getToken } from '@/hooks/use-auth';

type MerchantCommerceDomain = Merchant['commerceDomain'];
type ProductCommerceDomain = Product['commerceDomain'];
type BuyerProductDetail = Product & {
  merchant?: { commerceDomain?: MerchantCommerceDomain; name?: string };
};

/** Matches backend CreateRfqInput. Buyer id is taken from the JWT, not this body. */
type CreateRfqInput = {
  merchantId: number;
  shopId: number;
  productId: number;
  productVariantId?: number;
  quantity: number;
  specifications?: string;
  size?: string;
  color?: string;
  customization?: string;
  requiredDate?: string;
  deliveryAddress?: string;
  notes?: string;
  submit?: boolean;
};

type CreatedRfq = {
  id: string;
  rfqNumber: string;
  status: string;
};

const fieldClass =
  'w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none';

function isRfqEligible(
  merchantDomain: MerchantCommerceDomain | undefined,
  productDomain: ProductCommerceDomain | undefined,
): boolean {
  if (merchantDomain === 'NON_FOOD') return true;
  if (merchantDomain === 'MIXED') return productDomain === 'NON_FOOD';
  return false;
}

function variantLabel(variant: NonNullable<Product['variants']>[number]): string {
  const options = variant.optionValues?.map(link => link.optionValue.value).filter(Boolean).join(' / ');
  return options || variant.sku;
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function publicApiMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Unable to submit your quote request. Please try again.';
  const response = (error as { response?: { status?: number; data?: { message?: unknown } } }).response;
  if (response?.status === 401) return 'Please sign in to request a quote.';
  const raw = response?.data?.message;
  const message = Array.isArray(raw) ? raw.filter(item => typeof item === 'string').join(', ') : raw;
  if (typeof message === 'string') {
    const trimmed = message.trim();
    if (trimmed && trimmed.length <= 280 && !trimmed.includes('\n') && !/at\s+\S+\s+\(/.test(trimmed)) {
      return trimmed;
    }
  }
  return 'Unable to submit your quote request. Please try again.';
}

function BuyerRfqCreateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryProductId = Number(searchParams.get('productId') || '');
  const queryMerchantId = Number(searchParams.get('merchantId') || '');
  const queryShopId = Number(searchParams.get('shopId') || searchParams.get('shop') || '');
  const merchantSlug = searchParams.get('merchantSlug') || '';

  const [product, setProduct] = useState<BuyerProductDetail | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedRfq | null>(null);

  const [shopId, setShopId] = useState<number | ''>('');
  const [productVariantId, setProductVariantId] = useState<number | ''>('');
  const [quantity, setQuantity] = useState(1);
  const [specifications, setSpecifications] = useState('');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [customization, setCustomization] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError('');
      if (!Number.isInteger(queryProductId) || queryProductId < 1) {
        setLoadError('This quote request is missing a product. Go back to the product page and try again.');
        setLoading(false);
        return;
      }
      try {
        const loadedProduct = await productsApi.getById(queryProductId) as BuyerProductDetail;
        if (cancelled) return;
        setProduct(loadedProduct);
        const merchantId = loadedProduct.merchantId || queryMerchantId;
        let loadedMerchant: Merchant | null = null;
        if (Number.isInteger(merchantId) && merchantId > 0) {
          try {
            loadedMerchant = await merchantsApi.getById(merchantId);
          } catch {
            loadedMerchant = null;
          }
        }
        if (cancelled) return;
        setMerchant(loadedMerchant);
        const branches = loadedMerchant?.branches || [];
        const queriedShop = Number.isInteger(queryShopId) && queryShopId > 0 ? queryShopId : null;
        const defaultShop = branches.find(branch => branch.isDefault)?.id || branches[0]?.id || queriedShop;
        setShopId(defaultShop || '');
        const firstVariant = loadedProduct.variants?.find(variant => variant.isActive !== false);
        setProductVariantId(firstVariant?.id || '');
      } catch {
        if (!cancelled) setLoadError('Unable to load this product. Go back and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [queryProductId, queryMerchantId, queryShopId]);

  const merchantDomain = merchant?.commerceDomain ?? product?.merchant?.commerceDomain ?? null;
  const eligible = isRfqEligible(merchantDomain, product?.commerceDomain);
  const merchantId = product?.merchantId || queryMerchantId;
  const shops = merchant?.branches || [];
  const activeVariants = useMemo(
    () => (product?.variants || []).filter(variant => variant.isActive !== false),
    [product],
  );

  const goBack = () => {
    if (product) {
      const query = new URLSearchParams();
      if (merchantId) query.set('merchantId', String(merchantId));
      if (merchantSlug) query.set('merchantSlug', merchantSlug);
      if (shopId) query.set('shopId', String(shopId));
      router.push(`/customer/food/item/${product.id}${query.toString() ? `?${query.toString()}` : ''}`);
      return;
    }
    router.back();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting || !product) return;
    if (!eligible) {
      toast.error('Request a Quote is unavailable for this product.');
      return;
    }
    if (!Number.isInteger(merchantId) || merchantId < 1) {
      toast.error('This quote request is missing the merchant.');
      return;
    }
    if (typeof shopId !== 'number' || shopId < 1) {
      toast.error('Select an available shop for this quote request.');
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      toast.error('Quantity must be at least one.');
      return;
    }
    if (product.hasVariants && activeVariants.length > 0 && !productVariantId) {
      toast.error('Select a product variant.');
      return;
    }
    if (!getToken()) {
      toast.error('Please sign in to request a quote.');
      router.push(`/auth/login?redirect=${encodeURIComponent(`/customer/rfq/new?${searchParams.toString()}`)}`);
      return;
    }

    const payload: CreateRfqInput = {
      merchantId,
      shopId,
      productId: product.id,
      quantity,
      submit: true,
    };
    if (typeof productVariantId === 'number') payload.productVariantId = productVariantId;
    const spec = optionalText(specifications);
    const sizeValue = optionalText(size);
    const colorValue = optionalText(color);
    const customizationValue = optionalText(customization);
    const requiredDateValue = optionalText(requiredDate);
    const deliveryAddressValue = optionalText(deliveryAddress);
    const notesValue = optionalText(notes);
    if (spec) payload.specifications = spec;
    if (sizeValue) payload.size = sizeValue;
    if (colorValue) payload.color = colorValue;
    if (customizationValue) payload.customization = customizationValue;
    if (requiredDateValue) payload.requiredDate = requiredDateValue;
    if (deliveryAddressValue) payload.deliveryAddress = deliveryAddressValue;
    if (notesValue) payload.notes = notesValue;

    setSubmitting(true);
    try {
      const response = await apiClient.post<CreatedRfq>('/backend/rfqs', payload);
      setCreated({
        id: response.data.id,
        rfqNumber: response.data.rfqNumber,
        status: response.data.status,
      });
      toast.success('Quote request submitted.');
    } catch (error) {
      toast.error(publicApiMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FFFAF3]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#DB0002] border-t-transparent" />
      </div>
    );
  }

  if (created) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-[#FFFAF3] px-4 py-8">
        <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
            <svg className="h-10 w-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Quote request submitted</h1>
          <p className="mt-2 text-sm text-gray-500">The merchant will review your request and send a quotation.</p>
          <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4 text-left text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Reference</span>
              <span className="font-mono font-semibold text-gray-900">{created.rfqNumber}</span>
            </div>
            <div className="mt-2 flex justify-between gap-3">
              <span className="text-gray-500">Status</span>
              <span className="font-semibold text-gray-900">{created.status.replaceAll('_', ' ')}</span>
            </div>
            {product && (
              <div className="mt-2 flex justify-between gap-3">
                <span className="text-gray-500">Product</span>
                <span className="font-semibold text-gray-900">{product.name}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={goBack}
            className="mt-6 w-full rounded-2xl border-2 border-[#DB0002] py-3.5 text-[15px] font-semibold text-[#DB0002] active:bg-red-50"
          >
            Back to product
          </button>
          <button
            type="button"
            onClick={() => router.push('/customer/rfq')}
            className="mt-3 w-full rounded-2xl bg-[#DB0002] py-3.5 text-[15px] font-semibold text-white active:bg-[#B80002]"
          >
            View my quote requests
          </button>
        </div>
      </div>
    );
  }

  if (loadError || !product) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center bg-[#FFFAF3] px-4">
        <h1 className="text-lg font-bold text-gray-900">Request a Quote</h1>
        <p className="mt-2 max-w-md text-center text-sm text-gray-500">{loadError || 'Product not found.'}</p>
        <button
          type="button"
          onClick={() => router.back()}
          className="mt-4 rounded-xl bg-[#DB0002] px-5 py-2.5 text-sm font-semibold text-white"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFAF3] px-4 py-6 md:py-8">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Request a Quote</h1>
          <button type="button" onClick={goBack} className="text-sm font-medium text-[#DB0002] hover:underline">
            Cancel
          </button>
        </div>

        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex gap-4">
            {product.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.thumbnailUrl || product.imageUrl} alt={product.name} className="h-24 w-24 flex-shrink-0 rounded-xl object-cover" />
            ) : (
              <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#DB0002]/10 to-orange-50 text-3xl">
                📦
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-gray-900">{product.name}</h2>
              {(merchant?.name || product.merchant?.name) && (
                <p className="mt-0.5 text-sm text-gray-500">{merchant?.name || product.merchant?.name}</p>
              )}
              {product.description && (
                <p className="mt-2 line-clamp-3 text-sm text-gray-500">{product.description}</p>
              )}
              <p className="mt-2 text-base font-bold text-[#DB0002]">₱{Number(product.price || 0).toFixed(2)}</p>
            </div>
          </div>
        </section>

        {!eligible ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
            Request a Quote is unavailable for this product.
            <button type="button" onClick={goBack} className="mt-4 block font-semibold text-[#DB0002] hover:underline">
              Back to product
            </button>
          </section>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
            {shops.length > 1 && (
              <label className="block text-sm font-semibold text-gray-900">
                Shop
                <select
                  required
                  value={shopId}
                  onChange={event => setShopId(event.target.value ? Number(event.target.value) : '')}
                  className={`${fieldClass} mt-1.5`}
                >
                  <option value="">Select shop</option>
                  {shops.map(shop => (
                    <option key={shop.id} value={shop.id}>{shop.name}</option>
                  ))}
                </select>
              </label>
            )}

            {product.hasVariants && activeVariants.length > 0 && (
              <label className="block text-sm font-semibold text-gray-900">
                Variant
                <select
                  required
                  value={productVariantId}
                  onChange={event => setProductVariantId(event.target.value ? Number(event.target.value) : '')}
                  className={`${fieldClass} mt-1.5`}
                >
                  <option value="">Select variant</option>
                  {activeVariants.map(variant => (
                    <option key={variant.id} value={variant.id}>{variantLabel(variant)}</option>
                  ))}
                </select>
              </label>
            )}

            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Quantity</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQuantity(value => Math.max(1, value - 1))}
                  disabled={quantity <= 1}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                  </svg>
                </button>
                <span className="w-8 text-center text-xl font-bold text-gray-900">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(value => value + 1)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#DB0002] text-white active:bg-[#B80002]"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
            </div>

            <label className="block text-sm font-semibold text-gray-900">
              Specifications
              <textarea value={specifications} onChange={event => setSpecifications(event.target.value)} rows={3} placeholder="Describe the item details you need quoted" className={`${fieldClass} mt-1.5 resize-y`} />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-gray-900">
                Size
                <input value={size} onChange={event => setSize(event.target.value)} className={`${fieldClass} mt-1.5`} />
              </label>
              <label className="block text-sm font-semibold text-gray-900">
                Color
                <input value={color} onChange={event => setColor(event.target.value)} className={`${fieldClass} mt-1.5`} />
              </label>
            </div>

            <label className="block text-sm font-semibold text-gray-900">
              Customization
              <textarea value={customization} onChange={event => setCustomization(event.target.value)} rows={2} className={`${fieldClass} mt-1.5 resize-y`} />
            </label>

            <label className="block text-sm font-semibold text-gray-900">
              Required date
              <input type="date" value={requiredDate} onChange={event => setRequiredDate(event.target.value)} className={`${fieldClass} mt-1.5`} />
            </label>

            <label className="block text-sm font-semibold text-gray-900">
              Delivery address
              <textarea value={deliveryAddress} onChange={event => setDeliveryAddress(event.target.value)} rows={2} className={`${fieldClass} mt-1.5 resize-y`} />
            </label>

            <label className="block text-sm font-semibold text-gray-900">
              Notes
              <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} placeholder="Anything else the merchant should know" className={`${fieldClass} mt-1.5 resize-y`} />
            </label>

            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
              <button
                type="button"
                onClick={goBack}
                disabled={submitting}
                className="flex-1 rounded-2xl border-2 border-[#DB0002] py-3.5 text-[15px] font-semibold text-[#DB0002] active:bg-red-50 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !shopId}
                className="flex-[2] rounded-2xl bg-[#DB0002] py-3.5 text-[15px] font-semibold text-white active:bg-[#B80002] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? 'Submitting…' : 'Submit quote request'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function BuyerRfqCreatePage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-[#FFFAF3]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#DB0002] border-t-transparent" />
      </div>
    }>
      <BuyerRfqCreateForm />
    </Suspense>
  );
}
