'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Rider {
  id: string;
  firstName: string | null;
  first_name?: string | null;
  lastName: string | null;
  last_name?: string | null;
  email: string | null;
  phone: string;
  role: string;
  isActive: boolean;
  is_active?: boolean;
  isVerified?: boolean;
  is_verified?: boolean;
  status?: string | null;
  vehicleType?: string | null;
  vehicle_type?: string | null;
  plateNumber?: string | null;
  plate_number?: string | null;
  licenseNumber?: string | null;
  license_number?: string | null;
  rating?: number;
  totalDeliveries?: number;
  total_deliveries?: number;
  createdAt?: string;
  created_at?: string;
  zoneIds?: string[];
  preferredZoneId?: string | null;
}

interface Zone {
  id: string;
  name: string;
  code: string;
  city: string;
  district?: string | null;
  isActive?: boolean;
}

type RiderStatus = 'pending' | 'approved' | 'suspended' | 'rejected';
type StatusFilter = 'all' | RiderStatus;

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'rejected', label: 'Rejected' },
];

const STATUS_BADGE: Record<RiderStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
  rejected: 'bg-gray-200 text-gray-700',
};

function riderStatus(r: Rider): RiderStatus {
  const s = (r.status || '').toLowerCase();
  if (s === 'pending') return 'pending';
  if (s === 'rejected') return 'rejected';
  if (s === 'suspended') return 'suspended';
  // 'active' / 'approved' / empty → fall back to the isActive flag
  const active = r.isActive ?? r.is_active ?? true;
  return active ? 'approved' : 'suspended';
}

