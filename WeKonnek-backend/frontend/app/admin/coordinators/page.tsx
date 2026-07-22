'use client';

import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, MapPin, UserCheck, UsersRound } from 'lucide-react';
import { getToken } from '@/hooks/use-auth';

interface CoordinatorApplication {
  id: number; fullName: string; mobileNumber: string; email: string; cityMunicipality: string;
  barangay?: string; status: string; submittedAt: string; managementZoneId?: string | null;
  managementZone?: { id: string; name: string; code: string; coverages: { cityMunicipalityName: string; congressionalDistrict: string }[] } | null;
}
interface CoordinatorStats { applicants: number; pending: number; coordinators: number; activeCoverageAreas: number }
interface CoordinatorZone { id: string; name: string; code: string; isActive: boolean; coverages: { cityMunicipalityName: string; congressionalDistrict: string }[] }

export default function CoordinatorManagementPage() {
  const [applications, setApplications] = useState<CoordinatorApplication[]>([]);
  const [stats, setStats] = useState<CoordinatorStats>({ applicants: 0, pending: 0, coordinators: 0, activeCoverageAreas: 0 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [zones, setZones] = useState<CoordinatorZone[]>([]);
  const [zoneSelections, setZoneSelections] = useState<Record<number, string>>({});

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
    const managementZoneId = zoneSelections[id];
    if (nextStatus === 'approved' && !managementZoneId) { setLoadError('Select a coordinator zone before approving the applicant'); return; }
    const response = await fetch(`/api/backend/coordinator-applications/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ status: nextStatus, managementZoneId }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setLoadError(body.message || 'Unable to update coordinator'); return; }
    setLoadError('');
    setApplications(current => current.map(application => application.id === id ? body : application));
    setStats(current => ({ ...current, pending: Math.max(0, current.pending - 1), coordinators: current.coordinators + (nextStatus === 'approved' ? 1 : 0), activeCoverageAreas: current.activeCoverageAreas + (nextStatus === 'approved' ? 1 : 0) }));
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
      {loading ? <div className="p-12 text-center text-sm text-gray-500">Loading applications…</div> : filtered.length === 0 ? <div className="p-12 text-center"><p className="font-medium text-gray-700">No coordinators found</p><p className="mt-1 text-sm text-gray-500">Submitted coordinator applications will appear here.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Applicant</th><th className="px-5 py-3">Contact</th><th className="px-5 py-3">Requested area</th><th className="px-5 py-3">Coordinator zone</th><th className="px-5 py-3">Submitted</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{filtered.map(application => <tr key={application.id}><td className="px-5 py-4 font-semibold text-slate-900">{application.fullName}</td><td className="px-5 py-4"><span className="block">{application.email}</span><span className="text-xs text-slate-500">{application.mobileNumber}</span></td><td className="px-5 py-4">{application.barangay ? `${application.barangay}, ` : ''}{application.cityMunicipality}</td><td className="px-5 py-4">{application.status === 'pending' ? <select value={zoneSelections[application.id] || ''} onChange={event => setZoneSelections(current => ({ ...current, [application.id]: event.target.value }))} className="min-w-52 rounded-lg border border-slate-300 px-3 py-2 text-xs"><option value="">Select coordinator zone</option>{zones.filter(zone => zone.isActive).map(zone => <option key={zone.id} value={zone.id}>{zone.name} ({zone.coverages.length} areas)</option>)}</select> : application.managementZone ? <div><p className="font-semibold text-blue-700">{application.managementZone.name}</p><p className="mt-1 max-w-64 text-xs text-slate-500">{application.managementZone.coverages.map(item => `${item.cityMunicipalityName} · ${item.congressionalDistrict}`).join(', ')}</p></div> : <span className="text-red-600">Not assigned</span>}</td><td className="px-5 py-4 text-slate-500">{new Date(application.submittedAt).toLocaleDateString()}</td><td className="px-5 py-4"><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold capitalize text-amber-700">{application.status}</span></td><td className="px-5 py-4">{application.status === 'pending' ? <div className="flex gap-2"><button onClick={() => updateStatus(application.id, 'approved')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Approve & assign</button><button onClick={() => updateStatus(application.id, 'rejected')} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600">Reject</button></div> : '—'}</td></tr>)}</tbody></table></div>}
    </div>
  </div>;
}
