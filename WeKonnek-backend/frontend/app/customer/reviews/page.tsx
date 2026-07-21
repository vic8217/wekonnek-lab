'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface ReviewableOrder {
  id: number;
  order_code: string;
  merchant_id: number;
  merchant_name: string;
  created_at: string;
  items: { product_id: number; product_name: string }[];
  has_review: boolean;
}

interface ExistingReview {
  id: number;
  merchant_id: number;
  product_id: number | null;
  rating: number;
  review_text: string;
  response_text: string | null;
  created_at: string;
  merchant_name: string;
  product_name: string;
}

export default function CustomerReviewsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'write' | 'history'>('write');
  const [reviewableOrders, setReviewableOrders] = useState<ReviewableOrder[]>([]);
  const [existingReviews, setExistingReviews] = useState<ExistingReview[]>([]);
  const [loading, setLoading] = useState(true);

  const [showReviewForm, setShowReviewForm] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<ReviewableOrder | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const { user: authUser } = useAuth();

  useEffect(() => { if (authUser) fetchData(); }, [authUser]);

  const fetchData = async () => {
    try {
      const token = await getToken();
      if (!token) return;

      let ordersData: any[] = [];
      try {
        const ordersRes = await fetch(`${API}/api/orders?status=completed`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (ordersRes.ok) {
          const json = await ordersRes.json();
          ordersData = Array.isArray(json) ? json : json.data || [];
        }
      } catch { /* non-critical */ }

      let reviewsData: any[] = [];
      try {
        const reviewsRes = await fetch(`${API}/api/reviews`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (reviewsRes.ok) {
          const json = await reviewsRes.json();
          reviewsData = Array.isArray(json) ? json : json.data || [];
        }
      } catch { /* non-critical */ }

      const reviewedMerchants = new Set(reviewsData.map((r: any) => `${r.merchant_id || r.merchantId}`));

      setReviewableOrders(ordersData.map((o: any) => ({
        id: o.id,
        order_code: o.order_code || o.orderCode,
        merchant_id: o.merchant_id || o.merchantId,
        merchant_name: o.merchants?.name || o.merchant?.name || 'Unknown',
        created_at: o.created_at || o.createdAt,
        items: (o.order_items || o.orderItems || []).map((i: any) => ({
          product_id: i.product_id || i.productId,
          product_name: i.product_name || i.productName,
        })),
        has_review: reviewedMerchants.has(`${o.merchant_id || o.merchantId}`),
      })));

      setExistingReviews(reviewsData.map((r: any) => ({
        id: r.id,
        merchant_id: r.merchant_id || r.merchantId,
        product_id: r.product_id || r.productId,
        rating: r.rating,
        review_text: r.review_text || r.reviewText || '',
        response_text: r.response_text || r.responseText,
        created_at: r.created_at || r.createdAt,
        merchant_name: r.merchants?.name || r.merchant?.name || 'Unknown',
        product_name: r.products?.name || r.product?.name || 'General',
      })));
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const openReviewForm = (order: ReviewableOrder) => {
    setSelectedOrder(order);
    setReviewRating(5);
    setReviewText('');
    setSelectedProductId(order.items.length > 0 ? order.items[0].product_id : null);
    setShowReviewForm(true);
    setSubmitSuccess(false);
  };

  const submitReview = async () => {
    if (!selectedOrder) return;
    try {
      setSubmitting(true);
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`${API}/api/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          merchant_id: selectedOrder.merchant_id,
          product_id: selectedProductId,
          rating: reviewRating,
          review_text: reviewText,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to submit review');
      }

      setSubmitSuccess(true);
      setTimeout(() => {
        setShowReviewForm(false);
        setSubmitSuccess(false);
        fetchData();
      }, 1500);
    } catch (error: any) {
      console.error('Error submitting review:', error);
      alert(error.message || 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  };

  const renderStars = (rating: number, size = 'w-4 h-4') => (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg key={star} className={`${size} ${star <= rating ? 'text-yellow-400' : 'text-gray-200'}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      ))}
    </div>
  );

  const ratingLabels = ['', '😞 Terrible', '😕 Poor', '😐 Okay', '😊 Great', '🎉 Excellent!'];

  const getTimeAgo = (date: string) => {
    const now = new Date();
    const d = new Date(date);
    const diffMs = now.getTime() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  };

  const pendingReviews = reviewableOrders.filter(o => !o.has_review);

  // Compute average rating for stats
  const avgRating = existingReviews.length > 0
    ? (existingReviews.reduce((s, r) => s + r.rating, 0) / existingReviews.length).toFixed(1)
    : '0.0';
  const ratingDistribution = [5, 4, 3, 2, 1].map(r => ({
    rating: r,
    count: existingReviews.filter(rev => rev.rating === r).length,
    pct: existingReviews.length > 0 ? (existingReviews.filter(rev => rev.rating === r).length / existingReviews.length) * 100 : 0,
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-gray-400">Loading reviews...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ========== MOBILE REVIEWS ========== */}
      <div className="lg:hidden min-h-screen bg-gray-50 pb-20">
        {/* Sticky Header */}
        <div className="sticky top-0 z-20 bg-white safe-area-top shadow-sm">
          <div className="px-4 pt-4 pb-2 flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-900">My Reviews</h1>
            {existingReviews.length > 0 && (
              <div className="flex items-center gap-1.5 bg-yellow-50 px-2.5 py-1 rounded-full">
                <svg className="w-3.5 h-3.5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                <span className="text-xs font-bold text-yellow-700">{avgRating}</span>
                <span className="text-[10px] text-yellow-600">({existingReviews.length})</span>
              </div>
            )}
          </div>
          {/* Tab Bar */}
          <div className="flex px-4 gap-1">
            <button
              onClick={() => setActiveTab('write')}
              className={`flex-1 py-2.5 text-center text-sm font-semibold transition-all duration-200 relative ${
                activeTab === 'write' ? 'text-[#DB0002]' : 'text-gray-400'
              }`}
            >
              To Review
              {pendingReviews.length > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#DB0002] text-white text-[10px] font-bold">
                  {pendingReviews.length}
                </span>
              )}
              {activeTab === 'write' && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#DB0002] rounded-full" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-2.5 text-center text-sm font-semibold transition-all duration-200 relative ${
                activeTab === 'history' ? 'text-[#DB0002]' : 'text-gray-400'
              }`}
            >
              History ({existingReviews.length})
              {activeTab === 'history' && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-[#DB0002] rounded-full" />
              )}
            </button>
          </div>
        </div>

        {/* Write Tab — Pending Reviews */}
        {activeTab === 'write' && (
          <div className="px-4 py-3 space-y-3 mobile-scroll">
            {pendingReviews.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-24 h-24 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <span className="text-4xl">⭐</span>
                </div>
                <p className="text-gray-800 font-bold text-base">All caught up!</p>
                <p className="text-xs text-gray-400 mt-1 max-w-[220px] mx-auto">Complete orders to unlock reviews and share your experience</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-gray-400 px-0.5">Tap to rate your recent orders</p>
                {pendingReviews.map((order) => (
                  <div
                    key={order.id}
                    className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 mobile-press"
                    onClick={() => openReviewForm(order)}
                  >
                    <div className="p-4">
                      <div className="flex items-center gap-3">
                        {/* Merchant avatar */}
                        <div className="w-12 h-12 bg-gradient-to-br from-orange-100 to-red-50 rounded-2xl flex items-center justify-center flex-shrink-0">
                          <span className="text-xl">🍽️</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold text-gray-900 truncate">{order.merchant_name}</h3>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            #{order.order_code} • {getTimeAgo(order.created_at)}
                          </p>
                        </div>
                        <div className="flex-shrink-0">
                          <div className="w-8 h-8 bg-[#DB0002]/10 rounded-xl flex items-center justify-center">
                            <svg className="w-4 h-4 text-[#DB0002]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </div>
                        </div>
                      </div>
                      {/* Items */}
                      {order.items.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {order.items.slice(0, 3).map((item, idx) => (
                            <span key={idx} className="text-[10px] bg-gray-50 text-gray-500 px-2 py-0.5 rounded-full">
                              {item.product_name}
                            </span>
                          ))}
                          {order.items.length > 3 && (
                            <span className="text-[10px] bg-gray-50 text-gray-400 px-2 py-0.5 rounded-full">
                              +{order.items.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                      {/* Stars placeholder */}
                      <div className="flex gap-1 mt-3">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <svg key={star} className="w-5 h-5 text-gray-200" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        ))}
                        <span className="text-[11px] text-gray-400 ml-1">Tap to rate</span>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <div className="mobile-scroll">
            {existingReviews.length === 0 ? (
              <div className="text-center py-20 px-4">
                <div className="w-24 h-24 bg-gradient-to-br from-gray-50 to-gray-100 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <span className="text-4xl">📝</span>
                </div>
                <p className="text-gray-800 font-bold text-base">No reviews yet</p>
                <p className="text-xs text-gray-400 mt-1 max-w-[220px] mx-auto">Your review history will appear here after you rate an order</p>
              </div>
            ) : (
              <>
                {/* Rating Summary Card */}
                <div className="mx-4 mt-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-center gap-4">
                    {/* Big average */}
                    <div className="text-center">
                      <p className="text-3xl font-black text-gray-900">{avgRating}</p>
                      <div className="flex gap-0.5 mt-1 justify-center">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <svg key={star} className={`w-3 h-3 ${star <= Math.round(Number(avgRating)) ? 'text-yellow-400' : 'text-gray-200'}`} fill="currentColor" viewBox="0 0 20 20">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        ))}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5">{existingReviews.length} reviews</p>
                    </div>
                    {/* Distribution bars */}
                    <div className="flex-1 space-y-1">
                      {ratingDistribution.map((d) => (
                        <div key={d.rating} className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-500 w-3 text-right">{d.rating}</span>
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-yellow-400 rounded-full transition-all duration-500"
                              style={{ width: `${d.pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-gray-400 w-4">{d.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Review List */}
                <div className="px-4 py-3 space-y-3">
                  {existingReviews.map((review) => (
                    <div key={review.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="p-4">
                        {/* Header */}
                        <div className="flex items-start justify-between mb-1.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 bg-gradient-to-br from-red-50 to-orange-50 rounded-xl flex items-center justify-center flex-shrink-0">
                              <span className="text-sm">🏪</span>
                            </div>
                            <div>
                              <h3 className="text-sm font-bold text-gray-900">{review.merchant_name}</h3>
                              <p className="text-[10px] text-gray-400">{review.product_name}</p>
                            </div>
                          </div>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">{getTimeAgo(review.created_at)}</span>
                        </div>

                        {/* Stars & Rating */}
                        <div className="flex items-center gap-2 mt-2 mb-2">
                          {renderStars(review.rating, 'w-3.5 h-3.5')}
                          <span className="text-[11px] font-semibold text-gray-500">
                            {ratingLabels[review.rating] || ''}
                          </span>
                        </div>

                        {/* Review Text */}
                        {review.review_text && (
                          <p className="text-xs text-gray-600 leading-relaxed">{review.review_text}</p>
                        )}

                        {/* Merchant Response */}
                        {review.response_text && (
                          <div className="mt-3 bg-gradient-to-r from-gray-50 to-gray-50/50 rounded-xl p-3 border-l-2 border-[#DB0002]">
                            <div className="flex items-center gap-1.5 mb-1">
                              <svg className="w-3 h-3 text-[#DB0002]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                              </svg>
                              <p className="text-[10px] font-bold text-[#DB0002] uppercase tracking-wider">Merchant Reply</p>
                            </div>
                            <p className="text-xs text-gray-600 leading-relaxed">{review.response_text}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ====== Review Form — Mobile Full-Screen Bottom Sheet ====== */}
        {showReviewForm && selectedOrder && (
          <div className="fixed inset-0 z-50">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => !submitting && setShowReviewForm(false)}
            />

            {/* Sheet */}
            <div className="absolute bottom-0 left-0 right-0 bg-white max-h-[92vh] rounded-t-3xl overflow-y-auto safe-area-bottom animate-slideUp">
              {/* Handle bar */}
              <div className="sticky top-0 bg-white z-10 flex justify-center py-3 rounded-t-3xl">
                <div className="w-10 h-1 bg-gray-300 rounded-full" />
              </div>

              {/* Success State */}
              {submitSuccess ? (
                <div className="flex flex-col items-center justify-center py-16 px-6">
                  <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-gray-900">Thank you!</h3>
                  <p className="text-sm text-gray-500 mt-1">Your review has been submitted</p>
                </div>
              ) : (
                <>
                  {/* Header */}
                  <div className="px-5 pb-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-gray-900">Rate Your Experience</h3>
                      <button
                        onClick={() => setShowReviewForm(false)}
                        className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center mobile-press"
                        title="Close review form"
                      >
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    {/* Merchant Info */}
                    <div className="flex items-center gap-2.5 mt-2 bg-gray-50 rounded-xl px-3 py-2">
                      <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                        <span className="text-sm">🍽️</span>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{selectedOrder.merchant_name}</p>
                        <p className="text-[10px] text-gray-400">Order #{selectedOrder.order_code}</p>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 py-4 space-y-5">
                    {/* Star Rating */}
                    <div className="text-center py-5 bg-gradient-to-b from-yellow-50/80 to-transparent rounded-2xl">
                      <p className="text-sm font-medium text-gray-600 mb-3">How was your experience?</p>
                      <div className="flex justify-center gap-2">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            onClick={() => setReviewRating(star)}
                            className="transition-all duration-150 mobile-press active:scale-90"
                            title={`Rate ${star} star${star > 1 ? 's' : ''}`}
                          >
                            <svg
                              className={`w-11 h-11 transition-all duration-200 ${
                                star <= reviewRating
                                  ? 'text-yellow-400 drop-shadow-sm'
                                  : 'text-gray-200'
                              }`}
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                            </svg>
                          </button>
                        ))}
                      </div>
                      <p className="text-sm text-gray-500 mt-2.5 font-semibold">
                        {ratingLabels[reviewRating]}
                      </p>
                    </div>

                    {/* Product Selection */}
                    {selectedOrder.items.length > 1 && (
                      <div>
                        <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Product</label>
                        <select
                          value={selectedProductId || ''}
                          onChange={(e) => setSelectedProductId(e.target.value ? parseInt(e.target.value) : null)}
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none appearance-none"
                        >
                          {selectedOrder.items.map((item) => (
                            <option key={item.product_id} value={item.product_id}>{item.product_name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Review Text */}
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Your Review</label>
                      <textarea
                        value={reviewText}
                        onChange={(e) => setReviewText(e.target.value)}
                        placeholder="Tell others about your experience..."
                        rows={4}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none resize-none leading-relaxed"
                      />
                      <p className="text-[10px] text-gray-400 mt-1 text-right">{reviewText.length}/500</p>
                    </div>
                  </div>

                  {/* Submit Area */}
                  <div className="px-5 pb-6 pt-2 flex gap-3">
                    <button
                      onClick={() => setShowReviewForm(false)}
                      disabled={submitting}
                      className="flex-1 py-3.5 border-2 border-gray-200 text-gray-600 rounded-2xl font-semibold text-sm mobile-press active:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitReview}
                      disabled={submitting || !reviewText.trim()}
                      className="flex-1 py-3.5 bg-[#DB0002] text-white rounded-2xl font-bold text-sm disabled:opacity-40 mobile-press active:bg-[#B80002] transition-all duration-200 shadow-lg shadow-red-200/50"
                    >
                      {submitting ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Sending...
                        </span>
                      ) : (
                        'Submit Review'
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ========== DESKTOP REVIEWS ========== */}
      <div className="hidden lg:block space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">My Reviews</h1>
          <p className="text-gray-600">Rate your purchases and see your review history</p>
        </div>

        <div className="flex space-x-2 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('write')}
            className={`px-6 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'write' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Write a Review ({pendingReviews.length})
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-6 py-3 font-medium border-b-2 transition-colors ${
              activeTab === 'history' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            My Reviews ({existingReviews.length})
          </button>
        </div>

        {activeTab === 'write' && (
          <div className="space-y-4">
            {pendingReviews.length === 0 ? (
              <div className="bg-white rounded-lg p-12 text-center border border-gray-200">
                <p className="text-gray-500 text-lg">No pending reviews</p>
                <p className="text-gray-400 text-sm mt-1">Complete some orders to leave reviews</p>
              </div>
            ) : (
              pendingReviews.map((order) => (
                <div key={order.id} className="bg-white rounded-lg p-6 border border-gray-200">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-gray-900">{order.merchant_name}</h3>
                      <p className="text-sm text-gray-500">Order {order.order_code} • {new Date(order.created_at).toLocaleDateString()}</p>
                      <p className="text-sm text-gray-500 mt-1">{order.items.map(i => i.product_name).join(', ')}</p>
                    </div>
                    <button
                      onClick={() => openReviewForm(order)}
                      className="px-4 py-2 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors text-sm font-medium"
                    >
                      Write Review
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-4">
            {existingReviews.length === 0 ? (
              <div className="bg-white rounded-lg p-12 text-center border border-gray-200">
                <p className="text-gray-500 text-lg">No reviews yet</p>
              </div>
            ) : (
              existingReviews.map((review) => (
                <div key={review.id} className="bg-white rounded-lg p-6 border border-gray-200">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-gray-900">{review.merchant_name}</h3>
                      <p className="text-sm text-gray-500">{review.product_name} • {new Date(review.created_at).toLocaleDateString()}</p>
                    </div>
                    {renderStars(review.rating, 'w-5 h-5')}
                  </div>
                  <p className="text-gray-700">{review.review_text}</p>
                  {review.response_text && (
                    <div className="mt-4 bg-gray-50 rounded-lg p-4 border-l-4 border-[#DB0002]">
                      <p className="text-sm font-medium text-gray-900 mb-1">Merchant Response:</p>
                      <p className="text-sm text-gray-600">{review.response_text}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Desktop Review Modal */}
        {showReviewForm && selectedOrder && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-xl font-bold text-gray-900">Rate Your Experience</h3>
                <p className="text-sm text-gray-500 mt-1">{selectedOrder.merchant_name} • Order {selectedOrder.order_code}</p>
              </div>
              <div className="p-6 space-y-5">
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700 mb-3">How was your experience?</p>
                  <div className="flex justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button key={star} onClick={() => setReviewRating(star)} className="p-1 transition-transform hover:scale-110" title={`Rate ${star} stars`}>
                        <svg className={`w-10 h-10 ${star <= reviewRating ? 'text-yellow-400' : 'text-gray-300'}`} fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
                {selectedOrder.items.length > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Product</label>
                    <select
                      value={selectedProductId || ''}
                      onChange={(e) => setSelectedProductId(e.target.value ? parseInt(e.target.value) : null)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                    >
                      {selectedOrder.items.map((item) => (
                        <option key={item.product_id} value={item.product_id}>{item.product_name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Your Review</label>
                  <textarea
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                    placeholder="Share your experience..."
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none resize-none"
                  />
                </div>
              </div>
              <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
                <button onClick={() => setShowReviewForm(false)} className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">Cancel</button>
                <button onClick={submitReview} disabled={submitting} className="px-6 py-2.5 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] font-medium disabled:opacity-50">
                  {submitting ? 'Submitting...' : 'Submit Review'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
