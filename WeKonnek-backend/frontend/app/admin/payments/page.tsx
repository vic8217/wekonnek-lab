import Link from 'next/link';

const summaryCards = [
  ['Today’s Collections', '—'], ['Pending', '—'], ['Completed', '—'], ['Failed', '—'],
  ['Merchant Payable', '—'], ['Settled', '—'], ['Refunds', 'Disabled'], ['Reconciliation Exceptions', '—'],
];

const paymentDestinations = [
  { title: 'Merchant Accounts', description: 'Receive customer payments on behalf of merchants and track amounts due for settlement.', label: 'Collections', icon: 'M' },
  { title: 'App User Wallets', description: 'Accept wallet loads for customers and other WEKONNEK app users.', label: 'Wallet Load', icon: 'U' },
  { title: 'Rider Wallets', description: 'Accept wallet loads for riders for use across rider payment and operational flows.', label: 'Rider Load', icon: 'R' },
];

const quickLinks = [
  { href: '/admin/payments/transactions', title: 'Transactions', description: 'Search and inspect customer payment activity', icon: '↔' },
  { href: '/admin/payments/settlements', title: 'Merchant Settlements', description: 'Review merchant payable and settlement history', icon: '▤' },
  { href: '/admin/payments/refunds', title: 'Refunds', description: 'View refund records and processing availability', icon: '↶' },
  { href: '/admin/payments/payouts', title: 'Payouts', description: 'Monitor merchant disbursements and approvals', icon: '₱' },
  { href: '/admin/payments/reconciliation', title: 'Reconciliation', description: 'Inspect provider mismatches and exceptions', icon: '✓' },
  { href: '/admin/payments/partners', title: 'Payment Partners', description: 'Manage PayCools and future payment providers', icon: '⌁' },
];

export default function PaymentsOverview() {
  return (
    <div className="w-full space-y-8">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#DB0002]">WEKONNEK Admin</p>
        <h1 className="mt-2 text-3xl font-bold text-gray-900">Payments</h1>
        <p className="mt-2 text-gray-500">Central monitoring and configuration for collections, settlements, and payment partners.</p>
      </header>

      <section>
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Payment destinations</h2>
          <p className="mt-1 text-sm text-gray-500">Payments received by WEKONNEK are assigned to the appropriate platform account or wallet.</p>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {paymentDestinations.map((item) => (
            <div key={item.title} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 font-bold text-white">{item.icon}</span>
                <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-600">{item.label}</span>
              </div>
              <h3 className="mt-5 font-semibold text-gray-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-500">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900">Quick access</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {quickLinks.map((item) => (
            <Link key={item.title} href={item.href} className="group flex min-h-32 items-start gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-red-200 hover:shadow-md">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-xl font-bold text-red-600 transition group-hover:bg-red-600 group-hover:text-white">{item.icon}</span>
              <span>
                <span className="flex items-center gap-2 font-semibold text-gray-900">{item.title}<span className="text-gray-300 transition group-hover:translate-x-1 group-hover:text-red-500">→</span></span>
                <span className="mt-1 block text-sm leading-5 text-gray-500">{item.description}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900">Overview</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {summaryCards.map(([label, value]) => <div key={label} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><p className="text-sm text-gray-500">{label}</p><p className="mt-2 text-2xl font-bold text-gray-900">{value}</p></div>)}
        </div>
      </section>

      <Link href="/admin/payments/partners/paycools" className="block rounded-2xl bg-slate-950 p-6 text-white transition hover:bg-slate-900">
        <p className="text-xs font-bold tracking-widest text-red-300">PAYMENT PARTNER</p>
        <div className="mt-2 flex flex-wrap justify-between gap-4">
          <div><h2 className="text-2xl font-bold">PayCools</h2><p className="text-slate-300">QR Ph · Dynamic QR enabled for UAT baseline</p></div>
          <span className="h-fit rounded bg-amber-400 px-3 py-1 font-bold text-amber-950">UAT</span>
        </div>
      </Link>
    </div>
  );
}
