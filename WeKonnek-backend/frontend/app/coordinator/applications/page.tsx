'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapPin, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { getToken } from '@/hooks/use-auth';

type Lead = {
  id: number; business_name: string; category_name?: string; contact_name?: string; phone?: string; email: string;
  city_municipality?: string; barangay?: string; council_district?: string; geographic_area?: string; submitted_at: string; assigned_coordinator_id?: string; assignment_status: 'assigned' | 'unassigned';
};

export default function MerchantOnboardingPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tab, setTab] = useState<'unassigned' | 'assigned'>('unassigned');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/backend/merchant-applications/coordinator/leads', { headers: { Authorization: `Bearer ${getToken()}` } });
      const contentType = response.headers.get('content-type') || '';
      const body = contentType.includes('application/json') ? await response.json() : null;
      if (!response.ok) {
        throw new Error(body?.message || (response.status >= 500
          ? 'Merchant application service is unavailable. Start or restart the backend server.'
          : 'Unable to load merchant leads'));
      }
      if (!Array.isArray(body)) throw new Error('Merchant application service returned an invalid response.');
      setLeads(body);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load merchant leads'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const visible = useMemo(() => leads.filter(lead => tab === 'assigned' ? lead.assignment_status === 'assigned' : lead.assignment_status === 'unassigned'), [leads, tab]);
  const claim = async (id: number) => {
    const response = await fetch(`/api/backend/merchant-applications/${id}/claim`, { method: 'PATCH', headers: { Authorization: `Bearer ${getToken()}` } });
    const body = await response.json();
    if (!response.ok) return toast.error(body.message || 'Unable to assign merchant');
    toast.success('Merchant assigned to your coordinator account.'); await load(); window.dispatchEvent(new Event('coordinator-leads-updated')); setTab('assigned');
  };

  return <div className="w-full">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><h2 className="text-2xl font-black text-[#071d43]">Merchant Onboarding</h2><p className="mt-1 text-sm text-[#4d6385]">Unassigned website leads are shown when their city, district, and area match your assigned coordinator zone.</p></div><button onClick={load} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#ccd8e9] bg-white px-5 text-sm font-black text-[#075cff]"><RefreshCw size={17} /> Refresh</button></div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <div className="mt-6 inline-flex rounded-xl bg-[#edf2fa] p-1"><button onClick={() => setTab('unassigned')} className={`rounded-lg px-4 py-2 text-xs font-black ${tab === 'unassigned' ? 'bg-white text-[#075cff] shadow-sm' : 'text-[#365078]'}`}>Unassigned leads ({leads.filter(lead => lead.assignment_status === 'unassigned').length})</button><button onClick={() => setTab('assigned')} className={`rounded-lg px-4 py-2 text-xs font-black ${tab === 'assigned' ? 'bg-white text-[#075cff] shadow-sm' : 'text-[#365078]'}`}>Assigned to me ({leads.filter(lead => lead.assignment_status === 'assigned').length})</button></div>
    <div className="mt-6 overflow-x-auto rounded-2xl border border-[#d2ddea] bg-white shadow-sm"><table className="w-full min-w-[1050px] text-left"><thead className="bg-[#f8faff] text-xs text-[#365078]"><tr>{['Merchant','Contact','Coverage zone','Submitted','Assignment','Officer approval','Action'].map(label => <th key={label} className="px-5 py-4 font-black">{label}</th>)}</tr></thead><tbody>{visible.map(lead => <tr key={lead.id} className="border-t border-[#d2ddea] text-sm"><td className="px-5 py-4"><p className="font-black text-[#071d43]">{lead.business_name}</p><p className="mt-1 text-xs text-[#365078]">{lead.category_name || 'Local Business'} · {lead.contact_name || 'Merchant applicant'}</p></td><td className="px-5 py-4 text-[#365078]"><p>{lead.phone || '—'}</p><p className="text-xs">{lead.email}</p></td><td className="px-5 py-4 text-[#365078]"><span className="flex items-center gap-1"><MapPin size={15} />{lead.city_municipality}{lead.council_district ? ` · ${lead.council_district}` : lead.barangay ? ` · ${lead.barangay}` : ''}</span></td><td className="px-5 py-4 text-[#365078]">{new Date(lead.submitted_at).toLocaleDateString()}</td><td className="px-5 py-4"><span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${lead.assignment_status === 'assigned' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{lead.assignment_status}</span></td><td className="px-5 py-4"><span className="rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black text-amber-700">PENDING</span></td><td className="px-5 py-4">{lead.assignment_status === 'assigned' ? <button className="rounded-xl bg-[#eaf1ff] px-4 py-2 text-xs font-black text-[#075cff]">Continue</button> : <button onClick={() => claim(lead.id)} className="rounded-xl bg-[#075cff] px-4 py-2 text-xs font-black text-white">Assign to me</button>}</td></tr>)}{!loading && visible.length === 0 && <tr><td colSpan={7} className="px-5 py-16 text-center text-sm text-[#4d6385]">No {tab === 'assigned' ? 'assigned merchants' : 'unassigned leads in your approved zone'} found.</td></tr>}{loading && <tr><td colSpan={7} className="px-5 py-16 text-center text-sm text-[#4d6385]">Loading merchant leads…</td></tr>}</tbody></table></div>
  </div>;
}
