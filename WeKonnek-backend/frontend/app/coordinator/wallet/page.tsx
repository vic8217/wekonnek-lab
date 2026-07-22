import { Banknote, CalendarDays, FileText, Landmark, WalletCards } from 'lucide-react';

const summaries = [
	{ icon: WalletCards, label: 'Total commission earned', value: '₱0.00', note: 'All-time commission to date', tone: 'bg-blue-50 text-[#075cff]' },
	{ icon: CalendarDays, label: 'Commission this month', value: '₱0.00', note: 'Current calendar month', tone: 'bg-violet-50 text-violet-600' },
	{ icon: Banknote, label: 'Payments made', value: '₱0.00', note: 'Total released payouts', tone: 'bg-emerald-50 text-emerald-600' },
	{ icon: Landmark, label: 'Available balance', value: '₱0.00', note: 'Eligible for the next payout', tone: 'bg-amber-50 text-amber-600' },
];

export default function CoordinatorWalletPage() {
	return <div className="mx-auto max-w-[1320px]">
		<div><h2 className="text-2xl font-black text-[#071d43]">Coordinator Wallet</h2><p className="mt-1 text-sm text-[#4d6385]">Track earned commissions, payments, adjustments, and your complete wallet ledger.</p></div>
		<section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{summaries.map(({ icon: Icon, label, value, note, tone }) => <article key={label} className="rounded-2xl border border-[#d2ddea] bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-[#365078]">{label}</p><p className="mt-2 text-2xl font-black text-[#071d43]">{value}</p></div><span className={`flex size-11 items-center justify-center rounded-xl ${tone}`}><Icon size={21} /></span></div><p className="mt-3 text-xs text-[#4d6385]">{note}</p></article>)}</section>
		<section className="mt-6 overflow-hidden rounded-2xl border border-[#d2ddea] bg-white shadow-sm">
			<div className="flex flex-col justify-between gap-4 border-b border-[#d2ddea] p-5 sm:flex-row sm:items-center"><div><h3 className="font-black text-[#071d43]">Commission ledger</h3><p className="mt-1 text-xs text-[#4d6385]">Every commission credit, payout, reversal, and adjustment</p></div><div className="flex gap-2"><select aria-label="Transaction type" className="rounded-lg border border-[#d2ddea] bg-white px-3 py-2 text-xs font-semibold text-[#365078]"><option>All transaction types</option><option>Commission earned</option><option>Payment made</option><option>Adjustment</option><option>Reversal</option></select><select aria-label="Ledger period" className="rounded-lg border border-[#d2ddea] bg-white px-3 py-2 text-xs font-semibold text-[#365078]"><option>All time</option><option>This month</option><option>Last month</option><option>This year</option></select></div></div>
			<div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead className="bg-[#f8faff] text-xs text-[#365078]"><tr>{['Date','Reference','Description','Type','Commission','Payment','Running balance'].map(label => <th key={label} className="px-5 py-4 font-black">{label}</th>)}</tr></thead><tbody><tr><td colSpan={7} className="px-5 py-16"><div className="flex flex-col items-center justify-center text-center text-[#4d6385]"><FileText size={34} /><p className="mt-3 font-semibold text-[#071d43]">No wallet transactions yet</p><p className="mt-1 text-sm">Commission earnings and payments will appear here once recorded.</p></div></td></tr></tbody></table></div>
		</section>
		<div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-5"><h3 className="text-sm font-black text-[#071d43]">How coordinator commissions work</h3><p className="mt-2 text-sm leading-6 text-[#4d6385]">Approved commissions are credited after eligible merchant transactions are confirmed. Released payouts appear as payments and reduce the available wallet balance. Reversed or cancelled transactions are recorded separately in the ledger.</p></div>
	</div>;
}
