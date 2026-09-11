'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { getToken, useAuth } from '@/hooks/use-auth';
import {
  accuraBusinessInfoPresentation,
  accuraOnboardingPresentation,
  hasAuthoritativeTaxpayerProfile,
  submittedForReviewNotice,
  statusToneClass,
} from '@/lib/accura-onboarding-presentation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type ProfileForm = {
  legalName: string;
  tradeName: string;
  contactEmail: string;
  contactPhone: string;
  registeredAddressLine1: string;
  tin: string;
  classification: '' | 'VAT' | 'NON_VAT' | 'VAT_EXEMPT';
  code: string;
};

type SetupResponse = {
  unavailable: boolean;
  unavailableMessage?: string;
  wekonnekDisplayName?: string;
  notice?: string;
  prefill: ProfileForm;
  profile: ProfileForm;
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
  documents: Array<{
    id: string;
    documentType: string;
    label: string;
    originalFilename: string;
    uploadedAt: string | null;
    statusLabel: string;
    reviewNotes: string | null;
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

function emptyForm(): ProfileForm {
  return {
    legalName: '',
    tradeName: '',
    contactEmail: '',
    contactPhone: '',
    registeredAddressLine1: '',
    tin: '',
    classification: '',
    code: '',
  };
}

function formFromSetup(setup: SetupResponse): ProfileForm {
  const profile = setup.profile || emptyForm();
  const prefill = setup.prefill || emptyForm();
  const saved = hasAuthoritativeTaxpayerProfile(profile);
  const pick = (key: keyof ProfileForm) =>
    saved ? profile[key] || '' : profile[key] || prefill[key] || '';
  return {
    legalName: pick('legalName'),
    tradeName: pick('tradeName'),
    contactEmail: pick('contactEmail'),
    contactPhone: pick('contactPhone'),
    registeredAddressLine1: pick('registeredAddressLine1'),
    tin: pick('tin'),
    classification: (pick('classification') as ProfileForm['classification']) || '',
    code: profile.code || '',
  };
}

export default function EReceiptTaxSetupPage() {
  const { user } = useAuth();
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [form, setForm] = useState<ProfileForm>(emptyForm());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitNotice, setSubmitNotice] = useState<{ title: string; body: string } | null>(null);
  const [editingBusinessInfo, setEditingBusinessInfo] = useState(false);
  const [branchCode, setBranchCode] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [documentType, setDocumentType] = useState('BIR_CERTIFICATE_OF_REGISTRATION');
  const [documentFile, setDocumentFile] = useState<File | null>(null);

  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${getToken()}` }),
    [],
  );

  const applySetup = useCallback((next: SetupResponse) => {
    setSetup(next);
    setForm(formFromSetup(next));
    setEditingBusinessInfo(false);
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`${API}/api/integrations/accura/onboarding/profile`, {
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(apiMessage(data, 'Unable to load E-Receipt setup.'));
    applySetup(data as SetupResponse);
  }, [applySetup, authHeaders]);

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

  const run = async (label: string, work: () => Promise<Response>) => {
    setBusy(label);
    setError(null);
    setSuccess(null);
    if (label !== 'submit') setSubmitNotice(null);
    try {
      const res = await work();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiMessage(data, 'Request failed.'));
      applySetup(data as SetupResponse);
      return data as SetupResponse;
    } finally {
      setBusy('');
    }
  };

  const usedPrefill = useMemo(() => {
    if (!setup) return false;
    return Object.keys(setup.prefill || {}).some((key) => {
      const field = key as keyof ProfileForm;
      return !setup.profile[field] && Boolean(setup.prefill[field]);
    });
  }, [setup]);

  const presentation = useMemo(
    () =>
      setup
        ? accuraOnboardingPresentation({
            unavailable: setup.unavailable,
            suspended: setup.status.suspended,
            reviewStatus: setup.status.reviewStatus,
            correctionRequired: setup.status.correctionRequired,
            readinessComplete: setup.readiness.complete,
            readinessPercent: setup.readiness.percent,
          })
        : null,
    [setup],
  );

  const businessInfo = useMemo(
    () =>
      setup
        ? accuraBusinessInfoPresentation({
            profile: setup.profile,
            reviewStatus: setup.status.reviewStatus,
            correctionRequired: setup.status.correctionRequired,
            unavailable: setup.unavailable,
            editing: editingBusinessInfo,
          })
        : null,
    [setup, editingBusinessInfo],
  );

  if (user && user.role !== 'merchant') {
    return (
      <div className="max-w-3xl mx-auto p-6 text-sm text-gray-600">
        E-Receipt / Tax Setup is available to Merchant Admin only.
      </div>
    );
  }

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!businessInfo?.showSave && !businessInfo?.showSaveChanges) return;
    const updating = Boolean(businessInfo.showSaveChanges);
    try {
      await run('save', () =>
        fetch(`${API}/api/integrations/accura/onboarding/profile`, {
          method: 'PATCH',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            legalName: form.legalName,
            tradeName: form.tradeName || null,
            contactEmail: form.contactEmail || null,
            contactPhone: form.contactPhone || null,
            registeredAddressLine1: form.registeredAddressLine1,
            tin: form.tin,
            ...(form.classification ? { classification: form.classification } : {}),
          }),
        }),
      );
      setSuccess(
        updating
          ? 'Business information updated successfully.'
          : 'Business information saved successfully.',
      );
    } catch (err) {
      if (updating) setEditingBusinessInfo(true);
      setError(err instanceof Error ? err.message : 'Unable to save.');
    }
  };

  const cancelBusinessInfoEdit = () => {
    if (!setup) return;
    setForm(formFromSetup(setup));
    setEditingBusinessInfo(false);
    setError(null);
  };

  const createBranch = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await run('branch', () =>
        fetch(`${API}/api/integrations/accura/onboarding/branches`, {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: branchCode,
            name: branchName,
            addressLine1: branchAddress || undefined,
          }),
        }),
      );
      setBranchCode('');
      setBranchName('');
      setBranchAddress('');
      setSuccess('Registered branch saved in ACCURA.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save the registered branch.');
    }
  };

  const mapShop = async (shopId: number, accuraBranchId: string) => {
    try {
      await run('map', () =>
        fetch(`${API}/api/integrations/accura/onboarding/shop-mappings`, {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shopId,
            accuraBranchId: accuraBranchId || null,
          }),
        }),
      );
      setSuccess('Shop mapping saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save shop mapping.');
    }
  };

  const uploadDocument = async (event: FormEvent) => {
    event.preventDefault();
    if (!documentFile) {
      setError('Choose a PDF, JPG, or PNG file first.');
      return;
    }
    const payload = new FormData();
    payload.set('documentType', documentType);
    payload.set('file', documentFile);
    try {
      await run('upload', () =>
        fetch(`${API}/api/integrations/accura/onboarding/documents`, {
          method: 'POST',
          headers: authHeaders(),
          body: payload,
        }),
      );
      setDocumentFile(null);
      setSuccess('Document sent to ACCURA.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload the document.');
    }
  };

  const submitReview = async () => {
    if (!presentation?.submitEnabled || busy) return;
    try {
      await run('submit', () =>
        fetch(`${API}/api/integrations/accura/onboarding/submit`, {
          method: 'POST',
          headers: authHeaders(),
        }),
      );
      const notice = submittedForReviewNotice(true);
      setSubmitNotice(notice);
      setSuccess(null);
      if (notice) toast.success(`${notice.title}. ${notice.body}`);
    } catch (err) {
      setSubmitNotice(submittedForReviewNotice(false));
      setError(err instanceof Error ? err.message : 'Unable to submit for review.');
    }
  };

  const canSubmit = Boolean(presentation?.submitEnabled);

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
      <div className="flex items-center gap-3">
        <Link href="/merchant/settings/security" className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">E-Receipt / Tax Setup</h1>
          <p className="text-sm text-gray-500">
            Register your taxpayer details with ACCURA. WeKonnek display name stays separate.
          </p>
        </div>
      </div>

      {loading && <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500">Loading ACCURA status…</div>}
      {submitNotice && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-4 rounded-lg">
          <p className="text-sm font-bold uppercase tracking-wide">{submitNotice.title}</p>
          <p className="text-sm mt-1">{submitNotice.body}</p>
        </div>
      )}
      {success && !submitNotice && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      {setup && (
        <>
          <section className={`rounded-xl border p-6 space-y-3 ${statusToneClass(presentation?.phase || 'incomplete')}`}>
            <p className="text-xs uppercase tracking-wide font-semibold">Registration Status</p>
            <h2 className="text-xl font-bold">
              {presentation?.title || 'Setup Incomplete'}
            </h2>
            {presentation?.body && <p className="text-sm">{presentation.body}</p>}
            {!setup.unavailable && setup.status.companyAccountStatusLabel && (
              <p className="text-sm">Account status: {setup.status.companyAccountStatusLabel}</p>
            )}
            {setup.status.issuanceActive && <p className="text-sm font-medium">E-Receipt Issuance: ACTIVE</p>}
            {presentation?.phase === 'correction' && setup.status.correctionNotes && (
              <p className="text-sm whitespace-pre-wrap">{setup.status.correctionNotes}</p>
            )}
            {setup.unavailable && (
              <p className="text-sm">{setup.unavailableMessage || setup.notice}</p>
            )}
            {setup.status.lastKnown && setup.unavailable && (
              <p className="text-xs">Last known ACCURA status is shown until the service is available again.</p>
            )}
          </section>

          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">E-Receipt Setup</h2>
            <p className="text-sm text-gray-500">Setup: {setup.readiness.percent}% complete</p>
            <ul className="space-y-2 text-sm">
              {setup.readiness.sections.map((section) => (
                <li key={section.key} className="flex gap-2">
                  <span>{section.complete ? '✓' : '!'}</span>
                  <span>
                    {section.label}
                    {section.missing.length > 0 ? ` — ${section.missing.join(', ')}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {setup.notice && <p className="text-xs text-gray-500">{setup.notice}</p>}
          </section>

          <form onSubmit={saveProfile} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Registered Business Information</h2>
            {setup.wekonnekDisplayName && (
              <p className="text-sm text-gray-500">
                WeKonnek display name: <span className="font-medium text-gray-700">{setup.wekonnekDisplayName}</span>
                {' '}(this is not replaced by the registered taxpayer name)
              </p>
            )}
            {usedPrefill && businessInfo && !businessInfo.saved && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Some fields were filled from your WeKonnek merchant profile for convenience. Review them before saving. ACCURA remains the official record after you save.
              </p>
            )}
            {businessInfo?.lockLabel && (
              <p className="text-sm font-medium text-gray-700">{businessInfo.lockLabel}</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="text-sm space-y-1 md:col-span-2">
                <span className="font-medium text-gray-700">Registered Business Name</span>
                <input className="w-full border rounded-lg px-3 py-2 disabled:bg-gray-50" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} disabled={Boolean(businessInfo?.fieldsDisabled)} />
              </label>
              <label className="text-sm space-y-1">
                <span className="font-medium text-gray-700">Trade Name</span>
                <input className="w-full border rounded-lg px-3 py-2 disabled:bg-gray-50" value={form.tradeName} onChange={(e) => setForm({ ...form, tradeName: e.target.value })} disabled={Boolean(businessInfo?.fieldsDisabled)} />
              </label>
              <label className="text-sm space-y-1">
                <span className="font-medium text-gray-700">TIN</span>
                <input className="w-full border rounded-lg px-3 py-2 disabled:bg-gray-50" autoComplete="off" value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })} disabled={Boolean(businessInfo?.fieldsDisabled)} />
              </label>
              <label className="text-sm space-y-1 md:col-span-2">
                <span className="font-medium text-gray-700">Registered Business Address</span>
                <input className="w-full border rounded-lg px-3 py-2 disabled:bg-gray-50" value={form.registeredAddressLine1} onChange={(e) => setForm({ ...form, registeredAddressLine1: e.target.value })} disabled={Boolean(businessInfo?.fieldsDisabled)} />
              </label>
              <label className="text-sm space-y-1">
                <span className="font-medium text-gray-700">Contact email</span>
                <input className="w-full border rounded-lg px-3 py-2 disabled:bg-gray-50" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} disabled={Boolean(businessInfo?.fieldsDisabled)} />
              </label>
              <label className="text-sm space-y-1">
                <span className="font-medium text-gray-700">Contact phone</span>
                <input className="w-full border rounded-lg px-3 py-2 disabled:bg-gray-50" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} disabled={Boolean(businessInfo?.fieldsDisabled)} />
              </label>
            </div>

            <h3 className="text-base font-semibold text-gray-900 pt-2">Tax Configuration</h3>
            <label className="text-sm space-y-1 block">
              <span className="font-medium text-gray-700">VAT / Tax Classification</span>
              <select className="w-full border rounded-lg px-3 py-2 disabled:bg-gray-50" value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value as ProfileForm['classification'] })} disabled={Boolean(businessInfo?.fieldsDisabled)}>
                <option value="">Select</option>
                <option value="VAT">VAT</option>
                <option value="NON_VAT">Non-VAT</option>
                <option value="VAT_EXEMPT">VAT Exempt</option>
              </select>
            </label>
            {form.code && <p className="text-xs text-gray-500">ACCURA client code: {form.code}</p>}
            <div className="flex flex-wrap gap-3">
              {businessInfo?.showSave && (
                <button type="submit" disabled={Boolean(busy)} className="bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50">
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </button>
              )}
              {businessInfo?.showEdit && (
                <button
                  type="button"
                  onClick={() => setEditingBusinessInfo(true)}
                  disabled={Boolean(busy)}
                  className="bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  Edit
                </button>
              )}
              {businessInfo?.showSaveChanges && (
                <button type="submit" disabled={Boolean(busy)} className="bg-red-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50">
                  {busy === 'save' ? 'Saving…' : 'Save Changes'}
                </button>
              )}
              {businessInfo?.showCancel && (
                <button
                  type="button"
                  onClick={cancelBusinessInfoEdit}
                  disabled={Boolean(busy)}
                  className="border border-gray-300 px-4 py-2 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Registered Branches</h2>
            <p className="text-sm text-gray-500">
              A WeKonnek shop is not automatically a registered taxpayer branch. Add the branches that appear on your tax registration, then map shops if needed.
            </p>
            {setup.registeredBranches.length === 0 && (
              <p className="text-sm text-gray-500">No registered branches yet.</p>
            )}
            <ul className="space-y-2 text-sm">
              {setup.registeredBranches.map((branch) => (
                <li key={branch.id} className="border border-gray-100 rounded-lg px-3 py-2">
                  <span className="font-medium">{branch.name}</span>
                  <span className="text-gray-500"> · {branch.code}</span>
                  {branch.addressLine1 ? <div className="text-gray-500">{branch.addressLine1}</div> : null}
                </li>
              ))}
            </ul>
            <form onSubmit={createBranch} className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Branch code" value={branchCode} onChange={(e) => setBranchCode(e.target.value)} disabled={setup.unavailable} />
              <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Registered branch name" value={branchName} onChange={(e) => setBranchName(e.target.value)} disabled={setup.unavailable} />
              <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Address" value={branchAddress} onChange={(e) => setBranchAddress(e.target.value)} disabled={setup.unavailable} />
              <button type="submit" disabled={setup.unavailable || Boolean(busy)} className="md:col-span-3 border border-gray-300 rounded-lg py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                {busy === 'branch' ? 'Saving…' : 'Add registered branch'}
              </button>
            </form>
            {setup.shops.length > 0 && (
              <div className="space-y-3 pt-2">
                <h3 className="font-medium text-gray-900">WeKonnek shops</h3>
                {setup.shops.map((shop) => (
                  <label key={shop.shopId} className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
                    <span className="sm:w-40 font-medium text-gray-700">{shop.name}</span>
                    <select
                      className="flex-1 border rounded-lg px-3 py-2"
                      value={shop.accuraBranchId || ''}
                      disabled={setup.unavailable}
                      onChange={(e) => void mapShop(shop.shopId, e.target.value)}
                    >
                      <option value="">Select / Configure</option>
                      {setup.registeredBranches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name} ({branch.code})
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Supporting Documents</h2>
            <ul className="space-y-2 text-sm">
              {setup.documents.map((doc) => (
                <li key={doc.id} className="border border-gray-100 rounded-lg px-3 py-2">
                  <div className="font-medium">{doc.label}</div>
                  <div className="text-gray-500">{doc.originalFilename}</div>
                  <div className="text-gray-500">
                    {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleString() : ''} · {doc.statusLabel}
                  </div>
                  {doc.reviewNotes && <div className="text-amber-800">{doc.reviewNotes}</div>}
                </li>
              ))}
            </ul>
            <form onSubmit={uploadDocument} className="space-y-3">
              <select className="w-full border rounded-lg px-3 py-2 text-sm" value={documentType} onChange={(e) => setDocumentType(e.target.value)} disabled={setup.unavailable}>
                <option value="BIR_CERTIFICATE_OF_REGISTRATION">Certificate of Registration</option>
                <option value="OTHER_TAX_REGISTRATION_DOCUMENT">Other tax registration document</option>
              </select>
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                className="block w-full text-sm"
                disabled={setup.unavailable}
                onChange={(e) => setDocumentFile(e.target.files?.[0] || null)}
              />
              <button type="submit" disabled={setup.unavailable || Boolean(busy)} className="border border-gray-300 rounded-lg px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                {busy === 'upload' ? 'Uploading…' : 'Upload Registration Document'}
              </button>
            </form>
          </section>

          <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">Submission / Review</h2>
            <p className="text-sm text-gray-500">
              ACCURA System Admin reviews this setup. You cannot activate e-receipt issuance yourself.
            </p>
            {presentation?.submitKind === 'none' ? (
              <div className="w-full bg-gray-100 text-gray-600 py-3 rounded-lg font-medium text-center text-sm">
                {presentation.phase === 'approved'
                  ? 'Approved for ACCURA Setup'
                  : presentation.phase === 'under_review'
                    ? 'Under ACCURA Review'
                    : 'Submitted for Review'}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void submitReview()}
                disabled={!canSubmit || Boolean(busy)}
                className="w-full bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {busy === 'submit' ? 'Submitting…' : presentation?.submitLabel || 'Submit for ACCURA Review'}
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
