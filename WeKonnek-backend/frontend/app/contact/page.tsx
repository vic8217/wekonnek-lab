import Image from 'next/image';
import Link from 'next/link';
import { Heart, Mail, MapPin, MessageCircle, MessagesSquare, Phone, Send, ShieldCheck, Store } from 'lucide-react';

const channels = [
	{ icon: Phone, title: 'Call Us', lines: ['+63 XXX XXX XXXX', 'Monday–Saturday', '8:00 AM–6:00 PM'] },
	{ icon: Mail, title: 'Email Us', lines: ['support@wekonnek.com', 'We reply within 24', 'business hours'], action: 'Contact now' },
	{ icon: MessageCircle, title: 'Chat With Us', lines: ['Live Chat on App', 'Available during business', 'hours'], action: 'Contact now' },
	{ icon: MessagesSquare, title: 'Message Us', lines: ['WeKonnek Official', 'Facebook Messenger'] },
	{ icon: MapPin, title: 'Visit Us', lines: ['WeKonnek Office', 'Metro Manila, Philippines', 'Monday–Friday', '9:00 AM–5:00 PM'] },
	{ icon: Store, title: 'For Merchants', lines: ['Merchant Support Line', '+63 XXX XXX XXXX'] },
];

export default function ContactPage() {
	return <main className="min-h-screen bg-white text-[#071333]">
		<ContactHeader />
		<section className="relative overflow-hidden bg-[#eef6ff]">
			<Image src="/images/weKonnekCityBackground.png" alt="" fill priority sizes="100vw" className="object-cover opacity-[.075]" />
			<div className="relative mx-auto grid min-h-[800px] max-w-[1480px] items-center gap-10 px-5 py-14 lg:grid-cols-[1.5fr_1fr] lg:px-7">
				<div className="relative min-h-[480px]">
					<div className="pt-24"><p className="text-sm font-black tracking-[.16em] text-red-600">WE&apos;RE HERE TO HELP</p><h1 className="mt-4 text-6xl font-black tracking-tight">Let&apos;s <span className="text-[#075cff]">Connect!</span></h1><p className="mt-5 max-w-xl text-lg leading-7 text-slate-600">Have a question, suggestion, or need assistance?<br />Our team is ready to help you and your business.</p>
						<div className="mt-8 grid max-w-[540px] gap-3 sm:grid-cols-3">{[
							{ icon: MessageCircle, title: 'Fast Response', text: 'We reply within 24 hours', color: 'text-[#075cff] bg-blue-50' },
							{ icon: Heart, title: 'We Care', text: 'Your satisfaction is our priority', color: 'text-red-500 bg-red-50' },
							{ icon: ShieldCheck, title: 'Secure Support', text: 'Your privacy is always protected', color: 'text-green-600 bg-green-50' },
						].map(({icon: Icon,title,text,color}) => <article key={title} className="flex items-center gap-3 rounded-2xl border border-[#ccd8e9] bg-white p-4"><span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${color}`}><Icon size={21} /></span><div><h3 className="text-sm font-black">{title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{text}</p></div></article>)}</div>
					</div>
					<Image src="/images/weko-mascot.png" alt="Blue WeKonnek mascot" width={1024} height={1536} className="absolute bottom-3 right-5 h-[300px] w-auto object-contain drop-shadow-xl" />
				</div>
				<ContactForm />
			</div>
		</section>

		<section className="mx-auto max-w-[1480px] px-5 py-16 lg:px-7">
			<p className="text-center text-xs font-black tracking-[.2em] text-red-600">SUPPORT CHANNELS</p><h2 className="mt-3 text-center text-4xl font-black">Other Ways to Reach Us</h2>
			<div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">{channels.map(({icon: Icon,title,lines,action}) => <article key={title} className="min-h-[235px] rounded-2xl border border-[#ccd8e9] bg-white p-5 shadow-[0_10px_28px_rgba(41,72,120,.06)]"><span className="flex size-12 items-center justify-center rounded-xl bg-blue-50 text-[#075cff]"><Icon size={24} /></span><h3 className="mt-5 font-black">{title}</h3><div className="mt-2 text-sm leading-6 text-slate-500">{lines.map(line => <p key={line}>{line}</p>)}</div>{action && <Link href="#message" className="mt-3 inline-block text-xs font-black text-[#075cff]">{action}</Link>}</article>)}</div>
			<div className="mt-16 grid items-center overflow-hidden rounded-[28px] bg-gradient-to-r from-[#075cff] to-[#071d50] px-12 py-10 text-white lg:grid-cols-[1fr_220px_1fr]">
				<div><h2 className="text-3xl font-black">We Value Your Feedback</h2><p className="mt-3 text-sm text-blue-100">Your feedback helps us improve WeKonnek and serve you better.</p><a href="#message" className="mt-6 inline-flex rounded-xl bg-white px-5 py-3 font-black text-[#075cff]">Submit Feedback</a></div>
				<Image src="/images/weko-mascot.png" alt="WeKonnek mascot" width={1024} height={1536} className="mx-auto h-40 w-auto object-contain" />
				<div><h2 className="text-2xl font-black">Follow Us</h2><p className="mt-3 max-w-md text-sm leading-6 text-blue-100">Stay updated with the latest news, promos, merchant stories, and community activities.</p><p className="mt-7 font-black underline">www.wekonnek.com</p></div>
			</div>
		</section>
	</main>;
}

function ContactForm() { return <section id="message" className="rounded-[28px] border border-[#ccd8e9] bg-white p-7 shadow-[0_18px_45px_rgba(42,73,120,.13)] lg:p-8"><p className="text-xs font-black tracking-[.2em] text-red-600">CONTACT WEKONNEK</p><h2 className="mt-3 text-3xl font-black">Send Us a Message</h2><form className="mt-7 space-y-4"><ContactField label="Full Name" /><ContactField label="Email Address" type="email" /><ContactField label="Mobile Number" optional placeholder="+63 9XX XXX XXXX or 09XX XXX XXXX" /><label className="block text-sm font-bold">Topic<select className="contact-input mt-2"><option>Select a topic</option><option>General Inquiry</option><option>Merchant Support</option><option>Coordinator Support</option><option>Feedback</option></select></label><label className="block text-sm font-bold">Message<textarea className="contact-input mt-2 min-h-36 resize-y" placeholder="How can we help?" /><small className="mt-2 block font-normal text-slate-500">10–2,000 characters</small></label><button className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#075cff] font-black text-white"><Send size={19} /> Send Message</button></form></section>; }
function ContactField({label,type='text',optional=false,placeholder=''}:{label:string;type?:string;optional?:boolean;placeholder?:string}) { return <label className="block text-sm font-bold">{label} {optional && <span className="font-normal text-slate-500">(optional)</span>}<input type={type} placeholder={placeholder} className="contact-input mt-2" />{optional && <small className="mt-1 block font-normal text-slate-500">Philippine mobile numbers only.</small>}</label>; }

function ContactHeader() { return <header className="relative flex h-[114px] items-center justify-between border-b border-slate-100 bg-white px-5 lg:px-12"><Link href="/"><Image src="/images/weKonnekLogov1.png" alt="WeKonnek" width={1536} height={1024} priority className="h-24 w-auto" /></Link><nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-[52px] whitespace-nowrap text-[15px] font-semibold xl:flex"><Link href="/">Home</Link><Link href="/for-merchants">For Merchants</Link><Link href="/coordinators">For Coordinators</Link><Link href="/contact" className="relative font-black text-[#075cff] after:absolute after:-bottom-4 after:left-1/2 after:h-[3px] after:w-8 after:-translate-x-1/2 after:rounded-full after:bg-[#075cff]">Contact</Link></nav><Link href="/customer/dashboard" className="rounded-xl bg-[#075cff] px-7 py-4 text-sm font-black text-white shadow-[0_12px_24px_rgba(0,86,255,.24)]">Open WeKonnek App</Link></header>; }
