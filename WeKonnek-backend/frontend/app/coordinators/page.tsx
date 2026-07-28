'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type L from 'leaflet';
import toast from 'react-hot-toast';
import { uploadApi } from '@/lib/api';
import {
	BadgeDollarSign, BriefcaseBusiness, CalendarDays, Check, CheckCircle2, ClipboardCheck,
	Crosshair, GraduationCap, Handshake, MapPin, Megaphone, Network, Phone, Send,
	Store, Upload, UserRound, X,
} from 'lucide-react';

const steps = [
	{ icon: ClipboardCheck, title: 'Register as Coordinator', text: 'Submit your application and coverage details.' },
	{ icon: UserRound, title: 'Interview and Verification', text: 'Our team will verify your information and discuss the role.' },
	{ icon: MapPin, title: 'Area Assignment', text: 'Receive an assigned or approved coverage area.' },
	{ icon: GraduationCap, title: 'Training and Orientation', text: 'Learn the platform, policies, and merchant support process.' },
	{ icon: Store, title: 'Start Onboarding Merchants', text: 'Help qualified local merchants register and activate.' },
	{ icon: BadgeDollarSign, title: 'Earn Commissions', text: 'Earn from approved and active merchant accounts.' },
];

const perks = [
	{ icon: BadgeDollarSign, text: 'Earn commissions from merchant subscriptions' },
	{ icon: ClipboardCheck, text: 'Access coordinator dashboard and reports' },
	{ icon: Network, text: 'Build your own merchant network' },
	{ icon: Megaphone, text: 'Marketing materials provided' },
	{ icon: MapPin, text: 'Support local businesses in your area' },
	{ icon: CalendarDays, text: 'Flexible schedule' },
];

const NCR_CITIES = [
	'Caloocan', 'Las Piñas', 'Makati', 'Malabon', 'Mandaluyong', 'Manila',
	'Marikina', 'Muntinlupa', 'Navotas', 'Parañaque', 'Pasay', 'Pasig',
	'Quezon City', 'San Juan', 'Taguig', 'Valenzuela', 'Pateros',
];

const NCR_CITY_CENTERS: Record<string, [number, number]> = {
	'Caloocan': [14.7566, 121.0450], 'Las Piñas': [14.4453, 120.9939],
	'Makati': [14.5547, 121.0244], 'Malabon': [14.6681, 120.9658],
	'Mandaluyong': [14.5794, 121.0359], 'Manila': [14.5995, 120.9842],
	'Marikina': [14.6507, 121.1029], 'Muntinlupa': [14.4081, 121.0415],
	'Navotas': [14.6732, 120.9350], 'Parañaque': [14.4793, 121.0198],
	'Pasay': [14.5378, 121.0014], 'Pasig': [14.5764, 121.0851],
	'Quezon City': [14.6760, 121.0437], 'San Juan': [14.6019, 121.0355],
	'Taguig': [14.5176, 121.0509], 'Valenzuela': [14.7011, 120.9830],
	'Pateros': [14.5447, 121.0680],
};

const LocationMap = dynamic(() => import('@/components/LocationMap'), {
	ssr: false,
	loading: () => <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-500">Loading map…</div>,
});

