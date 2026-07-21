'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Review {
  id: number;
  user_id: string;
  merchant_id: number;
  product_id: number | null;
  rating: number;
  review_text: string;
  response_text: string | null;
  responded_at: string | null;
  created_at: string;
  user_name: string;
  user_initials: string;
  product_name: string;
}

export default function CustomerReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [averageRating, setAverageRating] = useState(0);
  const [responseRate, setResponseRate] = useState(0);
  const [newReviewsCount, setNewReviewsCount] = useState(0);
  const [respondingTo, setRespondingTo] = useState<number | null>(null);
  const [responseText, setResponseText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [filterRating, setFilterRating] = useState<number | null>(null);

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    try {
      const token = getToken();
      if (!token) return;

      const meRes = await fetch(`${API}/api/merchants/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!meRes.ok) { setLoading(false); return; }
      const merchantData = await meRes.json();

      const res = await fetch(`${API}/api/reviews?merchantId=${merchantData.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch reviews');
      const reviewsData = await res.json();

      const transformedReviews: Review[] = (Array.isArray(reviewsData) ? reviewsData : reviewsData.data || []).map((r: any) => {
        const firstName = r.user_first_name || r.users?.first_name || 'Customer';
        const lastName = r.user_last_name || r.users?.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim();
        const initials = `${firstName.charAt(0)}${lastName.charAt(0) || ''}`.toUpperCase();
        return {
          id: r.id,
          user_id: r.user_id,
          merchant_id: r.merchant_id,
          product_id: r.product_id,
          rating: r.rating,
          review_text: r.review_text || '',
          response_text: r.response_text,
          responded_at: r.responded_at,
          created_at: r.created_at,
          user_name: fullName,
          user_initials: initials,
          product_name: r.product_name || r.products?.name || 'General Review',
        };
      });

      setReviews(transformedReviews);

      if (transformedReviews.length > 0) {
        const avg = transformedReviews.reduce((sum, r) => sum + r.rating, 0) / transformedReviews.length;
        setAverageRating(avg);
        const responded = transformedReviews.filter(r => r.response_text).length;
        setResponseRate(Math.round((responded / transformedReviews.length) * 100));
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        setNewReviewsCount(transformedReviews.filter(r => new Date(r.created_at) > oneWeekAgo).length);
      }
    } catch (error) {
      console.error('Error fetching reviews:', error);
    } finally {
      setLoading(false);
    }
  };

  const submitResponse = async (reviewId: number) => {
    if (!responseText.trim()) return;
    try {
      setSubmitting(true);
      const token = getToken();
      const res = await fetch(`${API}/api/reviews/${reviewId}/respond`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ response_text: responseText }),
      });
      if (!res.ok) throw new Error('Failed to submit response');

      setRespondingTo(null);
      setResponseText('');
      fetchReviews();
    } catch (error) {
      console.error('Error submitting response:', error);
      alert('Failed to submit response');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredReviews = filterRating
    ? reviews.filter(r => r.rating === filterRating)
    : reviews;

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <svg
        key={i}
        className={`w-5 h-5 ${i < rating ? 'text-yellow-400' : 'text-gray-300'}`}
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    ));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-12 h-12 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Customer Reviews</h1>
        <p className="text-gray-600">Manage and respond to customer feedback</p>
      </div>

      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gray-100 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-4xl font-bold text-gray-900">{averageRating.toFixed(1)}</p>
              <p className="text-gray-600 mt-1">{reviews.length} reviews</p>
            </div>
            <svg className="w-12 h-12 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </div>
        </div>

        <div className="bg-gray-100 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-4xl font-bold text-gray-900">{responseRate}%</p>
              <p className="text-gray-600 mt-1">Response Rate</p>
            </div>
            <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
        </div>

        <div className="bg-gray-100 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-4xl font-bold text-gray-900">{newReviewsCount}</p>
              <p className="text-gray-600 mt-1">New This Week</p>
            </div>
            <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterRating(null)}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${!filterRating ? 'bg-[#DB0002] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          All ({reviews.length})
        </button>
        {[5, 4, 3, 2, 1].map(star => (
          <button
            key={star}
            onClick={() => setFilterRating(star)}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-1 ${filterRating === star ? 'bg-[#DB0002] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {star} ★ ({reviews.filter(r => r.rating === star).length})
          </button>
        ))}
      </div>

      {/* Reviews List */}
      <div className="space-y-4">
        {filteredReviews.length === 0 ? (
          <div className="bg-white rounded-lg p-12 text-center border border-gray-200">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-gray-500 text-lg">No reviews yet</p>
            <p className="text-gray-400 text-sm mt-1">Customer reviews will appear here</p>
          </div>
        ) : (
          filteredReviews.map((review) => (
            <div key={review.id} className="bg-white rounded-lg p-6 border border-gray-200">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#DB0002] text-white rounded-full flex items-center justify-center font-bold text-sm">
                    {review.user_initials}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{review.user_name}</h3>
                    <p className="text-xs text-gray-500">{new Date(review.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                  </div>
                </div>
                <div className="flex">{renderStars(review.rating)}</div>
              </div>

              <p className="text-sm text-gray-600 mb-1">Product: <span className="font-medium text-gray-900">{review.product_name}</span></p>
              <p className="text-gray-700 mb-4">{review.review_text}</p>

              {/* Merchant Response */}
              {review.response_text ? (
                <div className="bg-gray-50 rounded-lg p-4 border-l-4 border-[#DB0002]">
                  <p className="text-sm font-medium text-gray-900 mb-1">Your Response:</p>
                  <p className="text-sm text-gray-600">{review.response_text}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    Responded {review.responded_at ? new Date(review.responded_at).toLocaleDateString() : ''}
                  </p>
                </div>
              ) : respondingTo === review.id ? (
                <div className="space-y-3">
                  <textarea
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    placeholder="Write your response..."
                    rows={3}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none resize-none text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => submitResponse(review.id)}
                      disabled={submitting || !responseText.trim()}
                      className="px-4 py-2 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors text-sm font-medium disabled:opacity-50"
                    >
                      {submitting ? 'Submitting...' : 'Submit Response'}
                    </button>
                    <button
                      onClick={() => { setRespondingTo(null); setResponseText(''); }}
                      className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setRespondingTo(review.id)}
                  className="text-[#DB0002] text-sm font-medium hover:underline"
                >
                  Reply to this review
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
