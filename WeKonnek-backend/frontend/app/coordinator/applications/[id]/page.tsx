'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, ExternalLink, FileUp, Save } from 'lucide-react';
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
};

type Plan = {
  tier: string;
  prices: Record<string, number>;
  features: string[];
  listingLimit: number;
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
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [applicationResponse, plansResponse] = await Promise.all([
        fetch(`/api/backend/merchant-applications/coordinator/leads/${id}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
          cache: 'no-store',
        }),
        fetch('/api/backend/subscriptions/plans', { cache: 'no-store' }),
      ]);
      const applicationBody = await applicationResponse.json();
      if (!applicationResponse.ok) throw new Error(applicationBody.message || 'Unable to load the assigned application');
      setApplication(applicationBody);
      setNotes(applicationBody.coordinator_notes || '');
      if (plansResponse.ok) setPlans(await plansResponse.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the assigned application');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

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
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Unable to save coordinator review');
      setApplication(body);
      setFiles({});
      setExtraFiles([]);
      toast.success('Coordinator review saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to save coordinator review');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="rounded-2xl border border-[#d2ddea] bg-white p-16 text-center text-sm text-[#4d6385]">Loading merchant application…</div>;
  if (error || !application) return <div><Link href="/coordinator/applications" className="inline-flex items-center gap-2 text-sm font-bold text-[#075cff]"><ArrowLeft size={17} /> Back to applications</Link><div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error || 'Application not found'}</div></div>;

  const submittedDocuments = [
    ...documentFields.flatMap(([field, label]) => application[field] ? [[label, application[field]] as [string, string]] : []),
    ...(application.business_documents_urls || []).map((url, index) => [`Business document ${index + 1}`, url] as [string, string]),
  ];

  return <div className="space-y-6">
    <div>
      <Link href="/coordinator/applications" className="inline-flex items-center gap-2 text-sm font-bold text-[#075cff]"><ArrowLeft size={17} /> Back to applications</Link>
      <div className="mt-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><h2 className="text-2xl font-black text-[#071d43]">{application.business_name}</h2><p className="mt-1 text-sm text-[#4d6385]">Review the merchant’s application, documents, and interview notes.</p></div><span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase text-blue-700">{application.status}</span></div>
    </div>

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
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {documentFields.filter(([field]) => !application[field]).map(([field, label]) => <label key={field} className="rounded-xl border border-dashed border-[#b8c8dc] bg-[#f8faff] p-4">
          <span className="flex items-center gap-2 text-sm font-black text-[#365078]"><FileUp size={17} /> Add {label}</span>
          <input type="file" accept=".pdf,image/jpeg,image/png" className="mt-3 block w-full text-xs text-[#4d6385] file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-bold file:text-[#075cff]" onChange={event => setFiles(current => ({ ...current, [field]: event.target.files?.[0] }))} />
        </label>)}
        <label className="rounded-xl border border-dashed border-[#b8c8dc] bg-[#f8faff] p-4">
          <span className="flex items-center gap-2 text-sm font-black text-[#365078]"><FileUp size={17} /> Add business documents</span>
          <input type="file" multiple accept=".pdf,image/jpeg,image/png" className="mt-3 block w-full text-xs text-[#4d6385] file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-bold file:text-[#075cff]" onChange={event => setExtraFiles(Array.from(event.target.files || []))} />
        </label>
      </div>
      {submittedDocuments.length === 0 && <p className="mt-4 text-sm text-[#4d6385]">No documents were submitted by the merchant. Add available documents above during the interview.</p>}
    </section>

    <section className="rounded-2xl border border-[#d2ddea] bg-white p-5 shadow-sm">
      <h3 className="text-base font-black text-[#071d43]">Coordinator notes</h3>
      <p className="mt-1 text-xs text-[#4d6385]">Record interview findings, follow-ups, and document concerns for the admin review.</p>
      <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={6} maxLength={5000} placeholder="Add coordinator interview notes…" className="mt-4 w-full rounded-xl border border-[#ccd8e9] px-4 py-3 text-sm text-[#071d43] outline-none focus:border-[#075cff]" />
    </section>

    <section>
      <div><h3 className="text-lg font-black text-[#071d43]">Merchant plans</h3><p className="mt-1 text-sm text-[#4d6385]">Use these cards when discussing options with the merchant.</p></div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">{plans.map(plan => <div key={plan.tier} className={`rounded-2xl border bg-white p-5 shadow-sm ${plan.tier === application.subscription_tier ? 'border-[#075cff] ring-2 ring-blue-100' : 'border-[#d2ddea]'}`}>
        <div className="flex items-start justify-between"><div><p className="text-lg font-black capitalize text-[#071d43]">{plan.tier}</p><p className="mt-1 text-xs text-[#4d6385]">{plan.listingLimit >= 1000000 ? 'Unlimited' : plan.listingLimit} product listings</p></div>{plan.tier === application.subscription_tier && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-black uppercase text-[#075cff]">Selected</span>}</div>
        <div className="mt-4 grid grid-cols-3 gap-2">{Object.entries(plan.prices).map(([period, price]) => <div key={period} className="rounded-xl bg-[#f6f8fc] p-3 text-center"><p className="text-[10px] font-bold uppercase text-[#4d6385]">{period}</p><p className="mt-1 text-sm font-black text-[#071d43]">₱{price.toLocaleString()}</p></div>)}</div>
        <ul className="mt-4 space-y-2">{plan.features.map(feature => <li key={feature} className="flex gap-2 text-sm text-[#365078]"><Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />{feature}</li>)}</ul>
      </div>)}</div>
    </section>

    <div className="sticky bottom-4 flex justify-end"><button onClick={save} disabled={saving} className="inline-flex min-w-40 items-center justify-center gap-2 rounded-xl bg-[#075cff] px-5 py-3 text-sm font-black text-white shadow-lg disabled:opacity-60"><Save size={17} />{saving ? 'Saving…' : 'Save review'}</button></div>
  </div>;
}

function Detail({ label, value, wide = false, capitalize = false }: { label: string; value?: string | number | null; wide?: boolean; capitalize?: boolean }) {
  return <div className={`rounded-xl bg-[#f6f8fc] p-3 ${wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}><p className="text-[10px] font-bold uppercase tracking-wide text-[#4d6385]">{label}</p><p className={`mt-1 break-words text-sm font-semibold text-[#071d43] ${capitalize ? 'capitalize' : ''}`}>{value === undefined || value === null || value === '' ? 'N/A' : value}</p></div>;
}
