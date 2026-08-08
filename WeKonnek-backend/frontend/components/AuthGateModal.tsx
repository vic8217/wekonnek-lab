'use client';

import { useEffect, useState } from 'react';
import { getToken, getUser, useAuth, setAuth, type AuthUser } from '@/hooks/use-auth';
import toast from 'react-hot-toast';

const API = '';

interface AuthGateModalProps {
  open: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
  title?: string;
  subtitle?: string;
}

function mapApiUser(apiUser: any): AuthUser {
  return {
    id: apiUser.id,
    email: apiUser.email ?? undefined,
    phone: apiUser.phone ?? undefined,
    firstName: apiUser.firstName ?? apiUser.first_name ?? null,
    lastName: apiUser.lastName ?? apiUser.last_name ?? null,
    role: apiUser.role ?? apiUser.user_type ?? 'customer',
    userType: (apiUser.role ?? apiUser.user_type ?? 'customer') as AuthUser['userType'],
  };
}

export default function AuthGateModal({
  open,
  onClose,
  onAuthenticated,
  title = 'Sign in to continue',
  subtitle = 'Your details are saved — just sign in to confirm.',
}: AuthGateModalProps) {
  const { user, refreshAuth } = useAuth();
  const [mode, setMode] = useState<'signin' | 'phone'>('signin');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');

  useEffect(() => {
    if (!open) return;
    const storedUser = getUser();
    if ((user?.userType === 'customer' || storedUser?.userType === 'customer') && getToken()) {
      onAuthenticated();
    }
  }, [open, user, onAuthenticated]);

  if (!open) return null;

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Invalid credentials');
      const authenticatedUser = mapApiUser(body.user);
      if (authenticatedUser.userType !== 'customer') {
        throw new Error('Bazaar posting requires a separate WeKonnek customer account.');
      }
      setAuth(body.access_token, authenticatedUser);
      await refreshAuth();
      toast.success('Signed in successfully!');
      onAuthenticated();
    } catch (err: any) {
      setAuthError(err.message || 'Failed to sign in');
      toast.error(err.message || 'Failed to sign in');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSendOtp = async () => {
    if (!phone.trim()) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API}/api/auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || 'Failed to send OTP');
      }
      setOtpSent(true);
      toast.success('OTP sent to your phone!');
    } catch (err: any) {
      setAuthError(err.message || 'Failed to send OTP');
      toast.error(err.message || 'Failed to send OTP');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const res = await fetch(`${API}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: otp }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Invalid OTP');
      setAuth(body.access_token, mapApiUser(body.user));
      await refreshAuth();
      toast.success('Signed in successfully!');
      onAuthenticated();
    } catch (err: any) {
      setAuthError(err.message || 'Invalid OTP');
      toast.error(err.message || 'Invalid OTP');
    } finally {
      setAuthLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 p-6 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
          title="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-7 h-7 text-[#DB0002]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
        </div>

        <div className="mb-5 rounded-xl bg-gray-100 px-4 py-3 text-center text-sm font-semibold text-gray-700">Sign in with email or mobile number and password</div>

        {authError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{authError}</div>
        )}

        {mode === 'signin' ? (
          <form onSubmit={handleEmailSignIn} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email or mobile number</label>
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com or 0917 123 4567"
                required
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 bg-[#DB0002] text-white rounded-xl font-bold text-sm disabled:opacity-50 hover:bg-[#B80002] transition-colors"
            >
              {authLoading ? 'Signing in...' : 'Sign In & Continue'}
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+63 9XX XXX XXXX"
                  className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                />
                {!otpSent && (
                  <button
                    onClick={handleSendOtp}
                    disabled={authLoading || !phone.trim()}
                    className="px-4 py-3 bg-[#DB0002] text-white rounded-xl font-semibold text-sm disabled:opacity-50 hover:bg-[#B80002] transition-colors whitespace-nowrap"
                  >
                    {authLoading ? '...' : 'Send OTP'}
                  </button>
                )}
              </div>
            </div>
            {otpSent && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Enter OTP</label>
                  <input
                    type="text"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    placeholder="6-digit code"
                    maxLength={6}
                    required
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-center tracking-widest font-mono focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002] outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-3 bg-[#DB0002] text-white rounded-xl font-bold text-sm disabled:opacity-50 hover:bg-[#B80002] transition-colors"
                >
                  {authLoading ? 'Verifying...' : 'Verify & Continue'}
                </button>
                <button
                  type="button"
                  onClick={() => { setOtpSent(false); setOtp(''); }}
                  className="w-full text-sm text-gray-500 hover:text-gray-700"
                >
                  Resend OTP
                </button>
              </form>
            )}
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400">
            Don&apos;t have an account?{' '}
            <a href="/auth/login" className="text-[#DB0002] font-semibold hover:underline">Register here</a>
          </p>
        </div>
      </div>
    </div>
  );
}
