'use client';

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { getToken } from '@/hooks/use-auth';
import {
  DeliveryZone,
  DeliveryZoneArea,
  getAllDeliveryZones,
  createDeliveryZone,
  updateDeliveryZone,
  deleteDeliveryZone,
  addZoneArea,
  removeZoneArea,
} from '@/lib/delivery-zones';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface ZoneRider {
  id: string;
  firstName: string | null;
  lastName: string | null;
  vehicleType: string | null;
  isOnline: boolean;
  currentLat: number | null;
  currentLng: number | null;
  rating: number;
  totalDeliveries: number;
  zoneIds: string[];
}

export default function AdminZonesPage() {
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedZone, setSelectedZone] = useState<DeliveryZone | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showAreaForm, setShowAreaForm] = useState(false);
  const [filterCity, setFilterCity] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  const [zoneRiders, setZoneRiders] = useState<ZoneRider[]>([]);
  const [allRiders, setAllRiders] = useState<ZoneRider[]>([]);
  const [riderCounts, setRiderCounts] = useState<Record<string, number>>({});
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [detailTab, setDetailTab] = useState<'areas' | 'riders'>('areas');

  // Zone form state
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    city: '',
    region: 'Metro Manila',
    description: '',
    base_delivery_fee: 49,
    cross_zone_fee: 69,
    cross_city_fee: 99,
    is_active: true,
    display_order: 0,
  });

  // Area form state
  const [areaForm, setAreaForm] = useState({
    area_name: '',
    area_type: 'barangay' as const,
    zip_code: '',
  });

  const apiFetch = useCallback(async (path: string, options?: RequestInit) => {
    const token = getToken();
    const headers: Record<string, string> = { ...((options?.headers as Record<string, string>) || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (options?.body) headers['Content-Type'] = 'application/json';
    return fetch(`${API}${path}`, { ...options, headers });
  }, []);

  const fetchAllRiders = useCallback(async () => {
    try {
      const res = await apiFetch('/api/users?role=rider');
      if (!res.ok) return;
      const data = await res.json();
      const riders: ZoneRider[] = Array.isArray(data) ? data : data?.data || [];
      setAllRiders(riders);

      const counts: Record<string, number> = {};
      for (const r of riders) {
        for (const zid of r.zoneIds || []) {
          counts[zid] = (counts[zid] || 0) + 1;
        }
      }
      setRiderCounts(counts);
    } catch (error) {
      console.error('Error fetching riders:', error);
    }
  }, [apiFetch]);

  const fetchZoneRiders = useCallback(async (zoneId: string | number) => {
    try {
      const res = await apiFetch(`/api/users/riders/available?zoneId=${zoneId}`);
      if (!res.ok) {
        setZoneRiders([]);
        return;
      }
      const data = await res.json();
      setZoneRiders(Array.isArray(data) ? data : data?.data || []);
    } catch (error) {
      console.error('Error fetching zone riders:', error);
      setZoneRiders([]);
    }
  }, [apiFetch]);

  const fetchZones = async () => {
    try {
      setLoading(true);
      const data = await getAllDeliveryZones();
      setZones(data);
      setSelectedZone(prev => {
        if (!prev) return null;
        return data.find((z: DeliveryZone) => z.id === prev.id) || null;
      });
      return data;
    } catch (error) {
      console.error('Error fetching zones:', error);
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchZones();
    fetchAllRiders();
  }, [fetchAllRiders]);

  useEffect(() => {
    if (selectedZone) {
      fetchZoneRiders(selectedZone.id);
    } else {
      setZoneRiders([]);
    }
  }, [selectedZone, fetchZoneRiders]);

  const handleAssignRider = async (riderId: string) => {
    if (!selectedZone) return;
    try {
      setSaving(true);
      const res = await apiFetch(`/api/users/${riderId}/zones`, {
        method: 'POST',
        body: JSON.stringify({ zoneId: String(selectedZone.id) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to assign rider');
      }
      toast.success('Rider assigned to zone');
      setShowAssignModal(false);
      await fetchAllRiders();
      await fetchZoneRiders(selectedZone.id);
    } catch (error: any) {
      toast.error(error.message || 'Failed to assign rider');
    } finally {
      setSaving(false);
    }
  };

  const handleUnassignRider = async (riderId: string) => {
    if (!selectedZone) return;
    if (!confirm('Unassign this rider from the zone?')) return;
    try {
      const res = await apiFetch(`/api/users/${riderId}/zones/${selectedZone.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to unassign rider');
      }
      toast.success('Rider unassigned from zone');
      await fetchAllRiders();
      if (selectedZone) await fetchZoneRiders(selectedZone.id);
    } catch (error: any) {
      toast.error(error.message || 'Failed to unassign rider');
    }
  };

  const unassignedRiders = selectedZone
    ? allRiders.filter(r => !(r.zoneIds || []).includes(String(selectedZone.id)))
    : allRiders.filter(r => (r.zoneIds || []).length === 0);

  const cities = [...new Set(zones.map(z => z.city))].sort();

  const filteredZones = zones.filter(z => {
    const matchesCity = filterCity === 'all' || z.city === filterCity;
    const matchesSearch = searchTerm === '' ||
      z.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      z.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      z.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      z.areas?.some(a => a.area_name.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesCity && matchesSearch;
  });

  const openCreateForm = () => {
    setFormData({
      name: '',
      code: '',
      city: '',
      region: 'Metro Manila',
      description: '',
      base_delivery_fee: 49,
      cross_zone_fee: 69,
      cross_city_fee: 99,
      is_active: true,
      display_order: zones.length + 1,
    });
    setSelectedZone(null);
    setShowForm(true);
  };

  const openEditForm = (zone: DeliveryZone) => {
    setFormData({
      name: zone.name,
      code: zone.code,
      city: zone.city,
      region: zone.region,
      description: zone.description || '',
      base_delivery_fee: zone.base_delivery_fee,
      cross_zone_fee: zone.cross_zone_fee,
      cross_city_fee: zone.cross_city_fee,
      is_active: zone.is_active,
      display_order: zone.display_order,
    });
    setSelectedZone(zone);
    setShowForm(true);
  };

  const handleSaveZone = async () => {
    if (!formData.name || !formData.code || !formData.city) {
      toast.error('Name, Code, and City are required');
      return;
    }

    try {
      setSaving(true);
      if (selectedZone) {
        await updateDeliveryZone(selectedZone.id, formData);
        toast.success('Zone updated successfully');
      } else {
        await createDeliveryZone(formData);
        toast.success('Zone created successfully');
      }
      setShowForm(false);
      await fetchZones();
    } catch (error: any) {
      toast.error(error.message || 'Failed to save zone');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteZone = async (zone: DeliveryZone) => {
    if (!confirm(`Delete "${zone.name}"? This will also remove all its areas.`)) return;
    try {
      await deleteDeliveryZone(zone.id);
      if (selectedZone?.id === zone.id) setSelectedZone(null);
      await fetchZones();
      toast.success('Zone deleted successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete zone');
    }
  };

  const handleAddArea = async () => {
    if (!selectedZone || !areaForm.area_name) return;
    try {
      setSaving(true);
      await addZoneArea({
        zone_id: selectedZone.id,
        area_name: areaForm.area_name,
        area_type: areaForm.area_type,
        zip_code: areaForm.zip_code || null,
      });
      setAreaForm({ area_name: '', area_type: 'barangay', zip_code: '' });
      setShowAreaForm(false);
      await fetchZones();
      toast.success('Area added successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to add area');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveArea = async (areaId: number) => {
    if (!confirm('Remove this area?')) return;
    try {
      await removeZoneArea(areaId);
      await fetchZones();
      toast.success('Area removed successfully');
    } catch (error: any) {
      toast.error(error.message || 'Failed to remove area');
    }
  };

  const toggleZoneActive = async (zone: DeliveryZone) => {
    try {
      await updateDeliveryZone(zone.id, { is_active: !zone.is_active } as any);
      await fetchZones();
      toast.success(`Zone ${zone.is_active ? 'deactivated' : 'activated'} successfully`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to toggle zone');
    }
  };

  const totalAreas = zones.reduce((sum, z) => sum + (z.areas?.length || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Delivery Zone Management</h1>
          <p className="text-gray-500 text-sm mt-1">Manage districts, barangays, and delivery fees per zone</p>
        </div>
        <button
          onClick={openCreateForm}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#DB0002] text-white rounded-xl hover:bg-[#B80002] transition-colors font-medium text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Zone
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-2xl font-bold text-gray-900">{zones.length}</p>
          <p className="text-xs text-gray-500">Total Zones</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-2xl font-bold text-green-600">{zones.filter(z => z.is_active).length}</p>
          <p className="text-xs text-gray-500">Active Zones</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-2xl font-bold text-blue-600">{cities.length}</p>
          <p className="text-xs text-gray-500">Cities Covered</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-2xl font-bold text-purple-600">{totalAreas}</p>
          <p className="text-xs text-gray-500">Barangays / Areas</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search zones, barangays..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
          />
        </div>
        <select
          value={filterCity}
          onChange={(e) => setFilterCity(e.target.value)}
          className="px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none bg-white"
        >
          <option value="all">All Cities ({zones.length})</option>
          {cities.map(city => (
            <option key={city} value={city}>
              {city} ({zones.filter(z => z.city === city).length})
            </option>
          ))}
        </select>
      </div>

      {/* Zones Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredZones.map((zone) => (
          <div
            key={zone.id}
            className={`bg-white rounded-2xl border overflow-hidden transition-all hover:shadow-md ${
              selectedZone?.id === zone.id ? 'border-[#DB0002] ring-2 ring-[#DB0002]/10' : 'border-gray-200'
            } ${!zone.is_active ? 'opacity-60' : ''}`}
          >
            {/* Zone Header */}
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-gray-900 text-sm truncate">{zone.name}</h3>
                    {!zone.is_active && (
                      <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-[9px] font-bold rounded">INACTIVE</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    <span className="font-mono bg-gray-50 px-1 rounded">{zone.code}</span> • {zone.city}, {zone.region}
                  </p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => setSelectedZone(selectedZone?.id === zone.id ? null : zone)}
                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="View areas"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => openEditForm(zone)}
                    className="p-1.5 text-gray-400 hover:text-[#DB0002] hover:bg-red-50 rounded-lg transition-colors"
                    title="Edit zone"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Fee badges */}
              <div className="flex gap-2 mt-3">
                <span className="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-semibold">
                  Same Zone: ₱{zone.base_delivery_fee}
                </span>
                <span className="text-[10px] bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full font-semibold">
                  Cross: ₱{zone.cross_zone_fee}
                </span>
                <span className="text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-semibold">
                  City: ₱{zone.cross_city_fee}
                </span>
              </div>
            </div>

            {/* Areas List */}
            <div className="p-3">
              {zone.description && (
                <p className="text-[11px] text-gray-400 mb-2 line-clamp-1">{zone.description}</p>
              )}
              <div className="flex flex-wrap gap-1">
                {(zone.areas || []).slice(0, 8).map((area) => (
                  <span key={area.id} className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                    {area.area_name}
                  </span>
                ))}
                {(zone.areas?.length || 0) > 8 && (
                  <span className="text-[10px] bg-gray-50 text-gray-500 px-2 py-0.5 rounded-full">
                    +{(zone.areas?.length || 0) - 8} more
                  </span>
                )}
                {(zone.areas?.length || 0) === 0 && (
                  <span className="text-[10px] text-gray-400 italic">No areas added</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-2">
                <p className="text-[10px] text-gray-400">{zone.areas?.length || 0} areas</p>
                {(riderCounts[String(zone.id)] || 0) > 0 && (
                  <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">
                    {riderCounts[String(zone.id)]} rider{riderCounts[String(zone.id)] > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredZones.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No zones found</p>
          <button onClick={openCreateForm} className="text-[#DB0002] text-sm font-medium mt-2 hover:underline">
            Create your first zone
          </button>
        </div>
      )}

      {/* Selected Zone Detail Panel */}
      {selectedZone && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-900">{selectedZone.name}</h2>
                <p className="text-sm text-gray-500">Areas & Barangays</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setAreaForm({ area_name: '', area_type: 'barangay', zip_code: '' }); setShowAreaForm(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Area
                </button>
                <button
                  onClick={() => toggleZoneActive(selectedZone)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    selectedZone.is_active
                      ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                      : 'bg-green-100 text-green-700 hover:bg-green-200'
                  }`}
                >
                  {selectedZone.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  onClick={() => handleDeleteZone(selectedZone)}
                  className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-medium hover:bg-red-200 transition-colors"
                >
                  Delete Zone
                </button>
              </div>
            </div>
          </div>

          <div className="p-4">
            {/* Delivery Fee Config */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-green-700">₱{selectedZone.base_delivery_fee}</p>
                <p className="text-[10px] text-green-600 font-medium">SAME ZONE</p>
              </div>
              <div className="bg-yellow-50 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-yellow-700">₱{selectedZone.cross_zone_fee}</p>
                <p className="text-[10px] text-yellow-600 font-medium">CROSS ZONE</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-red-700">₱{selectedZone.cross_city_fee}</p>
                <p className="text-[10px] text-red-600 font-medium">CROSS CITY</p>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-4 border-b border-gray-100">
              <button
                onClick={() => setDetailTab('areas')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  detailTab === 'areas'
                    ? 'border-[#DB0002] text-[#DB0002]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Areas ({selectedZone.areas?.length || 0})
              </button>
              <button
                onClick={() => setDetailTab('riders')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  detailTab === 'riders'
                    ? 'border-[#DB0002] text-[#DB0002]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Riders ({riderCounts[String(selectedZone.id)] || 0})
              </button>
            </div>

            {/* Areas Table */}
            {detailTab === 'areas' && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Area Name</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Type</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">ZIP</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedZone.areas || []).map((area) => (
                      <tr key={area.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 px-3 font-medium text-gray-900">{area.area_name}</td>
                        <td className="py-2 px-3">
                          <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">
                            {area.area_type}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-gray-500 font-mono text-xs">{area.zip_code || '—'}</td>
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={() => handleRemoveArea(area.id)}
                            className="text-red-500 hover:text-red-700 text-xs font-medium"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(selectedZone.areas?.length || 0) === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-gray-400 text-sm">
                          No areas added yet. Click &quot;Add Area&quot; to get started.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Riders Section */}
            {detailTab === 'riders' && (
              <div>
                <div className="flex justify-end mb-3">
                  <button
                    onClick={() => setShowAssignModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Assign Rider
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Rider</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Vehicle</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Status</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Location</th>
                        <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allRiders
                        .filter(r => (r.zoneIds || []).includes(String(selectedZone.id)))
                        .map((rider) => (
                          <tr key={rider.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-2 px-3">
                              <p className="font-medium text-gray-900">
                                {rider.firstName || ''} {rider.lastName || ''}
                                {!rider.firstName && !rider.lastName && <span className="text-gray-400 italic">No name</span>}
                              </p>
                            </td>
                            <td className="py-2 px-3">
                              <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">
                                {rider.vehicleType || 'N/A'}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                                rider.isOnline
                                  ? 'bg-green-50 text-green-700'
                                  : 'bg-gray-100 text-gray-500'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${rider.isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
                                {rider.isOnline ? 'Online' : 'Offline'}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-gray-500 font-mono text-xs">
                              {rider.currentLat && rider.currentLng
                                ? `${rider.currentLat.toFixed(4)}, ${rider.currentLng.toFixed(4)}`
                                : '—'}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <button
                                onClick={() => handleUnassignRider(rider.id)}
                                className="text-red-500 hover:text-red-700 text-xs font-medium"
                              >
                                Unassign
                              </button>
                            </td>
                          </tr>
                        ))}
                      {allRiders.filter(r => (r.zoneIds || []).includes(String(selectedZone.id))).length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-gray-400 text-sm">
                            No riders assigned. Click &quot;Assign Rider&quot; to add one.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== Zone Create/Edit Modal ========== */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">
                {selectedZone ? 'Edit Zone' : 'Create New Zone'}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase">Zone Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="District 3 - Manila"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase">Zone Code *</label>
                  <input
                    type="text"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    placeholder="MNL-D3"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm font-mono focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase">City *</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    placeholder="Manila"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase">Region</label>
                  <input
                    type="text"
                    value={formData.region}
                    onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                    placeholder="Metro Manila"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Binondo, Quiapo, San Nicolas, Santa Cruz"
                  rows={2}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none resize-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase">Same Zone Fee (₱)</label>
                  <input
                    type="number"
                    value={formData.base_delivery_fee}
                    onChange={(e) => setFormData({ ...formData, base_delivery_fee: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase">Cross Zone Fee (₱)</label>
                  <input
                    type="number"
                    value={formData.cross_zone_fee}
                    onChange={(e) => setFormData({ ...formData, cross_zone_fee: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase">Cross City Fee (₱)</label>
                  <input
                    type="number"
                    value={formData.cross_city_fee}
                    onChange={(e) => setFormData({ ...formData, cross_city_fee: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 text-[#DB0002] focus:ring-[#DB0002]"
                  />
                  <span className="text-sm text-gray-700">Active</span>
                </label>
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveZone}
                disabled={saving}
                className="px-5 py-2.5 bg-[#DB0002] text-white rounded-xl hover:bg-[#B80002] font-medium text-sm disabled:opacity-50"
              >
                {saving ? 'Saving...' : selectedZone ? 'Update Zone' : 'Create Zone'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== Add Area Modal ========== */}
      {showAreaForm && selectedZone && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Add Area to {selectedZone.name}</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase">Area / Barangay Name *</label>
                <input
                  type="text"
                  value={areaForm.area_name}
                  onChange={(e) => setAreaForm({ ...areaForm, area_name: e.target.value })}
                  placeholder="e.g., Binondo"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase">Type</label>
                  <select
                    value={areaForm.area_type}
                    onChange={(e) => setAreaForm({ ...areaForm, area_type: e.target.value as any })}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none bg-white"
                  >
                    <option value="barangay">Barangay</option>
                    <option value="district">District</option>
                    <option value="neighborhood">Neighborhood</option>
                    <option value="subdivision">Subdivision</option>
                    <option value="zone">Zone</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase">ZIP Code</label>
                  <input
                    type="text"
                    value={areaForm.zip_code}
                    onChange={(e) => setAreaForm({ ...areaForm, zip_code: e.target.value })}
                    placeholder="1006"
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowAreaForm(false)}
                className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleAddArea}
                disabled={saving || !areaForm.area_name}
                className="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Area'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== Assign Rider Modal ========== */}
      {showAssignModal && selectedZone && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Assign Rider to {selectedZone.name}</h2>
              <p className="text-sm text-gray-500 mt-1">Select an unassigned rider</p>
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
              {unassignedRiders.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">
                  All riders are already assigned to zones.
                </p>
              ) : (
                <div className="space-y-2">
                  {unassignedRiders.map((rider) => (
                    <button
                      key={rider.id}
                      onClick={() => handleAssignRider(rider.id)}
                      disabled={saving}
                      className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50 transition-colors text-left disabled:opacity-50"
                    >
                      <div>
                        <p className="font-medium text-gray-900 text-sm">
                          {rider.firstName || ''} {rider.lastName || ''}
                          {!rider.firstName && !rider.lastName && <span className="text-gray-400 italic">No name</span>}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">
                            {rider.vehicleType || 'N/A'}
                          </span>
                          <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            rider.isOnline
                              ? 'bg-green-50 text-green-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${rider.isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
                            {rider.isOnline ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      </div>
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-200">
              <button
                onClick={() => setShowAssignModal(false)}
                className="w-full px-5 py-2.5 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 font-medium text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
