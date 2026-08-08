'use client';

import { useState, useEffect } from 'react';
import { useAuth, getToken } from '@/hooks/use-auth';
import Image from 'next/image';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function CustomerProfilePage() {
  const { user: authUser, loading: authLoading, signOut } = useAuth();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('profile');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
  });

  // Account settings
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [language, setLanguage] = useState('English');
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    try {
      setNotifEnabled(localStorage.getItem('wk_notif_enabled') !== 'false');
      setLanguage(localStorage.getItem('wk_language') || 'English');
    } catch {
      /* ignore */
    }
  }, []);

  const toggleNotif = () => {
    setNotifEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('wk_notif_enabled', String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const cycleLanguage = () => {
    setLanguage((prev) => {
      const next = prev === 'English' ? 'Filipino' : 'English';
      try {
        localStorage.setItem('wk_language', next);
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleChangePassword = async () => {
    setPwdError(null);
    if (pwd.next.length < 8) {
      setPwdError('New password must be at least 8 characters.');
      return;
    }
    if (pwd.next !== pwd.confirm) {
      setPwdError('New passwords do not match.');
      return;
    }
    try {
      setPwdSaving(true);
      const token = await getToken();
      const res = await fetch(`${API}/api/users/me/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwd.current, newPassword: pwd.next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to change password.');
      }
      setPwdSuccess(true);
      setPwd({ current: '', next: '', confirm: '' });
      setTimeout(() => {
        setShowPasswordModal(false);
        setPwdSuccess(false);
      }, 1200);
    } catch (err: any) {
      setPwdError(Array.isArray(err.message) ? err.message.join(' ') : err.message);
    } finally {
      setPwdSaving(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await signOut('/customer/dashboard');
    } catch {
      setLoggingOut(false);
    }
  };

  const connectIdentity = async (provider: 'google' | 'facebook' | 'apple') => {
    try {
      const token = await getToken();
      const response = await fetch(`${API}/api/auth/oauth/${provider}/link/start`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || `Could not connect ${provider}.`);
      window.location.assign(body.authorizationUrl);
    } catch (error: any) { toast.error(error.message || 'Could not connect that sign-in method.'); }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!authUser) { setLoading(false); return; }

    const fetchProfile = async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API}/api/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to fetch profile');
        const profile = await res.json();

        if (profile) {
          setUser(profile);
          setFormData({
            firstName: profile.first_name || profile.firstName || '',
            lastName: profile.last_name || profile.lastName || '',
            email: profile.email || '',
            phone: profile.phone || '',
            address: '',
          });
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
        setFormData({
          firstName: authUser.firstName || '',
          lastName: authUser.lastName || '',
          email: authUser.email || '',
          phone: '',
          address: '',
        });
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [authUser, authLoading]);

  const handleUpdateProfile = async () => {
    try {
      setSaving(true);
      const token = await getToken();
      if (!token) return;

      const res = await fetch(`${API}/api/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          first_name: formData.firstName,
          last_name: formData.lastName,
          phone: formData.phone,
        }),
      });

      if (!res.ok) throw new Error('Failed to update profile');

      toast.success('Profile updated successfully!');
      setIsEditing(false);

      const profileRes = await fetch(`${API}/api/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        if (profile) setUser(profile);
      }
    } catch (error: any) {
      console.error('Error updating profile:', error);
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-3 border-[#DB0002] border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const fullName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'User';
  const initials = fullName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <>
      {/* ========== MOBILE PROFILE ========== */}
      <div className="lg:hidden min-h-screen bg-gray-50">
        {/* Profile Hero */}
        <div className="bg-gradient-to-br from-[#DB0002] to-[#8B0001] px-4 pt-6 pb-10 relative overflow-hidden">
          {/* Decorative circles */}
          <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/5 rounded-full" />
          <div className="absolute -bottom-16 -left-8 w-32 h-32 bg-white/5 rounded-full" />

          <div className="relative flex flex-col items-center">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center text-2xl font-bold text-[#DB0002] shadow-lg mb-3">
              {initials}
            </div>
            <h1 className="text-lg font-bold text-white">{fullName}</h1>
            <p className="text-white/70 text-xs mt-0.5">{user?.email}</p>
            <span className="mt-2 px-3 py-0.5 bg-white/20 text-white text-[10px] font-semibold rounded-full capitalize">
              {user?.user_type || 'Customer'}
            </span>
          </div>
        </div>

        {/* Content pulled up */}
        <div className="-mt-4 px-4 space-y-3 pb-6">
          {/* Quick Stats */}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-lg font-bold text-gray-900">0</p>
              <p className="text-[10px] text-gray-400 font-medium">Orders</p>
            </div>
            <div className="border-x border-gray-100">
              <p className="text-lg font-bold text-gray-900">0</p>
              <p className="text-[10px] text-gray-400 font-medium">Reviews</p>
            </div>
            <div>
              <p className="text-lg font-bold text-gray-900">0</p>
              <p className="text-[10px] text-gray-400 font-medium">Favorites</p>
            </div>
          </div>

          {/* Personal Information */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
              <h2 className="text-sm font-bold text-gray-900">Personal Information</h2>
              {!isEditing ? (
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-[#DB0002] text-xs font-semibold mobile-press"
                >
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setIsEditing(false);
                      setFormData({
                        firstName: user?.first_name || '',
                        lastName: user?.last_name || '',
                        email: user?.email || '',
                        phone: user?.phone || '',
                        address: '',
                      });
                    }}
                    className="text-gray-400 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateProfile}
                    disabled={saving}
                    className="text-[#DB0002] text-xs font-semibold disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-gray-400 font-medium mb-1 uppercase tracking-wider">First Name</label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                    disabled={!isEditing}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none disabled:bg-gray-50 disabled:text-gray-600 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 font-medium mb-1 uppercase tracking-wider">Last Name</label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                    disabled={!isEditing}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none disabled:bg-gray-50 disabled:text-gray-600 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-gray-400 font-medium mb-1 uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  value={formData.email}
                  disabled
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 text-gray-500"
                />
              </div>

              <div>
                <label className="block text-[10px] text-gray-400 font-medium mb-1 uppercase tracking-wider">Phone Number</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  disabled={!isEditing}
                  placeholder="+63 9XX XXX XXXX"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none disabled:bg-gray-50 disabled:text-gray-600 transition-colors"
                />
              </div>

              <div>
                <label className="block text-[10px] text-gray-400 font-medium mb-1 uppercase tracking-wider">Address</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                  disabled={!isEditing}
                  placeholder="Enter your address"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none disabled:bg-gray-50 disabled:text-gray-600 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Account Settings */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50">
              <h2 className="text-sm font-bold text-gray-900">Account Settings</h2>
            </div>
            <div>
              <div className="px-4 py-3.5 border-b border-gray-50">
                <p className="text-xs font-semibold text-gray-500 mb-2">CONNECTED SIGN-IN METHODS</p>
                <div className="flex gap-2">{(['google', 'facebook', 'apple'] as const).map(provider => <button key={provider} onClick={() => connectIdentity(provider)} className="flex-1 rounded-lg border px-2 py-2 text-xs font-semibold capitalize hover:bg-gray-50">{provider}</button>)}</div>
              </div>
              {/* Change Password */}
              <button
                onClick={() => {
                  setPwdError(null);
                  setShowPasswordModal(true);
                }}
                className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 active:bg-gray-50 transition-colors text-left"
              >
                <span className="text-base">🔒</span>
                <span className="flex-1 text-sm text-gray-700 font-medium">Change Password</span>
                <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Notification Preferences */}
              <div className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-gray-50">
                <span className="text-base">🔔</span>
                <span className="flex-1 text-sm text-gray-700 font-medium">Notifications</span>
                <button
                  onClick={toggleNotif}
                  role="switch"
                  aria-checked={notifEnabled}
                  aria-label="Toggle notifications"
                  className={`relative w-11 h-6 rounded-full transition-colors ${notifEnabled ? 'bg-[#DB0002]' : 'bg-gray-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notifEnabled ? 'translate-x-5' : ''}`} />
                </button>
              </div>

              {/* Language */}
              <button
                onClick={cycleLanguage}
                className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 active:bg-gray-50 transition-colors text-left"
              >
                <span className="text-base">🌐</span>
                <span className="flex-1 text-sm text-gray-700 font-medium">Language</span>
                <span className="text-xs text-gray-400">{language}</span>
                <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {/* Privacy Policy */}
              <a
                href="/privacy"
                className="w-full flex items-center gap-3 px-4 py-3.5 active:bg-gray-50 transition-colors text-left"
              >
                <span className="text-base">🛡️</span>
                <span className="flex-1 text-sm text-gray-700 font-medium">Privacy Policy</span>
                <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-50">
              <h2 className="text-sm font-bold text-gray-900">Quick Links</h2>
            </div>
            <div>
              {[
                // Wallet hidden for now
                { emoji: '📍', label: 'My Addresses', href: '/customer/addresses' },
                { emoji: '🎁', label: 'Deals & Vouchers', href: '/customer/deals' },
                { emoji: '📅', label: 'Bookings', href: '/customer/bookings' },
                { emoji: '⭐', label: 'My Reviews', href: '/customer/reviews' },
              ].map((item, idx) => (
                <a
                  key={idx}
                  href={item.href}
                  className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 last:border-0 active:bg-gray-50 transition-colors text-left"
                >
                  <span className="text-base">{item.emoji}</span>
                  <span className="flex-1 text-sm text-gray-700 font-medium">{item.label}</span>
                  <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-white rounded-2xl shadow-sm border border-gray-100 text-[#DB0002] font-semibold text-sm active:bg-red-50 transition-colors disabled:opacity-60"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {loggingOut ? 'Logging out...' : 'Log Out'}
          </button>
        </div>
      </div>

      {/* ========== DESKTOP PROFILE ========== */}
      <div className="hidden lg:block space-y-6">
        {/* Profile Header Banner */}
        <div className="relative bg-gradient-to-r from-red-600 to-purple-700 rounded-lg p-8 text-white">
          <div className="flex items-center space-x-6">
            <div className="relative">
              <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center text-2xl font-bold text-gray-800">
                {initials}
              </div>
              <button className="absolute bottom-0 right-0 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg" title="Change photo">
                <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-bold mb-2">{fullName}</h1>
              <p className="text-white/90">{user?.email}</p>
            </div>
            <div>
              <span className="px-4 py-2 bg-red-600 rounded-lg font-medium capitalize">
                {user?.user_type || 'Customer'}
              </span>
            </div>
          </div>
        </div>

        {/* Main Content Card */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="border-b border-gray-200">
            <div className="flex space-x-1 px-6">
              {[
                { id: 'profile', label: 'Profile', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
                { id: 'transactions', label: 'Transactions', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
                { id: 'favorites', label: 'Favorites', icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-6 py-4 flex items-center space-x-2 font-medium transition-colors border-b-2 ${
                    activeTab === tab.id
                      ? 'border-red-600 text-red-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
                  </svg>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="p-6">
            {activeTab === 'profile' && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">Personal Information</h2>
                    <p className="text-gray-600">Update your personal details and contact information</p>
                  </div>
                  {!isEditing && (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      Edit Profile
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">First Name</label>
                    <input
                      type="text"
                      value={formData.firstName}
                      onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                      disabled={!isEditing}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Last Name</label>
                    <input
                      type="text"
                      value={formData.lastName}
                      onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                      disabled={!isEditing}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                    <input
                      type="email"
                      value={formData.email}
                      disabled
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Phone Number</label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                      disabled={!isEditing}
                      placeholder="+63 9123 456 7890"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
                    <input
                      type="text"
                      value={formData.address}
                      onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                      disabled={!isEditing}
                      placeholder="123 Mabuti Street, City, Province"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100"
                    />
                  </div>
                </div>

                {isEditing && (
                  <div className="flex justify-end space-x-4 mt-6">
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setFormData({
                          firstName: user?.first_name || '',
                          lastName: user?.last_name || '',
                          email: user?.email || '',
                          phone: user?.phone || '',
                          address: '',
                        });
                      }}
                      className="px-6 py-2 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleUpdateProfile}
                      disabled={saving}
                      className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'transactions' && (
              <div className="text-center py-12">
                <p className="text-gray-500">No transactions yet</p>
              </div>
            )}

            {activeTab === 'favorites' && (
              <div className="text-center py-12">
                <p className="text-gray-500">No favorites yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Account Settings (desktop) */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Account Settings</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2 flex items-center gap-2 px-4 py-3 border border-gray-200 rounded-lg"><span className="text-sm font-medium text-gray-700 mr-auto">Connect a sign-in method</span>{(['google', 'facebook', 'apple'] as const).map(provider => <button key={provider} onClick={() => connectIdentity(provider)} className="rounded-md border px-3 py-1.5 text-sm font-semibold capitalize hover:bg-gray-50">{provider}</button>)}</div>
            <button
              onClick={() => {
                setPwdError(null);
                setShowPasswordModal(true);
              }}
              className="flex items-center justify-between px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-gray-700 font-medium">🔒 Change Password</span>
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
            <div className="flex items-center justify-between px-4 py-3 border border-gray-200 rounded-lg">
              <span className="flex items-center gap-2 text-gray-700 font-medium">🔔 Notifications</span>
              <button
                onClick={toggleNotif}
                role="switch"
                aria-checked={notifEnabled}
                aria-label="Toggle notifications"
                className={`relative w-11 h-6 rounded-full transition-colors ${notifEnabled ? 'bg-[#DB0002]' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${notifEnabled ? 'translate-x-5' : ''}`} />
              </button>
            </div>
            <button
              onClick={cycleLanguage}
              className="flex items-center justify-between px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2 text-gray-700 font-medium">🌐 Language</span>
              <span className="text-sm text-gray-500">{language}</span>
            </button>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center justify-center gap-2 px-4 py-3 border border-red-200 text-[#DB0002] font-semibold rounded-lg hover:bg-red-50 transition-colors disabled:opacity-60"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
              {loggingOut ? 'Logging out...' : 'Log Out'}
            </button>
          </div>
        </div>
      </div>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center bg-black/50 p-0 lg:p-4" onClick={() => !pwdSaving && setShowPasswordModal(false)}>
          <div className="bg-white w-full lg:max-w-md rounded-t-2xl lg:rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-gray-900">Change Password</h3>
              <button onClick={() => !pwdSaving && setShowPasswordModal(false)} className="text-gray-400 p-1" aria-label="Close">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {pwdSuccess ? (
              <div className="py-8 text-center">
                <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </div>
                <p className="text-sm font-semibold text-gray-900">Password updated!</p>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="password"
                  value={pwd.current}
                  onChange={(e) => setPwd((p) => ({ ...p, current: e.target.value }))}
                  placeholder="Current password"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                />
                <input
                  type="password"
                  value={pwd.next}
                  onChange={(e) => setPwd((p) => ({ ...p, next: e.target.value }))}
                  placeholder="New password (min 8 characters)"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                />
                <input
                  type="password"
                  value={pwd.confirm}
                  onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))}
                  placeholder="Confirm new password"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                />
                {pwdError && <p className="text-xs text-red-600">{pwdError}</p>}
                <button
                  onClick={handleChangePassword}
                  disabled={pwdSaving}
                  className="w-full py-3 bg-[#DB0002] text-white rounded-xl font-semibold text-sm disabled:opacity-60"
                >
                  {pwdSaving ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
