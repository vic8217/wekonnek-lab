'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function AccuraMerchantConnectionDetailPage() {
  const params = useParams();
  const merchantId = Number(params.merchantId);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(
      `${API}/api/integrations/accura/admin/merchants/${merchantId}`,
      { headers: { Authorization: `Bearer ${getToken()}` } },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Unable to load merchant');
    setDetail(data);
  }, [merchantId]);

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : 'Unable to load merchant'),
    );
  }, [load]);

  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/api/integrations/accura/admin/merchants/${merchantId}/refresh-status`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Refresh failed');
      setDetail(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="w-full max-w-4xl p-5 md:p-8 space-y-6">
      <Link href="/admin/accura/merchants" className="text-sm font-medium text-red-600">
        ← Merchant Connections
      </Link>
      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </p>
      )}
      {!detail && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {detail && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{detail.merchantName}</h1>
              <p className="text-sm text-gray-600">{detail.externalClientReference}</p>
              <p className="text-sm text-gray-600 mt-1">{detail.note}</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void refresh()}
              className="rounded-lg bg-red-600 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {busy ? 'Refreshing…' : 'Refresh ACCURA Status'}
            </button>
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-2 text-sm">
            <p>Connection: {detail.connectionStatus}</p>
            <p>Production eligible: {detail.productionEligible ? 'Yes' : 'No'}</p>
            <p>Reason: {detail.eligibilityReason}</p>
            <p>Review: {detail.link?.lastReviewStatus || '—'}</p>
            <p>Account: {detail.link?.lastAccountStatus || '—'}</p>
            <p>
              Last sync:{' '}
              {detail.link?.lastSyncedAt
                ? new Date(detail.link.lastSyncedAt).toLocaleString()
                : '—'}
            </p>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">Shop mappings</h2>
            {(detail.shops || []).map((shop: any) => (
              <div key={shop.shopId} className="text-sm flex justify-between gap-3">
                <span>{shop.name}</span>
                <span className="font-mono text-gray-600">
                  {shop.accuraBranchId || 'Unmapped'}
                </span>
              </div>
            ))}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
            <h2 className="font-semibold text-gray-900">Recent issuance jobs</h2>
            {(detail.recentJobs || []).length === 0 && (
              <p className="text-sm text-gray-500">No issuance jobs yet.</p>
            )}
            {(detail.recentJobs || []).map((job: any) => (
              <div key={job.id} className="text-sm border-t border-gray-100 pt-2">
                <p>
                  {job.wkOrder?.orderCode || job.wkOrderId} · {job.status}
                </p>
                <p className="text-gray-600">
                  {job.lastErrorCategory || '—'} ·{' '}
                  {job.wkOrder?.accuraInvoice?.accuraInvoiceNumber || 'No invoice yet'}
                </p>
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
