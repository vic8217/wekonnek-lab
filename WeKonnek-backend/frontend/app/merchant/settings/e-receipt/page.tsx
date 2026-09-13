'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getToken, useAuth } from '@/hooks/use-auth';
import {
  accuraEInvoiceStatusPage,
  formatAccuraStatusTime,
  statusPageToneClass,
} from '@/lib/accura-onboarding-presentation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type SetupResponse = {
  unavailable: boolean;
  unavailableMessage?: string;
  wekonnekDisplayName?: string;
  notice?: string;
  status: {
    reviewStatus: string | null;
    reviewStatusLabel: string;
    companyAccountStatus: string | null;
    companyAccountStatusLabel: string;
    issuanceActive: boolean;
    productionEligible?: boolean;
    suspended: boolean;
    correctionRequired: boolean;
    correctionNotes: string | null;
    approvedForAccuraSetup: boolean;
    lastKnown?: boolean;
    lastKnownPercent?: number | null;
    lastSyncedAt?: string | null;
  };
  readiness: {
    complete: boolean;
    percent: number | null;
    missing: string[];
    canSubmit: boolean;
    sections: Array<{
      key: string;
      label: string;
      complete: boolean;
      missing: string[];
    }>;
  };
  registeredBranches: Array<{
    id: string;
    code: string;
    name: string;
    addressLine1: string;
    active: boolean;
  }>;
  shops: Array<{
    shopId: number;
    name: string;
    address: string | null;
    accuraBranchId: string | null;
  }>;
};

function apiMessage(data: unknown, fallback: string) {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  if (typeof record?.message === 'string') return record.message;
  if (Array.isArray(record?.message)) return record.message.map(String).join(' ');
  return fallback;
}

function branchName(
  branches: SetupResponse['registeredBranches'],
  branchId: string | null,
): string | null {
  if (!branchId) return null;
  const match = branches.find((branch) => branch.id === branchId);
  return match ? match.name : null;
}

