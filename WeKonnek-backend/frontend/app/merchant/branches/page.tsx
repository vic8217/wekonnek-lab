'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Branch {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  operatingHours: any;
  isActive: boolean;
  is_active: boolean;
  staff_count: number;
}

interface BranchForm {
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  operatingHours: string;
}

const EMPTY_FORM: BranchForm = {
  name: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  phone: '',
  operatingHours: '',
};

export default function MerchantBranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [merchantId, setMerchantId] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

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
      toast.error('Failed to load branches');
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

  const openAddModal = () => {
    setEditingBranch(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEditModal = (branch: Branch) => {
    setEditingBranch(branch);
    setForm({
      name: branch.name,
      address: branch.address || '',
      city: branch.city || '',
      state: branch.state || '',
      zipCode: branch.zipCode || '',
      phone: branch.phone || '',
      operatingHours: branch.operatingHours ? JSON.stringify(branch.operatingHours) : '',
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('Branch name is required');
      return;
    }
    if (!merchantId) return;
    setSaving(true);
    const token = getToken();

    const payload: any = {
      name: form.name,
      address: form.address || null,
      city: form.city || null,
      state: form.state || null,
      zip_code: form.zipCode || null,
      phone: form.phone || null,
    };

    if (form.operatingHours.trim()) {
      try {
        payload.operating_hours = JSON.parse(form.operatingHours);
      } catch {
        toast.error('Operating hours must be valid JSON');
        setSaving(false);
        return;
      }
    }

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
        throw new Error(err.message || 'Failed to save branch');
      }

      toast.success(editingBranch ? 'Branch updated' : 'Branch created');
      setShowModal(false);
      await fetchBranches(merchantId);
    } catch (error: any) {
      toast.error(error.message || 'Failed to save branch');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (branchId: number) => {
    if (!window.confirm('Delete this branch? This action cannot be undone.')) return;
    const token = getToken();

    try {
      const res = await fetch(`${API}/api/branches/${branchId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to delete');
      toast.success('Branch deleted');
      if (merchantId) await fetchBranches(merchantId);
    } catch {
      toast.error('Failed to delete branch');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading branches…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Branches</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your business locations</p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 bg-[#DB0002] text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#B80002] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Branch
        </button>
      </div>

      {/* Branch Cards */}
      {branches.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <p className="text-gray-600 font-semibold">No branches yet</p>
          <p className="text-gray-400 text-sm mt-1">Add your first branch to get started</p>
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
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ml-2 ${
                  (branch.isActive ?? branch.is_active) ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                }`}>
                  {(branch.isActive ?? branch.is_active) ? 'Active' : 'Inactive'}
                </span>
              </div>

              {branch.address && (
                <p className="text-sm text-gray-600 mb-2 line-clamp-2">{branch.address}</p>
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
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(branch.id)}
                  className="px-3 py-2 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                {editingBranch ? 'Edit Branch' : 'Add Branch'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Branch Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
                  placeholder="e.g. Main Branch"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Operating Hours (JSON)</label>
                <textarea
                  value={form.operatingHours}
                  onChange={(e) => setForm({ ...form, operatingHours: e.target.value })}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002] resize-none"
                  placeholder='{"mon-fri": "8:00-17:00", "sat": "9:00-14:00"}'
                />
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
                {saving ? 'Saving…' : editingBranch ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
