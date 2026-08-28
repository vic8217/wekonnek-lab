'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getToken } from '@/hooks/use-auth';

type Partner = { code: string; name: string; enabled: boolean; status: string; configurable: boolean };

export default function DeliveryPartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { fetch('/api/backend/admin/delivery-partners', { headers: { Authorization: `Bearer ${getToken()}` } })
    .then(async response => response.ok ? response.json() : Promise.reject(await response.text()))
    .then(data => setPartners(data.providers)).catch(() => setError('Unable to load delivery partner configuration.')); }, []);
  return <main className="mx-auto max-w-6xl p-5 md:p-8">
    <div className="mb-8"><p className="text-sm font-medium text-[#DB0002]">Settings</p><h1 className="mt-1 text-2xl font-bold text-gray-900">Delivery Partners</h1><p className="mt-2 text-sm text-gray-600">Configure delivery-provider foundations. Connections and delivery execution are not enabled in this phase.</p></div>
    {error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{partners.map(partner => <section key={partner.code} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-gray-900">{partner.name}</h2><p className="mt-1 text-sm text-gray-500">{partner.code === 'LALAMOVE' ? 'Third-party delivery configuration' : 'Reserved for a future phase'}</p></div><span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">{partner.status === 'NOT_TESTED' ? 'Not Tested' : 'Coming Soon'}</span></div>
      <p className="mt-5 text-sm text-gray-600">Status: <span className="font-medium">{partner.enabled ? 'Enabled' : 'Disabled'}</span></p>
      {partner.configurable ? <Link className="mt-5 inline-flex rounded-lg bg-[#DB0002] px-4 py-2 text-sm font-medium text-white hover:bg-[#b80002]" href="/admin/delivery-partners/lalamove">Configure Lalamove</Link> : <span className="mt-5 inline-block text-sm font-medium text-gray-400">Not available in Phase 1</span>}
    </section>)}</div>
  </main>;
}
