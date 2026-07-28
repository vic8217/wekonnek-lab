'use client';

import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, ExternalLink, Eye, FileText, MapPin, Save, UserCheck, UsersRound, X } from 'lucide-react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

interface CoordinatorApplication {
  id: number; fullName: string; mobileNumber: string; email: string; cityMunicipality: string;
  coordinatorCode?: string; userId?: string;
  viberAccount?: string; whatsappNumber?: string; region?: string; provinceDistrict?: string;
  barangay?: string; preferredCoverageArea?: string; latitude?: string | number; longitude?: string | number;
  background?: string; occupation?: string; motivation?: string; monthlyCapacity?: string; referred?: string;
  governmentIdFrontUrl?: string; governmentIdBackUrl?: string; resumeUrl?: string; supportingDocumentUrl?: string;
  adminNotes?: string; status: string; submittedAt: string; managementZoneId?: string | null;
  managementZone?: { id: string; name: string; code: string; coverages: { cityMunicipalityName: string; congressionalDistrict: string }[] } | null;
}
interface CoordinatorStats { applicants: number; pending: number; coordinators: number; activeCoverageAreas: number }
interface CoordinatorZone { id: string; name: string; code: string; isActive: boolean; coverages: { cityMunicipalityName: string; congressionalDistrict: string }[] }
type GeneratedAccess = { title: string; applicationId: number; coordinatorCode: string; email?: string; temporaryPassword?: string; resetKey?: string; expiresAt?: string; viberAccount?: string; whatsappNumber?: string };