export default function EReceiptTaxSetupPage() {
  const { user } = useAuth();
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${getToken()}` }),
    [],
  );

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`${API}/api/integrations/accura/onboarding/profile`, {
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(apiMessage(data, 'Unable to load ACCURA status.'));
    setSetup(data as SetupResponse);
  }, [authHeaders]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load ACCURA status.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refreshStatus = async () => {
    if (refreshing || busy) return;
    setRefreshing(true);
    setError(null);
    setSuccess(null);
    try {
      await load();
      setSuccess('Status refreshed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh ACCURA status.');
    } finally {
      setRefreshing(false);
    }
  };

  const mappedShopCount = useMemo(
    () => setup?.shops.filter((shop) => Boolean(shop.accuraBranchId)).length ?? 0,
    [setup],
  );

  const page = useMemo(
    () =>
      setup
        ? accuraEInvoiceStatusPage({
            unavailable: setup.unavailable,
            lastKnown: setup.status.lastKnown,
            lastKnownPercent: setup.status.lastKnownPercent,
            lastSyncedAt: setup.status.lastSyncedAt,
            notConfigured: /not configured/i.test(setup.unavailableMessage || ''),
            suspended: setup.status.suspended,
            correctionRequired: setup.status.correctionRequired,
            reviewStatus: setup.status.reviewStatus,
            productionEligible: setup.status.productionEligible,
            issuanceActive: setup.status.issuanceActive,
            approvedForAccuraSetup: setup.status.approvedForAccuraSetup,
            readinessComplete: setup.readiness.complete,
            readinessPercent: setup.readiness.percent,
            shopCount: setup.shops.length,
            mappedShopCount,
          })
        : null,
    [setup, mappedShopCount],
  );

  if (user && user.role !== 'merchant') {
    return (
      <div className="max-w-3xl mx-auto p-6 text-sm text-gray-600">
        ACCURA Electronic Invoicing setup is available to Merchant Admin only.
      </div>
    );
  }

  const mapShop = async (shopId: number, accuraBranchId: string) => {
    setBusy('map');
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/api/integrations/accura/onboarding/shop-mappings`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopId,
          accuraBranchId: accuraBranchId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiMessage(data, 'Unable to save shop mapping.'));
      setSetup(data as SetupResponse);
      setSuccess('Shop mapping saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save shop mapping.');
    } finally {
      setBusy('');
    }
  };

  const startHandoff = async () => {
    if (busy || !page?.handoffEnabled) return;
    setBusy('handoff');
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/api/integrations/accura/onboarding/handoff`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: 'COMPLETE_SETUP' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          apiMessage(data, 'ACCURA setup is temporarily unavailable. Please try again.'),
        );
      }
      const redirectUrl =
        data && typeof data === 'object' && typeof (data as { redirectUrl?: unknown }).redirectUrl === 'string'
          ? (data as { redirectUrl: string }).redirectUrl
          : '';
      if (!redirectUrl.startsWith('https://') && !redirectUrl.startsWith('http://')) {
        throw new Error('ACCURA setup is temporarily unavailable. Please try again.');
      }
      window.location.assign(redirectUrl);
    } catch (err) {
      setBusy('');
      setError(
        err instanceof Error
          ? err.message
          : 'ACCURA setup is temporarily unavailable. Please try again.',
      );
    }
  };

  const isActive = page?.displayState === 'ACTIVE';
  const syncedLabel = formatAccuraStatusTime(page?.lastSyncedAt);

  return (
    <div className="max-w-3xl mx-auto w-full space-y-6 px-4 sm:px-0 pb-16">
      <div className="flex items-start gap-3">
        <Link
          href="/merchant"
          className="p-2 -ml-2 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
          aria-label="Back to Dashboard"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 leading-tight">
            ACCURA Electronic Invoicing
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Electronic invoicing for your WeKonnek transactions is managed through ACCURA.
          </p>
        </div>
      </div>

      {loading && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500 w-full">
          Loading ACCURA status…
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {setup && page && (
        <>
          <section
            className={`rounded-xl border p-5 sm:p-6 space-y-4 w-full ${statusPageToneClass(page.displayState)}`}
          >
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide font-semibold opacity-80">
                ACCURA Electronic Invoicing
              </p>
              <h2 className="text-xl sm:text-2xl font-bold leading-tight">{page.title}</h2>
              <p className="text-sm leading-relaxed">{page.body}</p>
            </div>

            {page.displayState === 'UNAVAILABLE' && page.lastKnown && page.lastKnownTitle && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wide opacity-70">Last known status</dt>
                  <dd className="font-medium mt-0.5">{page.lastKnownTitle}</dd>
                </div>
                {syncedLabel && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide opacity-70">Last updated</dt>
                    <dd className="font-medium mt-0.5">{syncedLabel}</dd>
                  </div>
                )}
              </dl>
            )}

            {page.displayState !== 'UNAVAILABLE' && !isActive && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs uppercase tracking-wide opacity-70">ACCURA Status</dt>
                  <dd className="font-medium mt-0.5 truncate">{page.accuraStatusLabel}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs uppercase tracking-wide opacity-70">Production</dt>
                  <dd className="font-medium mt-0.5">{page.productionLabel}</dd>
                </div>
              </dl>
            )}

            {isActive && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wide opacity-70">Production</dt>
                  <dd className="font-medium mt-0.5">Active</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide opacity-70">Shops</dt>
                  <dd className="font-medium mt-0.5">{page.connection.shopMappingLabel}</dd>
                </div>
              </dl>
            )}

            {page.progressPercent != null &&
              page.displayState !== 'ACTIVE' &&
              page.displayState !== 'SUSPENDED' && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium">
                    <span>Setup progress</span>
                    <span>{page.progressPercent}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-black/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-current opacity-70"
                      style={{ width: `${Math.max(0, Math.min(100, page.progressPercent))}%` }}
                    />
                  </div>
                </div>
              )}

            {page.displayState === 'CORRECTION_REQUIRED' && setup.status.correctionNotes && (
              <p className="text-sm whitespace-pre-wrap border-t border-current/10 pt-3">
                {setup.status.correctionNotes}
              </p>
            )}

            <div className="flex flex-col gap-2 pt-1">
              {page.displayState === 'UNAVAILABLE' ? (
                <button
                  type="button"
                  onClick={() => void refreshStatus()}
                  disabled={refreshing || Boolean(busy)}
                  className="w-full sm:w-auto bg-gray-900 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-gray-800 disabled:opacity-50"
                >
                  {refreshing ? 'Refreshing…' : 'Refresh Status'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void startHandoff()}
                  disabled={!page.handoffEnabled || Boolean(busy)}
                  className="w-full sm:w-auto bg-red-600 text-white px-4 py-2.5 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {busy === 'handoff' ? 'Opening ACCURA…' : page.handoffLabel}
                </button>
              )}
              {page.displayState !== 'UNAVAILABLE' && (
                <button
                  type="button"
                  onClick={() => void refreshStatus()}
                  disabled={refreshing || Boolean(busy)}
                  className="w-full sm:w-auto text-sm text-current/80 underline-offset-2 hover:underline disabled:opacity-50 self-start"
                >
                  {refreshing ? 'Refreshing…' : 'Refresh status'}
                </button>
              )}
            </div>
          </section>

          {!isActive && (
            <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 sm:p-6 space-y-3 w-full">
              <h2 className="text-lg font-semibold text-gray-900">Connection Status</h2>
              <dl className="space-y-3 text-sm">
                <div className="flex flex-col sm:flex-row sm:justify-between gap-0.5 sm:gap-4">
                  <dt className="text-gray-500">ACCURA Connection</dt>
                  <dd className="font-medium text-gray-900 sm:text-right">
                    {page.connection.connectionLabel}
                  </dd>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between gap-0.5 sm:gap-4">
                  <dt className="text-gray-500">Electronic Invoicing</dt>
                  <dd className="font-medium text-gray-900 sm:text-right">
                    {page.connection.invoicingLabel}
                  </dd>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between gap-0.5 sm:gap-4">
                  <dt className="text-gray-500">Production</dt>
                  <dd className="font-medium text-gray-900 sm:text-right">
                    {page.connection.productionLabel}
                  </dd>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between gap-0.5 sm:gap-4">
                  <dt className="text-gray-500">Shop Mapping</dt>
                  <dd className="font-medium text-gray-900 sm:text-right">
                    {page.connection.shopMappingLabel}
                  </dd>
                </div>
              </dl>
            </section>
          )}

          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 sm:p-6 space-y-4 w-full">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Shop &amp; Branch Mapping</h2>
              <p className="text-sm text-gray-500 mt-1">
                Connect each WeKonnek shop to its corresponding ACCURA branch.
              </p>
            </div>
            {setup.shops.length === 0 && (
              <p className="text-sm text-gray-500">No WeKonnek shops yet.</p>
            )}
            {setup.shops.map((shop) => {
              const mappedName = branchName(setup.registeredBranches, shop.accuraBranchId);
              const mapped = Boolean(shop.accuraBranchId);
              return (
                <div
                  key={shop.shopId}
                  className="border border-gray-200 rounded-lg p-4 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <h3 className="font-semibold text-gray-900 break-words">{shop.name}</h3>
                    <span
                      className={`text-xs font-semibold uppercase tracking-wide shrink-0 ${
                        mapped ? 'text-green-700' : 'text-amber-700'
                      }`}
                    >
                      {mapped ? 'Mapped' : 'Not mapped'}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <label
                      htmlFor={`accura-branch-${shop.shopId}`}
                      className="text-xs uppercase tracking-wide text-gray-500 font-medium"
                    >
                      ACCURA Branch
                    </label>
                    {mapped && mappedName && (
                      <p className="text-sm font-medium text-gray-900 break-words">{mappedName}</p>
                    )}
                    {!mapped && (
                      <p className="text-sm text-gray-500">
                        Map this shop before electronic invoices can be issued for its
                        transactions.
                      </p>
                    )}
                    <select
                      id={`accura-branch-${shop.shopId}`}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white max-w-full"
                      value={shop.accuraBranchId || ''}
                      disabled={setup.unavailable || Boolean(busy)}
                      onChange={(e) => void mapShop(shop.shopId, e.target.value)}
                    >
                      <option value="">
                        {mapped ? 'Change Branch' : 'Select ACCURA Branch'}
                      </option>
                      {setup.registeredBranches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
            {setup.registeredBranches.length === 0 && setup.shops.length > 0 && (
              <p className="text-sm text-gray-500">
                No ACCURA branches are available yet. Continue setup in ACCURA first.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
