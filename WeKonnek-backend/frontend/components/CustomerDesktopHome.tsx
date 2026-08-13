"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  Heart,
  Home,
  LayoutGrid,
  MapPin,
  Mic,
  Package,
  Pill,
  QrCode,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Store,
  Tag,
  Tickets,
  Truck,
  UserRound,
  UtensilsCrossed,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useUserLocation } from "@/hooks/use-geolocation";
import { type Category, type Merchant } from "@/lib/api";
import { publicAssetUrl } from "@/lib/public-asset-url";

const categoryStyles: Array<{ icon: LucideIcon; gradient: string }> = [
  { icon: UtensilsCrossed, gradient: "from-orange-400 to-red-500" },
  { icon: Store, gradient: "from-red-500 to-rose-600" },
  { icon: ShoppingBag, gradient: "from-emerald-400 to-green-600" },
  { icon: Pill, gradient: "from-green-400 to-teal-600" },
  { icon: Wrench, gradient: "from-blue-400 to-indigo-600" },
  { icon: Tag, gradient: "from-violet-500 to-purple-700" },
  { icon: CalendarDays, gradient: "from-pink-400 to-rose-600" },
  { icon: Sparkles, gradient: "from-cyan-400 to-teal-600" },
  { icon: Truck, gradient: "from-amber-400 to-orange-600" },
  { icon: Tickets, gradient: "from-fuchsia-400 to-purple-600" },
  { icon: QrCode, gradient: "from-sky-400 to-blue-600" },
  { icon: LayoutGrid, gradient: "from-slate-500 to-slate-700" },
];

type DisplayCategory = {
  id: number;
  icon: LucideIcon;
  adminIcon?: string;
  imageUrl?: string;
  name: string;
  details: string;
  stat: string;
  href: string;
  gradient: string;
};

function toDisplayCategory(
  category: Category & { imageUrl?: string | null },
  index: number,
): DisplayCategory {
  const style = categoryStyles[index % categoryStyles.length];
  const subCategories = category.subCategories || [];
  return {
    id: category.id,
    icon: style.icon,
    adminIcon: category.icon?.trim(),
    imageUrl: publicAssetUrl(category.imageUrl),
    name: category.name,
    details:
      category.description?.trim() ||
      subCategories
        .slice(0, 3)
        .map((item) => item.name)
        .join(" · ") ||
      "Explore local listings",
    stat: `${subCategories.length} ${subCategories.length === 1 ? "subcategory" : "subcategories"}`,
    href:
      category.slug === "property"
        ? "/property"
        : `/customer/explore/${category.slug}`,
    gradient: style.gradient,
  };
}

type ApiCategory = Category & { imageUrl?: string | null };

function merchantImage(merchant: Merchant) {
  return publicAssetUrl(merchant.coverImageUrl || merchant.logoUrl);
}

function merchantKind(merchant: Merchant) {
  return (merchant.subCategory?.name || merchant.category?.name || "Local merchant").toUpperCase();
}

function merchantMeta(merchant: Merchant) {
  return [merchant.category?.name, merchant.subCategory?.name, merchant.city]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(" • ");
}

const nav = [
  [Home, "Home", "/customer/dashboard"],
  [MapPin, "Explore Map", "/customer/map"],
  [Tag, "Vouchers & Deals", "/customer/deals"],
  [Package, "My Orders", "/customer/orders"],
  [ShoppingBag, "Bazaar", "/customer/categories"],
  [UserRound, "Profile", "/customer/profile"],
] as const;

