export default function AdminPaymentPlaceholder({ title, disabled }: { title: string; disabled?: string }) {
  return <div className="w-full"><h1 className="text-3xl font-bold">{title}</h1>{disabled && <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900">{disabled}</div>}<div className="mt-6 rounded-2xl border bg-white p-10 text-center text-gray-500">No financial records are available yet. Data will be derived from backend ledger entries when the collection workflow is connected.</div></div>;
}
