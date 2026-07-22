import Image from 'next/image';
import Link from 'next/link';
import AddToHomeScreenButton from '@/components/AddToHomeScreenButton';
import {
	ArrowRight,
	Check,
	HeartPulse,
	Pill,
	ShoppingBag,
	Store,
	Truck,
	UserRound,
	Users,
	Utensils,
	Wrench,
	Gift,
} from 'lucide-react';


const categories = [
	{
		name: 'Food Delivery',
		icon: Truck,
		text: 'Order your favorite meals fast.',
		color: 'bg-[#0056FF]',
		href: '/customer/food',
	},
	{
		name: 'Restaurants',
		icon: Utensils,
		text: 'Dine in, take out, or reserve.',
		color: 'bg-[#EF3333]',
		href: '/customer/food?type=restaurant',
	},
	{
		name: 'Groceries',
		icon: ShoppingBag,
		text: 'Daily needs, delivered.',
		color: 'bg-[#39B66A]',
		href: '/customer/mart',
	},
	{
		name: 'Pharmacy',
		icon: Pill,
		text: 'Medicines and essentials.',
		color: 'bg-[#17A8C7]',
		href: '/customer/mart?type=pharmacy',
	},
	{
		name: 'Shops',
		icon: ShoppingBag,
		text: 'Discover local products.',
		color: 'bg-[#7B35D8]',
		href: '/customer/mart?type=shop',
	},
	{
		name: 'Services',
		icon: Wrench,
		text: 'Book trusted services.',
		color: 'bg-[#F47721]',
		href: '/customer/express',
	},
	{
		name: 'Wellness',
		icon: HeartPulse,
		text: 'Health and well-being.',
		color: 'bg-[#E63363]',
		href: '/customer/express?type=wellness',
	},
	{
		name: 'Deals',
		icon: Gift,
		text: 'Exclusive promos and vouchers.',
		color: 'bg-[#F5AE17]',
		href: '/customer/deals',
	},
];

export default function HomePage() {
	return (
		<main className="min-h-screen overflow-x-hidden bg-white text-[#031E3F]">
			<Header />
			<Hero />
			<CategorySection />
			<BenefitsStrip />
			<FooterStrip />
		</main>
	);
}

