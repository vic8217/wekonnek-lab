'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { setAuth, useAuth, type AuthUser } from '@/hooks/use-auth';

export default function AdminLoginPage() {
	const router = useRouter();
	const { refreshAuth } = useAuth();
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	async function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		setLoading(true);
		setError('');
		let timeout: number | undefined;
		try {
			const controller = new AbortController();
			timeout = window.setTimeout(() => controller.abort(), 12_000);
			const response = await fetch('/api/auth/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, password }),
				signal: controller.signal,
			});
			const contentType = response.headers.get('content-type') || '';
			const body = contentType.includes('application/json')
				? await response.json().catch(() => ({ message: 'Authentication service returned an invalid response. Please try again.' }))
				: { message: response.ok ? '' : 'Authentication service is temporarily unavailable. Please try again.' };
			if (!response.ok) throw new Error(body.message || 'Invalid email address or password');
			if (!body.access_token || !body.user) throw new Error('Authentication service returned an incomplete response. Please try again.');
			const apiUser = body.user;
			const role = apiUser.role ?? apiUser.user_type;
			if (role !== 'admin' && role !== 'staff') throw new Error('This account is not authorized for administration.');
			const user: AuthUser = {
				id: apiUser.id, email: apiUser.email, phone: apiUser.phone,
				firstName: apiUser.firstName ?? apiUser.first_name ?? null,
				lastName: apiUser.lastName ?? apiUser.last_name ?? null,
				role, userType: role,
			};
			setAuth(body.access_token, user);
			await refreshAuth();
			router.replace('/admin/dashboard');
		} catch (err) {
			setError(err instanceof Error && err.name === 'AbortError' ? 'Authentication request timed out. Please try again.' : err instanceof Error ? err.message : 'Unable to sign in. Please try again.');
		} finally {
			if (timeout !== undefined) window.clearTimeout(timeout);
			setLoading(false);
		}
	}

	return <main className="grid min-h-screen bg-[#f7f9fc] lg:grid-cols-2">
		<section className="relative hidden overflow-hidden bg-gradient-to-br from-[#061330] to-[#22477f] p-12 text-white lg:flex lg:flex-col">
			<div className="flex items-center gap-3"><Image src="/images/weKonnekLogov1.png" alt="WeKonnek" width={1536} height={1024} priority className="h-14 w-auto" /><div><p className="font-black"><span className="text-[#075cff]">WE</span><span className="text-red-500">KONNEK</span></p><p className="text-[10px] text-slate-400">Administration</p></div></div>
			<div className="my-auto max-w-xl"><p className="text-sm font-black tracking-[.25em] text-blue-300">SECURE OPERATIONS</p><h1 className="mt-7 text-5xl font-black leading-tight">Manage the entire<br />WeKonnek platform.</h1><p className="mt-6 text-lg leading-7 text-slate-300">Oversee merchants, customers, coordinators, orders, promotions, wallets, reports, and integrations.</p></div>
			<p className="text-sm text-slate-400">Restricted to authorized administrators</p>
	</section>

		<section className="flex items-center justify-center p-5 sm:p-10">
			<div className="w-full max-w-md rounded-[28px] border border-[#ccd8e9] bg-white p-8 shadow-[0_20px_45px_rgba(26,48,83,.15)]">
				<span className="flex size-12 items-center justify-center rounded-xl bg-blue-50 text-[#075cff]"><ShieldCheck size={24} /></span>
				<h2 className="mt-6 text-3xl font-black">Admin Login</h2><p className="mt-2 text-sm text-slate-500">Sign in with an authorized administrator account.</p>
				<form onSubmit={handleSubmit} className="mt-7 space-y-5">
					{error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
					<label className="block text-xs font-black text-slate-600">EMAIL ADDRESS<div className="relative mt-2"><Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="admin@wekonnek.com" className="h-13 w-full rounded-xl border border-[#ccd8e9] pl-12 pr-4 text-sm outline-none focus:border-[#075cff] focus:ring-2 focus:ring-blue-100" /></div></label>
					<label className="block text-xs font-black text-slate-600">PASSWORD<div className="relative mt-2"><LockKeyhole className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" placeholder="Enter your password" className="h-13 w-full rounded-xl border border-[#ccd8e9] px-12 text-sm outline-none focus:border-[#075cff] focus:ring-2 focus:ring-blue-100" /><button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
					<button disabled={loading} className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#1749e8] font-black text-white shadow-md transition hover:bg-[#0b3bd0] disabled:opacity-60">{loading ? 'Signing In…' : 'Open Admin Dashboard'} {!loading && <ArrowRight size={18} />}</button>
				</form>
				<p className="mt-6 text-center text-xs leading-5 text-slate-400">Access is checked against your assigned WeKonnek administrator role.</p>
			</div>
		</section>
	</main>;
}