export default function CustomerDesktopHome() {
  const { coords, status } = useUserLocation();
  const [deliveryLocation, setDeliveryLocation] = useState("Your City");
  const [categories, setCategories] = useState<DisplayCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesFailed, setCategoriesFailed] = useState(false);
  const [partners, setPartners] = useState<Merchant[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(true);
  const [partnersFailed, setPartnersFailed] = useState(false);
  const [showPartners, setShowPartners] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/categories", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Failed to load categories");
        return response.json() as Promise<ApiCategory[]>;
      })
      .then((data) => {
        const active = Array.isArray(data)
          ? data
              .filter((category) => category.isActive)
              .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
          : [];
        setCategories(active.map(toDisplayCategory));
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setCategoriesFailed(true);
      })
      .finally(() => setCategoriesLoading(false));

    fetch("/api/merchants", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Failed to load merchants");
        return response.json() as Promise<Merchant[]>;
      })
      .then((data) => {
        const active = Array.isArray(data)
          ? data
              .filter((merchant) => merchant.isActive)
              .sort(
                (a, b) =>
                  Number(b.isVerified) - Number(a.isVerified) ||
                  Number(b.rating || 0) - Number(a.rating || 0) ||
                  a.name.localeCompare(b.name),
              )
              .slice(0, 8)
          : [];
        setPartners(active);
      })
      .catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setPartnersFailed(true);
      })
      .finally(() => setPartnersLoading(false));

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!coords) return;

    const controller = new AbortController();
    fetch(`/api/routing/reverse?lat=${coords.lat}&lng=${coords.lng}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => {
        const address = data?.address;
        setDeliveryLocation(
          address?.city ||
            address?.municipality ||
            address?.province ||
            "Your City",
        );
      })
      .catch(() => {});

    return () => controller.abort();
  }, [coords]);

  useEffect(() => {
    if (!showPartners) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowPartners(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [showPartners]);

  return (
    <div className="hidden min-h-screen bg-white text-[#12192b] xl:grid xl:grid-cols-[254px_minmax(0,1fr)]">
      <aside className="flex min-h-screen flex-col border-r border-slate-200 bg-white px-5 py-7">
        <Link
          href="/customer/dashboard"
          className="flex items-center gap-3 px-1"
        >
          <Image
            src="/images/weKonnekLogov1.png"
            alt="WeKonnek"
            width={72}
            height={72}
            className="size-16 object-contain"
          />
          <div>
            <strong className="block text-base text-[#151cff]">
              WE<span className="text-red-600">KONNEK</span>
            </strong>
            <span className="block text-xs text-slate-500">Customer App</span>
          </div>
        </Link>
        <nav className="mt-10 space-y-2">
          {nav.map(([Icon, label, href], index) => (
            <Link
              key={label}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${index === 0 ? "bg-[#ff0719] text-white shadow-lg shadow-red-200" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon size={19} />
              {label}
            </Link>
          ))}
        </nav>
        <Link
          href="/customer/scan"
          className="mt-auto flex items-center justify-center gap-3 rounded-xl bg-[#ff0719] px-4 py-3 text-sm font-bold text-white"
        >
          <QrCode size={19} /> Scan QR Code
        </Link>
        <Link
          href="/customer/profile"
          className="mt-4 flex items-center gap-3 px-3 text-sm font-semibold text-slate-600"
        >
          <UserRound size={19} /> Account
        </Link>
      </aside>

      <main className="min-w-0">
        <header className="rounded-b-[22px] bg-[#ff0719] px-12 pb-10 pt-7 text-white shadow-[0_18px_35px_rgba(255,7,25,.18)]">
          <div className="flex items-center justify-between">
            <Link
              href="/customer/map"
              className="flex min-h-12 items-center gap-3 text-xl font-black"
            >
              <MapPin size={27} />
              <span>
                {status === "locating" ? "Locating…" : deliveryLocation}
              </span>
              <ChevronDown size={17} />
            </Link>
            <div className="flex items-center gap-4">
              <button className="relative p-2">
                <Bell size={26} />
                <span className="absolute right-0 top-0 flex size-6 items-center justify-center rounded-full bg-red-400 text-xs font-bold">
                  3
                </span>
              </button>
              <Link
                href="/auth/login?redirect=/customer/dashboard"
                className="flex size-14 items-center justify-center rounded-xl bg-red-500"
              >
                <UserRound size={28} />
              </Link>
            </div>
          </div>
          <form action="/customer/search" className="relative mt-5">
            <Search
              className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500"
              size={27}
            />
            <input
              name="q"
              placeholder="Search merchants, categories, and services"
              className="h-[78px] w-full rounded-[22px] bg-white pl-20 pr-48 text-lg font-medium text-slate-700 outline-none ring-0 transition focus:shadow-xl"
            />
            <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-1">
              <button
                type="button"
                aria-label="Voice search"
                className="flex size-11 items-center justify-center rounded-full text-red-600 hover:bg-red-50"
              >
                <Mic size={22} />
              </button>
              <Link
                href="/customer/map"
                aria-label="Search near me"
                className="flex size-11 items-center justify-center rounded-full text-blue-700 hover:bg-blue-50"
              >
                <MapPin size={22} />
              </Link>
              <button
                type="button"
                aria-label="Search filters"
                className="flex size-11 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
              >
                <SlidersHorizontal size={21} />
              </button>
            </div>
          </form>
        </header>

        <div className="px-12 py-11">
          <div className="mb-4 flex justify-end">
            <Link
              href="/customer/categories"
              className="min-h-12 rounded-full border border-slate-300 px-5 py-2.5 text-sm font-bold text-red-600 transition hover:border-red-200 hover:bg-red-50"
            >
              Show all categories
            </Link>
          </div>
          <section
            aria-label="Category listings"
            className="flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-5"
          >
            {categoriesLoading ? (
              [1, 2, 3, 4, 5].map((item) => (
                <div key={item} className="min-h-[218px] w-[176px] shrink-0 animate-pulse rounded-[22px] bg-slate-100" />
              ))
            ) : categories.length === 0 ? (
              <div className="flex min-h-[150px] w-full items-center justify-center rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-6 text-sm text-slate-500">
                {categoriesFailed ? "Categories are temporarily unavailable." : "No categories are available yet."}
              </div>
            ) : categories.map(
              ({
                id,
                icon: Icon,
                adminIcon,
                imageUrl,
                name,
                details,
                stat,
                href,
                gradient,
              }) => (
                <Link
                  key={id}
                  href={href}
                  className="group relative min-h-[218px] w-[176px] shrink-0 snap-start overflow-hidden rounded-[22px] border border-[#edf2f7] bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,.07)] transition-all duration-200 ease-out hover:-translate-y-1.5 hover:shadow-[0_20px_42px_rgba(15,23,42,.14)] active:scale-[.98]"
                >
                  <span
                    className={`flex size-14 items-center justify-center rounded-full bg-gradient-to-br ${gradient} text-white shadow-lg transition duration-200 group-hover:scale-110 group-hover:brightness-110`}
                  >
                    {imageUrl ? (
                      <img src={imageUrl} alt="" className="size-full rounded-full object-cover" />
                    ) : adminIcon ? (
                      <span className="text-2xl" aria-hidden="true">
                        {adminIcon}
                      </span>
                    ) : (
                      <Icon size={28} strokeWidth={1.8} />
                    )}
                  </span>
                  <h3 className="mt-5 text-[17px] font-black">{name}</h3>
                  <p className="mt-1 min-h-9 line-clamp-2 text-xs leading-4 text-slate-500">
                    {details}
                  </p>
                  <p className="mt-4 text-sm font-bold text-blue-700">{stat}</p>
                </Link>
              ),
            )}
          </section>

          <section className="mt-12">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-2xl font-black">Featured Partners</h2>
              <button
                type="button"
                onClick={() => setShowPartners(true)}
                className="min-h-12 px-2 font-bold text-red-600"
              >
                See All ›
              </button>
            </div>
            {partnersLoading ? (
              <div className="grid grid-cols-4 gap-3">
                {[1, 2, 3, 4].map((item) => <div key={item} className="h-56 animate-pulse rounded-2xl bg-slate-100" />)}
              </div>
            ) : partners.length === 0 ? (
              <div className="flex min-h-36 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                {partnersFailed ? "Featured partners are temporarily unavailable." : "No active merchants are available yet."}
              </div>
            ) : <div className="grid grid-cols-4 gap-3">
              {partners.slice(0, 4).map((partner) => {
                const image = merchantImage(partner);
                const meta = merchantMeta(partner);
                return (
                <Link
                  href={`/merchants/${partner.slug}`}
                  key={partner.id}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_10px_25px_rgba(15,23,42,.08)] transition duration-200 hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className="relative h-36 overflow-hidden p-3 text-white">
                    {image ? <img src={image} alt={partner.name} className="absolute inset-0 size-full object-cover transition duration-300 group-hover:scale-105" /> : <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-600 to-slate-900"><Store size={42} /></div>}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent" />
                    {partner.isVerified && <span className="relative rounded-xl bg-[#ff0719] px-3 py-2 text-xs font-bold">Verified</span>}
                    <Heart
                      className="absolute right-3 top-3 rounded-full bg-white p-2 text-red-600"
                      size={42}
                    />
                    <p className="absolute bottom-12 text-xs font-bold">
                      {merchantKind(partner)}
                    </p>
                  </div>
                  <div className="p-4">
                    <h3 className="text-lg font-black">{partner.name}</h3>
                    <p className="mt-4 text-xs text-slate-500">
                      {Number(partner.rating) > 0 ? <><span className="text-amber-500">★</span> {Number(partner.rating).toFixed(1)}</> : "Not rated"}
                      {meta && <> &nbsp;•&nbsp; {meta}</>}
                    </p>
                  </div>
                </Link>
              )})}
            </div>}
          </section>

          <section className="mt-12">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-2xl font-black">
                <Tag className="text-red-600" /> Exclusive Deals
              </h2>
              <Link href="/customer/deals" className="font-bold text-red-600">
                See All ›
              </Link>
            </div>
            <div className="grid max-w-3xl grid-cols-2 gap-4">
              {[
                ["₱50 OFF", "drinksDiscount"],
                ["5% OFF", "5%onMain"],
              ].map(([discount, code]) => (
                <Link
                  href="/customer/deals"
                  key={discount}
                  className="rounded-2xl bg-[#ff0719] p-6 text-center text-white"
                >
                  <p className="flex items-center gap-2 text-left text-xs font-bold">
                    <Tickets size={16} /> VOUCHER
                  </p>
                  <h3 className="mt-5 text-3xl font-black">{discount}</h3>
                  <p className="mt-2">{code}</p>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </main>

      {showPartners && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowPartners(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-6 backdrop-blur-sm"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="all-partners-title"
            className="max-h-[88vh] w-full max-w-6xl overflow-y-auto rounded-[28px] bg-[#fafbfc] p-7 shadow-2xl sm:p-9"
          >
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-sm font-bold uppercase tracking-[.16em] text-red-600">
                  Trusted local businesses
                </p>
                <h2
                  id="all-partners-title"
                  className="mt-1 text-3xl font-black"
                >
                  All featured partners
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  Explore standout merchants selected for quality, service, and
                  community trust.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPartners(false)}
                aria-label="Close featured partners"
                className="flex size-12 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100"
              >
                <X size={22} />
              </button>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-5 lg:grid-cols-4">
              {partners.map((partner) => {
                const image = merchantImage(partner);
                const meta = merchantMeta(partner);
                return (
                <Link
                  href={`/merchants/${partner.slug}`}
                  key={partner.id}
                  onClick={() => setShowPartners(false)}
                  className="group overflow-hidden rounded-[22px] border border-[#edf2f7] bg-white shadow-[0_8px_24px_rgba(15,23,42,.07)] transition-all duration-200 hover:-translate-y-1.5 hover:shadow-xl"
                >
                  <div className="relative h-44 overflow-hidden">
                    {image ? <img src={image} alt={partner.name} className="size-full object-cover transition duration-300 group-hover:scale-105" /> : <div className="flex size-full items-center justify-center bg-gradient-to-br from-slate-600 to-slate-900 text-white"><Store size={48} /></div>}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent" />
                    {partner.isVerified && <span className="absolute left-3 top-3 rounded-full bg-[#ff0719] px-3 py-1.5 text-xs font-bold text-white">Verified</span>}
                    <Heart
                      className="absolute right-3 top-3 rounded-full bg-white p-2 text-red-600"
                      size={42}
                    />
                    <p className="absolute bottom-4 left-4 text-xs font-bold text-white">
                      {merchantKind(partner)}
                    </p>
                  </div>
                  <div className="p-5">
                    <h3 className="text-lg font-black">{partner.name}</h3>
                    <p className="mt-3 text-sm text-slate-500">
                      {Number(partner.rating) > 0 ? <><span className="text-amber-500">★</span> {Number(partner.rating).toFixed(1)}</> : "Not rated"}
                      {meta && <> &nbsp;•&nbsp; {meta}</>}
                    </p>
                  </div>
                </Link>
              )})}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