export default function CoordinatorsPage() {
	return (
		<main className="min-h-screen bg-[#f6faff] text-[#071333]">
			<CoordinatorHeader />
			<div className="grid w-full gap-6 px-4 py-7 lg:grid-cols-[minmax(0,1.55fr)_minmax(520px,1fr)] lg:px-7">
				<div>
					<section className="relative min-h-[475px] overflow-hidden rounded-[28px] bg-white">
						<Image src="/images/coordinator-hero.png" alt="Zone coordinator helping a local shop owner" fill priority sizes="(min-width:1024px) 58vw, 100vw" className="object-cover" />
						<div className="absolute inset-y-0 left-0 w-[55%] bg-gradient-to-r from-white via-white/95 to-transparent" />
						<div className="relative z-10 max-w-[430px] p-8 lg:p-10">
							<h1 className="text-[39px] font-black leading-[.98] tracking-tight">GROW YOUR<br /><span className="text-[#075cff]">COMMUNITY</span><br />WITH <span className="text-[#075cff]">WE</span><span className="text-red-600">KONNEK</span></h1>
							<p className="mt-4 max-w-xs text-[15px] leading-5">Help local businesses go digital and earn recurring commissions as a WeKonnek Zone Coordinator.</p>
							<div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3">
								{perks.map(({ icon: Icon, text }) => <div key={text} className="flex items-center gap-2 text-[11px] font-bold leading-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#075cff] text-white"><Icon size={15} /></span>{text}</div>)}
							</div>
						</div>
						<div className="absolute inset-x-0 bottom-0 h-16 bg-[#075cff] [clip-path:polygon(0_25%,50%_80%,100%_30%,100%_100%,0_100%)]" />
						<div className="absolute inset-x-[10%] bottom-3 z-10 grid grid-cols-3 gap-5">
							{[['Be a Leader','Lead digital transformation in your community.'],['Make an Impact','Empower local businesses to grow and thrive.'],['Earn More','Enjoy recurring income and performance bonuses.']].map(([title,text]) => <div key={title} className="rounded-xl bg-white px-5 py-3 shadow-lg"><h3 className="font-black text-[#075cff]">{title}</h3><p className="mt-1 text-[10px]">{text}</p></div>)}
						</div>
					</section>

					<section className="py-16">
						<h2 className="mb-8 text-center text-2xl font-black text-[#075cff]">HOW IT WORKS</h2>
						<div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
							{steps.map(({ icon: Icon, title, text }, index) => <article key={title} className="relative flex min-h-[165px] flex-col items-center justify-center rounded-xl border border-[#ccd8e9] bg-white p-5 text-center shadow-sm"><span className="absolute -top-3 left-4 flex size-7 items-center justify-center rounded-full bg-[#075cff] text-sm font-black text-white">{index + 1}</span><Icon size={34} className="mb-4 text-[#075cff]" /><h3 className="font-black">{title}</h3><p className="mt-2 text-sm leading-5 text-slate-600">{text}</p></article>)}
						</div>
					</section>

					<section className="rounded-2xl bg-[#eef5ff] p-7">
						<h2 className="font-black text-[#075cff]">COORDINATOR SUPPORT</h2><p className="mt-2">We provide the tools, training, and support you need to succeed.</p>
						<div className="mt-4 grid gap-2 sm:grid-cols-2">{['Dedicated coordinator dashboard','Merchant lead and onboarding tracking','Marketing materials and flyers','Promotions and partnership support','Training resources','Account management support'].map(item => <p key={item} className="flex items-center gap-2"><Check size={17} className="text-[#075cff]" />{item}</p>)}</div>
						<div className="mt-6 rounded-xl bg-white p-5"><h3 className="font-black">QUESTIONS?</h3><p className="mt-2 text-slate-600">Visit our Contact page and our team will help you through the application process.</p><Link href="/contact" className="mt-4 inline-flex items-center gap-2 font-black text-[#075cff]"><Phone size={18} /> Contact WeKonnek</Link></div>
					</section>
				</div>

				<CoordinatorForm />
			</div>
		</main>
	);
}

