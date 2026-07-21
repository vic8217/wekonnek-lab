'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken, useAuth } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface ProfileForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatarUrl: string;
}

const MOCK_PROFILE: ProfileForm = {
  firstName: 'Juan',
  lastName: 'dela Cruz',
  email: 'juan.delacruz@email.com',
  phone: '+639171234567',
  avatarUrl: '',
};

export default function EditProfilePage() {
  const router = useRouter();
  const { user: authUser, refreshAuth } = useAuth();

  const [form, setForm] = useState<ProfileForm>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    avatarUrl: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const fetchProfile = async () => {
    try {
      const token = getToken();
      if (!token) throw new Error('No token');

      const res = await fetch(`${API}/api/users/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed');

      const data = await res.json();
      const profile = data.data || data;
      setForm({
        firstName: profile.firstName || profile.first_name || '',
        lastName: profile.lastName || profile.last_name || '',
        email: profile.email || '',
        phone: profile.phone || '',
        avatarUrl: profile.avatarUrl || profile.avatar_url || '',
      });
    } catch {
      setForm(MOCK_PROFILE);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/users/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      await refreshAuth();
      setToast('Profile updated successfully!');
    } catch {
      setToast('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const update = (field: keyof ProfileForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const initials =
    (form.firstName?.[0] || '') + (form.lastName?.[0] || '') || '?';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all ${
            toast.includes('success') ? 'bg-green-500' : 'bg-red-500'
          }`}
        >
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-gray-900">Edit Profile</h1>
      </div>

      {/* Avatar */}
      <div className="flex flex-col items-center mb-8">
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#DB0002] to-red-600 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
            {form.avatarUrl ? (
              <img src={form.avatarUrl} alt="Avatar" className="w-full h-full rounded-full object-cover" />
            ) : (
              initials.toUpperCase()
            )}
          </div>
          <button className="absolute bottom-0 right-0 w-8 h-8 bg-white shadow-md rounded-full flex items-center justify-center border border-gray-200 hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-3">Tap camera to change photo</p>
      </div>

      {/* Form */}
      <form onSubmit={handleSave} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">First Name</label>
          <input
            type="text"
            value={form.firstName}
            onChange={(e) => update('firstName', e.target.value)}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002] transition-all"
            placeholder="First name"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Last Name</label>
          <input
            type="text"
            value={form.lastName}
            onChange={(e) => update('lastName', e.target.value)}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002] transition-all"
            placeholder="Last name"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#DB0002]/30 focus:border-[#DB0002] transition-all"
            placeholder="your@email.com"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
          <div className="relative">
            <input
              type="tel"
              value={form.phone}
              readOnly
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-500 cursor-not-allowed"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">Phone number cannot be changed</p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-3.5 bg-[#DB0002] text-white font-semibold rounded-xl hover:bg-red-700 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed mt-4"
        >
          {saving ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving...
            </span>
          ) : (
            'Save Changes'
          )}
        </button>
      </form>
    </div>
  );
}
