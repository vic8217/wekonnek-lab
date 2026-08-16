'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import MerchantSidebar from './MerchantSidebar';

export default function MerchantMobileSidebarDrawer({ open, onClose, subscriptionTier, subscriptionActive, basePath = '/merchant' }: {
  open: boolean;
  onClose: () => void;
  subscriptionTier: string;
  subscriptionActive: boolean;
  basePath?: '/merchant' | '/shop';
}) {
  const pathname = usePathname();

  useEffect(() => { onClose(); }, [pathname, onClose]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', closeOnEscape); };
  }, [onClose, open]);

  if (!open) return null;
  return <div className="fixed inset-0 z-[100] lg:hidden" role="dialog" aria-modal="true" aria-label="Portal navigation">
    <button type="button" aria-label="Close navigation menu" onClick={onClose} className="absolute inset-0 bg-slate-950/55" />
    <aside className="absolute inset-y-0 left-0 w-[min(88vw,20rem)] overflow-y-auto bg-white shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-wider text-red-600">WeKonnek</p><h2 className="text-lg font-black text-slate-950">Navigation</h2></div><button type="button" onClick={onClose} aria-label="Close navigation menu" className="grid size-11 place-items-center rounded-full bg-slate-100 text-2xl text-slate-700">×</button></div>
      <MerchantSidebar subscriptionTier={subscriptionTier} subscriptionActive={subscriptionActive} basePath={basePath} className="w-full" />
    </aside>
  </div>;
}
