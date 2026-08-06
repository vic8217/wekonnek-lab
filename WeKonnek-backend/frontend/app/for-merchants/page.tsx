'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type L from 'leaflet';
import {
	BookOpen,
	BriefcaseBusiness,
	CalendarDays,
	ChevronDown,
	LocateFixed,
	Mail,
	MapPin,
	Phone,
	QrCode,
	ShieldCheck,
	ShoppingBag,
	Star,
	Store,
	Tag,
	TrendingUp,
	UserRound,
	UsersRound,
	Wrench,
	X,
} from 'lucide-react';
import toast from 'react-hot-toast';

const LocationMap = dynamic(() => import('@/components/LocationMap'), {
	ssr: false,
	loading: () => <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-500">Loading interactive map…</div>,
});

const DEFAULT_MAP_CENTER: [number, number] = [14.5995, 120.9842];
type CoverageArea = { code: string; name: string };
type CoverageDistrict = { name: string; areas: CoverageArea[] };
type CoverageOption = { code: string; name: string; districts: CoverageDistrict[] };
type BusinessCategory = { id: number; name: string; isActive: boolean; displayOrder: number; subCategories?: Array<{ id: number; name: string; groupName?: string }> };

const benefits = [
	{
		icon: TrendingUp,
		title: 'Increase Sales & Visibility',
		text: 'Reach more customers in your local community.',
	},
	{
		icon: Wrench,
		title: 'All-in-One Business Tools',
		text: 'Manage orders, menus, bookings, and more in one platform.',
	},
	{
		icon: ShieldCheck,
		title: 'Secure & Reliable',
		text: 'Safe transactions and data protection you can trust.',
	},
	{
		icon: UsersRound,
		title: 'Dedicated Support',
		text: 'Get help from your local Zone Coordinator whenever you need it.',
	},
];

const features = [
	{
		icon: QrCode,
		color: 'bg-[#7833d7]',
		title: 'In-Store Ordering',
		image: '/images/merchantQRordering.png',
		text: 'Customers scan the QR code in your store to browse the menu and place orders directly from their phone.',
	},
	{
		icon: ShoppingBag,
		color: 'bg-[#35b86d]',
		title: 'Pick-Up Orders',
		image: '/images/merchantPickupOrder.png',
		text: 'Let customers order ahead and pick up at their convenience. Faster service, happier customers.',
	},
	{
		icon: CalendarDays,
		color: 'bg-[#075cff]',
		title: 'Dining Reservation',
		image: '/images/merchantReservedImage.png',
		text: 'Allow customers to reserve tables in advance and manage bookings with ease.',
	},
	{
		icon: BookOpen,
		color: 'bg-[#f39200]',
		title: 'Digital Menu',
		image: '/images/merchantDigitalMenu.png',
		text: 'Showcase your menu with photos, descriptions, and prices—easy to update anytime.',
	},
	{
		icon: Tag,
		color: 'bg-[#ed0000]',
		title: 'BillOut with Auto Discount (Senior / PWD)',
		image: '/images/merchantBillOutDiscount.png',
		text: 'Automatic discounts for Senior Citizens and PWD for a faster and fairer billing experience.',
	},
	{
		icon: Star,
		color: 'bg-[#7833d7]',
		title: 'Customer Ratings & Reviews',
		image: '/images/merchantCustomerReview.png',
		text: 'Build trust and credibility with real reviews and star ratings from your happy customers.',
	},
];

const marketStats = [
	{ value: '97.5M', label: 'Internet Users', detail: '83.8% Internet Penetration' },
	{ value: '74%–99%', label: 'Smartphone Penetration', detail: 'Nationwide' },
	{ value: '142M', label: 'Active Mobile Connections', detail: 'Multiple SIMs/devices' },
	{ value: '89%', label: 'Android Market Share', detail: '' },
	{ value: '70M+', label: 'Active Online Shoppers', detail: '' },
	{ value: '8.4', label: 'Online Purchases Per Month', detail: '93% shop via smartphones' },
];