function Header() {
	return (
		<header className="relative z-30 flex h-[100px] w-full items-center justify-between bg-white px-4 sm:px-6 lg:px-8">
			<Link href="/" className="flex shrink-0 items-center" aria-label="WeKonnek home">
				<Image
					src="/images/weKonnekLogov1.png"
					alt="WeKonnek"
					width={1536}
					height={1024}
					priority
					className="h-20 w-auto object-contain lg:h-24"
				/>
			</Link>

			<nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-[38px] whitespace-nowrap text-sm font-semibold text-[#06113F] xl:flex">
				<Link
					href="/"
					className="relative font-black text-[#0056FF] after:absolute after:-bottom-[15px] after:left-1/2 after:h-[3px] after:w-7 after:-translate-x-1/2 after:rounded-full after:bg-[#0056FF]">
					Home
				</Link>
				<Link href="/for-merchants">For Merchants</Link>
				<Link href="/coordinators">For Coordinators</Link>
				<Link href="/contact">Contact</Link>
			</nav>

			<Link
				href="/customer/dashboard"
				className="inline-flex h-[46px] items-center justify-center whitespace-nowrap rounded-xl bg-[#0056FF] px-6 text-sm font-black text-white shadow-[0_12px_24px_rgba(0,86,255,0.24)] sm:min-w-[201px]">
				Open WeKonnek App
			</Link>
		</header>
	);
}

function Hero() {
	return (
		<section
			id="about"
			className="relative -mt-1 w-full overflow-hidden bg-white">
			<CityBackdrop />

			<div className="absolute inset-0 bg-white/20" />

			<div className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center px-4 pb-8 pt-3 sm:px-6 sm:pb-10 md:pt-5 lg:px-8 xl:min-h-[620px] xl:py-3 2xl:px-12">
				<div className="grid w-full grid-cols-1 items-center gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,1fr)_minmax(270px,0.58fr)] xl:gap-6 2xl:gap-10">
					{/* Left content */}
					<div className="mx-auto w-full max-w-2xl text-center xl:mx-0 xl:text-left">
						<h1 className="text-[clamp(3rem,13vw,5.75rem)] font-black leading-none tracking-normal xl:text-[6.25rem]">
							<span className="text-blue-600">WE</span>
							<span className="text-red-600">KONNEK</span>
						</h1>

						<h2 className="mt-3 text-[clamp(1.45rem,5vw,2.4rem)] font-extrabold leading-tight text-blue-600">
							CONNECTING COMMUNITIES
						</h2>

						<p className="mx-auto mt-4 max-w-xl text-base font-medium leading-relaxed text-slate-900 sm:text-lg md:mt-5 md:text-xl xl:mx-0 xl:mt-7">
							The smart digital companion of{' '}
							<span className="font-bold text-blue-600">We</span>
							<span className="font-bold text-red-600">Konnek</span>. We connect
							businesses, customers, and communities in one hyperlocal
							ecosystem.
						</p>

					</div>

					{/* Mascot + Phone */}
					<div className="flex items-end justify-center rounded-[28px] bg-white/35 px-2 pt-4 sm:px-4 xl:min-h-[520px] xl:bg-transparent xl:p-0">
						<div className="relative flex max-w-full items-end justify-center">
							<Image
								src="/images/weKon.png"
								alt="WeKo Mascot"
								width={360}
								height={520}
								priority
								sizes="(max-width: 640px) 38vw, (max-width: 1024px) 260px, 320px"
								className="relative z-20 h-[210px] w-auto object-contain sm:h-[250px] md:h-[300px] lg:h-[340px] xl:h-[420px]"
							/>

							<Image
								src="/images/wekonnetPhone.png"
								alt="WeKonnek App Preview"
								width={300}
								height={560}
								priority
								sizes="(max-width: 640px) 42vw, (max-width: 1024px) 260px, 300px"
								className="relative z-10 -ml-8 h-[220px] w-auto object-contain sm:-ml-10 sm:h-[265px] md:h-[315px] lg:h-[360px] xl:-ml-12 xl:h-[440px]"
							/>
						</div>
					</div>

					{/* QR Card */}
					<div className="flex justify-center xl:col-span-1">
						<div className="grid w-full max-w-md items-center gap-4 rounded-2xl bg-slate-950 p-5 text-white shadow-2xl sm:max-w-2xl sm:grid-cols-[1fr_auto] sm:p-6 xl:block xl:w-[310px] xl:p-7">
							<div>
								<h3 className="text-xl font-black leading-tight sm:text-2xl">
									SCAN TO GET STARTED!
								</h3>

								<p className="mt-3 text-base leading-snug text-white/90 sm:text-lg xl:mt-5">
									Scan the QR code to open WeKonnek App instantly.
								</p>

								<AddToHomeScreenButton className="mt-4 hidden w-full items-center justify-center gap-3 rounded-xl border border-white/70 px-4 py-3 text-sm font-bold text-white hover:bg-white/10 sm:flex xl:mt-5" />
							</div>

							<div className="mx-auto hidden w-full rounded-xl bg-white p-3 min-[430px]:block min-[430px]:max-w-[180px] sm:w-[150px] xl:mt-6 xl:w-auto xl:max-w-none xl:p-4">
								<Link href="/customer/dashboard" aria-label="Open the WeKonnek customer app">
									<Image
										src="/images/wekonnek-qr.png"
										alt="QR code for the WeKonnek customer app"
										width={250}
										height={250}
										sizes="(max-width: 640px) 180px, (max-width: 1280px) 150px, 250px"
										className="mx-auto h-auto w-full"
									/>
								</Link>
							</div>

							<AddToHomeScreenButton className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/70 px-4 py-3 text-sm font-bold text-white hover:bg-white/10 min-[430px]:hidden sm:hidden" />
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

function CityBackdrop() {
	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			<Image
				src="/images/weKonnekCityBackground.png"
				alt=""
				fill
				priority
				sizes="120vw"
				className="object-cover object-bottom"
			/>
		</div>
	);
}

function CategorySection() {
	return (
		<section
			id="services"
			className="relative z-20 -mt-[2px] w-full rounded-t-xl bg-white px-4 pb-7 pt-5 shadow-[0_-8px_24px_rgba(3,30,63,0.05)] sm:px-6 lg:px-8 2xl:px-12">
			<h2 className="text-[19px] font-black tracking-wide">
				<span className="text-[#0056FF]">ONE APP.</span>{' '}
				<span className="text-[#E60000]">ENDLESS POSSIBILITIES.</span>
			</h2>
		<div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8 2xl:gap-5">
			{categories.map(({ name, icon: Icon, text, color, href }) => (
				<Link
					key={name}
					href={href}
					className="flex min-h-[138px] flex-col items-center rounded-xl border border-[#EEF2FA] bg-white px-3 py-4 text-center shadow-[0_8px_18px_rgba(3,30,63,0.06)] transition-all hover:shadow-lg hover:border-[#D0DBEF] hover:-translate-y-0.5">
					<div
						className={`flex h-[58px] w-[58px] items-center justify-center rounded-full ${color} text-white shadow-lg`}>
						<Icon className="h-7 w-7" />
					</div>
					<h3 className="mt-3 text-[13px] font-black">{name}</h3>
					<p className="mt-2 text-[11px] font-medium leading-snug text-[#06113F]/75">
						{text}
					</p>
				</Link>
			))}
		</div>
		</section>
	);
}

const benefits = [
	{
		title: 'BENEFITS FOR CUSTOMERS',
		tone: 'blue' as const,
		icon: ShoppingBag,
		image: '/images/wekonnetPhone.png',
		imageAlt: 'WeKonnek app preview',
		items: [
			'Easy store onboarding',
			'Powerful business tools',
			'Increase sales & visibility',
			'Safe & secure transactions',
		],
	},
	{
		title: 'BENEFITS FOR MERCHANTS',
		tone: 'green' as const,
		icon: Store,
		image: '/images/weko-merchant.png',
		imageAlt: 'WeKo merchant assistant',
		items: [
			'Easy store onboarding',
			'Powerful business tools',
			'Increase sales & visibility',
			'Safe & secure transactions',
		],
	},
	{
		title: 'BENEFITS FOR COMMUNITIES',
		tone: 'violet' as const,
		icon: Users,
		image: '/images/weko-mascot.png',
		imageAlt: 'WeKo community assistant',
		items: [
			'Support local businesses',
			'Create local jobs',
			'Stronger connections',
			'Stronger & better communities',
		],
	},
];

const benefitTones = {
	blue: {
		text: 'text-[#0056FF]',
		check: 'text-[#0056FF]',
		bg: 'from-[#F2F7FF] to-[#EAF3FF]',
		ring: 'border-[#BBD5FF] bg-[#F4F8FF] text-[#0056FF]',
	},
	green: {
		text: 'text-[#168E3F]',
		check: 'text-[#168E3F]',
		bg: 'from-[#F4FFF7] to-[#EAF8EF]',
		ring: 'border-[#A9E6BE] bg-[#F2FFF6] text-[#168E3F]',
	},
	violet: {
		text: 'text-[#5B32F5]',
		check: 'text-[#5B32F5]',
		bg: 'from-[#F8F5FF] to-[#F0ECFF]',
		ring: 'border-[#CDBDFF] bg-[#F8F5FF] text-[#5B32F5]',
	},
};

function BenefitsStrip() {
	return (
		<section
			id="merchants"
			className="grid w-full gap-2 px-4 pb-5 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:px-8 2xl:px-12">
			{benefits.map((benefit) => {
				const tone = benefitTones[benefit.tone];
				const Icon = benefit.icon;

				return (
					<div
						key={benefit.title}
						className={`relative min-h-[132px] overflow-hidden rounded-xl border border-[#E7EEF8] bg-gradient-to-r ${tone.bg} px-5 py-4 shadow-[0_8px_18px_rgba(3,30,63,0.06)]`}>
						<div className="relative z-10 max-w-[58%]">
							<h2
								className={`text-[14px] font-black leading-tight ${tone.text}`}>
								{benefit.title}
							</h2>
							<ul className="mt-3 space-y-2 text-[11px] font-medium leading-none text-[#06113F]">
								{benefit.items.map((item) => (
									<li key={item} className="flex items-center gap-2">
										<Check className={`h-3.5 w-3.5 shrink-0 ${tone.check}`} />
										{item}
									</li>
								))}
							</ul>
						</div>

						<div
							className={`absolute right-6 top-1/2 z-20 flex h-[58px] w-[58px] -translate-y-1/2 items-center justify-center rounded-full border ${tone.ring}`}>
							<Icon className="h-8 w-8" />
						</div>
						<Image
							src={benefit.image}
							alt={benefit.imageAlt}
							width={180}
							height={210}
							className="absolute bottom-[-28px] right-[64px] h-[150px] w-auto object-contain drop-shadow-[0_12px_18px_rgba(3,30,63,0.12)]"
							style={{ width: 'auto' }}
						/>
					</div>
				);
			})}
			<MerchantPromo />
		</section>
	);
}

function MerchantPromo() {
	return (
		<div className="relative min-h-[132px] overflow-hidden rounded-xl bg-[linear-gradient(135deg,#0056FF_0%,#0646CF_48%,#EAF3FF_100%)] px-5 py-4 text-white shadow-[0_8px_18px_rgba(0,86,255,0.18)]">
			<div className="relative z-20 max-w-[58%]">
				<h2 className="text-[15px] font-black leading-tight">
					GROW YOUR BUSINESS
					<br />
					WITH WEKONNEK
				</h2>
				<p className="mt-2 text-[11px] font-medium leading-snug">
					Reach more customers in your community.
				</p>
				<Link
					href="/auth/login?redirect=/merchant/dashboard"
					className="mt-3 inline-flex rounded-lg bg-[#E60000] px-3 py-2 text-[11px] font-black text-white shadow-[0_8px_16px_rgba(230,0,0,0.22)]">
					Become a Merchant
				</Link>
			</div>

			<div className="absolute bottom-4 left-[47%] z-10 hidden h-[58px] w-[84px] rounded-lg bg-white/20 shadow-[0_10px_18px_rgba(3,30,63,0.14)] sm:block">
				<div className="absolute inset-x-2 top-3 h-5 rounded-t-md bg-[#E60000]" />
				<div className="absolute inset-x-3 bottom-2 h-7 rounded-b-md bg-white/40" />
				<Store className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 text-white" />
			</div>
			<Image
				src="/images/weko-merchant.png"
				alt="WeKo merchant assistant"
				width={180}
				height={210}
				className="absolute bottom-[-32px] right-[-4px] z-20 h-[170px] w-auto object-contain drop-shadow-[0_12px_18px_rgba(3,30,63,0.18)]"
				style={{ width: 'auto' }}
			/>
		</div>
	);
}

const BLUE = '#0056FF';
const RED = '#E60000';

function FooterStrip() {
	return (
		<footer
			id="communities"
			className="grid w-full grid-cols-1 gap-5 px-4 pb-7 pt-2 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.25fr_1fr_1fr_1fr_1fr] lg:px-8 2xl:px-12">
			<div className="flex items-center gap-4">
				<Image
					src="/images/weKon.png"
					alt="WeKo"
					width={105}
					height={105}
					className="h-[96px] w-auto object-contain"
					style={{ width: 'auto' }}
				/>
				<div>
					<h3 className="text-[16px] font-black text-[#0056FF]">
						Hi! I&apos;m WeKo!
					</h3>
					<p className="mt-1 text-[12px] font-medium leading-relaxed">
						Your smart digital assistant. I&apos;m here to help you discover,
						connect, and grow with your community.
					</p>
				</div>
			</div>
			<FooterCard
				color={BLUE}
				title="For Customers"
				text="Discover, order, and enjoy from trusted local stores and services."
				link="Open WeKonnek App"
				href="/customer/dashboard"
			/>
			<FooterCard
				color={RED}
				title="For Merchants"
				text="Join WeKonnek and grow your business in your community."
				link="Sign Up Now"
				href="/auth/login?redirect=/merchant/dashboard"
			/>
			<FooterCard
				color="#69BE45"
				title="For Communities"
				text="Let&apos;s build stronger connections and a better future together."
				link="Learn More"
				href="/admin/dashboard"
			/>
			<div id="contact" className="flex flex-col justify-center">
				<p className="text-[13px] font-black text-[#0056FF]">FOLLOW US</p>
				<div className="mt-3 flex gap-3">
					{['f', '◎', '♪', '▶'].map((item, index) => (
						<span
							key={index}
							className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0056FF] text-[16px] font-black text-white">
							{item}
						</span>
					))}
				</div>
				<p className="mt-4 text-[15px] font-black text-[#0056FF]">
					www.wekonnek.com
				</p>
			</div>
		</footer>
	);
}

function FooterCard({ color, title, text, link, href }: { color: string; title: string; text: string; link: string; href: string }) {
	return (
		<div className="flex items-center gap-4 border-l border-[#DDE5F3] pl-6">
			<div
				className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white"
				style={{ backgroundColor: color }}>
				<UserRound className="h-8 w-8" />
			</div>
			<div>
				<h3 className="text-[13px] font-black">{title}</h3>
				<p className="mt-1 text-[11px] font-medium leading-relaxed">{text}</p>
				<Link
					href={href}
					className="mt-2 inline-flex items-center gap-1 text-[11px] font-black"
					style={{ color }}>
					{link} <ArrowRight className="h-3 w-3" />
				</Link>
			</div>
		</div>
	);
}