export default function CoordinatorManagementPage() {
  const [applications, setApplications] = useState<CoordinatorApplication[]>([]);
  const [stats, setStats] = useState<CoordinatorStats>({ applicants: 0, pending: 0, coordinators: 0, activeCoverageAreas: 0 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [zones, setZones] = useState<CoordinatorZone[]>([]);
  const [zoneSelections, setZoneSelections] = useState<Record<number, string>>({});
  const [selectedApplication, setSelectedApplication] = useState<CoordinatorApplication | null>(null);
  const [adminNotes, setAdminNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [generatedAccess, setGeneratedAccess] = useState<GeneratedAccess | null>(null);
  const [temporaryAccess, setTemporaryAccess] = useState<Record<number, GeneratedAccess>>({});

  useEffect(() => {
    const load = async () => {
      try {
        setLoadError('');
        const headers = { Authorization: `Bearer ${getToken()}` };
        const [applicationsResponse, statsResponse, zonesResponse] = await Promise.all([
          fetch('/api/backend/coordinator-applications', { headers }),
          fetch('/api/backend/coordinator-applications/stats', { headers }),
          fetch('/api/backend/management-zones', { headers }),
        ]);
        if (!applicationsResponse.ok || !statsResponse.ok || !zonesResponse.ok) throw new Error('Unable to load coordinator applications');
        const loadedApplications: CoordinatorApplication[] = await applicationsResponse.json();
        setApplications(loadedApplications);
        setStats(await statsResponse.json());
        setZones(await zonesResponse.json());
        setZoneSelections(Object.fromEntries(loadedApplications.filter(item => item.managementZoneId).map(item => [item.id, item.managementZoneId as string])));
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : 'Unable to load coordinator applications');
      } finally { setLoading(false); }
    };
    load();
  }, []);

  const updateStatus = async (id: number, nextStatus: 'approved' | 'rejected') => {
    const previousStatus = applications.find(item => item.id === id)?.status;
    const managementZoneId = zoneSelections[id];
    if (nextStatus === 'approved' && !managementZoneId) { setLoadError('Select a coordinator zone before approving the applicant'); return; }
    const response = await fetch(`/api/backend/coordinator-applications/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ status: nextStatus, managementZoneId }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setLoadError(body.message || 'Unable to update coordinator'); return; }
    setLoadError('');
    setApplications(current => current.map(application => application.id === id ? body : application));
    if (previousStatus === 'pending') setStats(current => ({ ...current, pending: Math.max(0, current.pending - 1), coordinators: current.coordinators + (nextStatus === 'approved' ? 1 : 0), activeCoverageAreas: current.activeCoverageAreas + (nextStatus === 'approved' ? 1 : 0) }));
    if (body.credentials) {
      const access = { title: 'Coordinator account created', ...body.credentials } as GeneratedAccess;
      setGeneratedAccess(access);
      setTemporaryAccess(current => ({ ...current, [id]: access }));
    }
  };

  const suspendCoordinator = async (application: CoordinatorApplication) => {
    if (!window.confirm(`Suspend ${application.fullName}'s coordinator access?`)) return;
    const response = await fetch(`/api/backend/coordinator-applications/${application.id}/suspend`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${getToken()}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { toast.error(body.message || 'Unable to suspend coordinator'); return; }
    setApplications(current => current.map(item => item.id === body.id ? body : item));
    toast.success('Coordinator account suspended.');
  };

  const generateResetKey = async (application: CoordinatorApplication) => {
    const response = await fetch(`/api/backend/coordinator-applications/${application.id}/reset-key`, {
      method: 'POST', headers: { Authorization: `Bearer ${getToken()}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { toast.error(body.message || 'Unable to generate reset key'); return; }
    const access: GeneratedAccess = { title: 'Password reset key generated', applicationId: application.id, email: application.email, viberAccount: application.viberAccount, whatsappNumber: application.whatsappNumber, ...body };
    setGeneratedAccess(access);
    setTemporaryAccess(current => ({ ...current, [application.id]: access }));
  };

  const openReview = (application: CoordinatorApplication) => {
    setSelectedApplication(application);
    setAdminNotes(application.adminNotes || '');
  };

  const saveNotes = async () => {
    if (!selectedApplication) return;
    setSavingNotes(true);
    try {
      const response = await fetch(`/api/backend/coordinator-applications/${selectedApplication.id}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ adminNotes }),
      });
      const updated = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(updated.message || 'Unable to save staff notes');
      setApplications(current => current.map(item => item.id === updated.id ? updated : item));
      setSelectedApplication(updated);
      setAdminNotes(updated.adminNotes || '');
      toast.success('Staff notes saved.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to save staff notes');
    } finally { setSavingNotes(false); }
  };

  const filtered = useMemo(() => applications.filter(application => {
    const query = search.toLowerCase();
    const matchesSearch = !query || [application.fullName, application.email, application.cityMunicipality].some(value => value.toLowerCase().includes(query));
    return matchesSearch && (status === 'all' || application.status === status);
  }), [applications, search, status]);

  const cards = [
    { label: 'Total Coordinators', value: stats.coordinators, icon: UserCheck, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Coordinator Applicants', value: stats.applicants, icon: ClipboardList, color: 'text-blue-600 bg-blue-50' },
    { label: 'Pending Applications', value: stats.pending, icon: UsersRound, color: 'text-amber-600 bg-amber-50' },
    { label: 'Active Coverage Areas', value: stats.activeCoverageAreas, icon: MapPin, color: 'text-violet-600 bg-violet-50' },
  ];

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold text-gray-900">Coordinator Management</h1><p className="mt-1 text-sm text-gray-600">Review applications, assignments, coverage areas, and coordinator status.</p></div>
    {loadError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}. Please confirm the backend service is running, then refresh this page.</div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon, color }) => <div key={label} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm"><div><p className="text-sm text-gray-500">{label}</p><p className="mt-2 text-3xl font-bold text-gray-900">{loading ? '—' : value}</p></div><span className={`flex size-12 items-center justify-center rounded-xl ${color}`}><Icon size={23} /></span></div>)}</div>
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-200 p-4 sm:flex-row"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search coordinators..." className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /><select value={status} onChange={event => setStatus(event.target.value)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm"><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>
      {loading ? <div className="p-12 text-center text-sm text-gray-500">Loading applications…</div> : filtered.length === 0 ? <div className="p-12 text-center"><p className="font-medium text-gray-700">No coordinators found</p><p className="mt-1 text-sm text-gray-500">Submitted coordinator applications will appear here.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[1320px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Applicant</th><th className="px-5 py-3">Contact</th><th className="px-5 py-3">Requested area</th><th className="px-5 py-3">Coordinator zone</th><th className="px-5 py-3">Submitted</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{filtered.map(application => <tr key={application.id}><td className="px-5 py-4 font-semibold text-slate-900"><span className="block">{application.fullName}</span>{application.coordinatorCode && <span className="mt-1 block font-mono text-xs font-bold text-blue-700">{application.coordinatorCode}</span>}</td><td className="px-5 py-4"><span className="block">{application.email}</span><span className="text-xs text-slate-500">{application.mobileNumber}</span></td><td className="px-5 py-4">{application.barangay ? `${application.barangay}, ` : ''}{application.cityMunicipality}</td><td className="px-5 py-4">{application.status === 'pending' ? <select value={zoneSelections[application.id] || ''} onChange={event => setZoneSelections(current => ({ ...current, [application.id]: event.target.value }))} className="min-w-52 rounded-lg border border-slate-300 px-3 py-2 text-xs"><option value="">Select coordinator zone</option>{zones.filter(zone => zone.isActive).map(zone => <option key={zone.id} value={zone.id}>{zone.name} ({zone.coverages.length} areas)</option>)}</select> : application.managementZone ? <div><p className="font-semibold text-blue-700">{application.managementZone.name}</p><p className="mt-1 max-w-64 text-xs text-slate-500">{application.managementZone.coverages.map(item => `${item.cityMunicipalityName} · ${item.congressionalDistrict}`).join(', ')}</p></div> : <span className="text-red-600">Not assigned</span>}</td><td className="px-5 py-4 text-slate-500">{new Date(application.submittedAt).toLocaleDateString()}</td><td className="px-5 py-4"><span className={`rounded-full px-3 py-1 text-xs font-bold capitalize ${application.status === 'suspended' ? 'bg-red-50 text-red-700' : application.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{application.status}</span></td><td className="px-5 py-4"><div className="flex gap-2"><button onClick={() => openReview(application)} className="flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700"><Eye size={15} /> View</button>{application.status === 'pending' && <><button onClick={() => updateStatus(application.id, 'approved')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Approve & assign</button><button onClick={() => updateStatus(application.id, 'rejected')} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600">Reject</button></>}{application.status === 'approved' && (application.coordinatorCode ? <>{temporaryAccess[application.id] && (!temporaryAccess[application.id].expiresAt || new Date(temporaryAccess[application.id].expiresAt!).getTime() > Date.now()) && <button onClick={() => setGeneratedAccess(temporaryAccess[application.id])} className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">Access details</button>}<button onClick={() => generateResetKey(application)} className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">Reset key</button><button onClick={() => suspendCoordinator(application)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-700">Suspend</button></> : <button onClick={() => updateStatus(application.id, 'approved')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Create login</button>)}</div></td></tr>)}</tbody></table></div>}
    </div>
    {selectedApplication && <ApplicationReviewModal application={selectedApplication} notes={adminNotes} onNotesChange={setAdminNotes} onSaveNotes={saveNotes} savingNotes={savingNotes} onClose={() => setSelectedApplication(null)} />}
    {generatedAccess && <GeneratedAccessModal data={generatedAccess} onClose={() => setGeneratedAccess(null)} />}
  </div>;
}

function ApplicationReviewModal({ application, notes, onNotesChange, onSaveNotes, savingNotes, onClose }: { application: CoordinatorApplication; notes: string; onNotesChange: (value: string) => void; onSaveNotes: () => void; savingNotes: boolean; onClose: () => void }) {
  const details = [
    ['Full name', application.fullName], ['Email', application.email], ['Mobile', application.mobileNumber],
    ['Viber', application.viberAccount], ['WhatsApp', application.whatsappNumber], ['Status', application.status],
    ['Region', application.region], ['Province / District', application.provinceDistrict], ['City / Municipality', application.cityMunicipality],
    ['Barangay', application.barangay], ['Preferred coverage', application.preferredCoverageArea],
    ['Coordinates', application.latitude && application.longitude ? `${application.latitude}, ${application.longitude}` : null],
    ['Background', application.background], ['Occupation / Organization', application.occupation],
    ['Monthly capacity', application.monthlyCapacity], ['Referred', application.referred],
  ];
  const documents = [
    ['Government ID — front', application.governmentIdFrontUrl], ['Government ID — back', application.governmentIdBackUrl],
    ['Resume / Profile', application.resumeUrl], ['Supporting document', application.supportingDocumentUrl],
  ];
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="review-title" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">Coordinator application #{application.id}</p><h2 id="review-title" className="text-xl font-black text-slate-900">{application.fullName}</h2></div><button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close review"><X size={22} /></button></div>
      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6 p-6">
          <section><h3 className="mb-3 font-black text-slate-900">Application details</h3><dl className="grid gap-3 sm:grid-cols-2">{details.map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-slate-800">{value || '—'}</dd></div>)}</dl></section>
          <section><h3 className="mb-2 font-black text-slate-900">Applicant motivation</h3><p className="min-h-20 whitespace-pre-wrap rounded-xl border border-slate-200 p-4 text-sm leading-6 text-slate-700">{application.motivation || 'No motivation statement submitted.'}</p></section>
        </div>
        <aside className="space-y-6 border-t border-slate-200 bg-slate-50 p-6 lg:border-l lg:border-t-0">
          <section><h3 className="mb-3 flex items-center gap-2 font-black text-slate-900"><FileText size={18} /> Submitted documents</h3><div className="space-y-2">{documents.map(([label, url]) => url ? <a key={label} href={url} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-blue-700 hover:border-blue-300"><span>{label}</span><ExternalLink size={15} /></a> : <div key={label} className="flex items-center justify-between rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-400"><span>{label}</span><span className="text-xs">Not submitted</span></div>)}</div></section>
          <section><label className="block font-black text-slate-900">Admin staff notes<textarea value={notes} onChange={event => onNotesChange(event.target.value)} rows={8} placeholder="Add verification findings, follow-up items, or internal review notes…" className="mt-3 block w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm font-normal leading-5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></label><button onClick={onSaveNotes} disabled={savingNotes} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-bold text-white disabled:opacity-60"><Save size={17} />{savingNotes ? 'Saving…' : 'Save staff notes'}</button></section>
        </aside>
      </div>
    </div>
  </div>;
}

function GeneratedAccessModal({ data, onClose }: { data: GeneratedAccess; onClose: () => void }) {
  const rows = [
    ['Coordinator user ID', data.coordinatorCode], ['Contact email', data.email],
    ['Temporary password', data.temporaryPassword], ['Reset key', data.resetKey],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  const copyAll = () => {
    const text = buildCredentialMessage(data);
    navigator.clipboard.writeText(text).then(() => toast.success('Access details copied.'));
  };
  const share = (channel: 'email' | 'whatsapp' | 'viber') => {
    const message = buildCredentialMessage(data);
    if (channel === 'email') {
      window.location.href = `mailto:${encodeURIComponent(data.email || '')}?subject=${encodeURIComponent('Your WeKonnek Coordinator Access')}&body=${encodeURIComponent(message)}`;
      return;
    }
    if (channel === 'whatsapp') {
      const number = (data.whatsappNumber || '').replace(/\D/g, '').replace(/^0/, '63');
      window.open(`https://wa.me/${number}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
      return;
    }
    window.location.href = `viber://forward?text=${encodeURIComponent(message)}`;
  };
  return <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
    <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">One-time access details</p><h2 className="mt-1 text-xl font-black text-slate-900">{data.title}</h2></div><button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={21} /></button></div>
      <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs font-medium leading-5 text-amber-800">Send these details securely. The coordinator must use the password-change link within 30 minutes; the temporary credentials and reset key expire after that window.</p>
      <dl className="mt-4 space-y-3">{rows.map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-all font-mono text-sm font-bold text-slate-900">{value}</dd></div>)}</dl>
      {data.expiresAt && <p className="mt-3 text-xs text-slate-500">Reset key expires: {new Date(data.expiresAt).toLocaleString()}</p>}
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4"><button onClick={copyAll} className="h-11 rounded-xl bg-blue-600 text-sm font-bold text-white">Copy</button><button onClick={() => share('email')} disabled={!data.email} className="h-11 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 disabled:opacity-40">Email</button><button onClick={() => share('whatsapp')} disabled={!data.whatsappNumber} className="h-11 rounded-xl bg-emerald-600 text-sm font-bold text-white disabled:opacity-40">WhatsApp</button><button onClick={() => share('viber')} disabled={!data.viberAccount} className="h-11 rounded-xl bg-violet-600 text-sm font-bold text-white disabled:opacity-40">Viber</button></div>
      <button onClick={onClose} className="mt-3 h-11 w-full rounded-xl border border-slate-300 px-5 font-bold text-slate-700">Close</button>
    </div>
  </div>;
}

function buildCredentialMessage(data: GeneratedAccess) {
  const resetUrl = data.resetKey ? `${window.location.origin}/coordinator/reset-password?key=${encodeURIComponent(data.resetKey)}` : '';
  return [
    'Your WeKonnek Zone Coordinator account is ready.',
    '',
    `Coordinator user ID: ${data.coordinatorCode}`,
    data.email ? `Contact email: ${data.email}` : '',
    data.temporaryPassword ? `Temporary password: ${data.temporaryPassword}` : '',
    data.resetKey ? `Reset key: ${data.resetKey}` : '',
    resetUrl ? `Change password: ${resetUrl}` : '',
    '',
    'For your security, access the link and change your password within 30 minutes. Do not share these credentials with anyone.',
  ].filter(Boolean).join('\n');
}