export default function AdminRidersPage() {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Zone-assignment modal state. Used both for the approve flow (pending →
  // approved) and for editing zones on an already-approved rider.
  const [zoneModal, setZoneModal] = useState<{ rider: Rider; mode: 'approve' | 'edit' } | null>(null);
  const [zoneSelection, setZoneSelection] = useState<string[]>([]);
  const [zoneSaving, setZoneSaving] = useState(false);

  const fetchRiders = async () => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API}/api/users?role=rider`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRiders(Array.isArray(data) ? data : data.data || []);
      } else {
        toast.error('Failed to load riders');
      }
    } catch {
      toast.error('Failed to load riders');
    } finally {
      setLoading(false);
    }
  };

  const fetchZones = async () => {
    const token = getToken();
    try {
      const res = await fetch(`${API}/api/zones?active=true`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setZones(Array.isArray(data) ? data : data.data || []);
      }
    } catch {
      // Non-fatal: zone assignment simply won't be available.
    }
  };

  useEffect(() => {
    fetchRiders();
    fetchZones();
  }, []);

  const zoneName = (id: string) => {
    const z = zones.find((z) => z.id === id);
    return z ? z.name : id;
  };

  const updateStatus = async (
    rider: Rider,
    status: RiderStatus,
    confirmMsg?: string,
    zoneIds?: string[],
  ) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    const token = getToken();
    setBusyId(rider.id);
    try {
      const res = await fetch(`${API}/api/users/${rider.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(zoneIds ? { status, zoneIds } : { status }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to update rider');
      }
      const labels: Record<RiderStatus, string> = {
        approved: 'approved',
        rejected: 'rejected',
        suspended: 'suspended',
        pending: 'set to pending',
      };
      toast.success(`Rider ${labels[status]}`);
      await fetchRiders();
    } catch (error: any) {
      toast.error(error.message || 'Failed to update rider');
    } finally {
      setBusyId(null);
    }
  };

  const openZoneModal = (rider: Rider, mode: 'approve' | 'edit') => {
    // Prefill: existing zones if any, otherwise the rider's preferred zone hint.
    const preset =
      rider.zoneIds && rider.zoneIds.length > 0
        ? rider.zoneIds
        : rider.preferredZoneId
        ? [rider.preferredZoneId]
        : [];
    setZoneSelection(preset);
    setZoneModal({ rider, mode });
  };

  const toggleZone = (id: string) => {
    setZoneSelection((prev) =>
      prev.includes(id) ? prev.filter((z) => z !== id) : [...prev, id],
    );
  };

  const submitZoneModal = async () => {
    if (!zoneModal) return;
    const { rider, mode } = zoneModal;
    setZoneSaving(true);
    try {
      if (mode === 'approve') {
        await updateStatus(rider, 'approved', undefined, zoneSelection);
      } else {
        const token = getToken();
        const res = await fetch(`${API}/api/users/${rider.id}/zones`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ zoneIds: zoneSelection }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || 'Failed to update zones');
        }
        toast.success('Zones updated');
        await fetchRiders();
      }
      setZoneModal(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to update zones');
    } finally {
      setZoneSaving(false);
    }
  };

  const riderName = (r: Rider) => {
    const first = r.firstName ?? r.first_name ?? '';
    const last = r.lastName ?? r.last_name ?? '';
    return (first + ' ' + last).trim() || r.email || r.phone || 'Unknown rider';
  };

  const formatDate = (iso?: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const counts = STATUS_TABS.reduce((acc, tab) => {
    acc[tab.key] = tab.key === 'all' ? riders.length : riders.filter((r) => riderStatus(r) === tab.key).length;
    return acc;
  }, {} as Record<StatusFilter, number>);

  const filtered = riders.filter((r) => {
    if (statusFilter !== 'all' && riderStatus(r) !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = riderName(r).toLowerCase();
      const email = (r.email || '').toLowerCase();
      const plate = (r.plateNumber ?? r.plate_number ?? '').toLowerCase();
      if (!name.includes(q) && !email.includes(q) && !plate.includes(q)) return false;
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading riders…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Rider Management</h1>
        <p className="text-sm text-gray-500 mt-1">Review rider applications, approve or suspend delivery riders</p>
      </div>

      {/* Stats / filter cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`p-3 rounded-xl border text-center transition-colors ${
              statusFilter === tab.key
                ? 'bg-[#DB0002] text-white border-[#DB0002]'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <p className="text-lg font-bold">{counts[tab.key]}</p>
            <p className="text-xs font-medium mt-0.5">{tab.label}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, email or plate…"
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
        />
      </div>

      {/* Riders Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3 font-semibold text-gray-700">Rider</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-700">Vehicle</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-700">Zones</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-700">Performance</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-700">Joined</th>
                <th className="text-right px-5 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-gray-500">
                    No riders found
                  </td>
                </tr>
              ) : (
                filtered.map((rider) => {
                  const status = riderStatus(rider);
                  const vehicle = rider.vehicleType ?? rider.vehicle_type;
                  const plate = rider.plateNumber ?? rider.plate_number;
                  const deliveries = rider.totalDeliveries ?? rider.total_deliveries ?? 0;
                  const busy = busyId === rider.id;
                  return (
                    <tr key={rider.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center text-xs font-bold text-orange-600">
                            {riderName(rider)[0]?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{riderName(rider)}</p>
                            <p className="text-xs text-gray-400">{rider.email || rider.phone}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-gray-600">
                        {vehicle ? (
                          <div>
                            <p className="capitalize">{vehicle}</p>
                            {plate && <p className="text-xs text-gray-400">{plate}</p>}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-gray-600">
                        {(rider.zoneIds?.length ?? 0) > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[220px]">
                            {rider.zoneIds!.slice(0, 3).map((zid) => (
                              <span key={zid} className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                                {zoneName(zid)}
                              </span>
                            ))}
                            {rider.zoneIds!.length > 3 && (
                              <span className="text-[10px] bg-gray-50 text-gray-500 px-2 py-0.5 rounded-full">
                                +{rider.zoneIds!.length - 3}
                              </span>
                            )}
                          </div>
                        ) : rider.preferredZoneId ? (
                          <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
                            prefers {zoneName(rider.preferredZoneId)}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">Unassigned</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-gray-600">
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                          </svg>
                          <span className="font-medium text-gray-700">{(rider.rating ?? 0).toFixed(1)}</span>
                          <span className="text-xs text-gray-400">· {deliveries} deliveries</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_BADGE[status]}`}>
                          {status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-gray-600 text-xs">
                        {formatDate(rider.createdAt ?? rider.created_at)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2">
                          {status === 'pending' && (
                            <>
                              <button
                                disabled={busy}
                                onClick={() => openZoneModal(rider, 'approve')}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-50 text-green-600 hover:bg-green-100 disabled:opacity-50"
                              >
                                Approve
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => updateStatus(rider, 'rejected', `Reject ${riderName(rider)}'s application?`)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {status === 'approved' && (
                            <>
                              <button
                                disabled={busy}
                                onClick={() => openZoneModal(rider, 'edit')}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50"
                              >
                                Zones
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => updateStatus(rider, 'suspended', `Suspend ${riderName(rider)}? They won't be able to log in.`)}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"
                              >
                                Suspend
                              </button>
                            </>
                          )}
                          {(status === 'suspended' || status === 'rejected') && (
                            <button
                              disabled={busy}
                              onClick={() => updateStatus(rider, 'approved')}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-50 text-green-600 hover:bg-green-100 disabled:opacity-50"
                            >
                              {status === 'rejected' ? 'Approve' : 'Reinstate'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== Zone assignment modal (approve + edit) ===== */}
      {zoneModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">
                {zoneModal.mode === 'approve' ? 'Approve rider & assign zones' : 'Manage zones'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {riderName(zoneModal.rider)} — select the zones this rider will operate in.
              </p>
              {zoneModal.rider.preferredZoneId && (
                <p className="text-xs text-amber-600 mt-1">
                  Rider requested: <span className="font-semibold">{zoneName(zoneModal.rider.preferredZoneId)}</span>
                </p>
              )}
            </div>

            <div className="p-4 flex-1 overflow-y-auto">
              {zones.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">
                  No zones available. Create zones first.
                </p>
              ) : (
                <div className="space-y-1">
                  {zones.map((z) => {
                    const checked = zoneSelection.includes(z.id);
                    const isPreferred = zoneModal.rider.preferredZoneId === z.id;
                    return (
                      <label
                        key={z.id}
                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                          checked ? 'border-indigo-300 bg-indigo-50/50' : 'border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleZone(z.id)}
                          className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 text-sm truncate">
                            {z.name}
                            {isPreferred && (
                              <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full align-middle">
                                requested
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            <span className="font-mono">{z.code}</span> • {z.city}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 flex items-center justify-between gap-3">
              <span className="text-xs text-gray-500">{zoneSelection.length} selected</span>
              <div className="flex gap-3">
                <button
                  onClick={() => setZoneModal(null)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 font-medium text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={submitZoneModal}
                  disabled={zoneSaving}
                  className="px-4 py-2 bg-[#DB0002] text-white rounded-xl hover:bg-[#B80002] font-medium text-sm disabled:opacity-50"
                >
                  {zoneSaving
                    ? 'Saving…'
                    : zoneModal.mode === 'approve'
                    ? 'Approve rider'
                    : 'Save zones'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
