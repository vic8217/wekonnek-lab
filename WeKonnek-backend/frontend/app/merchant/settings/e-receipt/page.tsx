'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getToken, useAuth } from '@/hooks/use-auth';
import {
  accuraEInvoiceStatusPage,
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
    suspended: boolean;
    correctionRequired: boolean;
    correctionNotes: string | null;
    approvedForAccuraSetup: boolean;
    lastKnown?: boolean;
    lastKnownPercent?: number | null;
  };
  readiness: {
    complete: boolean;
    percent: number;
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

export default function EReceiptTaxSetupPage() {
  const { user } = useAuth();
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [loading, setLoading] = useState(true);
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
    if (!res.ok) throw new Error(apiMessage(data, 'Unable to load E-Receipt setup.'));
    setSetup(data as SetupResponse);
  }, [authHeaders]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load E-Receipt setup.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const page = useMemo(
    () =>
      setup
        ? accuraEInvoiceStatusPage({
            unavailable: setup.unavailable,
            lastKnown: setup.status.lastKnown,
            lastKnownPercent: setup.status.lastKnownPercent,
            notConfigured: /not configured/i.test(setup.unavailableMessage || ''),
            suspended: setup.status.suspended,
            correctionRequired: setup.status.correctionRequired,
            reviewStatus: setup.status.reviewStatus,
            issuanceActive: setup.status.issuanceActive,
            approvedForAccuraSetup: setup.status.approvedForAccuraSetup,
            readinessComplete: setup.readiness.complete,
            readinessPercent: setup.readiness.percent,
            sections: setup.readiness.sections,
          })
        : null,
    [setup],
  );

  if (user && user.role !== 'merchant') {
    return (
      <div className="max-w-3xl mx-auto p-6 text-sm text-gray-600">
        ACCURA E-Invoice setup is available to Merchant Admin only.
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
    if (busy || setup?.unavailable) return;
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

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
      <div className="flex items-center gap-3">
        <Link href="/merchant/settings/security" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ACCURA Electronic Invoicing</h1>
          <p className="text-sm text-gray-500">
            WeKonnek display name and shops stay here. Taxpayer registration is managed in ACCURA.
          </p>
        </div>
      </div>

      {loading && <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">Loading ACCURA status…</div>}
      {success && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      {setup && page && (
        <>
          <section className={`rounded-xl border p-6 space-y-3 ${statusPageToneClass(page.displayState)}`}>
            <p className="text-xs uppercase tracking-wide font-semibold">Status</p>
            <h2 className="text-xl font-bold">{page.title}</h2>
            {page.progressPercent != null && (
              <p className="text-sm">Progress: {page.progressPercent}%</p>
            )}
            <p className="text-sm">{page.body}</p>
            {setup.wekonnekDisplayName && (
              <p className="text-sm">WeKonnek display name: {setup.wekonnekDisplayName}</p>
            )}
            {!setup.unavailable && setup.status.companyAccountStatusLabel && (
              <p className="text-sm">Account status: {setup.status.companyAccountStatusLabel}</p>
            )}
            {page.lastKnown && (
              <p className="text-xs">Last known ACCURA status is shown until the service is available again.</p>
            )}
            {setup.unavailable && (
              <p className="text-sm">{setup.unavailableMessage || setup.notice}</p>
            )}
            {page.displayState === 'CORRECTION_REQUIRED' && setup.status.correctionNotes && (
              <p className="text-sm whitespace-pre-wrap">{setup.status.correctionNotes}</p>
            )}
            <button
              type="button"
              onClick={() => void startHandoff()}
              disabled={!page.handoffEnabled || Boolean(busy)}
              className="bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
            >
              {busy === 'handoff' ? 'Opening ACCURA…' : page.handoffLabel}
            </button>
          </section>

          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Setup Status</h2>
            <ul className="space-y-2 text-sm">
              {page.sections.map((section) => (
                <li key={section.key} className="flex gap-2">
                  <span>{section.complete ? '✓' : '!'}</span>
                  <span>
                    {section.label}
                    {section.missing.length > 0 ? ` — ${section.missing.join('; ')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">WeKonnek shops</h2>
            <p className="text-sm text-gray-500">
              Map each WeKonnek shop to an ACCURA registered branch. Branch details are managed in ACCURA.
            </p>
            {setup.shops.length === 0 && (
              <p className="text-sm text-gray-500">No WeKonnek shops yet.</p>
            )}
            {setup.shops.map((shop) => (
              <label key={shop.shopId} className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
                <span className="sm:w-40 font-medium text-gray-700">{shop.name}</span>
                <select
                  className="flex-1 border rounded-lg px-3 py-2"
                  value={shop.accuraBranchId || ''}
                  disabled={setup.unavailable || Boolean(busy)}
                  onChange={(e) => void mapShop(shop.shopId, e.target.value)}
                >
                  <option value="">Select ACCURA branch</option>
                  {setup.registeredBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} ({branch.code})
                    </option>
                  ))}
                </select>
              </label>
            ))}
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
