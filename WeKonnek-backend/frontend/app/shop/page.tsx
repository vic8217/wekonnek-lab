'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Store } from 'lucide-react';
import { setAuth, useAuth, type AuthUser } from '@/hooks/use-auth';

type ShopLoginResponse = {
  message?: string;
  access_token?: string;
  user?: {
    id: string;
    email?: string | null;
    phone: string;
    firstName?: string | null;
    first_name?: string | null;
    lastName?: string | null;
    last_name?: string | null;
  };
  shop?: {
    id: number;
    name: string;
    branch_name: string;
    shop_id: string;
    merchant_id: number;
    merchant_name: string;
    is_default: boolean;
  };
};

export default function ShopLoginPage() {
  const router = useRouter();
  const { refreshAuth } = useAuth();
  const [shopId, setShopId] = useState('');
  const [passkey, setPasskey] = useState('');
  const [showPasskey, setShowPasskey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/shop-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, passkey }),
      });
      const text = await response.text();
      let body: ShopLoginResponse = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = { message: response.ok ? 'The server returned an invalid response' : text };
      }
      if (!response.ok) throw new Error(body.message || 'Invalid or expired shop credentials');
      if (!body.user || !body.shop || !body.access_token) throw new Error('The server returned an incomplete login response');
      const apiUser = body.user;
      const user: AuthUser = {
        id: apiUser.id,
        email: apiUser.email ?? undefined,
        phone: apiUser.phone,
        firstName: apiUser.firstName ?? apiUser.first_name ?? body.shop?.name ?? 'Shop',
        lastName: apiUser.lastName ?? apiUser.last_name ?? null,
        role: 'merchant',
        userType: 'merchant',
      };
      setAuth(body.access_token, user, 'shop');
      sessionStorage.setItem('wk_active_shop', JSON.stringify(body.shop));
      await refreshAuth();
      router.replace('/shop/dashboard');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to open the shop portal');
    } finally {
      setLoading(false);
    }
  }

  return <main className="grid min-h-screen bg-[#f7f9fc] lg:grid-cols-2">
    <section className="relative hidden overflow-hidden bg-gradient-to-br from-[#061330] to-[#22477f] p-12 text-white lg:flex lg:flex-col">
      <div className="flex items-center gap-3"><Image src="/images/weKonnekLogov1.png" alt="WeKonnek" width={1536} height={1024} priority className="h-14 w-auto" /><div><p className="font-black"><span className="text-[#075cff]">WE</span><span className="text-red-500">KONNEK</span></p><p className="text-[10px] text-slate-400">Shop Portal</p></div></div>
      <div className="my-auto max-w-xl"><p className="text-sm font-black tracking-[.25em] text-blue-300">SHOP OPERATIONS</p><h1 className="mt-7 text-5xl font-black leading-tight">Run your shop.<br />Serve with WeKonnek.</h1><p className="mt-6 text-lg leading-7 text-slate-300">Open the operational interface assigned to this shop using credentials provided by your merchant administrator.</p></div>
      <p className="text-sm text-slate-400">Restricted to authorized WeKonnek shops</p>
    </section>
    <section className="flex items-center justify-center p-5 sm:p-10"><div className="w-full max-w-md rounded-[28px] border border-[#ccd8e9] bg-white p-8 shadow-[0_20px_45px_rgba(26,48,83,.15)]">
      <span className="flex size-12 items-center justify-center rounded-xl bg-blue-50 text-[#075cff]"><Store size={24} /></span><h2 className="mt-6 text-3xl font-black">Shop Login</h2><p className="mt-2 text-sm text-slate-500">Sign in with credentials created by your merchant administrator.</p>
      <form onSubmit={handleSubmit} className="mt-7 space-y-5">{error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <label className="block text-xs font-black text-slate-600">SHOP ID<div className="relative mt-2"><KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input value={shopId} onChange={event => setShopId(event.target.value.toUpperCase())} required autoComplete="username" placeholder="WKS-..." className="h-13 w-full rounded-xl border border-[#ccd8e9] pl-12 pr-4 text-sm font-semibold uppercase tracking-wider outline-none focus:border-[#075cff] focus:ring-2 focus:ring-blue-100" /></div></label>
        <label className="block text-xs font-black text-slate-600">PASSKEY<div className="relative mt-2"><LockKeyhole className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input type={showPasskey ? 'text' : 'password'} value={passkey} onChange={event => setPasskey(event.target.value)} required autoComplete="current-password" placeholder="Enter the daily passkey" className="h-13 w-full rounded-xl border border-[#ccd8e9] px-12 text-sm outline-none focus:border-[#075cff] focus:ring-2 focus:ring-blue-100" /><button type="button" onClick={() => setShowPasskey(value => !value)} aria-label={showPasskey ? 'Hide passkey' : 'Show passkey'} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">{showPasskey ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
        <button disabled={loading} className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-[#1749e8] font-black text-white shadow-md transition hover:bg-[#0b3bd0] disabled:opacity-60">{loading ? 'Opening Shop…' : 'Open Shop Portal'} {!loading && <ArrowRight size={18} />}</button>
      </form><p className="mt-6 text-center text-xs leading-5 text-slate-400">The passkey is valid for one day. Ask your merchant administrator for the current passkey.</p>
    </div></section>
  </main>;
}
