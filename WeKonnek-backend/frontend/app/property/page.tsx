"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  Bath,
  BedDouble,
  Building2,
  Heart,
  Home,
  Map,
  MapPin,
  Maximize2,
  Package,
  Plus,
  QrCode,
  Search,
  SlidersHorizontal,
  Tag,
  UserRound,
} from "lucide-react";
import {
  propertyApi,
  type PropertyListing,
  type PropertyType,
} from "@/lib/property";
import { useUserLocation } from "@/hooks/use-geolocation";

const PropertyMap = dynamic(() => import("@/components/PropertyMap"), {
  ssr: false,
});
const blankFilters = {
  transactionType: "",
  propertyTypeId: "",
  keyword: "",
  city: "",
  minPrice: "",
  maxPrice: "",
  bedrooms: "",
  bathrooms: "",
  floorArea: "",
  lotArea: "",
  distance: "",
};
const sidebarNav = [
  { icon: Home, label: "Home", href: "/customer/dashboard" },
  { icon: Map, label: "Explore Map", href: "/customer/map" },
  { icon: Tag, label: "Vouchers & Deals", href: "/customer/deals" },
  { icon: Package, label: "My Orders", href: "/customer/orders" },
  { icon: UserRound, label: "Profile", href: "/customer/profile" },
];
const money = (value: string | number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(Number(value));

export default function PropertyPage() {
  const { coords } = useUserLocation();
  const [types, setTypes] = useState<PropertyType[]>([]),
    [items, setItems] = useState<PropertyListing[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [filters, setFilters] = useState(blankFilters);
  useEffect(() => {
    propertyApi
      .types()
      .then(setTypes)
      .catch(() => setError("Unable to load property types."));
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const p = new URLSearchParams();
      Object.entries(filters).forEach(
        ([key, value]) => value && p.set(key, value),
      );
      if (coords) {
        p.set("latitude", String(coords.lat));
        p.set("longitude", String(coords.lng));
      }
      p.set("limit", "24");
      const result = await propertyApi.browse(p);
      setItems(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load properties.");
    } finally {
      setLoading(false);
    }
  }, [filters, coords]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);
  const setFilter = (key: string, value: string) =>
    setFilters((current) => ({ ...current, [key]: value }));
  return (
    <div className="min-h-screen bg-white text-slate-900 xl:grid xl:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="hidden min-h-screen border-r border-slate-200 bg-white p-5 xl:flex xl:flex-col">
        <Link href="/customer/dashboard" className="flex items-center gap-3">
          <Image
            src="/images/weKonnekLogov1.png"
            alt="WeKonnek"
            width={58}
            height={58}
            className="size-14 object-contain"
          />
          <div>
            <b className="text-blue-700">
              WE<span className="text-red-600">KONNEK</span>
            </b>
            <p className="text-xs text-slate-500">Customer App</p>
          </div>
        </Link>
        <div className="mt-10 rounded-2xl bg-red-50 p-4">
          <p className="text-xs font-bold text-red-600">BROWSING NEAR</p>
          <p className="mt-2 font-black">{filters.city || "Your City"}</p>
          <p className="text-xs text-slate-500">
            Local properties and listings
          </p>
        </div>
        <nav className="mt-6 space-y-2">
          {sidebarNav.map(({ icon: Icon, label, href }) => (
            <Link
              key={label}
              href={href}
              className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              <Icon size={19} />
              {label}
            </Link>
          ))}
        </nav>
        <Link
          href="/customer/scan"
          className="mt-auto flex min-h-12 items-center justify-center gap-3 rounded-xl bg-slate-950 text-sm font-bold text-white"
        >
          <QrCode size={19} />
          Scan QR
        </Link>
      </aside>

      <main className="min-w-0">
        <header className="bg-[#ff0719] px-5 py-4 text-white shadow-[0_12px_25px_rgba(255,7,25,.2)] lg:px-8">
          <div className="flex items-center gap-4">
            <Link
              href="/customer/dashboard"
              className="hidden min-h-11 items-center gap-2 text-sm font-bold xl:flex"
            >
              <ArrowLeft size={20} />
              Back to home
            </Link>
            <span className="flex size-11 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-700 shadow-lg">
              <Building2 size={24} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-black">Property</h1>
              <p className="truncate text-xs text-white/90">
                Homes, condos, lots and commercial spaces for sale or rent.
              </p>
            </div>
            <Link
              href="/property/post"
              className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-black text-[#ff0719] shadow-lg"
            >
              <Plus size={17} />
              Post Property
            </Link>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_220px]">
            <label className="relative">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
                size={20}
              />
              <input
                value={filters.keyword}
                onChange={(e) => setFilter("keyword", e.target.value)}
                placeholder="Search property, city or barangay..."
                className="h-12 w-full rounded-xl bg-white pl-12 pr-4 text-sm text-slate-700 outline-none"
              />
            </label>
            <input
              value={filters.city}
              onChange={(e) => setFilter("city", e.target.value)}
              placeholder="City"
              className="h-12 rounded-xl bg-white px-4 text-sm text-slate-700 outline-none"
            />
          </div>
        </header>

        <section className="border-b border-slate-200 bg-white px-4 py-3 lg:px-5">
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button
              onClick={() => setFilter("propertyTypeId", "")}
              className={`min-h-10 shrink-0 rounded-xl border px-4 text-sm font-semibold ${!filters.propertyTypeId ? "border-red-200 bg-red-50 text-red-600" : "border-slate-200 text-slate-600"}`}
            >
              All
            </button>
            {types.map((type) => (
              <button
                key={type.id}
                onClick={() => setFilter("propertyTypeId", type.id)}
                className={`min-h-10 shrink-0 rounded-xl border px-4 text-sm font-semibold ${filters.propertyTypeId === type.id ? "border-red-200 bg-red-50 text-red-600" : "border-slate-200 text-slate-600"}`}
              >
                {type.name}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
            <button
              onClick={() => setFilter("transactionType", "")}
              className={`min-h-9 shrink-0 rounded-full px-4 text-xs font-bold ${!filters.transactionType ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600"}`}
            >
              All Listings
            </button>
            <button
              onClick={() => setFilter("transactionType", "FOR_SALE")}
              className={`min-h-9 shrink-0 rounded-full px-4 text-xs font-bold ${filters.transactionType === "FOR_SALE" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600"}`}
            >
              For Sale
            </button>
            <button
              onClick={() => setFilter("transactionType", "FOR_RENT")}
              className={`min-h-9 shrink-0 rounded-full px-4 text-xs font-bold ${filters.transactionType === "FOR_RENT" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-600"}`}
            >
              For Rent
            </button>
            <input
              type="number"
              value={filters.minPrice}
              onChange={(e) => setFilter("minPrice", e.target.value)}
              placeholder="Min price"
              className="h-9 w-28 shrink-0 rounded-full border px-4 text-xs"
            />
            <input
              type="number"
              value={filters.maxPrice}
              onChange={(e) => setFilter("maxPrice", e.target.value)}
              placeholder="Max price"
              className="h-9 w-28 shrink-0 rounded-full border px-4 text-xs"
            />
            <select
              value={filters.bedrooms}
              onChange={(e) => setFilter("bedrooms", e.target.value)}
              className="h-9 shrink-0 rounded-full bg-slate-100 px-4 text-xs font-bold text-slate-600"
            >
              <option value="">Any bedrooms</option>
              <option value="1">1+ bedroom</option>
              <option value="2">2+ bedrooms</option>
              <option value="3">3+ bedrooms</option>
            </select>
            <input
              type="number"
              value={filters.bathrooms}
              onChange={(e) => setFilter("bathrooms", e.target.value)}
              placeholder="Bathrooms"
              className="h-9 w-28 shrink-0 rounded-full border px-4 text-xs"
            />
            <input
              type="number"
              value={filters.floorArea}
              onChange={(e) => setFilter("floorArea", e.target.value)}
              placeholder="Min floor sqm"
              className="h-9 w-32 shrink-0 rounded-full border px-4 text-xs"
            />
            <input
              type="number"
              value={filters.lotArea}
              onChange={(e) => setFilter("lotArea", e.target.value)}
              placeholder="Min lot sqm"
              className="h-9 w-32 shrink-0 rounded-full border px-4 text-xs"
            />
            <select
              value={filters.distance}
              onChange={(e) => setFilter("distance", e.target.value)}
              className="h-9 shrink-0 rounded-full bg-slate-100 px-4 text-xs font-bold text-slate-600"
            >
              <option value="">Any distance</option>
              {[1, 3, 5, 10].map((n) => (
                <option value={n} key={n}>
                  Within {n} km
                </option>
              ))}
            </select>
            <button
              onClick={() => setFilters(blankFilters)}
              className="h-9 shrink-0 rounded-full px-4 text-xs font-bold text-red-600"
            >
              Clear
            </button>
          </div>
        </section>

        {error && (
          <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="grid min-h-[calc(100vh-190px)] xl:grid-cols-[410px_minmax(0,1fr)]">
          <section className="border-r border-slate-200 md:grid md:grid-cols-2 md:content-start md:gap-4 md:bg-slate-50 md:p-4 xl:block xl:bg-white xl:p-0">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 md:col-span-2 md:-mx-4 md:-mt-4 md:bg-white xl:mx-0 xl:mt-0">
              <div>
                <b className="text-sm">
                  {loading
                    ? "Loading properties…"
                    : `${items.length} properties found`}
                </b>
                <p className="text-[10px] font-semibold text-red-600">
                  Verified local property listings
                </p>
              </div>
              <SlidersHorizontal size={18} />
            </div>
            {loading ? (
              [1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="m-3 h-28 animate-pulse rounded-xl bg-slate-200 md:m-0 xl:m-3"
                />
              ))
            ) : items.length ? (
              items.map((item) => (
                <Link
                  href={`/property/${item.slug || item.id}`}
                  key={item.id}
                  className="flex gap-3 border-b border-slate-200 p-3 transition hover:bg-slate-50 md:block md:overflow-hidden md:rounded-2xl md:border md:bg-white md:p-0 md:shadow-sm xl:flex xl:rounded-none xl:border-x-0 xl:border-t-0 xl:p-3 xl:shadow-none"
                >
                  <div className="relative size-24 shrink-0 overflow-hidden rounded-xl bg-slate-100 md:aspect-[4/3] md:h-auto md:w-full md:rounded-none xl:size-24 xl:rounded-xl">
                    {item.images?.[0]?.imageUrl ? (
                      <img
                        src={item.images[0].thumbnailUrl || item.images[0].imageUrl}
                        alt={item.title}
                        className="size-full object-cover"
                      />
                    ) : (
                      <Building2 className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-slate-300" />
                    )}
                    <span className="absolute left-1 top-1 rounded-md bg-red-600 px-2 py-1 text-[9px] font-bold text-white">
                      {item.transactionType === "FOR_RENT"
                        ? "FOR RENT"
                        : "FOR SALE"}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 md:p-3 xl:p-0">
                    <div className="flex justify-between gap-2">
                      <h2 className="truncate text-sm font-black">
                        {item.title}
                      </h2>
                      <Heart size={17} className="shrink-0 text-slate-400" />
                    </div>
                    <p className="mt-1 text-sm font-black text-red-600">
                      {money(item.price)}
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {item.propertyType.name} ·{" "}
                      {[item.barangay, item.city].filter(Boolean).join(", ")}
                    </p>
                    <div className="mt-2 flex gap-3 text-[11px] text-slate-600">
                      {item.bedrooms != null && (
                        <span className="flex items-center gap-1">
                          <BedDouble size={13} />
                          {item.bedrooms}
                        </span>
                      )}
                      {item.bathrooms != null && (
                        <span className="flex items-center gap-1">
                          <Bath size={13} />
                          {Number(item.bathrooms)}
                        </span>
                      )}
                      {item.floorArea != null && (
                        <span className="flex items-center gap-1">
                          <Maximize2 size={13} />
                          {Number(item.floorArea)} sqm
                        </span>
                      )}
                    </div>
                    {item.distanceKm != null && (
                      <p className="mt-1 flex items-center gap-1 text-[10px] font-bold text-blue-700">
                        <MapPin size={11} />
                        {item.distanceKm} km away
                      </p>
                    )}
                  </div>
                </Link>
              ))
            ) : (
              <div className="py-20 text-center md:col-span-2 xl:col-span-1">
                <Building2 className="mx-auto text-slate-300" size={48} />
                <h3 className="mt-3 font-black">No properties found</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Try widening your search.
                </p>
              </div>
            )}
          </section>
          <section className="relative hidden overflow-hidden bg-[#e7f4ec] xl:block">
            {loading ? (
              <div className="size-full animate-pulse bg-slate-200" />
            ) : (
              <PropertyMap listings={items} center={coords} embedded />
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
