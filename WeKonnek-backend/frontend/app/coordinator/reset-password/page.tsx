'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, KeyRound, LockKeyhole } from 'lucide-react';

export default function CoordinatorResetPasswordPage() {
  const searchParams = useSearchParams();
  const [resetKey, setResetKey] = useState(searchParams.get('key') || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setMessage('');
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const response = await fetch('/api/backend/coordinator-applications/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetKey: resetKey.trim(), newPassword }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Unable to change password');
      setMessage('Password changed successfully. You can now sign in.');
      setNewPassword(''); setConfirmPassword('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to change password'); }
    finally { setLoading(false); }
  };

  return <main className="flex min-h-screen items-center justify-center bg-[#f5f8fc] p-5"><div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
    <span className="flex size-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><KeyRound size={24} /></span>
    <h1 className="mt-5 text-2xl font-black text-slate-900">Reset coordinator password</h1>
    <p className="mt-2 text-sm leading-5 text-slate-500">Enter the one-time reset key provided by an administrator. Reset keys expire after 30 minutes.</p>
    {message ? <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mr-2 inline" size={18} />{message}<Link href="/coordinator/login" className="mt-3 block font-bold underline">Return to coordinator login</Link></div> :
    <form onSubmit={submit} className="mt-6 space-y-4">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <label className="block text-xs font-black text-slate-600">RESET KEY<input value={resetKey} onChange={event => setResetKey(event.target.value)} required className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 font-mono text-sm outline-none focus:border-blue-500" placeholder="WKR-…" /></label>
      <label className="block text-xs font-black text-slate-600">NEW PASSWORD<div className="relative mt-2"><LockKeyhole className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input type="password" minLength={8} value={newPassword} onChange={event => setNewPassword(event.target.value)} required className="h-12 w-full rounded-xl border border-slate-300 pl-11 pr-4 text-sm outline-none focus:border-blue-500" /></div></label>
      <label className="block text-xs font-black text-slate-600">CONFIRM PASSWORD<input type="password" minLength={8} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-4 text-sm outline-none focus:border-blue-500" /></label>
      <button disabled={loading} className="h-12 w-full rounded-xl bg-blue-600 font-black text-white disabled:opacity-60">{loading ? 'Changing password…' : 'Change password'}</button>
      <Link href="/coordinator/login" className="block text-center text-xs font-bold text-blue-600">Back to login</Link>
    </form>}
  </div></main>;
}
