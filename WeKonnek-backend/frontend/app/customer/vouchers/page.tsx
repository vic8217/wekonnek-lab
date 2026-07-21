'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface ApiVoucher {
  id: string;
  code: string;
  title: string;
  description: string | null;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  maxDiscountAmount: number | null;
  minOrderAmount: number;
  applicableOrderTypes: string | null;
  expiresAt: string;
}

// Rotating palette so each voucher card gets a distinct look.
const GRADIENTS = [
  'from-green-600 to-green-500',
  'from-[#DB0002] to-red-500',
  'from-[#165BB8] to-blue-500',
  'from-purple-600 to-purple-500',
  'from-orange-500 to-yellow-500',
  'from-teal-500 to-cyan-500',
];

function discountLabel(v: ApiVoucher): string {
  return v.discountType === 'percentage'
    ? `${v.discountValue}%`
    : `₱${v.discountValue}`;
}

function subText(v: ApiVoucher): string {
  if (v.description) return v.description;
  if (v.minOrderAmount > 0) return `Min. Spend ₱${v.minOrderAmount.toLocaleString('en-PH')}`;
  return 'No minimum spend';
}

export default function CustomerVouchersPage() {
  const [vouchers, setVouchers] = useState<ApiVoucher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);

  const loadVouchers = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setNeedsAuth(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/vouchers/customer/available`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        setNeedsAuth(true);
        return;
      }
      if (!res.ok) throw new Error('Failed to load vouchers');
      const data = await res.json();
      const list: ApiVoucher[] = (Array.isArray(data) ? data : data.data || []).map((v: any) => ({
        id: v.id,
        code: v.code,
        title: v.title,
        description: v.description ?? null,
        discountType: v.discountType,
        discountValue: Number(v.discountValue),
        maxDiscountAmount: v.maxDiscountAmount != null ? Number(v.maxDiscountAmount) : null,
        minOrderAmount: Number(v.minOrderAmount ?? 0),
        applicableOrderTypes: v.applicableOrderTypes ?? null,
        expiresAt: v.expiresAt,
      }));
      setVouchers(list);
    } catch (err: any) {
      setError(err.message || 'Failed to load vouchers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVouchers();
  }, [loadVouchers]);

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Code ${code} copied — use it at checkout`);
    } catch {
      toast.error('Could not copy code');
    }
  };

  const renderStates = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-16">
          <div className="w-10 h-10 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    if (needsAuth) {
      return (
        <div className="text-center py-14">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <p className="text-gray-600 font-medium">Sign in to view your vouchers</p>
          <Link href="/auth/login" className="inline-block mt-4 px-6 py-2.5 bg-[#DB0002] text-white rounded-xl font-semibold text-sm hover:bg-[#B80002] transition-colors">
            Sign In
          </Link>
        </div>
      );
    }
    if (error) {
      return (
        <div className="text-center py-14">
          <p className="text-gray-500 font-medium">{error}</p>
          <button onClick={loadVouchers} className="mt-4 px-6 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-200 transition-colors">
            Try Again
          </button>
        </div>
      );
    }
    if (vouchers.length === 0) {
      return (
        <div className="text-center py-14">
          <svg className="w-16 h-16 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
          </svg>
          <p className="text-gray-400 text-sm">No vouchers available right now</p>
          <p className="text-gray-400 text-xs mt-1">Check back soon for new deals</p>
        </div>
      );
    }
    return null;
  };

  const states = renderStates();

  return (
    <>
      {/* Mobile Vouchers Page */}
      <div className="lg:hidden min-h-screen bg-gray-50">
        <div className="bg-white px-4 py-3 border-b border-gray-100 sticky top-0 z-10">
          <h1 className="text-lg font-bold text-gray-900">My Vouchers</h1>
          <p className="text-xs text-gray-500 mt-0.5">Copy a code and apply it at checkout</p>
        </div>

        <div className="px-4 py-3 space-y-3">
          {states}
          {!states && vouchers.map((voucher, i) => (
            <div key={voucher.id} className="relative overflow-hidden rounded-xl shadow-sm">
              <div className="flex">
                <div className={`bg-gradient-to-b ${GRADIENTS[i % GRADIENTS.length]} w-28 flex-shrink-0 flex flex-col items-center justify-center p-3 text-white`}>
                  <span className="text-2xl font-black leading-none">{discountLabel(voucher)}</span>
                  <span className="text-[10px] font-medium mt-1 opacity-90">OFF</span>
                </div>
                <div className="bg-white flex-1 p-3 flex flex-col justify-center border-l-2 border-dashed border-gray-200">
                  <h3 className="text-sm font-bold text-gray-900">{voucher.title}</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">{subText(voucher)}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[10px] text-gray-400">
                      Expires: {new Date(voucher.expiresAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <button
                      onClick={() => copyCode(voucher.code)}
                      className="text-[10px] bg-[#DB0002] text-white px-3 py-1 rounded-full font-semibold flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      {voucher.code}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Desktop Vouchers Page */}
      <div className="hidden lg:block space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">My Vouchers</h1>
          <p className="text-gray-600">Copy a code and apply it at checkout</p>
        </div>

        {states}
        {!states && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vouchers.map((voucher, i) => (
              <div key={voucher.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className={`bg-gradient-to-r ${GRADIENTS[i % GRADIENTS.length]} p-4 text-white`}>
                  <span className="text-3xl font-black">{discountLabel(voucher)}</span>
                  <span className="text-lg font-bold ml-1">OFF</span>
                </div>
                <div className="p-4">
                  <h3 className="font-bold text-gray-900">{voucher.title}</h3>
                  <p className="text-sm text-gray-500 mt-1">{subText(voucher)}</p>
                  <p className="text-xs text-gray-400 mt-2">
                    Expires: {new Date(voucher.expiresAt).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </p>
                  <button
                    onClick={() => copyCode(voucher.code)}
                    className="mt-3 w-full bg-[#DB0002] text-white py-2 rounded-lg font-semibold hover:bg-[#B80002] transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy Code • {voucher.code}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
