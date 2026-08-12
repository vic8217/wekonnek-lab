'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, QrCode } from 'lucide-react';
import FloorPlanEditor from '@/components/FloorPlanEditor';

type ActiveShop = { merchant_id?: number; merchantId?: number; name?: string; branch_name?: string };

export default function TableConfigurationPage() {
  const [shop, setShop] = useState<ActiveShop | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem('wk_active_shop');
    setShop(saved ? JSON.parse(saved) as ActiveShop : null);
  }, []);

  const merchantId = shop?.merchant_id ?? shop?.merchantId;

  return <div className="space-y-5">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <Link href="/shop/shop" className="mb-3 inline-flex items-center gap-2 text-sm font-bold text-slate-600 hover:text-red-600"><ArrowLeft className="size-4"/>Back to order counter</Link>
        <h1 className="text-3xl font-black text-slate-900">Table Configuration</h1>
        <p className="mt-1 text-sm text-slate-600">Create and arrange tables, choose their shape, and set the maximum number of guests.</p>
        <p className="mt-2 text-sm font-bold text-red-600">{shop?.branch_name || shop?.name || 'Active shop'}</p>
      </div>
      <Link href="/shop/qr-codes" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-black text-white hover:bg-red-700"><QrCode className="size-5"/>Print Table QR Codes</Link>
    </header>

    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-400">Shapes</p><p className="mt-1 font-bold">Square · Round · Rectangle</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-400">Capacity</p><p className="mt-1 font-bold">Set pax per table</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-black uppercase text-slate-400">QR ordering</p><p className="mt-1 font-bold">One printable code per active table</p></div>
      </div>
      {merchantId ? <FloorPlanEditor merchantId={merchantId} editable configurationGrid /> : <div className="py-16 text-center text-sm text-slate-500">Select an active shop to configure its tables.</div>}
    </section>
  </div>;
}
