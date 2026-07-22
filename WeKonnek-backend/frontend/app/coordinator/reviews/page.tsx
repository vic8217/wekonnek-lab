import { FileText, MessageSquareText, Star, UsersRound } from 'lucide-react';

const stats = [
	{ icon: Star, label: 'Average rating', value: '—', note: 'Across all customer reviews', tone: 'bg-amber-50 text-amber-500' },
	{ icon: MessageSquareText, label: 'Total reviews', value: '0', note: 'Customer submissions', tone: 'bg-blue-50 text-[#075cff]' },
	{ icon: UsersRound, label: 'Onboarded merchants', value: '0', note: '0 with feedback', tone: 'bg-emerald-50 text-emerald-600' },
];

export default function CoordinatorReviewsPage() {
	return <div className="mx-auto max-w-[1320px]">
		<h2 className="text-2xl font-black text-[#071d43]">Merchant Reviews &amp; Ratings</h2><p className="mt-1 text-sm text-[#4d6385]">Customer feedback for every merchant you onboarded.</p>
		<section className="mt-6 grid gap-4 md:grid-cols-3">{stats.map(({ icon: Icon, label, value, note, tone }) => <article key={label} className="rounded-2xl border border-[#d2ddea] bg-white p-4 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-[#365078]">{label}</p><p className="mt-1 text-2xl font-black text-[#071d43]">{value}</p></div><span className={`flex size-10 items-center justify-center rounded-xl ${tone}`}><Icon size={20} /></span></div><p className="mt-2 text-xs text-[#4d6385]">{note}</p></article>)}</section>
		<section className="mt-6 overflow-hidden rounded-2xl border border-[#d2ddea] bg-white shadow-sm"><div className="border-b border-[#d2ddea] p-5"><h3 className="font-black text-[#071d43]">Onboarded merchant ratings</h3><p className="mt-1 text-xs text-[#4d6385]">Average customer rating for each merchant in your network</p></div><div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left"><thead className="bg-[#f8faff] text-xs text-[#365078]"><tr>{['Merchant','Location','Average rating','Reviews','Latest review'].map(label => <th key={label} className="px-5 py-4 font-black">{label}</th>)}</tr></thead><tbody><tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-[#4d6385]">No onboarded merchants found.</td></tr></tbody></table></div></section>
		<div className="mt-6 grid gap-5 lg:grid-cols-2"><EmptyReviewCard title="Latest 10 customer reviews" subtitle="Newest ratings and comments across your merchants" message="No reviews received yet." /><EmptyReviewCard title="Lowest 10 customer ratings" subtitle="Lowest scores first, with newest feedback used as the tie-breaker" message="No ratings available yet." /></div>
	</div>;
}

function EmptyReviewCard({ title, subtitle, message }: { title: string; subtitle: string; message: string }) {
	return <section className="overflow-hidden rounded-2xl border border-[#d2ddea] bg-white shadow-sm"><div className="border-b border-[#d2ddea] p-5"><h3 className="font-black text-[#071d43]">{title}</h3><p className="mt-1 text-xs text-[#4d6385]">{subtitle}</p></div><div className="flex min-h-[145px] flex-col items-center justify-center text-[#4d6385]"><FileText size={31} /><p className="mt-3 text-sm">{message}</p></div></section>;
}