export default function ForMerchantsPage() {
	const [location, setLocation] = useState<[number, number] | null>(null);
	const [locating, setLocating] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [mapExpanded, setMapExpanded] = useState(false);
	const [mapDialogOpen, setMapDialogOpen] = useState(false);
	const [categoryName, setCategoryName] = useState('');
	const [subCategoryName, setSubCategoryName] = useState('');
	const [businessCategories, setBusinessCategories] = useState<BusinessCategory[]>([]);
	const [categoriesLoading, setCategoriesLoading] = useState(true);
	const [businessAddress, setBusinessAddress] = useState('');
	const [hasBranches, setHasBranches] = useState('');
	const [geocodingAddress, setGeocodingAddress] = useState(false);
	const [coverageOptions, setCoverageOptions] = useState<CoverageOption[]>([]);
	const [coverageLoading, setCoverageLoading] = useState(true);
	const [coverageError, setCoverageError] = useState('');
	const [selectedCity, setSelectedCity] = useState('');
	const [selectedDistrict, setSelectedDistrict] = useState('');
	const [selectedArea, setSelectedArea] = useState('');
	const selectedDistrictOption = coverageOptions
		.find(city => city.name === selectedCity)
		?.districts.find(district => district.name === selectedDistrict);
	const normalizedCategory = categoryName.trim().toLowerCase();
	const isFoodBusiness = /(food|restaurant|cafe|bakery|catering|beverage)/.test(normalizedCategory);
	const isTradingBusiness = /(trad|retail|shop|store|merchandise|wholesale)/.test(normalizedCategory);
	const loadCoverageOptions = useCallback(() => {
		setCoverageLoading(true);
		setCoverageError('');
		fetch('/api/backend/merchant-applications/coverage-options')
			.then(response => response.ok ? response.json() : Promise.reject(new Error('Unable to load coordinator coverage')))
			.then(body => {
				const options = Array.isArray(body) ? body : [];
				setCoverageOptions(options);
				if (!options.length) setCoverageError('No active coordinator coverage areas are configured.');
			})
			.catch(() => {
				setCoverageOptions([]);
				setCoverageError('City list is temporarily unavailable.');
			})
			.finally(() => setCoverageLoading(false));
	}, []);
	useEffect(() => {
		loadCoverageOptions();
		const retry = window.setTimeout(() => {
			if (!coverageOptions.length) loadCoverageOptions();
		}, 3000);
		return () => window.clearTimeout(retry);
		// Retry once after initial load; subsequent retries are user initiated.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	useEffect(() => {
		fetch('/api/backend/merchant-categories')
			.then(response => response.ok ? response.json() : Promise.reject(new Error('Unable to load business categories')))
			.then(body => {
				const categories = Array.isArray(body) ? body : [];
				setBusinessCategories(categories
					.filter((category): category is BusinessCategory => Boolean(category?.id && category?.name && category?.isActive !== false))
					.sort((left, right) => (left.displayOrder ?? 0) - (right.displayOrder ?? 0)));
			})
			.catch(() => setBusinessCategories([]))
			.finally(() => setCategoriesLoading(false));
	}, []);
	useEffect(() => {
		if (!selectedCity) return;

		const controller = new AbortController();
		const timer = window.setTimeout(async () => {
			const query = [businessAddress.trim(), selectedArea, selectedCity, 'Philippines'].filter(Boolean).join(', ');
			setGeocodingAddress(true);
			try {
				const findLocation = async (url: string) => {
					const response = await fetch(url, { signal: controller.signal });
					if (!response.ok) return null;
					const body = await response.json();
					return body.status === 'ok' ? body.results?.[0] ?? null : null;
				};
				const encodedQuery = encodeURIComponent(query);
				const result = await findLocation(`/api/routing/geocode?q=${encodedQuery}&limit=1`)
					?? await findLocation(`/api/geocode?q=${encodedQuery}`);
				const latitude = Number(result?.location?.lat);
				const longitude = Number(result?.location?.lng);
				if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
					setLocation([latitude, longitude]);
				}
			} catch (error) {
				if (error instanceof Error && error.name === 'AbortError') return;
			} finally {
				if (!controller.signal.aborted) setGeocodingAddress(false);
			}
		}, businessAddress.trim() ? 600 : 150);

		return () => {
			window.clearTimeout(timer);
			controller.abort();
		};
	}, [businessAddress, selectedArea, selectedCity]);
	useEffect(() => {
		if (!mapDialogOpen) return;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setMapDialogOpen(false);
		};
		document.addEventListener('keydown', closeOnEscape);
		return () => document.removeEventListener('keydown', closeOnEscape);
	}, [mapDialogOpen]);
	const selectMapLocation = useCallback((latitude: number, longitude: number) => {
		setLocation([latitude, longitude]);
	}, []);
	const moveMapPin = useCallback((event: L.DragEndEvent) => {
		const point = event.target.getLatLng();
		setLocation([point.lat, point.lng]);
	}, []);
	const locateStore = () => {
		if (!navigator.geolocation) return toast.error('Location is not supported by this browser.');
		setLocating(true);
		navigator.geolocation.getCurrentPosition(position => { setLocation([position.coords.latitude, position.coords.longitude]); setLocating(false); toast.success('Store location pinned.'); }, () => { setLocating(false); toast.error('Allow location access to pin the store.'); }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
	};
	const submitLead = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault(); const form = event.currentTarget; setSubmitting(true);
		try {
			const values = Object.fromEntries(new FormData(form).entries());
			const response = await fetch('/api/backend/merchant-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, source: 'website_callback', latitude: location?.[0], longitude: location?.[1], subscription_amount: 0 }) });
			const contentType = response.headers.get('content-type') || '';
			const result = contentType.includes('application/json') ? await response.json() : { message: 'Merchant application service is unavailable.' };
			if (!response.ok) throw new Error(result.message || 'Unable to submit merchant application');
			toast.success('Your merchant application was submitted as unassigned.'); form.reset(); setLocation(null); setCategoryName(''); setSubCategoryName(''); setBusinessAddress(''); setHasBranches(''); setSelectedCity(''); setSelectedDistrict(''); setSelectedArea('');
		} catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to submit merchant application'); }
		finally { setSubmitting(false); }
	};
	return (
		<main className="min-h-screen overflow-x-hidden bg-[#f5faff] text-[#071333]">
			<MerchantHeader />

			<section className="grid min-w-0 items-stretch gap-5 px-4 py-6 md:grid-cols-[minmax(0,1.35fr)_minmax(360px,1fr)] lg:grid-cols-[minmax(0,1.7fr)_minmax(400px,1fr)] lg:px-9">
				<div className="relative order-2 h-[360px] min-w-0 max-w-full overflow-hidden rounded-[28px] bg-white sm:h-[460px] md:order-1 md:h-auto md:min-h-[810px] md:self-stretch md:rounded-[38px]">
					<Image
						src="/images/weKonnekCityBackground.png"
						alt=""
						fill
						aria-hidden="true"
						sizes="(min-width: 1024px) 62vw, 100vw"
						className="object-cover object-bottom opacity-80"
					/>
					<div className="relative z-10 aspect-[1024/837] w-full overflow-hidden bg-white shadow-[0_18px_32px_rgba(37,99,235,0.08)]">
					<Image
						src="/images/merchantHeroLeft.png"
						alt="Merchant using WeKonnek to grow his business"
						fill
						priority
						sizes="(min-width: 1024px) 62vw, 100vw"
						className="object-contain object-top"
					/>
					</div>
				</div>

				<div id="callback" className="order-1 min-w-0 max-w-full overflow-hidden rounded-2xl border border-[#ccd8e9] bg-white p-5 shadow-[0_16px_40px_rgba(49,91,150,0.12)] md:order-2 lg:p-7">
					<div className="flex items-start gap-4">
						<UsersRound className="mt-1 shrink-0 text-[#075cff]" size={45} strokeWidth={2.2} />
						<div>
							<h1 className="text-2xl font-black leading-tight">
								GET IN TOUCH WITH OUR<br />
								<span className="text-[#075cff]">ZONE COORDINATOR</span>
							</h1>
							<p className="mt-2 text-sm leading-5 text-[#17223b]">
								Submit your details and our Zone Coordinator will contact you for onboarding and support.
							</p>
						</div>
					</div>

					<form onSubmit={submitLead} className="mt-5 min-w-0 space-y-3">
						<FormField name="contact_name" icon={UserRound} placeholder="Full Name" required />
						<FormField name="business_name" icon={Store} placeholder="Business / Store Name" required />
						<FormField name="phone" icon={Phone} placeholder="Mobile Number" type="tel" required />
						<FormField name="email" icon={Mail} placeholder="Email Address" type="email" required />
						<label className="merchant-input flex items-center gap-3">
							<BriefcaseBusiness size={19} className="shrink-0 text-[#7187a8]" />
							<select name="category_name" value={categoryName} onChange={(event) => { setCategoryName(event.target.value); setSubCategoryName(''); }} required disabled={categoriesLoading} className="min-w-0 flex-1 bg-transparent outline-none disabled:cursor-wait disabled:text-slate-400">
								<option value="">{categoriesLoading ? 'Loading business categories…' : 'Business Category'}</option>
								{businessCategories.map(category => <option key={category.id} value={category.name}>{category.name}</option>)}
							</select>
						</label>
						<label className="merchant-input flex items-center gap-3">
							<Tag size={19} className="shrink-0 text-[#7187a8]" />
							<select name="sub_category_name" value={subCategoryName} onChange={event => setSubCategoryName(event.target.value)} required disabled={!categoryName} className="min-w-0 flex-1 bg-transparent outline-none disabled:text-slate-400">
								<option value="">Business Subcategory</option>
								{businessCategories.find(category => category.name === categoryName)?.subCategories?.map(subcategory => <option key={subcategory.id} value={subcategory.name}>{subcategory.groupName ? `${subcategory.groupName} — ` : ''}{subcategory.name}</option>)}
							</select>
						</label>
						<label className="merchant-input flex items-center gap-3">
							<MapPin size={19} className="shrink-0 text-slate-500" />
							<input name="address" value={businessAddress} onChange={event => setBusinessAddress(event.target.value)} placeholder="Store / Business Address" required className="min-w-0 flex-1 bg-transparent outline-none" />
						</label>
						<div className="grid min-w-0 gap-3 sm:grid-cols-2">
							<select name="city_municipality" value={selectedCity} onChange={event => { setSelectedCity(event.target.value); setSelectedDistrict(''); setSelectedArea(''); }} required className="merchant-input bg-white">
								<option value="">{coverageLoading ? 'Loading cities…' : coverageError ? 'Cities unavailable' : 'City / Municipality'}</option>
								{coverageOptions.map(city => <option key={city.code} value={city.name}>{city.name.replace(/^City of /, '').replace(/ \(City\)$/, '')}</option>)}
							</select>
							<select name="council_district" value={selectedDistrict} onChange={event => { setSelectedDistrict(event.target.value); setSelectedArea(''); }} required disabled={!selectedCity} className="merchant-input bg-white disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400">
								<option value="">City Council District</option>
								{coverageOptions.find(city => city.name === selectedCity)?.districts.map(district => <option key={district.name} value={district.name}>{district.name}</option>)}
							</select>
						</div>
						{coverageError && <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><span>{coverageError}</span><button type="button" onClick={loadCoverageOptions} disabled={coverageLoading} className="font-bold underline disabled:opacity-60">{coverageLoading ? 'Loading…' : 'Retry'}</button></div>}
						<select name="geographic_area" value={selectedArea} onChange={event => setSelectedArea(event.target.value)} required={Boolean(selectedDistrictOption?.areas.length)} disabled={!selectedDistrict || !selectedDistrictOption?.areas.length} className="merchant-input w-full bg-white disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400">
							<option value="">{selectedDistrictOption && !selectedDistrictOption.areas.length ? 'Whole district — no named areas configured' : 'Area within the council district'}</option>
							{selectedDistrictOption?.areas.map(area => <option key={area.code} value={area.name}>{area.name}</option>)}
						</select>
						<div className={`grid min-w-0 gap-3 ${hasBranches === 'yes' ? 'sm:grid-cols-2' : ''}`}>
							<select name="has_branches" value={hasBranches} onChange={(event) => setHasBranches(event.target.value)} required className="merchant-input bg-white text-slate-600">
								<option value="" disabled>Does the business have branches?</option>
								<option value="no">No branches</option>
								<option value="yes">Yes, with branches</option>
							</select>
							{hasBranches === 'yes' ? (
								<input name="branch_count" type="number" min="1" step="1" required className="merchant-input" placeholder="How many branches?" />
							) : null}
						</div>
						{(isFoodBusiness || isTradingBusiness) && (
							<input
								name="product_count"
								type="number"
								min="1"
								step="1"
								required
								className="merchant-input w-full"
								placeholder={isFoodBusiness ? 'How many products or items are on the menu?' : 'How many products do you sell?'}
							/>
						)}
						<div className="min-w-0 overflow-hidden rounded-xl border border-[#ccd8e9] bg-white">
							<div className="flex items-center gap-3 border-b border-[#dbe4f0] px-4 py-3">
							<MapPin size={19} className="text-[#075cff]" />
							<button type="button" onClick={() => setMapExpanded(current => !current)} className="min-w-0 flex-1 text-left">
								<p className="text-sm font-bold text-[#17223b]">Pin your store location</p>
								<p className="truncate text-xs text-slate-500">{geocodingAddress ? 'Finding the selected address…' : location ? `${location[0].toFixed(6)}, ${location[1].toFixed(6)}` : 'Use GPS or open the map to drop a pin.'}</p>
							</button>
							<button type="button" onClick={locateStore} disabled={locating} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#eaf1ff] px-3 py-2 text-xs font-bold text-[#075cff] transition hover:bg-[#dbe8ff] disabled:opacity-60">
								<LocateFixed size={16} /> {locating ? 'Locating…' : 'Use GPS'}
							</button>
							<button type="button" onClick={() => setMapExpanded(current => !current)} aria-label={mapExpanded ? 'Hide map' : 'Open map'} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
								<ChevronDown size={18} className={`transition-transform ${mapExpanded ? 'rotate-180' : ''}`} />
							</button>
							</div>
							{mapExpanded && <div className="relative h-64 w-full">
								<LocationMap selectedLocation={location} defaultCenter={location ?? DEFAULT_MAP_CENTER} onMapClick={selectMapLocation} onMarkerDrag={moveMapPin} selectedZoom={17} />
								<button
									type="button"
									onClick={() => setMapDialogOpen(true)}
									className="absolute inset-0 z-[500] flex items-end justify-center bg-transparent p-3 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#075cff]"
									aria-label="Open larger map to choose exact store location"
								>
									<span className="rounded-full bg-white/95 px-4 py-2 text-xs font-bold text-[#075cff] shadow-lg">
										Click to choose the exact location
									</span>
								</button>
							</div>}
						</div>
						{mapDialogOpen && (
							<div
								className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6"
								role="dialog"
								aria-modal="true"
								aria-labelledby="store-location-map-title"
								onMouseDown={event => {
									if (event.target === event.currentTarget) setMapDialogOpen(false);
								}}
							>
								<div className="flex h-[min(88vh,850px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
									<div className="flex items-center gap-4 border-b border-slate-200 px-4 py-3 sm:px-6">
										<div className="min-w-0 flex-1">
											<h2 id="store-location-map-title" className="font-black text-[#17223b]">Choose the exact store location</h2>
											<p className="text-xs text-slate-500">Click the street or drag the red pin to the store entrance.</p>
										</div>
										{location && <p className="hidden text-xs font-semibold text-slate-500 sm:block">{location[0].toFixed(6)}, {location[1].toFixed(6)}</p>}
										<button type="button" onClick={() => setMapDialogOpen(false)} className="rounded-full p-2 text-slate-600 hover:bg-slate-100" aria-label="Close larger map">
											<X size={22} />
										</button>
									</div>
									<div className="min-h-0 flex-1">
										<LocationMap selectedLocation={location} defaultCenter={location ?? DEFAULT_MAP_CENTER} onMapClick={selectMapLocation} onMarkerDrag={moveMapPin} selectedZoom={18} />
									</div>
									<div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:px-6">
										<p className="text-xs text-slate-500">Street names are visible at this zoom level.</p>
										<button type="button" onClick={() => setMapDialogOpen(false)} className="rounded-xl bg-[#075cff] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#0049d8]">
											Use this location
										</button>
									</div>
								</div>
							</div>
						)}
						<textarea name="business_description" rows={5} className="merchant-input block min-h-32 w-full resize-y" placeholder="Tell us about your business" />
						<label className="flex items-start gap-2 text-xs">
							<input type="checkbox" required className="mt-0.5 size-4" />
							<span>
								I agree to the <Link href="#" className="font-bold text-[#075cff]">Terms &amp; Conditions</Link> and{' '}
								<Link href="/privacy" className="font-bold text-[#075cff]">Privacy Policy</Link>
							</span>
						</label>
						<button disabled={submitting} className="h-[51px] w-full rounded-xl bg-[#075cff] font-extrabold text-white transition hover:bg-[#0049d8] disabled:opacity-60">
							{submitting ? 'Submitting…' : 'Submit for Callback'}
						</button>
					</form>
				</div>
			</section>

			<section id="services" className="px-4 pb-3 lg:px-9">
				<div className="rounded-2xl border border-[#ccd8e9] bg-white p-4 shadow-[0_10px_30px_rgba(49,91,150,0.1)]">
					<h2 className="mb-4 text-2xl font-black text-[#075cff]">POWERFUL IN-STORE FEATURES</h2>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
						{features.map(({ icon: Icon, color, title, image, text }) => (
							<article key={title} className="flex min-w-0 flex-col rounded-xl border border-[#ccd8e9] bg-white p-3">
								<div className={`mx-auto flex size-14 items-center justify-center rounded-full text-white ${color}`}><Icon size={30} strokeWidth={2.2} /></div>
								<h3 className="flex min-h-14 items-center justify-center text-center text-sm font-black leading-4">{title}</h3>
								<div className="relative h-[220px] overflow-hidden rounded-xl bg-[#edf4ff]">
									<Image src={image} alt={title} fill sizes="(min-width: 1536px) 15vw, (min-width: 1024px) 30vw, 50vw" className="object-cover" />
								</div>
								<p className="mt-4 text-[13px] leading-[19px]">{text}</p>
							</article>
						))}
					</div>
				</div>
			</section>

			<section className="grid gap-3 px-4 pb-3 lg:grid-cols-3 lg:px-9">
				<div className="relative min-h-[300px] overflow-hidden rounded-2xl border border-[#ccd8e9] bg-white">
					<Image src="/images/merchants.png" alt="Push discount notifications help merchants reach nearby customers" fill sizes="(min-width: 1024px) 33vw, 100vw" className="object-cover object-top" />
				</div>

				<div className="rounded-2xl border border-[#ccd8e9] bg-white p-6">
					<h2 className="mb-6 text-2xl font-black text-[#075cff]">WHY MERCHANTS LOVE WEKONNEK</h2>
					<div className="space-y-5">
						{benefits.map(({ icon: Icon, title, text }) => (
							<div key={title} className="flex gap-4">
								<Icon className="shrink-0 text-[#075cff]" size={31} />
								<div><h3 className="font-extrabold">{title}</h3><p className="mt-1 text-sm">{text}</p></div>
							</div>
						))}
					</div>
				</div>

				<div className="rounded-2xl border border-[#ccd8e9] bg-white p-6">
					<h2 className="text-2xl font-black text-[#075cff]">Simple Flat Pricing for <span className="text-red-600">Local Businesses</span></h2>
					<p className="mt-9 text-2xl font-black leading-snug">Affordable. Predictable. No Hidden Fees.<br />More savings. More customers. More growth.</p>
				</div>
			</section>

			<section className="overflow-hidden rounded-t-[28px] bg-gradient-to-br from-[#182854] to-[#075cff] px-5 py-8 text-white lg:px-9">
				<div className="grid items-center gap-6 lg:grid-cols-[260px_1fr]">
					<div className="relative mx-auto h-56 w-52 overflow-hidden lg:h-64 lg:w-60">
						<Image src="/images/weko-mascot.png" alt="Blue WeKonnek mascot" fill sizes="240px" className="object-contain object-center" />
					</div>
					<div>
						<h2 className="text-4xl font-black tracking-tight sm:text-5xl">LET&apos;S GROW <span className="text-[#ffcc00]">TOGETHER!</span></h2>
						<p className="mt-4 text-lg font-bold sm:text-xl">Join thousands of local businesses already growing with <span className="text-[#ffcc00]">WeKonnek.</span></p>
					</div>
				</div>

				<div className="mt-5 grid overflow-hidden rounded-2xl bg-white text-[#071333] sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
					{marketStats.map(({ value, label, detail }) => (
						<div key={label} className="flex min-h-[220px] flex-col items-center justify-center border-b border-r border-[#ccd8e9] p-5 text-center">
							<div className="mb-4 flex size-16 items-center justify-center rounded-full bg-[#1749e8] text-2xl text-white">•</div>
							<strong className="text-4xl font-black text-[#1749e8]">{value}</strong>
							<h3 className="mt-1 text-lg font-black leading-5">{label}</h3>
							{detail && <p className="mt-5 text-sm text-slate-500">{detail}</p>}
						</div>
					))}
				</div>

				<div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
					<div className="rounded-2xl bg-[#182854] p-8">
						<h3 className="text-4xl font-black text-[#ffcc00]">A ₱1.34T – ₱1.57T</h3>
						<p className="mt-3 text-2xl font-black">ONLINE SPENDING OPPORTUNITY<br />IN THE PHILIPPINES (2025)</p>
						<p className="mt-5 text-lg">Philippine e-commerce market size estimated at $24B – $28B annually</p>
					</div>
					<div className="grid gap-4 rounded-2xl bg-white p-7">
						<a href="#callback" className="flex items-center justify-center rounded-xl bg-red-600 px-5 py-4 text-center text-lg font-black text-white">Submit for Callback</a>
						<Link href="/customer/dashboard" className="flex items-center justify-center rounded-xl border-2 border-[#d6dfed] px-5 py-4 text-center text-lg font-black text-[#1749e8]">Open WeKonnek App</Link>
					</div>
				</div>
			</section>
		</main>
	);
}

