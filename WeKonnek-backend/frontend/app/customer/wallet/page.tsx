'use client';

import { useState, useEffect } from 'react';
import { useAuth, getToken } from '@/hooks/use-auth';
import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Transaction {
  id: string;
  type: 'top_up' | 'payment' | 'refund' | 'transfer';
  amount: number;
  description: string;
  date: string;
  status: 'completed' | 'pending' | 'failed';
}

const MOCK_BALANCE = 2450.0;
const MOCK_TRANSACTIONS: Transaction[] = [
  { id: '1', type: 'top_up', amount: 1000, description: 'GCash Top Up', date: '2026-06-25T14:30:00Z', status: 'completed' },
  { id: '2', type: 'payment', amount: -285.5, description: 'Jollibee - Order #WK2841', date: '2026-06-25T12:15:00Z', status: 'completed' },
  { id: '3', type: 'refund', amount: 150, description: 'Refund - Cancelled Order', date: '2026-06-24T18:00:00Z', status: 'completed' },
  { id: '4', type: 'payment', amount: -120, description: 'Mercury Drug - Order #WK2790', date: '2026-06-24T09:45:00Z', status: 'completed' },
  { id: '5', type: 'transfer', amount: -500, description: 'Sent to Juan D.', date: '2026-06-23T20:00:00Z', status: 'completed' },
  { id: '6', type: 'top_up', amount: 2000, description: 'Maya Top Up', date: '2026-06-23T08:30:00Z', status: 'completed' },
  { id: '7', type: 'payment', amount: -94.5, description: 'Express Delivery #EX1042', date: '2026-06-22T16:20:00Z', status: 'completed' },
];

