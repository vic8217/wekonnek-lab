'use client';

import { useState } from 'react';
import { getToken } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000, 5000];

const PAYMENT_METHODS = [
  { id: 'gcash', name: 'GCash', icon: '💚', color: 'border-green-200 bg-green-50', activeColor: 'border-green-500 bg-green-50 ring-2 ring-green-200' },
  { id: 'maya', name: 'Maya', icon: '💜', color: 'border-purple-200 bg-purple-50', activeColor: 'border-purple-500 bg-purple-50 ring-2 ring-purple-200' },
  { id: 'bank', name: 'Bank Transfer', icon: '🏦', color: 'border-blue-200 bg-blue-50', activeColor: 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' },
  { id: '7eleven', name: '7-Eleven', icon: '🏪', color: 'border-orange-200 bg-orange-50', activeColor: 'border-orange-500 bg-orange-50 ring-2 ring-orange-200' },
];

export default function TopUpPage() {
  const router = useRouter();
  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [method, setMethod] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const effectiveAmount = amount ?? (customAmount ? Number(customAmount) : 0);
  const canSubmit = effectiveAmount >= 50 && method;

  const handleQuickAmount = (val: number) => {
    setAmount(val);
    setCustomAmount('');
  };

  const handleCustomAmount = (val: string) => {
    const cleaned = val.replace(/[^0-9]/g, '');
    setCustomAmount(cleaned);
    setAmount(null);
  };

  const handleTopUp = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/wallet/top-up`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amount: effectiveAmount, method }),
      });
      if (!res.ok) throw new Error('Top-up failed');
      setShowSuccess(true);
    } catch {
      toast.error('Top-up failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (showSuccess) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
            <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">Top Up Successful!</h2>
          <p className="text-gray-500 text-sm mb-1">
            ₱{effectiveAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })} has been added
          </p>
          <p className="text-gray-400 text-xs mb-6">
            via {PAYMENT_METHODS.find((m) => m.id === method)?.name}
          </p>
          <div className="flex gap-3 justify-center">
            <Link
              href="/customer/wallet"
              className="px-6 py-2.5 bg-[#DB0002] text-white rounded-xl text-sm font-bold shadow-sm"
            >
              Back to Wallet
            </Link>
            <button
              onClick={() => {
                setShowSuccess(false);
                setAmount(null);
                setCustomAmount('');
                setMethod(null);
              }}
              className="px-6 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm font-bold"
            >
              Top Up Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* ========== MOBILE TOP UP ========== */}
      <div className="lg:hidden min-h-screen bg-gray-50">
        {/* Header */}
        <div className="sticky top-0 z-20 bg-white safe-area-top">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
            <button onClick={() => router.back()} className="p-1 -ml-1 active:bg-gray-100 rounded-lg transition-colors">
              <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-lg font-bold text-gray-900">Top Up</h1>
          </div>
        </div>

        <div className="px-4 py-4 space-y-5">
          {/* Quick Amounts */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2.5">Select Amount</label>
            <div className="grid grid-cols-3 gap-2.5">
              {QUICK_AMOUNTS.map((val) => (
                <button
                  key={val}
                  onClick={() => handleQuickAmount(val)}
                  className={`py-3.5 rounded-xl text-sm font-bold transition-all duration-200 ${
                    amount === val
                      ? 'bg-[#DB0002] text-white shadow-md shadow-red-200 scale-[1.02]'
                      : 'bg-white text-gray-700 border border-gray-200 active:scale-95'
                  }`}
                >
                  ₱{val.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Amount */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Or Enter Amount</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₱</span>
              <input
                type="text"
                inputMode="numeric"
                value={customAmount}
                onChange={(e) => handleCustomAmount(e.target.value)}
                placeholder="0.00"
                className="w-full pl-8 pr-4 py-3.5 bg-white border border-gray-200 rounded-xl text-lg font-bold text-gray-900 focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none transition-colors"
              />
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5 pl-1">Minimum top-up: ₱50</p>
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2.5">Payment Method</label>
            <div className="space-y-2">
              {PAYMENT_METHODS.map((pm) => (
                <button
                  key={pm.id}
                  onClick={() => setMethod(pm.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border transition-all duration-200 ${
                    method === pm.id ? pm.activeColor : `${pm.color} active:scale-[0.98]`
                  }`}
                >
                  <span className="text-2xl">{pm.icon}</span>
                  <span className="text-sm font-semibold text-gray-800 flex-1 text-left">{pm.name}</span>
                  {method === pm.id && (
                    <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          {effectiveAmount > 0 && method && (
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-500">Amount</span>
                <span className="text-sm font-bold text-gray-900">
                  ₱{effectiveAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Method</span>
                <span className="text-sm font-bold text-gray-900">
                  {PAYMENT_METHODS.find((m) => m.id === method)?.name}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Bottom CTA */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-4 py-3 safe-area-bottom lg:hidden">
          <button
            onClick={handleTopUp}
            disabled={!canSubmit || submitting}
            className="w-full py-3.5 bg-[#DB0002] text-white rounded-xl text-sm font-bold disabled:opacity-40 disabled:bg-gray-300 active:scale-[0.98] transition-all shadow-lg shadow-red-200/50"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Processing...
              </span>
            ) : effectiveAmount > 0 ? (
              `Top Up ₱${effectiveAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
            ) : (
              'Top Up Now'
            )}
          </button>
        </div>
      </div>

      {/* ========== DESKTOP TOP UP ========== */}
      <div className="hidden lg:block space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Top Up Wallet</h1>
            <p className="text-gray-600">Add funds to your WeKonnek Pay wallet</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            {/* Amount Selection */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Select Amount</h2>
              <div className="grid grid-cols-3 gap-3">
                {QUICK_AMOUNTS.map((val) => (
                  <button
                    key={val}
                    onClick={() => handleQuickAmount(val)}
                    className={`py-4 rounded-xl text-sm font-bold transition-all ${
                      amount === val
                        ? 'bg-[#DB0002] text-white shadow-md'
                        : 'bg-gray-50 text-gray-700 border border-gray-200 hover:border-[#DB0002] hover:text-[#DB0002]'
                    }`}
                  >
                    ₱{val.toLocaleString()}
                  </button>
                ))}
              </div>
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Custom Amount</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">₱</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={customAmount}
                    onChange={(e) => handleCustomAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-lg font-bold text-gray-900 focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Payment Method */}
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Payment Method</h2>
              <div className="grid grid-cols-2 gap-3">
                {PAYMENT_METHODS.map((pm) => (
                  <button
                    key={pm.id}
                    onClick={() => setMethod(pm.id)}
                    className={`flex items-center gap-3 px-4 py-4 rounded-xl border transition-all ${
                      method === pm.id ? pm.activeColor : `${pm.color} hover:shadow-sm`
                    }`}
                  >
                    <span className="text-2xl">{pm.icon}</span>
                    <span className="text-sm font-semibold text-gray-800">{pm.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Summary Card */}
          <div className="lg:sticky lg:top-6 self-start">
            <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Summary</h2>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between">
                  <span className="text-gray-500">Amount</span>
                  <span className="font-bold text-gray-900">
                    ₱{effectiveAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Method</span>
                  <span className="font-bold text-gray-900">
                    {method ? PAYMENT_METHODS.find((m) => m.id === method)?.name : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Fee</span>
                  <span className="font-bold text-green-600">Free</span>
                </div>
                <hr className="border-gray-100" />
                <div className="flex justify-between">
                  <span className="font-bold text-gray-900">Total</span>
                  <span className="text-xl font-black text-gray-900">
                    ₱{effectiveAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
              <button
                onClick={handleTopUp}
                disabled={!canSubmit || submitting}
                className="w-full py-3.5 bg-[#DB0002] text-white rounded-xl text-sm font-bold disabled:opacity-40 disabled:bg-gray-300 hover:bg-[#b80002] transition-colors"
              >
                {submitting ? 'Processing...' : 'Top Up Now'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
