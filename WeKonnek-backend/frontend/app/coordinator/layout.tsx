'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BellRing, ClipboardList, LayoutDashboard, LogOut, Megaphone, Menu, Star, WalletCards, X } from 'lucide-react';
import { getToken, useAuth, useRequireAuth } from '@/hooks/use-auth';

const navigation = [
	{ href: '/coordinator/dashboard', label: 'Dashboard', icon: LayoutDashboard },
	{ href: '/coordinator/applications', label: 'Merchant Onboarding', icon: ClipboardList },
	{ href: '/coordinator/reviews', label: 'Reviews & Ratings', icon: Star },
	{ href: '/coordinator/wallet', label: 'Coordinator Wallet', icon: WalletCards },
	{ href: '/coordinator/dashboard#materials', label: 'Marketing Materials', icon: WalletCards },
	{ href: '/coordinator/dashboard#announcements', label: 'Announcements', icon: Megaphone },
];

export default function CoordinatorLayout({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	if (pathname === '/coordinator' || pathname === '/coordinator/login' || pathname === '/coordinator/reset-password') return children;
	return <ProtectedCoordinatorLayout>{children}</ProtectedCoordinatorLayout>;
}

function ProtectedCoordinatorLayout({ children }: { children: React.ReactNode }) {
	const { user, loading } = useRequireAuth(['coordinator', 'admin'], '/coordinator');
	const { signOut } = useAuth();
	const pathname = usePathname();
	const [mobileOpen, setMobileOpen] = useState(false);
	const [unassignedLeadCount, setUnassignedLeadCount] = useState(0);
	useEffect(() => {
		const loadCount = async () => {
			const response = await fetch('/api/backend/merchant-applications/coordinator/leads', { headers: { Authorization: `Bearer ${getToken()}` } });
			if (!response.ok) return;
			const leads = await response.json();
			setUnassignedLeadCount(Array.isArray(leads) ? leads.filter(item => item.assignment_status === 'unassigned').length : 0);
		};
		if (user) loadCount();
		window.addEventListener('coordinator-leads-updated', loadCount);
		return () => window.removeEventListener('coordinator-leads-updated', loadCount);
	}, [user]);
	if (loading || !user) return <div className="flex min-h-screen items-center justify-center bg-[#f5f8fc]"><Image src="/images/weKonnekLogov1.png" alt="WeKonnek" width={1536} height={1024} className="h-20 w-auto animate-pulse" /></div>;
	const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Zone Coordinator';
	const pageTitle = pathname === '/coordinator/applications' ? 'Merchant Onboarding' : pathname === '/coordinator/reviews' ? 'Reviews & Ratings' : pathname === '/coordinator/wallet' ? 'Coordinator Wallet' : 'Coordinator Dashboard';
	const sidebar = <aside className="flex h-full w-[232px] flex-col border-r border-[#d7e0ed] bg-white p-3">
		<Link href="/" className="flex items-center gap-2 px-2 py-4"><Image src="/images/weKonnekLogov1.png" alt="WeKonnek" width={1536} height={1024} className="h-11 w-auto" /><div><p className="text-sm font-black"><span className="text-[#075cff]">WE</span><span className="text-red-600">KONNEK</span></p><p className="text-[10px] text-slate-500">Coordinator Portal</p></div></Link>
		<nav className="mt-5 space-y-1">{navigation.map(({ href, label, icon: Icon }) => { const active = !href.includes('#') && pathname === href; return <Link key={label} href={href} onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${active ? 'bg-[#075cff] text-white' : 'text-[#365078] hover:bg-blue-50'}`}><Icon size={18} /><span className="min-w-0 flex-1">{label}</span>{label === 'Merchant Onboarding' && unassignedLeadCount > 0 && <span className={`flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-black ${active ? 'bg-white text-[#075cff]' : 'bg-red-600 text-white'}`}>{unassignedLeadCount > 99 ? '99+' : unassignedLeadCount}</span>}</Link>; })}</nav>
		<div className="mt-auto rounded-2xl bg-[#f0f3ff] p-4"><WalletCards className="text-[#075cff]" /><p className="mt-4 text-sm font-black">Grow your earnings</p><p className="mt-1 text-xs leading-4 text-slate-600">Onboard active merchants and help them grow.</p></div>
		<button onClick={() => signOut('/coordinator')} className="mt-3 flex items-center gap-2 px-4 py-3 text-sm font-semibold text-red-600"><LogOut size={17} /> Sign out</button>
	</aside>;
	return <div className="min-h-screen bg-[#f4f6f8] lg:pl-[232px]">
		<div className="fixed inset-y-0 left-0 z-40 hidden lg:block">{sidebar}</div>
		{mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} /><div className="relative h-full w-[232px]">{sidebar}<button onClick={() => setMobileOpen(false)} className="absolute right-3 top-3"><X size={20} /></button></div></div>}
		<header className="flex h-[76px] items-center justify-between border-b border-[#d7e0ed] bg-white px-5 lg:px-7"><div className="flex items-center gap-3"><button onClick={() => setMobileOpen(true)} className="lg:hidden"><Menu /></button><div><h1 className="text-sm font-black">{pageTitle}</h1><p className="text-xs text-slate-500">{user.firstName || 'Coordinator'}</p></div></div><div className="flex items-center gap-5"><BellRing size={19} className="text-slate-500" /><div className="text-right"><p className="text-sm font-black">{name}</p><p className="text-xs text-slate-500">Zone Coordinator</p></div></div></header>
		<main className="p-5 lg:p-10">{children}</main>
	</div>;
}
