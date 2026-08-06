'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapPin, Plus, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { getToken } from '@/hooks/use-auth';

type Lead = {
  id: number; business_name: string; category_name?: string; contact_name?: string; phone?: string; email: string;
  city_municipality?: string; barangay?: string; council_district?: string; geographic_area?: string; submitted_at: string;
  status: 'pending' | 'reviewing' | 'for_approval' | 'approved' | 'rejected'; assignment_status: 'assigned' | 'unassigned';
};

export default function MerchantOnboardingPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tab, setTab] = useState<'unassigned' | 'assigned'>('assigned');
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

  const visible = useMemo(
    () => leads.filter(lead => tab === 'assigned' ? lead.assignment_status === 'assigned' : lead.assignment_status === 'unassigned'),
    [leads, tab],
  );

  return <div className="w-full">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><h2 className="text-2xl font-black text-[#071d43]">Merchant Onboarding</h2><p className="mt-1 text-sm text-[#4d6385]">View applications in your zone or directly onboard a new merchant.</p></div><div className="flex gap-3"><Link href="/coordinator/applications/new" className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#075cff] px-5 text-sm font-black text-white hover:bg-[#064ed8]"><Plus size={17} /> Add New Merchant</Link><button onClick={load} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#ccd8e9] bg-white px-5 text-sm font-black text-[#075cff]"><RefreshCw size={17} /> Refresh</button></div></div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <div className="mt-6 inline-flex rounded-xl bg-[#edf2fa] p-1"><button onClick={() => setTab('unassigned')} className={`rounded-lg px-4 py-2 text-xs font-black ${tab === 'unassigned' ? 'bg-white text-[#075cff] shadow-sm' : 'text-[#365078]'}`}>Unassigned leads ({leads.filter(lead => lead.assignment_status === 'unassigned').length})</button><button onClick={() => setTab('assigned')} className={`rounded-lg px-4 py-2 text-xs font-black ${tab === 'assigned' ? 'bg-white text-[#075cff] shadow-sm' : 'text-[#365078]'}`}>Assigned to me ({leads.filter(lead => lead.assignment_status === 'assigned').length})</button></div>
      <div className="mt-6 overflow-x-auto rounded-2xl border border-[#d2ddea] bg-white shadow-sm"><table className="w-full min-w-[900px] text-left"><thead className="bg-[#f8faff] text-xs text-[#365078]"><tr>{['Merchant','Contact','Coverage zone','Submitted','Assignment','Application status', ...(tab === 'assigned' ? ['Action'] : [])].map(label => <th key={label} className="px-5 py-4 font-black">{label}</th>)}</tr></thead><tbody>{visible.map(lead => <tr key={lead.id} className="border-t border-[#d2ddea] text-sm"><td className="px-5 py-4"><p className="font-black text-[#071d43]">{lead.business_name}</p><p className="mt-1 text-xs text-[#365078]">{lead.category_name || 'Local Business'} · {lead.contact_name || 'Merchant applicant'}</p></td><td className="px-5 py-4 text-[#365078]"><p>{lead.phone || '—'}</p><p className="text-xs">{lead.email}</p></td><td className="px-5 py-4 text-[#365078]"><span className="flex items-center gap-1"><MapPin size={15} />{lead.city_municipality}{lead.council_district ? ` · ${lead.council_district}` : lead.barangay ? ` · ${lead.barangay}` : ''}</span></td><td className="px-5 py-4 text-[#365078]">{new Date(lead.submitted_at).toLocaleDateString()}</td><td className="px-5 py-4"><span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${lead.assignment_status === 'assigned' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{lead.assignment_status}</span></td><td className="px-5 py-4"><span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${lead.status === 'approved' || lead.status === 'for_approval' ? 'bg-emerald-100 text-emerald-700' : lead.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{lead.status.replaceAll('_', ' ')}</span></td>{tab === 'assigned' && <td className="px-5 py-4"><Link href={`/coordinator/applications/${lead.id}`} className="inline-flex rounded-xl bg-[#075cff] px-4 py-2 text-xs font-black text-white hover:bg-[#064ed8]">{lead.status === 'pending' || lead.status === 'reviewing' ? 'Review' : 'View'}</Link></td>}</tr>)}{!loading && visible.length === 0 && <tr><td colSpan={tab === 'assigned' ? 7 : 6} className="px-5 py-16 text-center text-sm text-[#4d6385]">No {tab === 'assigned' ? 'applications assigned to you' : 'unassigned applications in your approved zone'} found.</td></tr>}{loading && <tr><td colSpan={tab === 'assigned' ? 7 : 6} className="px-5 py-16 text-center text-sm text-[#4d6385]">Loading merchant applications…</td></tr>}</tbody></table></div>
  </div>;
}
