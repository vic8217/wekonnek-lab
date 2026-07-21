'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface StaffMember {
  id: number;
  merchantId: number;
  userId: string;
  branchId: number | null;
  role: string;
  isActive: boolean;
  is_active: boolean;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    avatar: string | null;
  };
  branch: { id: number; name: string } | null;
}

interface BranchOption {
  id: number;
  name: string;
}

const ROLES = ['owner', 'manager', 'cashier', 'staff'] as const;

const ROLE_BADGE: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-800',
  manager: 'bg-blue-100 text-blue-800',
  cashier: 'bg-green-100 text-green-800',
  staff: 'bg-gray-100 text-gray-700',
};

export default function MerchantStaffPage() {
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [merchantId, setMerchantId] = useState<number | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState<string>('staff');
  const [formBranchId, setFormBranchId] = useState<string>('');
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

  const fetchStaff = async (mId: number) => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/merchants/${mId}/staff`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setStaffList(await res.json());
    } catch {
      toast.error('Failed to load staff');
    }
  };

  const fetchBranches = async (mId: number) => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/merchants/${mId}/branches`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setBranches(await res.json());
    } catch {}
  };

  useEffect(() => {
    const init = async () => {
      const mId = await fetchMerchant();
      if (mId) {
        setMerchantId(mId);
        await Promise.all([fetchStaff(mId), fetchBranches(mId)]);
      }
      setLoading(false);
    };
    init();
  }, []);

  const openAddModal = () => {
    setEditingStaff(null);
    setFormEmail('');
    setFormRole('staff');
    setFormBranchId('');
    setShowModal(true);
  };

  const openEditModal = (member: StaffMember) => {
    setEditingStaff(member);
    setFormEmail(member.user.email || '');
    setFormRole(member.role);
    setFormBranchId(member.branchId?.toString() || '');
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!merchantId) return;
    setSaving(true);
    const token = getToken();

    try {
      if (editingStaff) {
        const res = await fetch(`${API}/api/merchant-staff/${editingStaff.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            role: formRole,
            branch_id: formBranchId ? Number(formBranchId) : null,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Failed to update staff');
        }
        toast.success('Staff updated');
      } else {
        const identifier = formEmail.trim();
        if (!identifier) {
          toast.error('Email or phone number is required');
          setSaving(false);
          return;
        }
        const identityField = identifier.includes('@')
          ? { email: identifier }
          : { phone: identifier };
        const res = await fetch(`${API}/api/merchants/${merchantId}/staff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ...identityField,
            role: formRole,
            branch_id: formBranchId ? Number(formBranchId) : null,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Failed to add staff');
        }
        toast.success('Staff member added');
      }
      setShowModal(false);
      await fetchStaff(merchantId);
    } catch (error: any) {
      toast.error(error.message || 'Operation failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (staffId: number) => {
    if (!window.confirm('Remove this staff member?')) return;
    const token = getToken();

    try {
      const res = await fetch(`${API}/api/merchant-staff/${staffId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to remove');
      toast.success('Staff member removed');
      if (merchantId) await fetchStaff(merchantId);
    } catch {
      toast.error('Failed to remove staff member');
    }
  };

  const staffName = (s: StaffMember) => {
    const first = s.user.firstName || '';
    const last = s.user.lastName || '';
    return (first + ' ' + last).trim() || s.user.email || 'Unknown';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading staff…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff</h1>
          <p className="text-sm text-gray-500 mt-1">Manage your team members and their roles</p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 bg-[#DB0002] text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-[#B80002] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Staff
        </button>
      </div>

      {/* Staff Table */}
      {staffList.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-gray-600 font-semibold">No staff members yet</p>
          <p className="text-gray-400 text-sm mt-1">Add team members to help manage your business</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-5 py-3 font-semibold text-gray-700">Name</th>
                  <th className="text-left px-5 py-3 font-semibold text-gray-700">Email</th>
                  <th className="text-left px-5 py-3 font-semibold text-gray-700">Role</th>
                  <th className="text-left px-5 py-3 font-semibold text-gray-700">Branch</th>
                  <th className="text-left px-5 py-3 font-semibold text-gray-700">Status</th>
                  <th className="text-right px-5 py-3 font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {staffList.map((member) => (
                  <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-xs font-bold text-gray-600">
                          {(member.user.firstName?.[0] || member.user.email?.[0] || '?').toUpperCase()}
                        </div>
                        <span className="font-medium text-gray-900">{staffName(member)}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-600">{member.user.email || '—'}</td>
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${ROLE_BADGE[member.role] || ROLE_BADGE.staff}`}>
                        {member.role}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-gray-600">{member.branch?.name || '—'}</td>
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        (member.isActive ?? member.is_active) ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {(member.isActive ?? member.is_active) ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(member)}
                          className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-semibold hover:bg-gray-200 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleRemove(member.id)}
                          className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                {editingStaff ? 'Edit Staff Member' : 'Add Staff Member'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4">
              {!editingStaff && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email or Phone Number *</label>
                  <input
                    type="text"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
                    placeholder="staff@example.com or 0917xxxxxxxx"
                  />
                  <p className="text-xs text-gray-400 mt-1">The user must have a WeKonnek account. Most accounts sign up with a phone number.</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assign to Branch</label>
                <select
                  value={formBranchId}
                  onChange={(e) => setFormBranchId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
                >
                  <option value="">No branch assigned</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
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
                {saving ? 'Saving…' : editingStaff ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
