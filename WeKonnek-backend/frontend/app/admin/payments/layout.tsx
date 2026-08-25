'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function PaymentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPaymentsHome = pathname === '/admin/payments';

  return (
    <div className="w-full">
      {!isPaymentsHome && (
        <Link href="/admin/payments" className="mb-6 inline-flex items-center gap-2 rounded-lg px-1 py-2 text-sm font-semibold text-slate-600 transition hover:text-[#DB0002]">
          <span aria-hidden="true">←</span>
          Back to Payments
        </Link>
      )}
      {children}
    </div>
  );
}
