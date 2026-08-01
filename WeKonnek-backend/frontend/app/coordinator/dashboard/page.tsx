'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarChart3, ChevronRight, PackageCheck, ShoppingBag, Star, Store, WalletCards } from 'lucide-react';
import { getToken } from '@/hooks/use-auth';

type OnboardedMerchant = {
	id: number;
	business_name: string;
	merchant_code?: string;
	subscription_tier?: string;
	city_municipality?: string;
	geographic_area?: string;
	barangay?: string;
	assignment_status?: string;
	status: string;
};

export default function CoordinatorDashboardPage() {
	const [merchants, setMerchants] = useState<OnboardedMerchant[]>([]);
	const [loadingMerchants, setLoadingMerchants] = useState(true);
	const [merchantError, setMerchantError] = useState('');

	useEffect(() => {
		const loadMerchants = async () => {
			try {
				const response = await fetch('/api/backend/merchant-applications/coordinator/leads', {
					headers: { Authorization: `Bearer ${getToken()}` },
					cache: 'no-store',
				});
				const body = await response.json().catch(() => null);
				if (!response.ok) throw new Error(body?.message || 'Unable to load onboarded merchants.');
				const leads: OnboardedMerchant[] = Array.isArray(body) ? body : [];
				setMerchants(leads.filter(lead => lead.assignment_status === 'assigned' && lead.status === 'approved'));
			} catch (error) {
				setMerchantError(error instanceof Error ? error.message : 'Unable to load onboarded merchants.');
			} finally {
				setLoadingMerchants(false);
			}
		};
		loadMerchants();
	}, []);

	const stats = [
		{ icon: Store, label: 'Merchants onboarded', value: String(merchants.length), note: `${merchants.length} linked store${merchants.length === 1 ? '' : 's'}`, tone: 'bg-emerald-50 text-emerald-600' },
		{ icon: ShoppingBag, label: 'Online orders', value: '0', note: 'Delivery and pickup', tone: 'bg-blue-50 text-[#075cff]' },
		{ icon: PackageCheck, label: 'In-store orders', value: '0', note: 'Dine-in transactions', tone: 'bg-orange-50 text-orange-500' },
		{ icon: BarChart3, label: 'Attributed sales', value: '₱0.00', note: 'Non-cancelled orders', tone: 'bg-violet-50 text-violet-600' },
	];

	return <div className="w-full">
		<h2 className="text-2xl font-black text-[#071d43]">Welcome back, Coordinator!</h2><p className="mt-1 text-sm text-[#4d6385]">Here is your merchant network overview for the last 30 days.</p>
		<section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stats.map(({ icon: Icon, label, value, note, tone }) => <article key={label} className="rounded-2xl border border-[#d2ddea] bg-white p-4 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-[#365078]">{label}</p><p className="mt-1 text-2xl font-black text-[#071d43]">{value}</p></div><span className={`flex size-10 items-center justify-center rounded-xl ${tone}`}><Icon size={20} /></span></div><p className="mt-2 text-xs text-[#4d6385]">{note}</p></article>)}</section>
		<div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,2.1fr)_minmax(320px,1fr)]">
			<section id="onboarding" className="min-h-[350px] rounded-2xl border border-[#d2ddea] bg-white shadow-sm">
				<div className="flex items-center justify-between border-b border-[#d2ddea] p-5"><div><h3 className="font-black text-[#071d43]">My onboarded merchants</h3><p className="text-xs text-[#4d6385]">Approved merchants assigned to your coordinator account</p></div><Link href="/coordinator/applications" className="text-xs font-black text-[#075cff]">View all</Link></div>
				{loadingMerchants ? <div className="flex min-h-[270px] items-center justify-center text-sm text-[#4d6385]">Loading onboarded merchants…</div> : merchantError ? <div className="flex min-h-[270px] items-center justify-center px-6 text-center text-sm text-red-600">{merchantError}</div> : merchants.length === 0 ? <div className="flex min-h-[270px] items-center justify-center text-sm text-[#4d6385]">No approved merchants assigned yet.</div> : <div className="divide-y divide-[#e1e8f2]">
					{merchants.map(merchant => <Link key={merchant.id} href={`/coordinator/applications/${merchant.id}`} className="flex items-center gap-4 p-5 transition hover:bg-[#f8faff]">
						<span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 font-black text-emerald-700"><Store size={20} /></span>
						<div className="min-w-0 flex-1"><p className="truncate font-black text-[#071d43]">{merchant.business_name}</p><p className="mt-1 truncate text-xs text-[#4d6385]">{[merchant.geographic_area || merchant.barangay, merchant.city_municipality].filter(Boolean).join(', ') || 'Location not provided'}</p></div>
						<div className="hidden text-right sm:block"><p className="font-mono text-xs font-bold text-[#365078]">{merchant.merchant_code || 'Code pending'}</p><p className="mt-1 text-[10px] font-black uppercase text-emerald-700">{merchant.subscription_tier || 'Basic'} · Approved</p></div>
						<ChevronRight className="shrink-0 text-[#8ca0bd]" size={18} />
					</Link>)}
				</div>}
			</section>
			<div className="space-y-4"><section className="rounded-2xl bg-gradient-to-br from-[#075cff] to-[#7a24ff] p-6 text-white shadow-lg"><WalletCards size={27} /><p className="mt-5 text-sm text-blue-100">Projected commission</p><p className="mt-1 text-3xl font-black">₱0.00</p><p className="mt-3 text-xs leading-5 text-blue-100">Estimated at 5% of ₱0.00 attributed sales over the last 30 days. Final earnings may vary.</p></section>
			<section id="reviews" className="rounded-2xl border border-[#d2ddea] bg-white p-5 shadow-sm"><div className="flex items-center gap-4"><Star size={34} className="fill-amber-400 text-amber-400" /><div><p className="text-xl font-black">—</p><p className="text-xs text-[#4d6385]">Average merchant rating</p></div></div><Link href="#" className="mt-5 flex items-center justify-between rounded-xl bg-[#eef4ff] px-3 py-3 text-xs font-black">Review feedback <ChevronRight size={16} /></Link></section></div>
		</div>
		<section id="materials" className="mt-5 grid gap-4 sm:grid-cols-2"><Link href="/admin/coordinator-resources" className="rounded-2xl border border-[#d2ddea] bg-white p-5 shadow-sm"><h3 className="font-black">Marketing Materials</h3><p className="mt-1 text-sm text-[#4d6385]">Open approved flyers, guides, and onboarding resources.</p></Link><div id="announcements" className="rounded-2xl border border-[#d2ddea] bg-white p-5 shadow-sm"><h3 className="font-black">Announcements</h3><p className="mt-1 text-sm text-[#4d6385]">No new coordinator announcements.</p></div></section>
	</div>;
}
