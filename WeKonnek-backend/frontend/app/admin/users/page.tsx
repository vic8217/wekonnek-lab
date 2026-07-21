'use client';

import { useState, useEffect } from 'react';
import { getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface PlatformUser {
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
  isVerified: boolean;
  is_verified?: boolean;
  createdAt: string;
  created_at?: string;
  avatar: string | null;
}

type RoleFilter = 'all' | 'customer' | 'merchant' | 'rider' | 'staff' | 'admin';

const ROLE_TABS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'customer', label: 'Customers' },
  { key: 'merchant', label: 'Merchants' },
  { key: 'rider', label: 'Riders' },
  { key: 'staff', label: 'Staff' },
  { key: 'admin', label: 'Admin' },
];

const ROLE_BADGE: Record<string, string> = {
  customer: 'bg-blue-100 text-blue-800',
  merchant: 'bg-purple-100 text-purple-800',
  rider: 'bg-orange-100 text-orange-800',
  driver: 'bg-orange-100 text-orange-800',
  staff: 'bg-green-100 text-green-800',
  admin: 'bg-red-100 text-red-800',
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchUsers = async () => {
    const token = getToken();
    if (!token) { setLoading(false); return; }

    try {
      const res = await fetch(`${API}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(Array.isArray(data) ? data : []);
      }
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const toggleUserActive = async (user: PlatformUser) => {
    const token = getToken();
    const currentlyActive = user.isActive ?? user.is_active ?? true;
    const action = currentlyActive ? 'suspend' : 'activate';
    if (!window.confirm(`${currentlyActive ? 'Suspend' : 'Activate'} ${userName(user)}?`)) return;

    try {
      const res = await fetch(`${API}/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isActive: !currentlyActive }),
      });
      if (!res.ok) throw new Error(`Failed to ${action} user`);
      toast.success(`User ${action}d`);
      await fetchUsers();
    } catch (error: any) {
      toast.error(error.message || `Failed to ${action} user`);
    }
  };

  const userName = (u: PlatformUser) => {
    const first = u.firstName ?? u.first_name ?? '';
    const last = u.lastName ?? u.last_name ?? '';
    return (first + ' ' + last).trim() || u.email || u.phone || 'Unknown';
  };

  const formatDate = (iso: string | undefined) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const filtered = users.filter((u) => {
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = userName(u).toLowerCase();
      const email = (u.email || '').toLowerCase();
      if (!name.includes(q) && !email.includes(q)) return false;
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading users…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <p className="text-sm text-gray-500 mt-1">View and manage all platform users</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {ROLE_TABS.map((tab) => {
          const count = tab.key === 'all'
            ? users.length
            : users.filter((u) => u.role === tab.key).length;
          return (
            <button
              key={tab.key}
              onClick={() => setRoleFilter(tab.key)}
              className={`p-3 rounded-xl border text-center transition-colors ${
                roleFilter === tab.key
                  ? 'bg-[#DB0002] text-white border-[#DB0002]'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <p className="text-lg font-bold">{count}</p>
              <p className="text-xs font-medium mt-0.5">{tab.label}</p>
            </button>
          );
        })}
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
          placeholder="Search by name or email…"
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002]"
        />
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3 font-semibold text-gray-700">User</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-700">Email</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-700">Role</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-left px-5 py-3 font-semibold text-gray-700">Joined</th>
                <th className="text-right px-5 py-3 font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-gray-500">
                    No users found
                  </td>
                </tr>
              ) : (
                filtered.map((user) => {
                  const active = user.isActive ?? user.is_active ?? true;
                  return (
                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-xs font-bold text-gray-600">
                            {userName(user)[0]?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{userName(user)}</p>
                            <p className="text-xs text-gray-400">{user.phone}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-gray-600">{user.email || '—'}</td>
                      <td className="px-5 py-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${ROLE_BADGE[user.role] || 'bg-gray-100 text-gray-700'}`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {active ? 'Active' : 'Suspended'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-gray-600 text-xs">
                        {formatDate(user.createdAt ?? user.created_at)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => toggleUserActive(user)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            active
                              ? 'bg-red-50 text-red-600 hover:bg-red-100'
                              : 'bg-green-50 text-green-600 hover:bg-green-100'
                          }`}
                        >
                          {active ? 'Suspend' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