function CoordinatorForm() {
	const [region, setRegion] = useState('');
	const [province, setProvince] = useState('');
	const [city, setCity] = useState('');
	const [selectedLocation, setSelectedLocation] = useState<[number, number] | null>(null);
	const [locating, setLocating] = useState(false);
	const [locationMessage, setLocationMessage] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [openPolicy, setOpenPolicy] = useState<'terms' | 'privacy' | null>(null);
	const locationEnabled = region === 'NCR';
	const setCoordinates = (latitude: number, longitude: number) => setSelectedLocation([latitude, longitude]);
	const locateUser = useCallback(() => {
		if (!navigator.geolocation) {
			setLocationMessage('Location is not supported by this browser.');
			return;
		}
		setLocating(true);
		setLocationMessage('');
		navigator.geolocation.getCurrentPosition(
			position => {
				setSelectedLocation([position.coords.latitude, position.coords.longitude]);
				setLocationMessage('Map centered on your current location.');
				setLocating(false);
			},
			() => {
				setLocationMessage('Allow location access to center the map on your position.');
				setLocating(false);
			},
			{ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
		);
	}, []);
	useEffect(() => {
		const request = window.setTimeout(locateUser, 0);
		return () => window.clearTimeout(request);
	}, [locateUser]);
	const handleMarkerDrag = (event: L.DragEndEvent) => {
		const point = event.target.getLatLng();
		setCoordinates(point.lat, point.lng);
	};
	const submitApplication = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = event.currentTarget;
		setSubmitting(true);
		try {
			const formData = new FormData(form);
			const values = Object.fromEntries(formData.entries());
			const uploadDocument = async (name: string) => {
				const file = formData.get(name);
				return file instanceof File && file.size > 0 ? uploadApi.uploadFile(file, 'document') : null;
			};
			const [governmentIdFrontUrl, governmentIdBackUrl, resumeUrl, supportingDocumentUrl] = await Promise.all([
				uploadDocument('governmentIdFront'), uploadDocument('governmentIdBack'),
				uploadDocument('resume'), uploadDocument('supportingDocument'),
			]);
			const response = await fetch('/api/backend/coordinator-applications', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...values, governmentIdFrontUrl, governmentIdBackUrl, resumeUrl, supportingDocumentUrl }),
			});
			const contentType = response.headers.get('content-type') || '';
			const result = contentType.includes('application/json') ? await response.json() : { message: 'Application service is unavailable. Please try again.' };
			if (!response.ok) throw new Error(result.message || 'Unable to submit application');
			toast.success('Coordinator application submitted successfully.');
			form.reset(); setRegion(''); setProvince(''); setCity(''); setSelectedLocation(null);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Unable to submit application');
		} finally { setSubmitting(false); }
	};

	return <section className="h-fit rounded-2xl border border-[#ccd8e9] bg-white p-6 shadow-[0_15px_35px_rgba(42,73,120,.12)]">
		<h2 className="text-center text-2xl font-black">BECOME A <span className="text-[#075cff]">ZONE COORDINATOR</span></h2><p className="mx-auto mt-2 max-w-lg text-center text-xs text-slate-500">Submit your details and our coordinator team will contact you for verification, orientation, and area assignment.</p>
		<form onSubmit={submitApplication} className="mt-6 space-y-4">
			<FormGroup icon={UserRound} title="PERSONAL INFORMATION"><div className="grid gap-3 sm:grid-cols-3"><Field name="fullName" label="Full Name" placeholder="Enter your full name" required /><Field name="mobileNumber" type="tel" label="Mobile Number" placeholder="09XXXXXXXXX" required /><Field name="email" type="email" label="Email Address" placeholder="you@example.com" required /><Field name="viberAccount" type="tel" label="Viber Account / Number" placeholder="Viber mobile number" /><Field name="whatsappNumber" type="tel" label="WhatsApp Number" placeholder="WhatsApp mobile number" /></div></FormGroup>
			<FormGroup icon={MapPin} title="LOCATION COVERAGE"><div className="grid gap-3 sm:grid-cols-3">
				<SelectField label="Region" text="Select region" name="region" value={region} options={[{ value: 'NCR', label: 'National Capital Region (NCR)' }]} onChange={value => { setRegion(value); setProvince(''); setCity(''); setSelectedLocation(null); }} />
				<SelectField label="Province / District" text="Select province / district" name="provinceDistrict" value={province} disabled={!locationEnabled} options={locationEnabled ? [{ value: 'Metro Manila', label: 'Metro Manila' }] : []} onChange={value => { setProvince(value); setCity(''); setSelectedLocation(null); }} />
				<SelectField label="City / Municipality" text="Select city / municipality" name="cityMunicipality" value={city} disabled={!province} options={province ? NCR_CITIES.map(name => ({ value: name, label: name })) : []} onChange={value => { setCity(value); setSelectedLocation(value ? NCR_CITY_CENTERS[value] : null); }} />
			</div><div className="mt-3 grid gap-3 sm:grid-cols-3"><Field name="barangay" label="Barangay" placeholder="Enter barangay" /><div className="sm:col-span-2"><Field name="preferredCoverageArea" label="Preferred Coverage Area" placeholder="Example: Barangays, puroks, subdivisions, or commercial areas" /></div></div>
				<div className="mt-4 overflow-hidden rounded-xl border border-[#ccd8e9] bg-slate-100">
					<div className="relative h-64 sm:h-72"><LocationMap selectedLocation={selectedLocation} defaultCenter={[14.6091, 121.0223]} selectedZoom={17} onMapClick={setCoordinates} onMarkerDrag={handleMarkerDrag} /><button type="button" onClick={locateUser} disabled={locating} className="absolute right-3 top-3 z-[500] flex min-h-10 items-center gap-2 rounded-xl bg-white px-3 text-xs font-bold text-[#075cff] shadow-lg disabled:opacity-60"><Crosshair size={16} />{locating ? 'Locating…' : 'Use my location'}</button></div>
					<div className="grid gap-3 border-t border-[#ccd8e9] bg-white p-3 sm:grid-cols-2">
						<label className="text-xs font-bold">Latitude<input name="latitude" value={selectedLocation?.[0].toFixed(7) ?? ''} required readOnly placeholder="Click the map to set" className="coord-input mt-2 bg-slate-50" /></label>
						<label className="text-xs font-bold">Longitude<input name="longitude" value={selectedLocation?.[1].toFixed(7) ?? ''} required readOnly placeholder="Click the map to set" className="coord-input mt-2 bg-slate-50" /></label>
					</div>
				</div>
				<p className="mt-2 text-[11px] text-slate-500">{locationMessage || 'Select a city, then click the map or drag the pin to mark the exact coverage location.'}</p>
			</FormGroup>
			<FormGroup icon={BriefcaseBusiness} title="EXPERIENCE"><div className="grid gap-3 sm:grid-cols-2"><SelectField name="background" label="What best describes your background?" text="Select your background" options={['Sales','Community work','Business owner','Marketing','Other'].map(value => ({ value, label: value }))} /><Field name="occupation" label="Current occupation or organization (optional)" placeholder="Enter occupation or organization" /></div></FormGroup>
			<FormGroup icon={CheckCircle2} title="COORDINATOR QUESTIONS"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold">Why do you want to become a Zone Coordinator?<textarea name="motivation" className="coord-input mt-2 min-h-28 resize-y" placeholder="Share your goals and how you plan to support local merchants." /></label><SelectField name="monthlyCapacity" label="How many merchants can you help onboard monthly?" text="Select range" options={['1–5','6–10','11–20','21 or more'].map(value => ({ value, label: value }))} /></div></FormGroup>
			<FormGroup icon={Handshake} title="REFERRAL INFORMATION"><SelectField name="referred" label="Were you referred?" text="Select an answer" options={[{ value: 'No', label: 'No' },{ value: 'Yes', label: 'Yes' }]} /></FormGroup>
			<FormGroup icon={Upload} title="UPLOADS (OPTIONAL)"><p className="mb-3 text-xs text-slate-500">Your information is used only to evaluate your application and meet verification requirements. JPG, PNG, or PDF; maximum 5 MB each.</p><div className="grid gap-3 sm:grid-cols-2">{[{ label: 'Government ID — front', name: 'governmentIdFront' },{ label: 'Government ID — back', name: 'governmentIdBack' },{ label: 'Resume / Profile', name: 'resume' },{ label: 'Supporting Document', name: 'supportingDocument' }].map(item => <label key={item.name} className="flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[#ccd8e9] p-4"><Upload className="text-[#075cff]" /><span><strong className="block text-sm">{item.label}</strong><small className="text-slate-500">Choose a file</small></span><input name={item.name} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" /></label>)}</div></FormGroup>
			<FormGroup icon={ShieldIcon} title="AGREEMENT">
				<label className="mt-2 flex items-start gap-2 text-xs"><input name="informationConfirmed" type="checkbox" required className="mt-0.5 size-4" /><span>I confirm that the information provided is complete and accurate.</span></label>
				<label className="mt-3 flex items-start gap-2 text-xs"><input name="policyAccepted" type="checkbox" required className="mt-0.5 size-4" /><span>I have read and agree to the <button type="button" onClick={() => setOpenPolicy('terms')} className="font-black text-[#075cff] underline hover:text-blue-800">Zone Coordinator Application Terms</button> and <button type="button" onClick={() => setOpenPolicy('privacy')} className="font-black text-[#075cff] underline hover:text-blue-800">Privacy Policy</button>.</span></label>
				<label className="mt-3 flex items-start gap-2 text-xs"><input name="updatesAccepted" type="checkbox" className="mt-0.5 size-4" /><span>I agree to receive application updates and coordinator announcements.</span></label>
			</FormGroup>
			<button disabled={submitting} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#075cff] font-black text-white disabled:opacity-60">{submitting ? 'SUBMITTING…' : 'APPLY AS ZONE COORDINATOR'} <Send size={17} /></button>
		</form>
		{openPolicy && <PolicyModal type={openPolicy} onClose={() => setOpenPolicy(null)} />}
	</section>;
}

const ShieldIcon = CheckCircle2;
function PolicyModal({ type, onClose }: { type: 'terms' | 'privacy'; onClose: () => void }) {
	const isTerms = type === 'terms';
	return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="policy-title" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
		<div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
			<div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><p className="text-xs font-black uppercase tracking-wide text-[#075cff]">WeKonnek Zone Coordinator</p><h3 id="policy-title" className="text-xl font-black">{isTerms ? 'Application Terms and Conditions' : 'Privacy Policy'}</h3></div><button type="button" onClick={onClose} aria-label="Close policy" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={22} /></button></div>
			<div className="max-h-[65vh] space-y-5 overflow-y-auto px-5 py-5 text-sm leading-6 text-slate-700">
				{isTerms ? <>
					<PolicySection title="1. Application and verification">You confirm that the information and documents you submit are accurate and may be verified by WeKonnek. Submission does not guarantee approval or assignment to a requested area.</PolicySection>
					<PolicySection title="2. Coordinator responsibilities">Approved coordinators must represent WeKonnek professionally, follow onboarding procedures, protect merchant and customer information, and avoid misleading promises or unauthorized collection of payments.</PolicySection>
					<PolicySection title="3. Coverage and performance">Coverage areas are assigned by WeKonnek and may change based on availability, operational requirements, compliance, or performance. Commission eligibility follows the current approved coordinator program.</PolicySection>
					<PolicySection title="4. Account and conduct">Coordinator access is personal and must not be shared. Fraud, harassment, misuse of platform data, policy violations, or inactivity may lead to reassignment, suspension, or termination.</PolicySection>
					<PolicySection title="5. Updates and acceptance">WeKonnek may update program procedures and terms. Material changes will be communicated through available contact details or the coordinator portal.</PolicySection>
				</> : <>
					<PolicySection title="Information we collect">We collect application details, contact numbers including Viber and WhatsApp, location and coverage preferences, experience, submitted documents, and application activity.</PolicySection>
					<PolicySection title="How information is used">Information is used to evaluate and verify your application, communicate updates, assign coverage, provide training and support, prevent fraud, and operate the coordinator program.</PolicySection>
					<PolicySection title="Sharing and protection">Access is limited to authorized WeKonnek personnel and service providers that support verification and platform operations. Information is not sold. Reasonable organizational and technical safeguards are used to protect it.</PolicySection>
					<PolicySection title="Retention">Application records are retained only as long as necessary for evaluation, legal obligations, dispute handling, fraud prevention, and legitimate operational needs.</PolicySection>
					<PolicySection title="Your choices">You may request access, correction, or deletion of eligible personal information and may withdraw optional announcement consent by contacting WeKonnek. Required records may be retained where legally or operationally necessary.</PolicySection>
				</>}
			</div>
			<div className="border-t border-slate-200 p-4"><button type="button" onClick={onClose} className="h-11 w-full rounded-xl bg-[#075cff] font-black text-white">I understand</button></div>
		</div>
	</div>;
}
function PolicySection({ title, children }: { title: string; children: React.ReactNode }) { return <section><h4 className="font-black text-[#071333]">{title}</h4><p className="mt-1">{children}</p></section>; }
function FormGroup({ icon: Icon, title, children }: { icon: typeof UserRound; title: string; children: React.ReactNode }) { return <fieldset className="rounded-xl border border-[#ccd8e9] p-3"><legend className="px-1 text-xs font-black text-[#075cff]"><span className="inline-flex items-center gap-2"><Icon size={16} />{title}</span></legend>{children}</fieldset>; }
function Field({ label, placeholder, name, type = 'text', required = false }: { label: string; placeholder: string; name?: string; type?: string; required?: boolean }) { return <label className="block text-xs font-bold">{label}<input name={name} type={type} required={required} className="coord-input mt-2" placeholder={placeholder} /></label>; }
function SelectField({ label, text, name, value, options = [], disabled = false, onChange }: { label: string; text: string; name?: string; value?: string; options?: { value: string; label: string }[]; disabled?: boolean; onChange?: (value: string) => void }) { return <label className="block text-xs font-bold">{label}<select name={name} value={value} disabled={disabled} onChange={event => onChange?.(event.target.value)} className="coord-input mt-2 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"><option value="">{text}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }

function CoordinatorHeader() { return <header className="relative flex h-[114px] items-center justify-between border-b border-slate-200 bg-white px-5 lg:px-12"><Link href="/"><Image src="/images/weKonnekLogov1.png" alt="WeKonnek" width={1536} height={1024} priority className="h-24 w-auto" /></Link><nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-[52px] whitespace-nowrap text-[15px] font-semibold xl:flex"><Link href="/">Home</Link><Link href="/for-merchants">For Merchants</Link><Link href="/coordinators" className="relative font-black text-[#075cff] after:absolute after:-bottom-4 after:left-1/2 after:h-[3px] after:w-12 after:-translate-x-1/2 after:rounded-full after:bg-[#075cff]">For Coordinators</Link><Link href="/contact">Contact</Link></nav><Link href="/coordinator" className="rounded-xl bg-[#075cff] px-7 py-4 text-sm font-black text-white shadow-[0_12px_24px_rgba(0,86,255,.24)]">Coordinator Portal</Link></header>; }
