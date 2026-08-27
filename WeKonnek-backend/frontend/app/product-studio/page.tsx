import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  ImageIcon,
  Layers3,
  Palette,
  RefreshCw,
  MapPinned,
  ScanFace,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  Sparkles,
  Smartphone,
  Store,
  Upload,
  UsersRound,
  WandSparkles,
} from "lucide-react";

const features = [
  { icon: ScanFace, title: "Models & Mannequins", text: "Show apparel on models or mannequins." },
  { icon: Palette, title: "Professional Backgrounds", text: "White, studio, lifestyle and catalogue-ready environments." },
  { icon: WandSparkles, title: "Fast & Easy", text: "Upload, configure and generate without editing skills." },
  { icon: Clock3, title: "Save Time & Cost", text: "Reduce photoshoot needs for suitable catalogue content." },
];

const categories = [
  [Shirt, "Apparel", "Put your clothes on models or mannequins.", "bg-[#075cff]", "0% 0%"],
  [ShoppingBag, "Food", "Make your dishes menu-ready.", "bg-[#ed174c]", "50% 0%"],
  [Layers3, "Grocery", "Clean images for packaged products.", "bg-[#38b576]", "100% 0%"],
  [ImageIcon, "Beverages", "Studio-quality product shots.", "bg-[#7b35d8]", "0% 100%"],
  [Sparkles, "Beauty", "Highlight details beautifully.", "bg-[#e83d65]", "50% 100%"],
  [Palette, "Home & More", "Home, pet, gadgets and more.", "bg-[#f47721]", "100% 100%"],
] as const;

const steps = [
  [Upload, "Upload Photo", "Merchant uploads a clear photo of the actual product."],
  [Palette, "Choose Style", "Select a model, presentation and/or background for the product category."],
  [WandSparkles, "Generate", "WeKo Product Studio creates the catalogue image."],
  [CheckCircle2, "Review & Approve", "Merchant reviews the image before publishing it."],
] as const;

const discoveryImages = [
  "/images/merchants.png",
  "/images/wekonnek-phone.png",
  "/images/customer-auth-storefront.png",
  "/images/weko-product-studio-customers.png",
];

