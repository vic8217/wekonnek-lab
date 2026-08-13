'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { getToken, getUser, useAuth, setAuth, type AuthUser } from '@/hooks/use-auth';
import toast from 'react-hot-toast';
import { ArrowRight, CalendarDays, Eye, EyeOff, Mail, Moon, ShoppingBag, Sun, Sunrise, Tag, UserRound, UserRoundPlus, UtensilsCrossed } from 'lucide-react';

// Keep backend addresses server-side so a bad build-time environment value
// can never make a production browser connect to localhost.
const API_URL = '';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshAuth } = useAuth();
  const redirectTo = searchParams.get('redirect');
  const [activeTab, setActiveTab] = useState<'signin' | 'register'>('signin');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(true);
  const [greeting, setGreeting] = useState({ title: 'Good Morning!', icon: 'morning' });

  // Sign In Form State
  const [signInData, setSignInData] = useState({
    email: '',
    password: '',
  });

  const [registerStep, setRegisterStep] = useState<'method' | 'otp' | 'profile'>('method');
  const [mobile, setMobile] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [deliveryStatus, setDeliveryStatus] = useState<'sent' | 'unavailable'>('sent');
  const [cooldown, setCooldown] = useState(0);
  const [profile, setProfile] = useState({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' });
  const [pendingToken, setPendingToken] = useState('');
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [registerData, setRegisterData] = useState({ firstName: '', lastName: '', email: '', password: '', confirmPassword: '' });

  const handleSignInChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setSignInData(prev => ({ ...prev, [name]: value }));
  };
  const handleRegisterChange = (e: React.ChangeEvent<HTMLInputElement>) => setRegisterData(previous => ({ ...previous, [e.target.name]: e.target.value }));
  const handleRegister = (e: React.FormEvent) => e.preventDefault();

  const deviceHeaders = () => {
    let id = localStorage.getItem('wekonnek_device_id');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('wekonnek_device_id', id); }
    return { 'Content-Type': 'application/json', 'X-Device-Id': id };
  };

  const saveSession = async (body: any) => {
    const apiUser = body.user;
    const authUser: AuthUser = { id: apiUser.id, email: apiUser.email ?? undefined, phone: apiUser.phone ?? undefined, firstName: apiUser.firstName ?? null, lastName: apiUser.lastName ?? null, role: apiUser.role ?? 'customer', userType: apiUser.role ?? 'customer' };
    setAuth(body.access_token ?? body.accessToken, authUser); await refreshAuth();
  };

  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour >= 5 && hour < 12
      ? { title: 'Good Morning!', icon: 'morning' }
      : hour >= 12 && hour < 18
        ? { title: 'Good Afternoon!', icon: 'afternoon' }
        : { title: 'Good Evening!', icon: 'evening' });
  }, []);

  useEffect(() => {
    const oauthCode = searchParams.get('oauth_code');
    if (!oauthCode) return;
    setActiveTab('register'); setLoading(true);
    fetch('/api/auth/oauth/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: oauthCode }) })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Social sign-in could not be completed.'); await saveSession(body); setPendingToken(body.access_token ?? body.accessToken); setProfile({ firstName: body.user.firstName || '', lastName: body.user.lastName || '', email: body.user.email || '', password: '', confirmPassword: '' }); setRegisterStep(body.needsMobileVerification ? 'method' : body.needsProfile ? 'profile' : 'method'); if (!body.needsMobileVerification && !body.needsProfile) router.replace(redirectTo || '/customer/dashboard'); })
      .catch(error => setError(error.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (!cooldown) return; const timer = window.setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1000); return () => clearInterval(timer); }, [cooldown]);

  const performPasswordSignIn = async (identifier: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier,
          password,
        }),
      });

      const body = await res.json();

      if (!res.ok) {
        throw new Error(body.message || 'Invalid login credentials');
      }

      const { access_token, user: apiUser } = body;
      if (!access_token || !apiUser) throw new Error('Sign-in response was incomplete. Please try again.');
      const authUser: AuthUser = {
        id: apiUser.id,
        email: apiUser.email ?? undefined,
        phone: apiUser.phone ?? undefined,
        firstName: apiUser.firstName ?? apiUser.first_name ?? null,
        lastName: apiUser.lastName ?? apiUser.last_name ?? null,
        role: apiUser.role ?? apiUser.user_type ?? 'customer',
        userType: (apiUser.role ?? apiUser.user_type ?? 'customer') as any,
      };

      // Verify the issued token before persisting or navigating. A failure is
      // shown here instead of allowing a protected-route redirect loop.
      const verification = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${access_token}` }, cache: 'no-store' });
      if (!verification.ok) throw new Error('Your credentials were accepted, but the session could not be verified. Restart the backend and try again.');

      setAuth(access_token, authUser);
      const persistedUser = getUser();
      if (!getToken() || persistedUser?.id !== authUser.id) {
        throw new Error('The browser blocked the customer session from being saved. Allow site storage and try again.');
      }

      const userType = authUser.role;
      const portalDestination =
        userType === 'coordinator'
          ? '/coordinator/dashboard'
          : userType === 'admin' || userType === 'staff'
            ? '/admin/dashboard'
            : null;

      // Privileged sessions use portal-specific storage. A full navigation
      // initializes AuthProvider against the destination portal's namespace.
      if (portalDestination) {
        // Never allow a redirect captured from one portal to send a
        // privileged session into another portal's route guard.
        window.location.assign(portalDestination);
        return;
      }

      if (userType === 'merchant') {
        window.location.assign('/merchant/dashboard');
        return;
      }

      // Normal customer sign-in always opens Home. Bazaar posting is the one
      // intentional resume-after-login workflow and returns to its form.
      const safeCustomerRedirect = redirectTo === '/bazaar/post'
        ? '/bazaar/post'
        : '/customer/dashboard';
      // A full navigation starts the destination with the already persisted
      // customer session and avoids a race with the login page's AuthProvider.
      window.location.replace(safeCustomerRedirect);
    } catch (error: any) {
      console.error('Sign in error:', error);
      const errorMessage = error.message || 'Failed to sign in. Please try again.';
      setError(errorMessage);
      toast.error(errorMessage);
      setTimeout(() => setError(null), 5000);
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    await performPasswordSignIn(signInData.email, signInData.password);
  };

  const beginSocial = async (provider: 'google' | 'facebook' | 'apple') => {
    setLoading(true); setError(null);
    try { const response = await fetch(`/api/auth/oauth/${provider}/start`); const body = await response.json(); if (!response.ok) throw new Error(body.message || `${provider} sign-in is unavailable.`); window.location.assign(body.authorizationUrl); }
    catch (error: any) { setError(error.message); setLoading(false); }
  };

  const requestOtp = async (channel?: 'sms' | 'whatsapp') => {
    setLoading(true); setError(null);
    try {
      const url = channel ? `/api/auth/otp/${challengeId}/send` : pendingToken ? '/api/auth/mobile/start' : '/api/auth/send-otp';
      const response = await fetch(url, { method: 'POST', headers: { ...deviceHeaders(), ...(pendingToken ? { Authorization: `Bearer ${pendingToken}` } : {}) }, body: JSON.stringify(channel ? { channel } : { phone: `+63${mobile.replace(/\D/g, '').replace(/^0/, '')}` }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Could not send a verification code.');
      setChallengeId(body.challengeId); setMaskedPhone(body.maskedPhone); setDeliveryStatus(body.deliveryStatus); setRegisterStep('otp'); setOtp(['', '', '', '', '', '']); setCooldown(body.deliveryStatus === 'unavailable' ? 0 : 60);
      if (body.devOtp) toast.success(`Development OTP: ${body.devOtp}`); else toast.success(body.message);
    } catch (error: any) { setError(error.message); } finally { setLoading(false); }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError(null);
    try { const response = await fetch('/api/auth/verify-otp', { method: 'POST', headers: deviceHeaders(), body: JSON.stringify({ challengeId, code: otp.join('') }) }); const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Verification failed.'); await saveSession(body); setPendingToken(body.access_token ?? body.accessToken); setProfile({ firstName: body.user.firstName || '', lastName: body.user.lastName || '', email: body.user.email || '', password: '', confirmPassword: '' }); if (body.needsProfile) setRegisterStep('profile'); else router.replace(redirectTo || '/customer/dashboard'); }
    catch (error: any) { setError(error.message); } finally { setLoading(false); }
  };

  const completeProfile = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (profile.password.length < 8) { setError('Create a password with at least 8 characters.'); return; }
    if (profile.password !== profile.confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try { const response = await fetch('/api/auth/complete-profile', { method: 'POST', headers: { ...deviceHeaders(), Authorization: `Bearer ${pendingToken}` }, body: JSON.stringify({ firstName: profile.firstName, lastName: profile.lastName, email: profile.email, password: profile.password }) }); const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Could not save your profile.'); router.replace(redirectTo || '/customer/dashboard'); }
    catch (error: any) { setError(error.message); } finally { setLoading(false); }
  };

  const updateOtp = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1); const next = [...otp]; next[index] = digit; setOtp(next); if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const pasteOtp = (event: React.ClipboardEvent) => { const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6); if (digits.length === 6) { event.preventDefault(); setOtp(digits.split('')); otpRefs.current[5]?.focus(); } };

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#071333] lg:grid lg:grid-cols-[minmax(520px,.92fr)_minmax(0,1.08fr)]">
      <Image src="/images/customer-auth-storefront.png" alt="Local WeKonnek storefront connected to nearby dining, shopping, and community services" fill priority sizes="100vw" className="pointer-events-none -z-20 object-cover object-center" />
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-white/35 via-[#d9e9ff]/10 to-transparent" />
      <section className="relative order-2 hidden min-h-screen overflow-hidden px-10 py-9 text-white lg:flex lg:flex-col xl:px-16">
        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col">
          <div className="flex flex-1 flex-col items-start pt-2 text-left">
            <Image src="/images/weKonnekLogov1.png" alt="WeKonnek" width={1536} height={1024} priority className="h-24 w-28 object-contain drop-shadow-xl xl:h-28 xl:w-32" />
            <h1 className="mt-1 text-5xl font-black leading-[1.02] tracking-tight drop-shadow-lg xl:text-6xl">Welcome to<br/><span className="text-[#2f71ff]">WeKonnek</span></h1>
            <p className="mt-6 max-w-xl text-lg font-medium leading-8 text-white drop-shadow-md xl:text-xl">Discover local businesses, shop, dine,<br/>book services, and more — all in one place.</p>
          </div>
          <div className="absolute inset-x-0 bottom-0 grid grid-cols-4 overflow-hidden rounded-3xl border border-white/60 bg-white/95 text-[#12192b] shadow-[0_18px_50px_rgba(0,0,0,.24)] backdrop-blur">
            {[
              [ShoppingBag, 'Shop Local', 'Find great products from nearby stores'],
              [UtensilsCrossed, 'Dine & Order', 'Order food, reserve tables, and more'],
              [CalendarDays, 'Book Services', 'Book appointments and services easily'],
              [Tag, 'Exclusive Deals', 'Enjoy discounts and exclusive offers'],
            ].map(([Icon, title, text], index) => <div key={String(title)} className={`p-5 text-center ${index ? 'border-l border-slate-200' : ''}`}><Icon className={`mx-auto ${index % 2 ? 'text-red-600' : 'text-[#075cff]'}`} size={29}/><h2 className="mt-3 text-sm font-black text-[#12192b]">{String(title)}</h2><p className="mt-2 text-xs leading-5 text-slate-600">{String(text)}</p></div>)}
          </div>
        </div>
      </section>

      <section className="order-1 flex min-h-screen items-center justify-center px-4 py-7 sm:px-8 lg:px-10">
        <div className="w-full max-w-[590px]">
          <div className="mb-5 text-center lg:hidden"><Image src="/images/weKonnekLogov1.png" alt="WeKonnek" width={120} height={80} className="mx-auto h-20 w-24 object-contain"/><h1 className="text-3xl font-black text-[#071333]">Welcome to <span className="text-[#075cff]">WeKonnek</span></h1></div>
          <div className="rounded-[28px] border border-white/80 bg-white p-6 shadow-[0_22px_60px_rgba(28,71,137,.16)] sm:p-9">
          <div className="mb-7 text-center">
            <span className="mx-auto flex size-14 items-center justify-center text-amber-500">{greeting.icon === 'morning' ? <Sunrise size={48}/> : greeting.icon === 'afternoon' ? <Sun size={46}/> : <Moon size={42}/>}</span>
            <h2 className="mt-2 text-3xl font-black text-[#071333]">{greeting.title}</h2>
            <p className="mt-1 text-base text-[#17223b]">Sign in to start shopping local</p>
          </div>

          {/* Tabs */}
          <div>
            <div className="mb-7 flex rounded-xl bg-[#f1f3f8] p-1">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('signin');
                  setError(null);
                }}
                className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg px-4 font-bold transition-colors ${
                  activeTab === 'signin'
                    ? 'bg-white text-[#075cff] shadow-md'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <UserRound size={18}/>
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('register');
                  setError(null);
                }}
                className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg px-4 font-bold transition-colors ${
                  activeTab === 'register'
                    ? 'bg-white text-[#075cff] shadow-md'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <UserRoundPlus size={18}/>
                Register
              </button>
            </div>

            {/* Sign In Form */}
            {activeTab === 'signin' && (
              <form onSubmit={handleSignIn} className="space-y-4">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {error}
                    {error.includes('Invalid login credentials') && (
                      <div className="mt-2 text-xs">
                        <p>Don't have an account? Switch to the Register tab to create one.</p>
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-3">
                  {(['google', 'facebook', 'apple'] as const).map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      disabled={loading}
                      onClick={() => beginSocial(provider)}
                      className="relative flex min-h-14 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-12 font-bold text-[#12192b] capitalize transition hover:border-blue-200 hover:bg-blue-50/40 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      <span className="absolute left-5 text-xl font-black normal-case">{provider === 'google' ? <span className="text-[#4285f4]">G</span> : provider === 'facebook' ? <span className="flex size-6 items-center justify-center rounded-full bg-[#1877f2] text-sm text-white">f</span> : <span className="text-black">●</span>}</span>
                      Continue with {provider}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="h-px flex-1 bg-gray-200" />
                  <span>or sign in with email</span>
                  <span className="h-px flex-1 bg-gray-200" />
                </div>
                {process.env.NODE_ENV !== 'production' && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void performPasswordSignIn('09175403565', '0000')}
                    className="w-full rounded-lg border border-dashed border-blue-300 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-800 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    {loading ? 'Signing in test customer…' : 'Sign in as temporary test customer'}
                  </button>
                )}
                <div>
                  <label htmlFor="signin-email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email or mobile number
                  </label>
                  <div className="relative"><input
                    type="text"
                    id="signin-email"
                    name="email"
                    value={signInData.email}
                    onChange={handleSignInChange}
                    required
                    inputMode="text"
                    autoComplete="username"
                    placeholder="juan@example.com or 0917 123 4567"
                    className="h-14 w-full rounded-xl border border-slate-300 px-4 pr-12 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  /><Mail className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" size={20}/></div>
                </div>

                <div>
                  <label htmlFor="signin-password" className="block text-sm font-medium text-gray-700 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="signin-password"
                      name="password"
                      value={signInData.password}
                      onChange={handleSignInChange}
                      required
                      placeholder="Enter your password"
                      className="h-14 w-full rounded-xl border border-slate-300 px-4 pr-12 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? <EyeOff size={20}/> : <Eye size={20}/>} 
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4 text-sm"><label className="flex cursor-pointer items-center gap-2 text-slate-700"><input type="checkbox" checked={rememberMe} onChange={event => setRememberMe(event.target.checked)} className="size-4 accent-[#075cff]"/>Remember me</label><button type="button" className="font-bold text-[#075cff] hover:underline">Forgot Password?</button></div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-[#f50012] font-black text-white shadow-[0_10px_24px_rgba(245,0,18,.24)] transition hover:bg-[#dc0010] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Signing In...' : <>Sign In <ArrowRight size={20}/></>}
                </button>
              </form>
            )}

            {activeTab === 'register' && <div className="space-y-4">
              {error && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}
              {registerStep === 'method' && <>
                <p className="text-center text-sm text-gray-600">Create your customer account in just a few steps.</p>
                {(['google', 'facebook', 'apple'] as const).map(provider => <button key={provider} type="button" disabled={loading} onClick={() => beginSocial(provider)} className="w-full min-h-12 border border-gray-300 rounded-lg bg-white font-semibold text-gray-800 hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-red-500 capitalize">Continue with {provider}</button>)}
                <div className="flex items-center gap-3 text-xs text-gray-500"><span className="h-px flex-1 bg-gray-200"/><span>or continue with mobile</span><span className="h-px flex-1 bg-gray-200"/></div>
                <label htmlFor="mobile" className="block text-sm font-medium text-gray-700">Philippine mobile number</label>
                <div className="flex rounded-lg border border-gray-300 focus-within:ring-2 focus-within:ring-red-500"><span className="px-4 py-3 bg-gray-50 rounded-l-lg font-medium">+63</span><input id="mobile" value={mobile} onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="tel" autoComplete="tel-national" placeholder="917 123 4567" className="min-w-0 flex-1 px-4 py-3 rounded-r-lg outline-none"/></div>
                <button type="button" onClick={() => requestOtp()} disabled={loading || mobile.replace(/\D/g, '').replace(/^0/, '').length !== 10} className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50">{loading ? 'Please wait…' : 'Continue'}</button>
              </>}
              {registerStep === 'otp' && <form onSubmit={verifyCode} className="space-y-4">
                <div className="text-center"><h2 className="text-xl font-bold text-gray-900">Verify your mobile</h2><p className="mt-1 text-sm text-gray-600">Enter the code sent to {maskedPhone}</p></div>
                {deliveryStatus === 'unavailable' && <p className="text-sm text-amber-700 bg-amber-50 p-3 rounded-lg">Viber is currently unavailable. Choose SMS or WhatsApp below.</p>}
                <div className="flex justify-center gap-2" onPaste={pasteOtp}>{otp.map((digit, index) => <input key={index} ref={element => { otpRefs.current[index] = element; }} aria-label={`OTP digit ${index + 1}`} value={digit} onChange={e => updateOtp(index, e.target.value)} onKeyDown={e => { if (e.key === 'Backspace' && !digit && index) otpRefs.current[index - 1]?.focus(); }} inputMode="numeric" pattern="[0-9]*" autoComplete={index === 0 ? 'one-time-code' : 'off'} maxLength={1} className="h-12 w-11 rounded-lg border border-gray-300 text-center text-xl font-bold focus:ring-2 focus:ring-red-500 outline-none"/>)}</div>
                <button type="submit" disabled={loading || otp.some(value => !value)} className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50">{loading ? 'Verifying…' : 'Verify & Continue'}</button>
                <div className="flex justify-center gap-4 text-sm"><button type="button" disabled={loading || cooldown > 0} onClick={() => requestOtp('sms')} className="text-red-600 disabled:text-gray-400">Send via SMS{cooldown ? ` (${cooldown}s)` : ''}</button><button type="button" disabled={loading || cooldown > 0} onClick={() => requestOtp('whatsapp')} className="text-green-700 disabled:text-gray-400">Send via WhatsApp</button></div>
                <button type="button" onClick={() => setRegisterStep('method')} className="w-full text-sm text-gray-600">Use a different number</button>
              </form>}
              {registerStep === 'profile' && <form onSubmit={completeProfile} className="space-y-4">
                <div><h2 className="text-xl font-bold">Complete your account</h2><p className="text-sm text-gray-600">Add your details and create a password for future sign-ins.</p></div>
                <input required aria-label="First name" placeholder="First name" value={profile.firstName} onChange={e => setProfile({...profile, firstName: e.target.value})} className="w-full px-4 py-3 border rounded-lg"/>
                <input required aria-label="Last name" placeholder="Last name" value={profile.lastName} onChange={e => setProfile({...profile, lastName: e.target.value})} className="w-full px-4 py-3 border rounded-lg"/>
                <input type="email" aria-label="Email (optional)" placeholder="Email (optional)" value={profile.email} onChange={e => setProfile({...profile, email: e.target.value})} className="w-full px-4 py-3 border rounded-lg"/>
                <input required type="password" autoComplete="new-password" minLength={8} aria-label="Create password" placeholder="Create password (at least 8 characters)" value={profile.password} onChange={e => setProfile({...profile, password: e.target.value})} className="w-full px-4 py-3 border rounded-lg"/>
                <input required type="password" autoComplete="new-password" minLength={8} aria-label="Confirm password" placeholder="Confirm password" value={profile.confirmPassword} onChange={e => setProfile({...profile, confirmPassword: e.target.value})} className="w-full px-4 py-3 border rounded-lg"/>
                <button disabled={loading} className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold">{loading ? 'Saving…' : 'Finish registration'}</button>
              </form>}
            </div>}

            {/* Retained only as unreachable markup during migration; existing password sign-in remains above. */}
            {false && activeTab === 'register' && (
              <form onSubmit={handleRegister} className="space-y-4">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="register-firstName" className="block text-sm font-medium text-gray-700 mb-2">
                      First Name
                    </label>
                    <input
                      type="text"
                      id="register-firstName"
                      name="firstName"
                      value={registerData.firstName}
                      onChange={handleRegisterChange}
                      required
                      placeholder="Juan"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="register-lastName" className="block text-sm font-medium text-gray-700 mb-2">
                      Last Name
                    </label>
                    <input
                      type="text"
                      id="register-lastName"
                      name="lastName"
                      value={registerData.lastName}
                      onChange={handleRegisterChange}
                      required
                      placeholder="Dela Cruz"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="register-email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="register-email"
                    name="email"
                    value={registerData.email}
                    onChange={handleRegisterChange}
                    required
                    placeholder="juan@example.com"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="register-password" className="block text-sm font-medium text-gray-700 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="register-password"
                      name="password"
                      value={registerData.password}
                      onChange={handleRegisterChange}
                      required
                      placeholder="Enter your password"
                      className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPassword ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="register-confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      id="register-confirmPassword"
                      name="confirmPassword"
                      value={registerData.confirmPassword}
                      onChange={handleRegisterChange}
                      required
                      placeholder="Confirm your password"
                      className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showConfirmPassword ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-red-600 text-white py-3 rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Registering...' : 'Register'}
                </button>
              </form>
            )}
          </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
