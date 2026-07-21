'use client';

import { useState, useEffect, useCallback } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface SubscriptionPayment {
  id: number;
  merchant_id: number;
  tier: string;
  plan: string;
  amount: number;
  payment_method: string;
  gateway?: string;
  status: string;
  payment_proof_url?: string;
  period_end?: string | null;
  created_at: string;
  merchant?: { id: number; name: string; slug?: string };
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  failed: 'bg-red-100 text-red-800',
};

export default function AdminSubscriptionsPage() {
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'paid' | 'rejected' | 'all'>('pending');
  const [busyId, setBusyId] = useState<number | null>(null);

  const fetchPayments = useCallback(async () => {
    try {
      setLoading(true);
      const token = getToken();
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const res = await fetch(`${API}/api/subscriptions${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch subscription payments');
      const data = await res.json();
      setPayments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching subscription payments:', error);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleAction = async (id: number, action: 'approve' | 'reject') => {
    let reason: string | undefined;
    if (action === 'reject') {
      reason = prompt('Reason for rejection (optional):') || undefined;
    }
    try {
      setBusyId(id);
      const token = getToken();
      const res = await fetch(`${API}/api/subscriptions/${id}/${action}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Action failed');
      }
      toast.success(`Subscription ${action === 'approve' ? 'approved' : 'rejected'} successfully`);
      await fetchPayments();
    } catch (error: any) {
      toast.error(error.message || 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleString();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Subscription Payments</h1>
        <p className="text-gray-600">Review and approve merchant subscription upgrades & renewals</p>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {(['pending', 'paid', 'rejected', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 font-medium capitalize transition-colors ${
              filter === f
                ? 'text-[#DB0002] border-b-2 border-[#DB0002]'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#DB0002] text-white">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold">Merchant</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Plan</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Amount</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Method</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Proof</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Requested</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Status</th>
                <th className="px-6 py-3 text-left text-sm font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-gray-500">Loading...</td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-gray-500">No subscription payments found</td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">
                      {p.merchant?.name || `Merchant #${p.merchant_id}`}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 capitalize">{p.tier} · {p.plan}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">₱{Number(p.amount).toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-gray-600 capitalize">
                      {p.payment_method}
                      {p.gateway ? ` (${p.gateway})` : ''}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      {p.payment_proof_url ? (
                        <a
                          href={p.payment_proof_url.startsWith('http') ? p.payment_proof_url : `${API}${p.payment_proof_url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{formatDate(p.created_at)}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[p.status] || 'bg-gray-100 text-gray-800'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {p.status === 'pending' && p.payment_method === 'manual' ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleAction(p.id, 'approve')}
                            disabled={busyId === p.id}
                            className="px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleAction(p.id, 'reject')}
                            disabled={busyId === p.id}
                            className="px-3 py-1.5 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      ) : p.status === 'pending' ? (
                        <span className="text-xs text-gray-400">Awaiting payment</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