export default function AiProductStudioPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f7faff] text-[#071333]">
      <PublicHeader />
      <section className="relative overflow-hidden bg-gradient-to-br from-white via-[#f2f7ff] to-[#e7f0ff]">
        <div className="absolute -left-24 top-20 size-72 rounded-full bg-[#075cff]/10 blur-3xl" />
        <div className="absolute right-0 top-0 size-80 rounded-full bg-red-500/10 blur-3xl" />
        <div className="relative grid w-full items-center gap-7 px-5 py-7 sm:px-8 lg:grid-cols-[minmax(0,.94fr)_minmax(620px,1.16fr)] lg:px-12 lg:py-10">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#075cff] px-4 py-2 text-xs font-black tracking-wide text-white"><Sparkles size={15} /> WEKO PRODUCT STUDIO</span>
            <h1 className="mt-4 text-4xl font-black leading-[1.05] tracking-tight text-[#071333] sm:text-5xl lg:text-[52px]">Take a photo.<br /><span className="text-[#075cff]">We<span className="text-[#db0002]">Konnek</span> makes it</span> catalogue-ready.</h1>
            <p className="mt-4 max-w-xl text-lg leading-7 text-slate-700">Transform your product photos into professional, eye-catching catalogue images in seconds with WeKo Product Studio.</p>
            <div className="mt-6 flex flex-col items-start gap-3 text-sm font-black text-[#18355f]">
              {["Better Images · More clicks", "More Attraction · More customers", "More Sales · More growth"].map((benefit, index) => <div key={benefit} className="flex items-center gap-2"><span className={`flex size-8 items-center justify-center rounded-full text-white ${index === 0 ? "bg-[#075cff]" : index === 1 ? "bg-[#db0002]" : "bg-[#38b576]"}`}><Sparkles size={15} /></span>{benefit}</div>)}
            </div>
            <Link href="/for-merchants#callback" className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#075cff] px-6 text-center font-black text-white shadow-[0_14px_28px_rgba(0,86,255,.25)] transition hover:bg-[#064bd1]">Be a Merchant to Use WeKo Product Studio <ArrowRight size={18} /></Link>
            <p className="mt-3 text-sm text-slate-500">Merchant subscription required. Product Studio credits may be included depending on the merchant plan.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1.05fr_.95fr]">
            <div className="overflow-hidden rounded-[26px] border border-white bg-white p-3 shadow-[0_20px_50px_rgba(7,55,128,.18)]">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[18px] bg-slate-100"><Image src="/images/weko-product-studio-hero.png" alt="A casual t-shirt photo transformed into a professional apparel catalogue image" fill priority sizes="(min-width: 1024px) 31vw, 90vw" className="object-cover" /></div>
              <div className="flex items-center justify-between px-2 pb-1 pt-3 text-xs font-black text-[#18355f]"><span>Original Product Photo</span><span className="rounded-full bg-[#e6f0ff] px-2 py-1 text-[#075cff]">WEKO</span><span>Catalogue Image</span></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {features.map(({ icon: Icon, title, text }) => <article key={title} className="flex min-h-[200px] flex-col rounded-2xl border border-[#d9e5f6] bg-white p-4 shadow-sm"><span className="flex size-10 items-center justify-center rounded-xl bg-[#eaf1ff] text-[#075cff]"><Icon size={22} /></span><h2 className="mt-3 font-black text-[#071333]">{title}</h2><p className="mt-1 text-sm leading-5 text-slate-500">{text}</p><span className="mt-auto self-end text-[#075cff]/40"><Icon size={68} strokeWidth={1.25} /></span></article>)}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full px-5 pb-8 pt-4 sm:px-8 lg:px-12">
        <h2 className="text-center text-2xl font-black sm:text-3xl">Works for Every Merchant</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{categories.map(([Icon, title, text, color, position]) => <article key={title} className="overflow-hidden rounded-xl border border-[#d9e5f6] bg-white p-2 shadow-sm"><div className="relative h-28 overflow-hidden rounded-lg bg-[#f5f8ff]"><div className="absolute inset-y-0 left-1/2 aspect-square -translate-x-1/2 bg-cover bg-no-repeat" style={{ backgroundImage: "url('/images/weko-product-studio-categories.png')", backgroundPosition: position, backgroundSize: "300% 200%" }} /></div><div className="flex gap-2 px-1 pb-2 pt-3"><span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-white ${color}`}><Icon size={16} /></span><div><h3 className="text-sm font-black">{title}</h3><p className="mt-0.5 text-xs leading-4 text-slate-600">{text}</p></div></div></article>)}</div>
      </section>

      <section className="px-5 pb-10 sm:px-8 lg:px-12"><div className="mx-auto grid w-full gap-7 rounded-[24px] border border-[#8bb5ff] bg-gradient-to-br from-[#f4f8ff] to-white p-6 shadow-sm lg:grid-cols-[.8fr_1.2fr] lg:items-center lg:p-8"><div><h2 className="text-3xl font-black leading-tight text-[#071333] sm:text-4xl">Your business is already good.<br /><span className="text-[#075cff]">Let more people discover it.</span></h2><p className="mt-5 max-w-md text-sm leading-6 text-slate-600">You don&apos;t need to change what makes your business special. WeKonnek helps you build your online presence, showcase your products professionally, and make it easier for customers in your community to discover you.</p></div><div className="grid gap-4 sm:grid-cols-4">{[[Store,"Your Business","You do what you do best every day."],[Smartphone,"Digital Catalogue","Product Studio turns your products into polished catalogue images."],[MapPinned,"WeKonnek Discovery","Your business is easy to find by more customers."],[UsersRound,"More Customers","More visibility leads to visits, orders, and loyalty."]].map(([,title,text], index) => <div key={title as string} className="relative text-center sm:px-2"><div className="mx-auto flex h-36 w-full max-w-[220px] items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm"><Image src={discoveryImages[index]} alt="" width={280} height={190} className="h-full w-full object-cover" /></div><span className="mx-auto mt-3 flex size-6 items-center justify-center rounded-full bg-[#075cff] text-xs font-black text-white">{index + 1}</span><h3 className="mt-2 text-sm font-black text-[#071333]">{title as string}</h3><p className="mt-1 text-xs leading-5 text-slate-600">{text as string}</p>{index < 3 && <span className="absolute right-[-10px] top-12 hidden h-px w-5 bg-[#8bb5ff] sm:block" />}</div>)}</div><p className="text-center text-base italic text-[#18355f] lg:col-span-2">Your neighborhood doesn&apos;t have to end at your storefront.</p></div></section>

      <section className="bg-white px-5 py-10 sm:px-8 lg:px-12">
        <div className="mx-auto w-full rounded-2xl border border-[#d9e5f6] bg-white p-5 shadow-sm lg:p-7">
          <h2 className="text-center text-2xl font-black text-[#071333] sm:text-3xl">How <span className="text-[#075cff]">We</span><span className="text-[#db0002]">Ko</span> Product Studio Works</h2>
          <div className="mt-6 grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_150px_230px]">
            <div className="grid gap-3 sm:grid-cols-4">
              {steps.map(([Icon, title, text], index) => (
                <article key={title} className="relative text-center sm:px-2">
                  <span className="mx-auto flex size-6 items-center justify-center rounded-full bg-[#075cff] text-xs font-black text-white">{index + 1}</span>
                  <span className="mx-auto mt-3 flex size-14 items-center justify-center rounded-full bg-[#edf4ff] text-[#075cff]"><Icon size={28} /></span>
                  {index < 3 && <ArrowRight className="absolute -right-3 top-12 hidden text-[#8bb5ff] sm:block" size={21} />}
                  <h3 className="mt-3 text-sm font-black text-[#071333]">{title}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{text}</p>
                </article>
              ))}
            </div>
            <div className="hidden border-l border-dashed border-[#b9d2ff] pl-5 lg:flex lg:justify-center">
              <Image src="/images/weko-mascot.png" alt="WeKo mascot" width={150} height={190} className="h-44 w-auto object-contain" />
            </div>
            <div className="flex items-start gap-3 rounded-xl bg-[#f1f6ff] p-4 text-sm leading-5 text-[#18355f]">
              <ShieldCheck className="mt-0.5 shrink-0 text-[#075cff]" size={22} />
              <p>Merchants should verify that generated images accurately represent the actual product before publishing.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 pb-10 pt-3 sm:px-8 lg:px-12">
        <div className="mx-auto grid w-full gap-6 rounded-2xl border border-[#e6d7ff] bg-gradient-to-r from-[#fcf9ff] via-[#f6f0ff] to-[#fffaff] p-6 lg:grid-cols-[220px_minmax(0,1fr)_190px] lg:items-center">
          <div>
            <p className="text-xl font-black text-[#6e35c9]">Product Studio Credits</p>
            <p className="mt-2 text-sm leading-5 text-[#4d3c72]">Each generation uses one credit. Simple, transparent and fair.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-5">
            {[[Sparkles, "1 Studio Credit", "1 generation attempt"], [UsersRound, "Credits belong", "to your merchant account"], [Layers3, "Included in", "subscription plans or available later"], [RefreshCw, "Regenerate", "uses another credit"], [ShieldCheck, "Technical issue", "may qualify for a credit refund"]].map(([Icon, title, text], index) => (
              <div key={title as string} className="relative text-center sm:px-2">
                <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-white text-[#7b35d8] shadow-sm"><Icon size={27} /></span>
                {index < 4 && <ArrowRight className="absolute -right-3 top-4 hidden text-[#c2a3f2] sm:block" size={19} />}
                <h3 className="mt-3 text-xs font-black text-[#34215c]">{title as string}</h3>
                <p className="mt-1 text-[11px] leading-4 text-[#55466e]">{text as string}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-white p-5 text-center shadow-sm">
            <p className="text-sm font-black text-[#34215c]">Your Studio Credits</p>
            <p className="mt-1 text-4xl font-black text-[#075cff]">18</p>
            <p className="text-sm text-[#55466e]">credits remaining</p>
            <Link href="/for-merchants#callback" className="mt-3 inline-flex items-center gap-1 text-sm font-black text-[#075cff]">View credit packages <ArrowRight size={16} /></Link>
          </div>
        </div>
      </section>

      <section className="px-5 pb-12 sm:px-8 lg:pb-16 lg:px-12"><div className="mx-auto w-full max-w-[1440px] rounded-[28px] bg-gradient-to-r from-[#075cff] via-[#5636c7] to-[#db0002] px-6 py-11 text-center text-white sm:px-10 lg:py-14"><h2 className="mx-auto max-w-3xl text-3xl font-black leading-tight sm:text-4xl">Get your business online with WeKonnek — and stay one step ahead of the competition.</h2><Link href="/for-merchants#callback" className="mt-7 inline-flex min-h-14 items-center gap-2 rounded-xl bg-white px-7 font-black text-[#db0002] shadow-lg">Be a Merchant Now <ArrowRight size={18} /></Link></div></section>
    </main>
  );
}

function PublicHeader() {
  return <header className="relative z-30 flex h-[114px] items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-9"><Link href="/" aria-label="WeKonnek home"><Image src="/images/weKonnekLogov1.png" alt="WeKonnek" width={1536} height={1024} priority className="h-24 w-auto object-contain" /></Link><nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-7 whitespace-nowrap text-[15px] font-semibold xl:flex"><Link href="/">Home</Link><Link href="/for-merchants">For Merchants</Link><Link href="/product-studio" className="relative font-black text-[#075cff] after:absolute after:-bottom-4 after:left-1/2 after:h-[3px] after:w-12 after:-translate-x-1/2 after:rounded-full after:bg-[#075cff]">Product Studio</Link><Link href="/coordinators">For Coordinators</Link><Link href="/contact">Contact</Link></nav><Link href="/for-merchants#callback" className="inline-flex h-[50px] items-center rounded-xl bg-[#075cff] px-5 text-sm font-black text-white shadow-[0_12px_24px_rgba(0,86,255,.24)] sm:px-7">Be a Merchant</Link></header>;
}
