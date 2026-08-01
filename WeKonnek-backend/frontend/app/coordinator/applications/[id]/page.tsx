'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, ExternalLink, FileUp, Pencil, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { getToken } from '@/hooks/use-auth';

type Application = {
  id: number;
  business_name: string;
  contact_name?: string;
  email: string;
  phone?: string;
  address?: string;
  category_name?: string;
  city_municipality?: string;
  barangay?: string;
  council_district?: string;
  geographic_area?: string;
  business_description?: string;
  has_branches?: boolean;
  branch_count?: number;
  product_count?: number;
  subscription_tier: string;
  subscription_plan: string;
  subscription_amount: number | string;
  selected_add_on_ids?: string[];
  selected_add_on_quantities?: Record<string, number>;
  payment_method?: string;
  payment_proof_url?: string;
  business_permit_url?: string;
  dti_permit_url?: string;
  valid_id_url?: string;
  establishment_photo_url?: string;
  authorized_person_photo_url?: string;
  business_documents_urls?: string[];
  coordinator_notes?: string;
  status: string;
  submitted_at: string;
  merchant_account?: MerchantAccount;
};

type FeeBreakdown = {
  plan: { name: string; amount: number; billing_unit: string };
  add_ons: Array<{ id: string; name: string; amount: number; quantity: number; subtotal: number; billing_unit: string; amount_basis?: string | null }>;
  add_on_fee: number;
  total_fee: number;
};

type MerchantAccount = {
  id: number;
  merchant_code?: string;
  temporary_password?: string;
  recovery_key?: string;
  status: string;
  joined_at: string;
  approved_at?: string;
  approved_by_name?: string;
  wallet_balance: number;
  fee_breakdown: FeeBreakdown;
  ledger: {
    total_billed: number;
    total_paid: number;
    unpaid: number;
    payments: Array<{
      id: number;
      tier: string;
      plan: string;
      amount: number;
      payment_method: string;
      gateway?: string;
      status: string;
      payment_ref?: string;
      period_start?: string;
      period_end?: string;
      created_at: string;
    }>;
  };
};

type Plan = {
  id: string;
  tier: string;
  fixedAmount: number | string;
  variableOrderPercent?: number | string | null;
  productLimit?: number | null;
  features: string[];
};

type AddOn = {
  id: string;
  name: string;
  amount: number | string;
  billingUnit: 'day' | 'week' | 'month';
  amountBasis?: 'keyword' | 'inventory' | null;
  description?: string | null;
};

const documentFields = [
  ['payment_proof_url', 'Payment proof'],
  ['business_permit_url', 'Business permit'],
  ['dti_permit_url', 'DTI permit'],
  ['valid_id_url', 'Valid ID'],
  ['establishment_photo_url', 'Establishment photo'],
  ['authorized_person_photo_url', 'Authorized person photo'],
] as const;

