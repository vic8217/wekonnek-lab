'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';
import dynamic from 'next/dynamic';
import L from 'leaflet';
import { useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const MapContainer = dynamic(() => import('react-leaflet').then(mod => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then(mod => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then(mod => mod.Marker), { ssr: false });

// Use an inline icon so the marker does not depend on Leaflet's image assets,
// whose default relative URLs are not reliably resolved by Next.js.
const shopLocationIcon = L.divIcon({
  className: '',
  html: '<span style="display:block;width:26px;height:26px;border:4px solid white;border-radius:50% 50% 50% 0;background:#DB0002;box-shadow:0 4px 12px rgba(15,23,42,.28);transform:rotate(-45deg)"><span style="display:block;width:6px;height:6px;margin:6px;border-radius:9999px;background:white"></span></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

type TaxClassification = '' | 'vat_registered' | 'non_vat_percentage_tax' | 'vat_exempt' | 'zero_rated_vat' | 'government_entity' | 'boi_peza_registered';

const TAX_CLASSIFICATIONS: Record<Exclude<TaxClassification, ''>, { label: string; invoiceType: string; tax: string }> = {
  vat_registered: { label: 'VAT Registered', invoiceType: 'VAT Invoice', tax: '12% VAT' },
  non_vat_percentage_tax: { label: 'Non-VAT (Percentage Tax)', invoiceType: 'Non-VAT Invoice', tax: 'Percentage Tax (if applicable)' },
  vat_exempt: { label: 'VAT-Exempt', invoiceType: 'VAT-Exempt Invoice', tax: 'No VAT' },
  zero_rated_vat: { label: 'Zero-Rated VAT', invoiceType: 'Zero-Rated VAT Invoice', tax: '0% VAT' },
  government_entity: { label: 'Government Entity', invoiceType: 'Special government rules', tax: 'Depends on transaction' },
  boi_peza_registered: { label: 'BOI/PEZA Registered', invoiceType: 'Special incentives', tax: 'Depends on registration/incentives' },
};

function LocationPicker({ onPick }: { onPick: (latitude: number, longitude: number) => void }) {
  useMapEvents({ click: event => onPick(event.latlng.lat, event.latlng.lng) });
  return null;
}

interface Branch {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  operatingHours: Record<string, unknown> | null;
  isActive: boolean;
  is_active: boolean;
  staff_count: number;
  latitude: number | null;
  longitude: number | null;
  tin?: string | null;
  registeredBusinessName?: string | null;
  registered_business_name?: string | null;
  taxClassification?: TaxClassification;
  tax_classification?: TaxClassification;
  isDefault?: boolean;
  is_default?: boolean;
  wallet_balance?: number;
  daily_subscription_fee?: number;
  wallet_funded?: boolean;
  store_id?: string | null;
  temporary_password?: string | null;
  recovery_key?: string | null;
  shop_id?: string | null;
  passkey?: string | null;
  passkey_expires_at?: string | null;
}

interface BranchForm {
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  weekdayOpen: string;
  weekdayClose: string;
  saturdayOpen: string;
  saturdayClose: string;
  sundayOpen: string;
  sundayClose: string;
  latitude: number;
  longitude: number;
  tin: string;
  registeredBusinessName: string;
  taxClassification: TaxClassification;
}

const EMPTY_FORM: BranchForm = {
  name: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  phone: '',
  weekdayOpen: '09:00',
  weekdayClose: '18:00',
  saturdayOpen: '09:00',
  saturdayClose: '18:00',
  sundayOpen: '09:00',
  sundayClose: '18:00',
  latitude: 14.5995,
  longitude: 120.9842,
  tin: '',
  registeredBusinessName: '',
  taxClassification: '',
};

export default function MerchantBranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [merchantId, setMerchantId] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [regeneratingPasskeyId, setRegeneratingPasskeyId] = useState<number | null>(null);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by this browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => {
        setForm(current => ({
          ...current,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }));
        toast.success('Shop location updated');
      },
      () => toast.error('Unable to access your current location'),
      { enableHighAccuracy: true },
    );
  };

  const fetchMerchant = async () => {
    const token = getToken();
    if (!token) return null;
    const res = await fetch(`${API}/api/merchants/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.id ?? null;
  };

  const fetchBranches = async (mId: number) => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/merchants/${mId}/branches`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBranches(data);
      }
    } catch {
      toast.error('Failed to load shops');
    }
  };

  useEffect(() => {
    const init = async () => {
      const mId = await fetchMerchant();
      if (mId) {
        setMerchantId(mId);
        await fetchBranches(mId);
      }
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (!merchantId) return;
    const expirations = branches
      .map(branch => branch.passkey_expires_at ? new Date(branch.passkey_expires_at).getTime() : NaN)
      .filter(Number.isFinite);
    if (!expirations.length) return;

    const nextExpiration = Math.min(...expirations);
    const timer = window.setTimeout(
      () => void fetchBranches(merchantId),
      Math.max(nextExpiration - Date.now() + 1000, 1000),
    );
    return () => window.clearTimeout(timer);
  }, [branches, merchantId]);

  const openAddModal = () => {
    setEditingBranch(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEditModal = (branch: Branch) => {
    const hours = branch.operatingHours || {};
    const weekday = (hours['monday-friday'] || hours.weekday || {}) as Record<string, string>;
    const saturday = (hours.saturday || {}) as Record<string, string>;
    const sunday = (hours.sunday || {}) as Record<string, string>;
    setEditingBranch(branch);
    setForm({
      name: branch.name,
      address: branch.address || '',
      city: branch.city || '',
      state: branch.state || '',
      zipCode: branch.zipCode || '',
      phone: branch.phone || '',
      weekdayOpen: weekday.open || '09:00',
      weekdayClose: weekday.close || '18:00',
      saturdayOpen: saturday.open || '09:00',
      saturdayClose: saturday.close || '18:00',
      sundayOpen: sunday.open || '09:00',
      sundayClose: sunday.close || '18:00',
      latitude: Number(branch.latitude) || 14.5995,
      longitude: Number(branch.longitude) || 120.9842,
      tin: branch.tin || '',
      registeredBusinessName: branch.registeredBusinessName || branch.registered_business_name || '',
      taxClassification: branch.taxClassification || branch.tax_classification || '',
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('Shop name is required');
      return;
    }
    if (!form.taxClassification) {
      toast.error('Business tax classification is required');
      return;
    }
    if (!merchantId) return;
    setSaving(true);
    const token = getToken();

    const payload: Record<string, unknown> = {
      name: form.name,
      address: form.address || null,
      city: form.city || null,
      state: form.state || null,
      zip_code: form.zipCode || null,
      phone: form.phone || null,
      latitude: form.latitude,
      longitude: form.longitude,
      tin: form.tin || null,
      registered_business_name: form.registeredBusinessName || form.name,
      tax_classification: form.taxClassification,
      operating_hours: {
        'monday-friday': { open: form.weekdayOpen, close: form.weekdayClose },
        saturday: { open: form.saturdayOpen, close: form.saturdayClose },
        sunday: { open: form.sundayOpen, close: form.sundayClose },
      },
    };

    try {
      const url = editingBranch
        ? `${API}/api/branches/${editingBranch.id}`
        : `${API}/api/merchants/${merchantId}/branches`;

      const res = await fetch(url, {
        method: editingBranch ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to save shop');
      }

      toast.success(editingBranch ? 'Shop updated' : 'Shop created');
      setShowModal(false);
      await fetchBranches(merchantId);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to save shop');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (branchId: number) => {
    if (!window.confirm('Delete this shop? This action cannot be undone.')) return;
    const token = getToken();

    try {
      const res = await fetch(`${API}/api/branches/${branchId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Shop deleted');
      if (merchantId) await fetchBranches(merchantId);
    } catch {
      toast.error('Failed to delete shop');
    }
  };

  const regeneratePasskey = async (branch: Branch) => {
    if (!window.confirm(`Regenerate the passkey for ${branch.name}? The current passkey will stop working immediately.`)) return;
    setRegeneratingPasskeyId(branch.id);
    try {
      const res = await fetch(`${API}/api/branches/${branch.id}/passkey`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Failed to regenerate passkey');
      setBranches(current => current.map(item => item.id === branch.id
        ? {
            ...item,
            passkey: body.passkey,
            temporary_password: body.passkey,
            passkey_expires_at: body.passkey_expires_at,
          }
        : item));
      toast.success('Shop passkey regenerated');
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to regenerate passkey');
    } finally {
      setRegeneratingPasskeyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading shops…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shops</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your shop locations</p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 bg-[#DB0002] text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#B80002] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Shop
        </button>
      </div>

      {/* Branch Cards */}
      {branches.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <p className="text-gray-600 font-semibold">No shops yet</p>
          <p className="text-gray-400 text-sm mt-1">Add your first shop to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {branches.map((branch) => (
            <div key={branch.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-gray-900 truncate">{branch.name}</h3>
                  {branch.city && (
                    <p className="text-sm text-gray-500 mt-0.5">{branch.city}{branch.state ? `, ${branch.state}` : ''}</p>
                  )}
                </div>
                <div className="ml-2 flex flex-wrap justify-end gap-1">
                  {(branch.isDefault ?? branch.is_default) && (
                    <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">Default Shop</span>
                  )}
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    (branch.isActive ?? branch.is_active) ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {(branch.isActive ?? branch.is_active)
                      ? 'Active'
                      : branch.wallet_funded === false
                        ? 'Inactive · Reload Wallet'
                        : 'Inactive'}
                  </span>
                </div>
              </div>

              {branch.address && (
                <p className="text-sm text-gray-600 mb-2 line-clamp-2">{branch.address}</p>
              )}
              {(!branch.latitude || !branch.longitude) && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                  Update the store address and pin this shop&apos;s map location.
                </div>
              )}
              {branch.wallet_funded === false && (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  Wallet balance ₱{Number(branch.wallet_balance || 0).toLocaleString()} is below the ₱{Number(branch.daily_subscription_fee || 0).toLocaleString()} daily subscription fee.
                </div>
              )}

              {(branch.shop_id || branch.store_id) && (
                <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-3">
                  <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-blue-700">Account access</p>
                  <div className="space-y-2 text-xs">
                    <div><p className="font-semibold text-gray-500">Shop ID</p><p className="mt-0.5 break-all font-mono font-bold text-gray-900">{branch.shop_id || branch.store_id || 'N/A'}</p></div>
                    <div><p className="font-semibold text-gray-500">Passkey</p><p className="mt-0.5 break-all font-mono font-bold text-gray-900">{branch.passkey || branch.temporary_password || 'N/A'}</p></div>
                    <div><p className="font-semibold text-gray-500">Passkey valid until</p><p className="mt-0.5 font-semibold text-gray-900">{branch.passkey_expires_at ? new Date(branch.passkey_expires_at).toLocaleString() : 'N/A'}</p></div>
                    <button
                      type="button"
                      onClick={() => regeneratePasskey(branch)}
                      disabled={regeneratingPasskeyId === branch.id}
                      className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {regeneratingPasskeyId === branch.id ? 'Regenerating…' : 'Regenerate passkey'}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
                {branch.phone && (
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    {branch.phone}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {branch.staff_count ?? 0} staff
                </span>
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                <button
                  onClick={() => openEditModal(branch)}
                  className="flex-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors"
                >
                  {(!branch.latitude || !branch.longitude) ? 'Set Store Location' : 'Edit'}
                </button>
                {!(branch.isDefault ?? branch.is_default) && (
                  <button
                    onClick={() => handleDelete(branch.id)}
                    className="px-3 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                {editingBranch ? 'Edit Shop' : 'Add Shop'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shop Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
                  placeholder="e.g. Main Shop"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Store Address</label>
                <textarea
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002] resize-none"
                  placeholder="Full street address"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input
                    type="text"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
                    placeholder="City"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State/Province</label>
                  <input
                    type="text"
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
                    placeholder="State"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Zip Code</label>
                  <input
                    type="text"
                    value={form.zipCode}
                    onChange={(e) => setForm({ ...form, zipCode: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
                    placeholder="Zip"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
                    placeholder="Phone number"
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">Shop Location *</h3>
                    <p className="text-xs text-gray-500">Click the map to pinpoint the shop.</p>
                  </div>
                  <button
                    type="button"
                    onClick={useCurrentLocation}
                    className="rounded-lg border border-[#DB0002] bg-white px-3 py-2 text-xs font-semibold text-[#DB0002] hover:bg-red-50"
                  >
                    Use My Location
                  </button>
                </div>
                <div className="h-64 overflow-hidden rounded-lg border border-gray-300">
                  <MapContainer
                    key={`${form.latitude}-${form.longitude}`}
                    center={[form.latitude, form.longitude]}
                    zoom={16}
                    className="h-full w-full"
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <LocationPicker
                      onPick={(latitude, longitude) =>
                        setForm(current => ({ ...current, latitude, longitude }))
                      }
                    />
                    <Marker
                      position={[form.latitude, form.longitude]}
                      icon={shopLocationIcon}
                    />
                  </MapContainer>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-medium text-gray-600">
                    Latitude
                    <input
                      type="number"
                      step="any"
                      value={form.latitude}
                      onChange={event => setForm({ ...form, latitude: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="text-xs font-medium text-gray-600">
                    Longitude
                    <input
                      type="number"
                      step="any"
                      value={form.longitude}
                      onChange={event => setForm({ ...form, longitude: Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border border-gray-200 p-4">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Business Tax Information</h3>
                  <p className="text-xs text-gray-500">Used for invoices issued by this shop.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-sm font-medium text-gray-700">
                    TIN
                    <input
                      type="text"
                      value={form.tin}
                      onChange={event => setForm({ ...form, tin: event.target.value })}
                      placeholder="Tax Identification Number"
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
                    />
                  </label>
                  <label className="text-sm font-medium text-gray-700">
                    Registered Business Name
                    <input
                      type="text"
                      value={form.registeredBusinessName}
                      onChange={event => setForm({ ...form, registeredBusinessName: event.target.value })}
                      placeholder={form.name || 'Registered business name'}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm"
                    />
                  </label>
                </div>
                <label className="block text-sm font-medium text-gray-700">
                  Business Tax Classification *
                  <select
                    value={form.taxClassification}
                    onChange={event => setForm({ ...form, taxClassification: event.target.value as TaxClassification })}
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm"
                  >
                    <option value="" disabled>Select a classification</option>
                    {(Object.entries(TAX_CLASSIFICATIONS) as Array<[Exclude<TaxClassification, ''>, (typeof TAX_CLASSIFICATIONS)[Exclude<TaxClassification, ''>]]>).map(([value, option]) => (
                      <option key={value} value={value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                {form.taxClassification && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs font-medium uppercase text-gray-500">Invoice Type</p>
                      <p className="mt-1 text-sm font-semibold">{TAX_CLASSIFICATIONS[form.taxClassification].invoiceType}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-xs font-medium uppercase text-gray-500">Tax Computation</p>
                      <p className="mt-1 text-sm font-semibold">{TAX_CLASSIFICATIONS[form.taxClassification].tax}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4 rounded-xl border border-gray-200 p-5">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Store Hours &amp; Location</h3>
                  <p className="mt-1 text-sm text-gray-500">Set your operating hours and location</p>
                </div>
                <div>
                  <p className="mb-3 text-sm font-semibold text-gray-700">Operating Hours</p>
                  <div className="space-y-3">
                    {[
                      { label: 'Monday–Friday', open: 'weekdayOpen', close: 'weekdayClose' },
                      { label: 'Saturday', open: 'saturdayOpen', close: 'saturdayClose' },
                      { label: 'Sunday', open: 'sundayOpen', close: 'sundayClose' },
                    ].map(row => (
                      <div key={row.label} className="grid items-center gap-2 sm:grid-cols-[110px_1fr_auto_1fr]">
                        <span className="text-sm font-semibold text-gray-700">{row.label}</span>
                        <input
                          type="time"
                          value={form[row.open as keyof BranchForm] as string}
                          onChange={event => setForm({ ...form, [row.open]: event.target.value })}
                          required
                          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-[#DB0002] focus:outline-none focus:ring-2 focus:ring-red-100"
                        />
                        <span className="text-center text-gray-400">–</span>
                        <input
                          type="time"
                          value={form[row.close as keyof BranchForm] as string}
                          onChange={event => setForm({ ...form, [row.close]: event.target.value })}
                          required
                          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-[#DB0002] focus:outline-none focus:ring-2 focus:ring-red-100"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-100">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-semibold hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="px-6 py-2.5 bg-[#DB0002] text-white rounded-lg text-sm font-semibold hover:bg-[#B80002] transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : editingBranch ? 'Update Shop' : 'Save Shop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