function MerchantHeader() {
	return (
		<header className="relative z-30 flex h-[114px] items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-9">
			<Link href="/" aria-label="WeKonnek home"><Image src="/images/weKonnekLogov1.png" alt="WeKonnek" width={1536} height={1024} priority className="h-24 w-auto object-contain" /></Link>
			<nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-[52px] whitespace-nowrap text-[15px] font-semibold xl:flex">
				<Link href="/">Home</Link>
				<Link href="/for-merchants" className="relative font-black text-[#075cff] after:absolute after:-bottom-4 after:left-1/2 after:h-[3px] after:w-12 after:-translate-x-1/2 after:rounded-full after:bg-[#075cff]">For Merchants</Link>
				<Link href="/coordinators">For Coordinators</Link><Link href="/contact">Contact</Link>
			</nav>
			<Link href="/merchant" className="inline-flex h-[50px] items-center gap-2 rounded-xl bg-[#075cff] px-7 text-sm font-black text-white shadow-[0_12px_24px_rgba(0,86,255,0.24)]"><Store size={17} /> Merchant Portal</Link>
		</header>
	);
}

function FormField({ name, icon: Icon, placeholder, type = 'text', required = false }: { name: string; icon: typeof UserRound; placeholder: string; type?: string; required?: boolean }) {
	return <label className="merchant-input flex items-center gap-3"><Icon size={19} className="shrink-0 text-slate-500" /><input name={name} required={required} type={type} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent outline-none" /></label>;
}