export default function CoordinatorMerchantReviewPage() {
  const id = String(useParams().id || '');
  const [application, setApplication] = useState<Application | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [addOns, setAddOns] = useState<AddOn[]>([]);
  const [selectedTier, setSelectedTier] = useState('');
  const [selectedAddOnIds, setSelectedAddOnIds] = useState<string[]>([]);
  const [selectedAddOnQuantities, setSelectedAddOnQuantities] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingRecoveryKey, setGeneratingRecoveryKey] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [applicationResponse, plansResponse] = await Promise.all([
        fetch(`/api/backend/merchant-applications/coordinator/leads/${id}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
          cache: 'no-store',
        }),
        fetch('/api/backend/subscriptions/merchant-options', {
          headers: { Authorization: `Bearer ${getToken()}` },
          cache: 'no-store',
        }),
      ]);
      const applicationBody = await applicationResponse.json();
      if (!applicationResponse.ok) throw new Error(applicationBody.message || 'Unable to load the assigned application');
      setApplication(applicationBody);
      setNotes(applicationBody.coordinator_notes || '');
      setSelectedTier(applicationBody.subscription_tier || '');
      setSelectedAddOnIds(applicationBody.selected_add_on_ids || []);
      setSelectedAddOnQuantities(applicationBody.selected_add_on_quantities || {});
      setEditingSubscription(false);
      if (plansResponse.ok) {
        const options = await plansResponse.json();
        setPlans(Array.isArray(options.plans) ? options.plans : []);
        setAddOns(Array.isArray(options.addOns) ? options.addOns : []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the assigned application');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const initialLoad = setTimeout(load, 0);
    return () => clearTimeout(initialLoad);
  }, [load]);

  const upload = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'document');
    const response = await fetch('/api/backend/upload', { method: 'POST', body: formData });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || 'Document upload failed');
    return String(body.url);
  };

  const save = async () => {
    if (!application) return;
    setSaving(true);
    try {
      const entries = await Promise.all(
        documentFields
          .filter(([field]) => !application[field] && files[field])
          .map(async ([field]) => [field, await upload(files[field]!)] as const),
      );
      const businessDocuments = await Promise.all(extraFiles.map(upload));
      const response = await fetch(`/api/backend/merchant-applications/coordinator/leads/${id}/review`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coordinator_notes: notes,
          ...Object.fromEntries(entries),
          business_documents_urls: businessDocuments,
          subscription_tier: selectedTier,
          selected_add_on_ids: selectedAddOnIds,
          selected_add_on_quantities: selectedAddOnQuantities,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Unable to save coordinator review');
      if (application.status !== 'approved' && body.status !== 'for_approval') {
        throw new Error(`Review was saved but the application status is still ${body.status || 'unknown'}. Restart the backend and submit again.`);
      }
      setApplication(body);
      setSelectedTier(body.subscription_tier || '');
      setSelectedAddOnIds(body.selected_add_on_ids || []);
      setSelectedAddOnQuantities(body.selected_add_on_quantities || {});
      setEditingSubscription(false);
      setFiles({});
      setExtraFiles([]);
      toast.success(body.status === 'for_approval' ? 'Review submitted for admin approval.' : 'Coordinator review saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to save coordinator review');
    } finally {
      setSaving(false);
    }
  };

  const generateRecoveryKey = async () => {
    setGeneratingRecoveryKey(true);
    try {
      const response = await fetch(`/api/backend/merchant-applications/coordinator/leads/${id}/recovery-key`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Unable to generate recovery key');
      setApplication(current => current?.merchant_account
        ? {
            ...current,
            merchant_account: {
              ...current.merchant_account,
              recovery_key: body.recovery_key,
            },
          }
        : current);
      toast.success('Recovery key generated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to generate recovery key');
    } finally {
      setGeneratingRecoveryKey(false);
    }
  };

  if (loading) return <div className="rounded-2xl border border-[#d2ddea] bg-white p-16 text-center text-sm text-[#4d6385]">Loading merchant application…</div>;
  if (error || !application) return <div><Link href="/coordinator/applications" className="inline-flex items-center gap-2 text-sm font-bold text-[#075cff]"><ArrowLeft size={17} /> Back to applications</Link><div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error || 'Application not found'}</div></div>;

  const submittedDocuments = [
    ...documentFields.flatMap(([field, label]) => application[field] ? [[label, application[field]] as [string, string]] : []),
    ...(application.business_documents_urls || []).map((url, index) => [`Business document ${index + 1}`, url] as [string, string]),
  ];
  const canEdit = application.status === 'pending' || application.status === 'reviewing';
  const canEditSubscription = canEdit || editingSubscription;
  const approvedTier = application.status === 'approved' ? application.subscription_tier : '';

  const cancelSubscriptionChange = () => {
    setSelectedTier(application.subscription_tier || '');
    setSelectedAddOnIds(application.selected_add_on_ids || []);
    setSelectedAddOnQuantities(application.selected_add_on_quantities || {});
    setEditingSubscription(false);
  };

  return <div className="space-y-6">
    <div>
      <Link href="/coordinator/applications" className="inline-flex items-center gap-2 text-sm font-bold text-[#075cff]"><ArrowLeft size={17} /> Back to applications</Link>
      <div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-2xl font-black text-[#071d43]">{application.business_name}</h2><p className="mt-1 text-sm text-[#4d6385]">Review the merchant’s application, documents, and interview notes.</p></div><span className={`w-fit rounded-full px-3 py-1 text-xs font-black uppercase ${application.status === 'for_approval' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{application.status.replaceAll('_', ' ')}</span></div>
    </div>

    {application.merchant_account && (
      <MerchantAccountOverview
        account={application.merchant_account}
        generatingRecoveryKey={generatingRecoveryKey}
        onGenerateRecoveryKey={generateRecoveryKey}
      />
    )}

    <section className="rounded-2xl border border-[#d2ddea] bg-white p-5 shadow-sm">
      <h3 className="text-base font-black text-[#071d43]">Application details</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Contact person" value={application.contact_name} />
        <Detail label="Email" value={application.email} />
        <Detail label="Phone" value={application.phone} />
        <Detail label="Category" value={application.category_name} />
        <Detail label="City / Municipality" value={application.city_municipality} />
        <Detail label="Council district" value={application.council_district} />
        <Detail label="Barangay / Area" value={application.geographic_area || application.barangay} />
        <Detail label="Address" value={application.address} />
        <Detail label="Branches" value={application.has_branches ? `${application.branch_count || 0} branch(es)` : 'No branches'} />
        <Detail label="Estimated products" value={application.product_count} />
        <Detail label="Selected plan" value={`${application.subscription_tier} · ${application.subscription_plan}`} capitalize />
        <Detail label="Submitted" value={new Date(application.submitted_at).toLocaleString()} />
        <Detail label="Business description" value={application.business_description} wide />
      </div>
    </section>

    <section className="rounded-2xl border border-[#d2ddea] bg-white p-5 shadow-sm">
      <h3 className="text-base font-black text-[#071d43]">Merchant documents</h3>
      {submittedDocuments.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{submittedDocuments.map(([label, url]) => <a key={`${label}-${url}`} href={url} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-[#d2ddea] px-4 py-3 text-sm font-bold text-[#075cff] hover:bg-blue-50"><span>{label}</span><ExternalLink size={16} /></a>)}</div>}
      {canEdit && <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {documentFields.filter(([field]) => !application[field]).map(([field, label]) => <label key={field} className="rounded-xl border border-dashed border-[#b8c8dc] bg-[#f8faff] p-4">
          <span className="flex items-center gap-2 text-sm font-black text-[#365078]"><FileUp size={17} /> Add {label}</span>
          <input type="file" accept=".pdf,image/jpeg,image/png" className="mt-3 block w-full text-xs text-[#4d6385] file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-bold file:text-[#075cff]" onChange={event => setFiles(current => ({ ...current, [field]: event.target.files?.[0] }))} />
        </label>)}
        <label className="rounded-xl border border-dashed border-[#b8c8dc] bg-[#f8faff] p-4">
          <span className="flex items-center gap-2 text-sm font-black text-[#365078]"><FileUp size={17} /> Add business documents</span>
          <input type="file" multiple accept=".pdf,image/jpeg,image/png" className="mt-3 block w-full text-xs text-[#4d6385] file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-bold file:text-[#075cff]" onChange={event => setExtraFiles(Array.from(event.target.files || []))} />
        </label>
      </div>}
      {submittedDocuments.length === 0 && <p className="mt-4 text-sm text-[#4d6385]">No documents were submitted by the merchant. Add available documents above during the interview.</p>}
    </section>

    <section className="rounded-2xl border border-[#d2ddea] bg-white p-5 shadow-sm">
      <h3 className="text-base font-black text-[#071d43]">Coordinator notes</h3>
      <p className="mt-1 text-xs text-[#4d6385]">Record interview findings, follow-ups, and document concerns for the admin review.</p>
      <textarea value={notes} onChange={event => setNotes(event.target.value)} disabled={!canEdit} rows={6} maxLength={5000} placeholder="Add coordinator interview notes…" className="mt-4 w-full rounded-xl border border-[#ccd8e9] px-4 py-3 text-sm text-[#071d43] outline-none focus:border-[#075cff] disabled:bg-[#f6f8fc] disabled:text-[#4d6385]" />
    </section>

    <section>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="text-lg font-black text-[#071d43]">Merchant plans</h3><p className="mt-1 text-sm text-[#4d6385]">{application.status === 'approved' && !editingSubscription ? 'The approved plan is locked until change mode is enabled.' : 'Choose one plan for this merchant.'}</p></div>
        {application.status === 'approved' && !editingSubscription && <button type="button" onClick={() => setEditingSubscription(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#075cff] px-4 py-2.5 text-sm font-black text-white hover:bg-[#064ed8]"><Pencil size={16} /> Change plan and add-ons</button>}
        {application.status === 'approved' && editingSubscription && <button type="button" onClick={cancelSubscriptionChange} className="inline-flex items-center gap-2 rounded-xl border border-[#ccd8e9] bg-white px-4 py-2.5 text-sm font-black text-[#365078]"><X size={16} /> Cancel changes</button>}
      </div>
      {plans.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-[#b8c8dc] bg-white p-8 text-center text-sm text-[#4d6385]">No active merchant plans are configured.</div> : <div className="mt-4 grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">{plans.map(plan => <div key={plan.id} className={`flex h-full flex-col rounded-2xl border bg-white p-5 shadow-sm ${plan.tier === selectedTier ? 'border-[#075cff] ring-2 ring-blue-100' : 'border-[#d2ddea]'}`}>
        <div className="flex items-start justify-between gap-3"><div><p className="text-lg font-black capitalize text-[#071d43]">{plan.tier}</p><p className="mt-1 text-xs text-[#4d6385]">{plan.productLimit ?? 0} product listings</p></div>{plan.tier === selectedTier && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black uppercase text-[#075cff]">Selected</span>}</div>
        <div className="mt-4 rounded-xl bg-[#f6f8fc] p-3"><p className="text-[10px] font-bold uppercase text-[#4d6385]">Per day</p><p className="mt-1 text-lg font-black text-[#071d43]">₱{Number(plan.fixedAmount).toLocaleString()}</p></div>
        <p className="mt-3 text-sm text-[#365078]"><b>{plan.variableOrderPercent == null ? 'N/A' : `${Number(plan.variableOrderPercent)}%`}</b> on system sales</p>
        <ul className="mt-4 flex-1 space-y-2">{plan.features.map(feature => <li key={feature} className="flex gap-2 text-sm text-[#365078]"><Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />{feature}</li>)}</ul>
        <button type="button" onClick={() => setSelectedTier(plan.tier)} disabled={!canEditSubscription || plan.tier === selectedTier || plan.tier === approvedTier} className="mt-5 w-full shrink-0 rounded-xl bg-[#075cff] px-4 py-2.5 text-sm font-black text-white disabled:bg-blue-50 disabled:text-[#075cff]">{plan.tier === approvedTier ? 'Current plan' : plan.tier === selectedTier ? 'Selected' : 'Select plan'}</button>
      </div>)}</div>}
    </section>

    <section>
      <div><h3 className="text-lg font-black text-[#071d43]">Merchant add-ons</h3><p className="mt-1 text-sm text-[#4d6385]">Select any additional packages for this merchant.</p></div>
      {addOns.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-[#b8c8dc] bg-white p-8 text-center text-sm text-[#4d6385]">No active merchant add-ons are configured.</div> : <div className="mt-4 grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-4">{addOns.map(addOn => {
        const selected = selectedAddOnIds.includes(addOn.id);
        return <div key={addOn.id} className={`flex h-full flex-col rounded-2xl border bg-white p-5 shadow-sm ${selected ? 'border-[#075cff] ring-2 ring-blue-100' : 'border-[#d2ddea]'}`}>
          <div className="flex items-start justify-between gap-3"><p className="text-lg font-black text-[#071d43]">{addOn.name}</p>{selected && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black uppercase text-[#075cff]">Selected</span>}</div>
          <p className="mt-4 text-2xl font-black text-[#071d43]">₱{Number(addOn.amount).toLocaleString()}</p>
          <p className="text-[10px] font-bold uppercase text-[#4d6385]">Per {addOn.billingUnit}{addOn.amountBasis ? ` · Per ${addOn.amountBasis === 'inventory' ? 'inventory item' : 'keyword'}` : ''}</p>
          <p className="mt-4 flex-1 text-sm leading-6 text-[#365078]">{addOn.description || 'No description provided.'}</p>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-black text-[#365078]">
              Number of {addOn.amountBasis === 'keyword' ? 'keywords' : 'products/items'}
            </span>
            <input
              type="number"
              min="1"
              step="1"
              required={selected}
              disabled={!canEditSubscription}
              value={selectedAddOnQuantities[addOn.id] || 1}
              onChange={(event) => setSelectedAddOnQuantities(current => ({
                ...current,
                [addOn.id]: Math.max(1, Number.parseInt(event.target.value, 10) || 1),
              }))}
              className="w-full rounded-xl border border-[#b8c8dc] px-3 py-2.5 text-sm font-bold text-[#071d43] outline-none focus:border-[#075cff]"
            />
            {selected && (
              <span className="mt-2 block text-sm font-black text-[#075cff]">
                Subtotal: ₱{(Number(addOn.amount) * (selectedAddOnQuantities[addOn.id] || 1)).toLocaleString()}
              </span>
            )}
          </label>
          <button type="button" disabled={!canEditSubscription} onClick={() => {
            setSelectedAddOnIds(current => selected ? current.filter(value => value !== addOn.id) : [...current, addOn.id]);
            setSelectedAddOnQuantities(current => {
              const next = { ...current };
              if (selected) delete next[addOn.id];
              else if (!next[addOn.id]) next[addOn.id] = 1;
              return next;
            });
          }} className={`mt-5 w-full shrink-0 rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-60 ${selected ? 'border border-[#075cff] bg-white text-[#075cff]' : 'bg-[#075cff] text-white'}`}>{selected ? (canEditSubscription ? 'Remove add-on' : 'Selected') : 'Select add-on'}</button>
        </div>;
      })}</div>}
    </section>

    {canEditSubscription && <div className="sticky bottom-4 flex justify-end"><button onClick={save} disabled={saving || !selectedTier} className="inline-flex min-w-40 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-lg hover:bg-emerald-700 disabled:opacity-60"><Save size={17} />{saving ? 'Submitting…' : application.status === 'approved' ? 'Save subscription changes' : 'Submit for approval'}</button></div>}
  </div>;
}

function Detail({ label, value, wide = false, capitalize = false }: { label: string; value?: string | number | null; wide?: boolean; capitalize?: boolean }) {
  return <div className={`rounded-xl bg-[#f6f8fc] p-3 ${wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}><p className="text-[10px] font-bold uppercase tracking-wide text-[#4d6385]">{label}</p><p className={`mt-1 break-words text-sm font-semibold text-[#071d43] ${capitalize ? 'capitalize' : ''}`}>{value === undefined || value === null || value === '' ? 'N/A' : value}</p></div>;
}

function MerchantAccountOverview({
  account,
  generatingRecoveryKey,
  onGenerateRecoveryKey,
}: {
  account: MerchantAccount;
  generatingRecoveryKey: boolean;
  onGenerateRecoveryKey: () => void;
}) {
  return <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-base font-black text-[#071d43]">Approved merchant account</h3><p className="mt-1 text-xs text-[#4d6385]">Live account, subscription, wallet, and billing information.</p></div>
      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase text-emerald-700">{account.status}</span>
    </div>

    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Detail label="Merchant code" value={account.merchant_code} />
      <Detail label="Temporary password" value={account.temporary_password} />
      <Detail label="Wallet balance" value={`₱${Number(account.wallet_balance).toLocaleString()}`} />
      <Detail label="Total subscription fee" value={`₱${Number(account.fee_breakdown.total_fee).toLocaleString()}`} />
      <Detail label="Approved by" value={account.approved_by_name} />
      <Detail label="Approved at" value={account.approved_at ? new Date(account.approved_at).toLocaleString() : null} />
      <Detail label="Joined at" value={new Date(account.joined_at).toLocaleString()} />
      <Detail label="Unpaid ledger balance" value={`₱${Number(account.ledger.unpaid).toLocaleString()}`} />
    </div>

    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-black uppercase text-amber-700">Recovery key</p><p className="mt-1 break-all font-mono text-sm font-bold text-amber-900">{account.recovery_key || 'Generate only when the merchant needs password recovery.'}</p></div>
        <button type="button" onClick={onGenerateRecoveryKey} disabled={generatingRecoveryKey} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-black text-white disabled:opacity-60">{generatingRecoveryKey ? 'Generating...' : account.recovery_key ? 'Rotate key' : 'Generate key'}</button>
      </div>
    </div>

    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <div><h4 className="mb-3 text-xs font-black uppercase text-[#075cff]">Subscription breakdown</h4><CoordinatorFeeBreakdown breakdown={account.fee_breakdown} /></div>
      <div>
        <h4 className="mb-3 text-xs font-black uppercase text-[#075cff]">Ledger summary</h4>
        <div className="grid grid-cols-3 gap-2">
          <Detail label="Billed" value={`₱${Number(account.ledger.total_billed).toLocaleString()}`} />
          <Detail label="Paid" value={`₱${Number(account.ledger.total_paid).toLocaleString()}`} />
          <Detail label="Unpaid" value={`₱${Number(account.ledger.unpaid).toLocaleString()}`} />
        </div>
      </div>
    </div>

    <div className="mt-5">
      <h4 className="mb-3 text-xs font-black uppercase text-[#075cff]">Payment history</h4>
      <div className="overflow-x-auto rounded-xl border border-[#d2ddea]">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-[#f8faff] text-[#365078]"><tr>{['Date', 'Plan', 'Period', 'Amount', 'Method', 'Reference', 'Status'].map(label => <th key={label} className="px-3 py-3 font-black">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-[#d2ddea]">{account.ledger.payments.length ? account.ledger.payments.map(payment => <tr key={payment.id}>
            <td className="px-3 py-3">{new Date(payment.created_at).toLocaleString()}</td>
            <td className="px-3 py-3 capitalize">{payment.tier} · {payment.plan}</td>
            <td className="px-3 py-3">{payment.period_start ? new Date(payment.period_start).toLocaleDateString() : 'N/A'} – {payment.period_end ? new Date(payment.period_end).toLocaleDateString() : 'N/A'}</td>
            <td className="px-3 py-3 font-black">₱{Number(payment.amount).toLocaleString()}</td>
            <td className="px-3 py-3 capitalize">{payment.payment_method}{payment.gateway ? ` (${payment.gateway})` : ''}</td>
            <td className="px-3 py-3 font-mono">{payment.payment_ref || 'N/A'}</td>
            <td className="px-3 py-3 font-bold capitalize">{payment.status}</td>
          </tr>) : <tr><td colSpan={7} className="px-4 py-8 text-center text-[#4d6385]">No subscription payments recorded.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  </section>;
}

function CoordinatorFeeBreakdown({ breakdown }: { breakdown: FeeBreakdown }) {
  return <div className="overflow-hidden rounded-xl border border-[#d2ddea]">
    <div className="flex items-center justify-between bg-[#f8faff] px-4 py-3 text-sm"><div><p className="font-black capitalize text-[#071d43]">{breakdown.plan.name} plan</p><p className="text-xs text-[#4d6385]">Per {breakdown.plan.billing_unit}</p></div><span className="font-black text-[#071d43]">₱{Number(breakdown.plan.amount).toLocaleString()}</span></div>
    {breakdown.add_ons.map(addOn => <div key={addOn.id} className="flex items-center justify-between border-t border-[#d2ddea] px-4 py-3 text-sm"><div><p className="font-black text-[#071d43]">{addOn.name}</p><p className="text-xs text-[#4d6385]">₱{Number(addOn.amount).toLocaleString()} × {addOn.quantity} {addOn.amount_basis === 'keyword' ? 'keyword(s)' : 'product(s)/item(s)'}</p><p className="text-xs text-[#4d6385]">Per {addOn.billing_unit}{addOn.amount_basis ? ` · Per ${addOn.amount_basis === 'inventory' ? 'inventory item' : 'keyword'}` : ''}</p></div><span className="font-black text-[#071d43]">₱{Number(addOn.subtotal).toLocaleString()}</span></div>)}
    <div className="flex items-center justify-between border-t-2 border-[#b8c8dc] bg-blue-50 px-4 py-3"><span className="font-black text-[#071d43]">Total subscription fee</span><span className="text-lg font-black text-[#075cff]">₱{Number(breakdown.total_fee).toLocaleString()}</span></div>
  </div>;
}
