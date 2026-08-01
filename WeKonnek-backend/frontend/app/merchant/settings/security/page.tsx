'use client';

import { useState, useEffect } from 'react';
import { getToken, useAuth } from '@/hooks/use-auth';
import Image from 'next/image';
import Link from 'next/link';
import ChangePasswordModal from '@/components/ChangePasswordModal';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

type Step = 'idle' | 'loading' | 'qr' | 'confirm-disable';

export default function SecuritySettingsPage() {
  const { user, refreshAuth } = useAuth();
  const [twoFaEnabled, setTwoFaEnabled] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [step, setStep] = useState<Step>('idle');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const passwordChangeRequired = Boolean(user?.mustChangePassword);

  const headers = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getToken()}`,
  });

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/users/me/2fa/status`, { headers: headers() });
        if (res.ok) {
          const data = await res.json();
          setTwoFaEnabled(data.enabled);
        }
      } catch {
        /* ignore */
      } finally {
        setStatusLoading(false);
      }
    })();
  }, []);

  const handleSetup = async () => {
    setStep('loading');
    setError(null);
    try {
      const res = await fetch(`${API}/api/users/me/2fa/setup`, {
        method: 'POST',
        headers: headers(),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Setup failed');
      const data = await res.json();
      setQrDataUrl(data.qrDataUrl);
      setSecret(data.secret);
      setStep('qr');
    } catch (e: any) {
      setError(e.message);
      setStep('idle');
    }
  };

  const handleVerify = async () => {
    setError(null);
    if (otpCode.length !== 6) {
      setError('Enter a 6-digit code');
      return;
    }
    try {
      const res = await fetch(`${API}/api/users/me/2fa/verify`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ token: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Verification failed');
      setTwoFaEnabled(true);
      setStep('idle');
      setOtpCode('');
      setSuccess('Two-factor authentication has been enabled successfully!');
      setTimeout(() => setSuccess(null), 5000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDisable = async () => {
    setError(null);
    if (otpCode.length !== 6) {
      setError('Enter a 6-digit code to confirm');
      return;
    }
    try {
      const res = await fetch(`${API}/api/users/me/2fa`, {
        method: 'DELETE',
        headers: headers(),
        body: JSON.stringify({ token: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to disable');
      setTwoFaEnabled(false);
      setStep('idle');
      setOtpCode('');
      setSuccess('Two-factor authentication has been disabled.');
      setTimeout(() => setSuccess(null), 5000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/merchant/dashboard"
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Security Settings</h1>
          <p className="text-sm text-gray-500">Manage two-factor authentication</p>
        </div>
      </div>

      {/* Success / Error Banners */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* 2FA Status Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${twoFaEnabled ? 'bg-green-100' : 'bg-gray-100'}`}>
            <svg className={`w-6 h-6 ${twoFaEnabled ? 'text-green-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900">
              2FA is {statusLoading ? '...' : twoFaEnabled ? 'Enabled' : 'Disabled'}
            </h2>
            <p className="text-sm text-gray-500">
              {twoFaEnabled
                ? 'Your account is protected with two-factor authentication'
                : 'Enable 2FA to secure your account with Google Authenticator'}
            </p>
          </div>
          <span className={`w-3 h-3 rounded-full flex-shrink-0 ${twoFaEnabled ? 'bg-green-500' : 'bg-gray-300'}`} />
        </div>
      </div>

      {/* Google Authenticator Section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-600" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Google Authenticator</h3>
            <p className="text-sm text-gray-500">
              Use the Google Authenticator app on your phone to generate time-based
              one-time passwords (TOTP) for login verification.
            </p>
          </div>
        </div>

        {/* ─── Idle state: show setup or disable button ─── */}
        {step === 'idle' && !twoFaEnabled && (
          <button
            onClick={handleSetup}
            className="w-full bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
            Set Up Google Authenticator
          </button>
        )}

        {step === 'idle' && twoFaEnabled && (
          <button
            onClick={() => { setStep('confirm-disable'); setOtpCode(''); setError(null); }}
            className="w-full border border-red-300 text-red-600 py-3 rounded-lg font-medium hover:bg-red-50 transition-colors"
          >
            Disable Two-Factor Authentication
          </button>
        )}

        {step === 'loading' && (
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* ─── QR + verify step ─── */}
        {step === 'qr' && (
          <div className="space-y-5">
            <div className="bg-gray-50 rounded-lg p-6 text-center space-y-3">
              <p className="text-sm font-medium text-gray-700">
                Scan this QR code with Google Authenticator
              </p>
              {qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="2FA QR Code"
                  className="mx-auto w-48 h-48"
                />
              )}
              <div className="text-xs text-gray-500">
                <p className="mb-1">Or enter this key manually:</p>
                <code className="bg-white px-3 py-1.5 rounded border border-gray-200 font-mono text-sm select-all break-all">
                  {secret}
                </code>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter the 6-digit code from your authenticator app
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-2xl tracking-[0.5em] font-mono focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setStep('idle'); setOtpCode(''); setError(null); }}
                className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleVerify}
                disabled={otpCode.length !== 6}
                className="flex-1 bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Verify & Enable
              </button>
            </div>
          </div>
        )}

        {/* ─── Disable confirmation step ─── */}
        {step === 'confirm-disable' && (
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-amber-800">
                Enter a code from your authenticator app to confirm disabling 2FA.
                Your account will be less secure after this.
              </p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-2xl tracking-[0.5em] font-mono focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setStep('idle'); setOtpCode(''); setError(null); }}
                className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDisable}
                disabled={otpCode.length !== 6}
                className="flex-1 bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Disable 2FA
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Change Password */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Password</h3>
              <p className="text-sm text-gray-500">Change your account password</p>
            </div>
          </div>
          <button
            onClick={() => setShowPasswordModal(true)}
            className="px-4 py-2 text-sm font-medium text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
          >
            Change
          </button>
        </div>
      </div>

      <ChangePasswordModal
        isOpen={showPasswordModal || passwordChangeRequired}
        onClose={() => setShowPasswordModal(false)}
        required={passwordChangeRequired}
        onChanged={refreshAuth}
      />
    </div>
  );
}
