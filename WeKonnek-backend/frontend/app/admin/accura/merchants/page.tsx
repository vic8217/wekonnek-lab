'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type ConnectionRow = {
  merchantId: number;
  merchantName: string;
  externalClientReference: string;
  connectionStatus: string;
  productionEligible: boolean;
  reviewStatus: string | null;
  accountStatus: string | null;
  mappedBranches: number;
  lastSyncedAt: string | null;
  lastInvoiceNumber: string | null;
  lastIssuanceError: string | null;
};

const FILTERS = [
  'all',
  'not_connected',
  'onboarding',
  'needs_action',
  'active',
  'suspended',
  'error',
] as const;

export default function AccuraMerchantConnectionsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [rows, setRows] = useState<ConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/api/integrations/accura/admin/merchants?filter=${filter}`,
        { headers: { Authorization: `Bearer ${getToken()}` } },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Unable to load connections');
      setRows(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load connections');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="w-full max-w-none p-5 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ACCURA Merchant Connections</h1>
        <p className="mt-1 text-sm text-gray-600">
          Read-only diagnostics. ACCURA remains authoritative — WeKonnek cannot force Active
          or override compliance.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium border ${
              filter === item
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-white text-gray-700 border-gray-200'
            }`}
          >
            {item.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </p>
      )}

      <div className="grid gap-4 md:hidden">
        {rows.map((row) => (
          <article
            key={row.merchantId}
            className="rounded-xl border border-gray-200 bg-white p-4 space-y-2"
          >
            <h2 className="font-semibold text-gray-900">{row.merchantName}</h2>
            <p className="text-sm text-gray-600">Status: {row.connectionStatus}</p>
            <p className="text-sm text-gray-600">
              Production eligible: {row.productionEligible ? 'Yes' : 'No'}
            </p>
            <p className="text-sm text-gray-600">Branches mapped: {row.mappedBranches}</p>
            <p className="text-sm text-gray-600">
              Last invoice: {row.lastInvoiceNumber || '—'}
            </p>
            <Link
              href={`/admin/accura/merchants/${row.merchantId}`}
              className="inline-block text-sm font-medium text-red-600"
            >
              View
            </Link>
          </article>
        ))}
      </div>

      <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3">Merchant</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Eligible</th>
              <th className="px-4 py-3">Branches</th>
              <th className="px-4 py-3">Last Invoice</th>
              <th className="px-4 py-3">Last Error</th>
              <th className="px-4 py-3">Sync</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.merchantId} className="border-t border-gray-100">
                <td className="px-4 py-3 font-medium text-gray-900">{row.merchantName}</td>
                <td className="px-4 py-3">{row.connectionStatus}</td>
                <td className="px-4 py-3">{row.productionEligible ? 'Yes' : 'No'}</td>
                <td className="px-4 py-3">{row.mappedBranches}</td>
                <td className="px-4 py-3">{row.lastInvoiceNumber || '—'}</td>
                <td className="px-4 py-3">{row.lastIssuanceError || '—'}</td>
                <td className="px-4 py-3">
                  {row.lastSyncedAt
                    ? new Date(row.lastSyncedAt).toLocaleString()
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/accura/merchants/${row.merchantId}`}
                    className="text-red-600 font-medium"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