const txnIcons: Record<Transaction['type'], { emoji: string; bg: string }> = {
  top_up: { emoji: '💰', bg: 'bg-green-100' },
  payment: { emoji: '🛒', bg: 'bg-blue-100' },
  refund: { emoji: '↩️', bg: 'bg-amber-100' },
  transfer: { emoji: '📤', bg: 'bg-purple-100' },
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

export default function WalletPage() {
  const { user: authUser } = useAuth();
  const [balance, setBalance] = useState<number>(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWallet = async () => {
      try {
        const token = getToken();
        if (!token) throw new Error('No token');

        const [balRes, txnRes] = await Promise.all([
          fetch(`${API}/api/wallet/balance`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${API}/api/wallet/transactions`, { headers: { Authorization: `Bearer ${token}` } }),
        ]);

        if (!balRes.ok || !txnRes.ok) throw new Error('API error');

        const balData = await balRes.json();
        const txnData = await txnRes.json();
        setBalance(balData.balance ?? balData.amount ?? MOCK_BALANCE);
        setTransactions(Array.isArray(txnData) ? txnData : txnData.data || MOCK_TRANSACTIONS);
      } catch {
        setBalance(MOCK_BALANCE);
        setTransactions(MOCK_TRANSACTIONS);
      } finally {
        setLoading(false);
      }
    };
    fetchWallet();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-10 h-10 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-400">Loading wallet...</p>
        </div>
      </div>
    );
  }

  const quickActions = [
    { label: 'Top Up', icon: '💳', href: '/customer/wallet/topup', color: 'from-green-500 to-emerald-600' },
    { label: 'Send', icon: '📤', href: '#', color: 'from-blue-500 to-blue-600' },
    { label: 'Cash Out', icon: '🏧', href: '#', color: 'from-purple-500 to-purple-600' },
    { label: 'Pay', icon: '📱', href: '/customer/scan', color: 'from-orange-500 to-orange-600' },
  ];

  return (
    <>
      {/* ========== MOBILE WALLET ========== */}
      <div className="lg:hidden min-h-screen bg-gray-50">
        {/* Balance Card */}
        <div className="px-4 pt-2 pb-4">
          <div className="relative bg-gradient-to-br from-[#DB0002] to-[#8B0001] rounded-2xl p-5 text-white overflow-hidden shadow-lg shadow-red-200/40">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full" />
            <div className="absolute bottom-0 left-0 w-28 h-28 bg-white/5 rounded-full -translate-x-8 translate-y-8" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🔥</span>
                <span className="text-white/80 text-xs font-semibold tracking-wide uppercase">WeKonnek Pay</span>
              </div>
              <p className="text-white/60 text-xs mt-3">Available Balance</p>
              <p className="text-3xl font-black mt-0.5 tracking-tight">
                ₱{balance.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-white/15 rounded-full text-[10px] font-medium">
                  {authUser?.firstName || 'User'} {authUser?.lastName?.charAt(0) || ''}.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="px-4 pb-5">
          <div className="grid grid-cols-4 gap-3">
            {quickActions.map((action) => (
              <Link key={action.label} href={action.href} className="flex flex-col items-center group">
                <div className={`w-14 h-14 bg-gradient-to-br ${action.color} rounded-2xl flex items-center justify-center mb-1.5 shadow-sm group-active:scale-95 transition-transform`}>
                  <span className="text-2xl">{action.icon}</span>
                </div>
                <span className="text-[11px] text-gray-700 font-medium">{action.label}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Transactions */}
        <div className="px-4 pb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-gray-900">Recent Transactions</h2>
            <button className="text-xs text-[#DB0002] font-semibold">View All</button>
          </div>

          {transactions.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-2xl border border-gray-100">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-3xl">💸</span>
              </div>
              <p className="text-gray-500 font-medium text-sm">No transactions yet</p>
              <p className="text-xs text-gray-400 mt-1">Your transaction history will appear here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map((txn) => {
                const isPositive = txn.amount > 0;
                const iconData = txnIcons[txn.type] || txnIcons.payment;
                return (
                  <div
                    key={txn.id}
                    className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 border border-gray-100 shadow-sm"
                  >
                    <div className={`w-10 h-10 ${iconData.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                      <span className="text-lg">{iconData.emoji}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{txn.description}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(txn.date)}</p>
                    </div>
                    <span className={`text-sm font-bold flex-shrink-0 ${isPositive ? 'text-green-600' : 'text-gray-900'}`}>
                      {isPositive ? '+' : ''}₱{Math.abs(txn.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ========== DESKTOP WALLET ========== */}
      <div className="hidden lg:block space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">WeKonnek Pay Wallet</h1>
          <p className="text-gray-600">Manage your digital wallet and transactions</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Balance Card */}
          <div className="lg:col-span-1">
            <div className="relative bg-gradient-to-br from-[#DB0002] to-[#8B0001] rounded-2xl p-6 text-white overflow-hidden">
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full" />
              <div className="absolute bottom-0 left-0 w-28 h-28 bg-white/5 rounded-full -translate-x-8 translate-y-8" />
              <div className="relative">
                <p className="text-white/70 text-sm font-medium">Available Balance</p>
                <p className="text-4xl font-black mt-2 tracking-tight">
                  ₱{balance.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <div className="mt-6 grid grid-cols-2 gap-2">
                  <Link
                    href="/customer/wallet/topup"
                    className="py-2.5 bg-white text-[#DB0002] rounded-xl text-center text-sm font-bold hover:bg-white/90 transition-colors"
                  >
                    Top Up
                  </Link>
                  <button className="py-2.5 bg-white/15 text-white rounded-xl text-sm font-bold hover:bg-white/25 transition-colors">
                    Send
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Actions Desktop */}
            <div className="mt-4 bg-white rounded-2xl p-4 border border-gray-200 shadow-sm">
              <h3 className="text-sm font-bold text-gray-900 mb-3">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                {quickActions.map((action) => (
                  <Link
                    key={action.label}
                    href={action.href}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors"
                  >
                    <span className="text-xl">{action.icon}</span>
                    <span className="text-sm font-medium text-gray-700">{action.label}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Transactions */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">Recent Transactions</h2>
              <button className="text-sm text-[#DB0002] font-semibold hover:underline">View All</button>
            </div>
            <div className="divide-y divide-gray-50">
              {transactions.map((txn) => {
                const isPositive = txn.amount > 0;
                const iconData = txnIcons[txn.type] || txnIcons.payment;
                return (
                  <div key={txn.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50/50 transition-colors">
                    <div className={`w-10 h-10 ${iconData.bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                      <span className="text-lg">{iconData.emoji}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{txn.description}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(txn.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' '}at{' '}
                        {new Date(txn.date).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className={`text-sm font-bold ${isPositive ? 'text-green-600' : 'text-gray-900'}`}>
                      {isPositive ? '+' : ''}₱{Math.abs(txn.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
