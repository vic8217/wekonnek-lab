import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

const resources = [
	{ title: 'Training Materials', text: 'Orientation guides, platform training, and onboarding references.' },
	{ title: 'Merchant Onboarding', text: 'Checklists, requirements, and activation procedures.' },
	{ title: 'Marketing Materials', text: 'Approved flyers, campaign assets, and community materials.' },
	{ title: 'Policies & Guidelines', text: 'Coordinator policies, coverage rules, and operating standards.' },
	{ title: 'Forms & Templates', text: 'Reusable forms, reports, and coordinator communication templates.' },
	{ title: 'Announcements', text: 'Program updates and important coordinator notices.' },
];

export default function CoordinatorResourcesPage() {
	return <div className="space-y-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><Link href="/admin/coordinators" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-[#DB0002]"><ArrowLeft size={16} /> Coordinator Management</Link><h1 className="text-2xl font-bold text-gray-900">Coordinator Resources</h1><p className="mt-1 text-sm text-gray-600">Manage materials and references available to Zone Coordinators.</p></div><button className="rounded-lg bg-[#DB0002] px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700">Add Resource</button></div><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{resources.map(resource => <article key={resource.title} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"><span className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-xl text-blue-600">▤</span><h2 className="mt-5 text-lg font-bold text-gray-900">{resource.title}</h2><p className="mt-2 min-h-10 text-sm leading-5 text-gray-600">{resource.text}</p><button className="mt-5 text-sm font-semibold text-blue-600 hover:text-blue-800">Manage resources →</button></article>)}</div></div>;
}
