'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getUser, useAuth } from '@/hooks/use-auth';
import { FinancialReconciliationApiError } from '@/lib/financial-reconciliation-api';
import {
  findingTitle,
  isFinancialReconciliationAdmin,
  reviewStatusLabel,
} from '@/lib/financial-reconciliation-presentation';
import {
  listFinancialReconciliationReviews,
  type ReviewListItem,
} from '@/lib/financial-reconciliation-review-api';

function AccessDenied() {
  return (
    <div className="w-full">
      <h1 className="text-2xl font-bold text-gray-900">Reconciliation follow-ups</h1>
      <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Access denied. System admin only.
      </p>
    </div>
  );
}

export default function FinancialReconciliationReviewsPage() {
  const { user, loading } = useAuth();
  const admin = isFinancialReconciliationAdmin(user?.userType ?? getUser()?.userType);
  if (loading || !user) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!admin) return <AccessDenied />;
  return <ReviewListBody />;
}

function ReviewListBody() {
  const [items, setItems] = useState<ReviewListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [assignedTo, setAssignedTo] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (cursor?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const until = new Date();
      const since = new Date(until.getTime() - 30 * 24 * 60 * 60 * 1000);
      const query: Record<string, string> = {
        assignedTo,
        since: since.toISOString(),
        until: until.toISOString(),
      };
      if (status) query.status = status;
      if (cursor) query.cursor = cursor;
      const response = await listFinancialReconciliationReviews(query);
      setItems((current) => (cursor ? [...current, ...response.items] : response.items));
      setNextCursor(response.nextCursor);
    } catch (err) {
      setError(err instanceof FinancialReconciliationApiError ? err.message : 'Unable to load follow-ups.');
    } finally {
      setLoading(false);
    }
  }, [assignedTo, status]);

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <div className="w-full space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reconciliation follow-ups</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Operational review of live reconciliation findings. This is not a balance editor
            and does not change financial amounts.
          </p>
        </div>
        <Link href="/admin/financial-reconciliation" className="text-sm font-medium text-[#DB0002]">
          Back to Reconciliation
        </Link>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5" aria-labelledby="review-filters">
        <h2 id="review-filters" className="text-sm font-semibold text-gray-900">Filters</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-gray-700">
            Status
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All</option>
              <option value="OPEN">Open</option>
              <option value="IN_REVIEW">In review</option>
              <option value="WAITING_ON_PARTY">Waiting on party</option>
              <option value="ESCALATED_ENGINEERING">Escalated to engineering</option>
              <option value="CLOSED_CONDITION_CLEARED">Closed — condition cleared</option>
              <option value="CLOSED_REVIEW_ONLY">Closed — review only</option>
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Assignment
            <select
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={assignedTo}
              onChange={(event) => setAssignedTo(event.target.value)}
            >
              <option value="all">All</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </label>
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}
      {loading && items.length === 0 && (
        <div className="h-24 animate-pulse rounded-2xl bg-gray-100" />
      )}
      {!loading && items.length === 0 && !error && (
        <p className="rounded-2xl border border-gray-200 bg-white px-5 py-8 text-center text-sm text-gray-600">
          No follow-ups were found for this period.
        </p>
      )}

      {items.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <table className="hidden min-w-full text-sm md:table">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Finding</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Assignee</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Updated</th>
                <th className="px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-gray-100">
                  <td className="px-4 py-3">#{item.wkOrderId}</td>
                  <td className="px-4 py-3">{findingTitle(item.findingCode)}</td>
                  <td className="px-4 py-3">{reviewStatusLabel(item.status)}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {item.assignedAdminUserId ? 'Assigned' : 'Unassigned'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{new Date(item.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-600">{new Date(item.updatedAt).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/financial-reconciliation/reviews/${item.id}`} className="font-medium text-[#DB0002]">
                      Open follow-up
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-3 p-4 md:hidden">
            {items.map((item) => (
              <article key={item.id} className="rounded-xl border border-gray-200 p-4">
                <h2 className="font-semibold text-gray-900">Order #{item.wkOrderId}</h2>
                <p className="text-sm text-gray-700">{findingTitle(item.findingCode)}</p>
                <p className="text-sm text-gray-600">{reviewStatusLabel(item.status)}</p>
                <p className="text-sm text-gray-600">
                  {item.assignedAdminUserId ? 'Assigned' : 'Unassigned'}
                </p>
                <p className="text-xs text-gray-500">{new Date(item.createdAt).toLocaleString()}</p>
                <Link href={`/admin/financial-reconciliation/reviews/${item.id}`} className="mt-2 inline-block text-sm font-medium text-[#DB0002]">
                  Open follow-up
                </Link>
              </article>
            ))}
          </div>
        </div>
      )}

      {nextCursor && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(nextCursor)}
          className="rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium disabled:opacity-50"
        >
          Continue search
        </button>
      )}
    </div>
  );
}
