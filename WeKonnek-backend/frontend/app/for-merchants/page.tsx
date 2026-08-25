"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import type L from "leaflet";
import { usePortalUrl } from "@/hooks/use-portal-url";
import {
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
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
} from "lucide-react";
import toast from "react-hot-toast";
import { citiesInZoneProvince, findZoneCity, findZoneDistrict, loadAdminZoneAddresses, zoneProvinces, zoneRegions, type ZoneCityOption } from "@/lib/zone-address";

const LocationMap = dynamic(() => import("@/components/LocationMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-500">
      Loading interactive map…
    </div>
  ),
});

const DEFAULT_MAP_CENTER: [number, number] = [14.5995, 120.9842];
type BusinessCategory = {
  id: number;
  name: string;
  isActive: boolean;
  displayOrder: number;
  subCategories?: Array<{ id: number; name: string; groupName?: string }>;
};

const benefits = [
  {
    icon: TrendingUp,
    title: "Increase Sales & Visibility",
    text: "Reach more customers in your local community.",
  },
  {
    icon: Wrench,
    title: "All-in-One Business Tools",
    text: "Manage orders, menus, bookings, and more in one platform.",
  },
  {
    icon: ShieldCheck,
    title: "Secure & Reliable",
    text: "Safe transactions and data protection you can trust.",
  },
  {
    icon: UsersRound,
    title: "Dedicated Support",
    text: "Get help from your local Zone Coordinator whenever you need it.",
  },
];

const features = [
  {
    icon: QrCode,
    color: "bg-[#7833d7]",
    title: "In-Store Ordering",
    image: "/images/merchantQRordering.png",
    text: "Customers scan the QR code in your store to browse the menu and place orders directly from their phone.",
  },
  {
    icon: ShoppingBag,
    color: "bg-[#35b86d]",
    title: "Pick-Up Orders",
    image: "/images/merchantPickupOrder.png",
    text: "Let customers order ahead and pick up at their convenience. Faster service, happier customers.",
  },
  {
    icon: CalendarDays,
    color: "bg-[#075cff]",
    title: "Dining Reservation",
    image: "/images/merchantReservedImage.png",
    text: "Allow customers to reserve tables in advance and manage bookings with ease.",
  },
  {
    icon: BookOpen,
    color: "bg-[#f39200]",
    title: "Digital Menu",
    image: "/images/merchantDigitalMenu.png",
    text: "Showcase your menu with photos, descriptions, and prices—easy to update anytime.",
  },
  {
    icon: Tag,
    color: "bg-[#ed0000]",
    title: "BillOut with Auto Discount (Senior / PWD)",
    image: "/images/merchantBillOutDiscount.png",
    text: "Automatic discounts for Senior Citizens and PWD for a faster and fairer billing experience.",
  },
  {
    icon: Star,
    color: "bg-[#7833d7]",
    title: "Customer Ratings & Reviews",
    image: "/images/merchantCustomerReview.png",
    text: "Build trust and credibility with real reviews and star ratings from your happy customers.",
  },
];

const marketStats = [
  {
    value: "97.5M",
    label: "Internet Users",
    detail: "83.8% Internet Penetration",
  },
  { value: "74%–99%", label: "Smartphone Penetration", detail: "Nationwide" },
  {
    value: "142M",
    label: "Active Mobile Connections",
    detail: "Multiple SIMs/devices",
  },
  { value: "89%", label: "Android Market Share", detail: "" },
  { value: "70M+", label: "Active Online Shoppers", detail: "" },
  {
    value: "8.4",
    label: "Online Purchases Per Month",
    detail: "93% shop via smartphones",
  },
];

export default function ForMerchantsPage() {
  const [location, setLocation] = useState<[number, number] | null>(null);
  const [locationZoom, setLocationZoom] = useState(12);
  const geocodeSequence = useRef(0);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mapDialogOpen, setMapDialogOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [subCategoryName, setSubCategoryName] = useState("");
  const [businessCategories, setBusinessCategories] = useState<
    BusinessCategory[]
  >([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [hasBranches, setHasBranches] = useState("");
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const [coverageOptions, setCoverageOptions] = useState<ZoneCityOption[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedProvince, setSelectedProvince] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedArea, setSelectedArea] = useState("");
  const selectedDistrictOption = findZoneDistrict(findZoneCity(coverageOptions, selectedCity), selectedDistrict);
  const normalizedCategory = categoryName.trim().toLowerCase();
  const isFoodBusiness = /(food|restaurant|cafe|bakery|catering|beverage)/.test(
    normalizedCategory,
  );
  const isTradingBusiness =
    /(trad|retail|shop|store|merchandise|wholesale)/.test(normalizedCategory);
  const loadCoverageOptions = useCallback(() => {
    setCoverageLoading(true);
    setCoverageError("");
    loadAdminZoneAddresses()
      .then((body) => {
        const options = body;
        setCoverageOptions(options);
        if (!options.length)
          setCoverageError(
            "No active coordinator coverage areas are configured.",
          );
      })
      .catch(() => {
        setCoverageOptions([]);
        setCoverageError("City list is temporarily unavailable.");
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
  const loadBusinessCategories = useCallback(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    setCategoriesLoading(true);
    setCategoriesError("");
    fetch("/api/backend/merchant-categories", { signal: controller.signal, cache: "no-store" })
      .then((response) =>
        response.ok
          ? response.json()
          : Promise.reject(new Error("Unable to load business categories")),
      )
      .then((body) => {
        const categories = Array.isArray(body) ? body : [];
        setBusinessCategories(
          categories
            .filter((category): category is BusinessCategory =>
              Boolean(
                category?.id && category?.name && category?.isActive !== false,
              ),
            )
            .sort(
              (left, right) =>
                (left.displayOrder ?? 0) - (right.displayOrder ?? 0),
            ),
        );
      })
      .catch(() => {
        setBusinessCategories([]);
        setCategoriesError("Business categories are temporarily unavailable.");
      })
      .finally(() => {
        window.clearTimeout(timeout);
        setCategoriesLoading(false);
      });
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);
  useEffect(() => {
    return loadBusinessCategories();
  }, [loadBusinessCategories]);
  useEffect(() => {
    if (!selectedCity) return;

    const controller = new AbortController();
    const timer = window.setTimeout(
      async () => {
        const sequence = ++geocodeSequence.current;
        const district = selectedDistrict
          .replace(/^3rd\b/i, "Third")
          .replace(/^2nd\b/i, "Second")
          .replace(/^1st\b/i, "First");
        const province = /no province/i.test(selectedProvince) ? "" : selectedProvince;
        const queries = [
          [businessAddress.trim(), selectedArea, selectedCity, province, "Philippines"],
          [selectedArea, selectedCity, province, "Philippines"],
          [district, selectedCity, province, "Philippines"],
          [selectedCity, province, "Philippines"],
        ].map(parts => parts.filter(Boolean).join(", ")).filter((query, index, all) => query && all.indexOf(query) === index);
        setGeocodingAddress(true);
        try {
          let result = null;
          for (const query of queries) {
            const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { signal: controller.signal });
            const body = response.ok ? await response.json() : null;
            result = body?.results?.[0] ?? null;
            if (result) break;
          }
          const latitude = Number(result?.location?.lat);
          const longitude = Number(result?.location?.lng);
          if (
            sequence === geocodeSequence.current &&
            Number.isFinite(latitude) &&
            Number.isFinite(longitude)
          ) {
            setLocation([latitude, longitude]);
            setLocationZoom(
              businessAddress.trim() || selectedArea
                ? 16
                : selectedDistrict
                  ? 14
                  : 12,
            );
          }
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
        } finally {
          if (!controller.signal.aborted) setGeocodingAddress(false);
        }
      },
      businessAddress.trim() ? 600 : 150,
    );

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [businessAddress, selectedArea, selectedCity, selectedDistrict, selectedProvince]);
  useEffect(() => {
    if (!mapDialogOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMapDialogOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [mapDialogOpen]);
  const selectMapLocation = useCallback(
    (latitude: number, longitude: number) => {
      setLocation([latitude, longitude]);
      setLocationZoom(18);
    },
    [],
  );
  const moveMapPin = useCallback((event: L.DragEndEvent) => {
    const point = event.target.getLatLng();
    setLocation([point.lat, point.lng]);
    setLocationZoom(18);
  }, []);
  const locateStore = () => {
    if (!navigator.geolocation)
      return toast.error("Location is not supported by this browser.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation([position.coords.latitude, position.coords.longitude]);
        setLocationZoom(17);
        setLocating(false);
        toast.success("Store location pinned.");
      },
      () => {
        setLocating(false);
        toast.error("Allow location access to pin the store.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };
  const submitLead = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!location) {
      toast.error("Select your store location on the map or use GPS first.");
      return;
    }
    const form = event.currentTarget;
    setSubmitting(true);
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const response = await fetch("/api/backend/merchant-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          source: "website_callback",
          latitude: location?.[0],
          longitude: location?.[1],
          subscription_amount: 0,
        }),
      });
      const contentType = response.headers.get("content-type") || "";
      const result = contentType.includes("application/json")
        ? await response.json()
        : { message: "Merchant application service is unavailable." };
      if (!response.ok)
        throw new Error(
          result.message || "Unable to submit merchant application",
        );
      toast.success("Your merchant application was submitted as unassigned.");
      form.reset();
      setLocation(null);
      setCategoryName("");
      setSubCategoryName("");
      setBusinessAddress("");
      setHasBranches("");
      setSelectedCity("");
      setSelectedDistrict("");
      setSelectedArea("");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to submit merchant application",
      );
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="min-h-screen overflow-x-clip bg-[#f5faff] text-[#071333]">
      <MerchantHeader />

      <section className="grid w-full min-w-0 items-start gap-5 px-4 py-6 sm:px-6 xl:px-7 lg:grid-cols-[minmax(340px,34%)_minmax(0,66%)] min-[1200px]:grid-cols-[minmax(360px,36%)_minmax(0,64%)] min-[1440px]:grid-cols-[minmax(380px,38%)_minmax(0,62%)]">
        <div className="order-2 min-w-0 lg:sticky lg:top-4 lg:order-1 lg:h-[calc(100vh-32px)] lg:min-h-[620px] lg:max-h-[900px]">
        <aside className="relative h-full min-w-0 max-w-full overflow-hidden rounded-2xl bg-[#061b45] text-white shadow-[0_18px_38px_rgba(7,29,67,.22)]">
          <Image
            src="/images/merchantHeroLeft.png"
            alt=""
            fill
            aria-hidden="true"
            sizes="(min-width: 1024px) 40vw, 100vw"
            className="object-cover object-center opacity-45"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#041633]/95 via-[#061b45]/80 to-[#075cff]/70" />
          <div className="relative z-10 flex min-h-[430px] flex-col p-6 sm:p-8 lg:h-full lg:min-h-0 lg:p-9">
            <Image src="/images/weKonnekLogov1.png" alt="WeKonnek" width={1536} height={1024} priority className="h-14 w-auto self-start object-contain brightness-0 invert lg:h-16" />
            <div className="mt-6 max-w-sm lg:mt-8">
              <h1 className="text-2xl font-black leading-tight sm:text-3xl lg:text-4xl">Grow your business with WeKonnek</h1>
              <p className="mt-3 text-sm leading-6 text-blue-50 lg:mt-4">Get discovered by more customers, accept orders, and grow your sales—all in one simple platform.</p>
            </div>
            <div className="mt-6 space-y-4 text-sm lg:mt-7 lg:space-y-5">
              {[
                [QrCode, "QR Ordering", "Customers scan and order from your store."],
                [MapPin, "Online Discovery", "Be found on the map by more customers."],
                [Tag, "Deals & Vouchers", "Run promos and attract more buyers."],
              ].map(([Icon, title, text]) => (
                <div key={title as string} className="flex items-center gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#075cff] shadow-lg"><Icon size={21} /></span><div><p className="font-black">{title as string}</p><p className="mt-0.5 text-xs text-blue-100">{text as string}</p></div></div>
              ))}
            </div>
            <div className="mt-auto flex items-end gap-3 rounded-xl border border-white/20 bg-[#0d3a92]/75 p-4 backdrop-blur lg:p-5"><Image src="/images/weko-mascot.png" alt="WeKo, the WeKonnek mascot" width={120} height={150} className="-mb-4 hidden h-28 w-auto shrink-0 object-contain sm:block lg:h-32" /><div><p className="font-black">WeKo is here to help your business succeed!</p><p className="mt-2 text-sm leading-5 text-blue-50">Join thousands of merchants already growing with WeKonnek.</p></div></div>
          </div>
        </aside>
        </div>

        <div
          id="callback"
          className="order-1 min-w-0 max-w-full overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white p-5 shadow-[0_8px_28px_rgba(7,29,67,.08)] lg:order-2 lg:p-7"
        >
          <div className="mb-7 flex items-center text-xs font-bold text-slate-500 sm:text-sm">
            {["Business Info", "Location", "Review & Submit"].map((step, index) => <div key={step} className="flex flex-1 items-center last:flex-none"><span className={`mr-2 flex size-7 items-center justify-center rounded-full border ${index === 0 ? "border-[#075cff] bg-[#075cff] text-white" : "border-slate-300 bg-white"}`}>{index + 1}</span><span className={index === 0 ? "text-[#075cff]" : ""}>{step}</span>{index < 2 && <span className="mx-3 h-px flex-1 bg-slate-200" />}</div>)}
          </div>

          <div className="flex items-start gap-3"><BriefcaseBusiness className="mt-0.5 shrink-0 text-[#075cff]" size={22} /><div><h1 className="text-lg font-black text-[#071333]">Business Information</h1><p className="mt-1 text-sm text-slate-500">Tell us about your business.</p></div></div>

          <form onSubmit={submitLead} className="mt-5 min-w-0 space-y-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <FormField
                name="contact_name"
                icon={UserRound}
                placeholder="Full Name"
                required
              />
              <FormField
                name="business_name"
                icon={Store}
                placeholder="Business / Store Name"
                required
              />
              <FormField
                name="phone"
                icon={Phone}
                placeholder="Mobile Number"
                type="tel"
                required
              />
              <FormField
                name="email"
                icon={Mail}
                placeholder="Email Address"
                type="email"
                required
              />
            </div>
            <label className="merchant-input flex items-center gap-3">
              <BriefcaseBusiness
                size={19}
                className="shrink-0 text-[#7187a8]"
              />
              <select
                name="category_name"
                value={categoryName}
                onChange={(event) => {
                  setCategoryName(event.target.value);
                  setSubCategoryName("");
                }}
                required
                disabled={categoriesLoading}
                className="min-w-0 flex-1 bg-transparent outline-none disabled:cursor-wait disabled:text-slate-400"
              >
                <option value="">
                  {categoriesLoading
                    ? "Loading business categories…"
                    : "Business Category"}
                </option>
                {businessCategories.map((category) => (
                  <option key={category.id} value={category.name}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            {categoriesError && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <span>{categoriesError}</span>
                <button type="button" onClick={loadBusinessCategories} disabled={categoriesLoading} className="font-bold underline disabled:opacity-60">
                  {categoriesLoading ? "Loading…" : "Retry"}
                </button>
              </div>
            )}
            <label className="merchant-input flex items-center gap-3">
              <Tag size={19} className="shrink-0 text-[#7187a8]" />
              <select
                name="sub_category_name"
                value={subCategoryName}
                onChange={(event) => setSubCategoryName(event.target.value)}
                required
                disabled={!categoryName}
                className="min-w-0 flex-1 bg-transparent outline-none disabled:text-slate-400"
              >
                <option value="">Business Subcategory</option>
                {businessCategories
                  .find((category) => category.name === categoryName)
                  ?.subCategories?.map((subcategory) => (
                    <option key={subcategory.id} value={subcategory.name}>
                      {subcategory.groupName
                        ? `${subcategory.groupName} — `
                        : ""}
                      {subcategory.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="merchant-input flex items-center gap-3">
              <MapPin size={19} className="shrink-0 text-slate-500" />
              <input
                name="address"
                value={businessAddress}
                onChange={(event) => setBusinessAddress(event.target.value)}
                placeholder="Store / Business Address"
                required
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>
            <div className="rounded-xl border border-[#ccd8e9] bg-[#f8fbff] p-4">
              <p className="mb-3 text-xs font-black uppercase tracking-wide text-[#075cff]">Location Coverage</p>
              <div className="grid min-w-0 gap-3 sm:grid-cols-3">
              <label className="min-w-0 text-[11px] font-bold text-slate-700">Region<select name="region" value={selectedRegion} onChange={(event) => { setSelectedRegion(event.target.value); setSelectedProvince(""); setSelectedCity(""); setSelectedDistrict(""); setSelectedArea(""); setLocation(null); }} required className="merchant-input mt-2 block w-full bg-white">
                <option value="">Select region</option>
                {zoneRegions(coverageOptions).map(region => <option key={region} value={region}>{region}</option>)}
              </select></label>
              <label className="min-w-0 text-[11px] font-bold text-slate-700">Province / District<select name="province_district" value={selectedProvince} onChange={(event) => { setSelectedProvince(event.target.value); setSelectedCity(""); setSelectedDistrict(""); setSelectedArea(""); setLocation(null); }} required disabled={!selectedRegion} className="merchant-input mt-2 block w-full bg-white disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400">
                <option value="">Select province / district</option>
                {zoneProvinces(coverageOptions, selectedRegion).map(province => <option key={province} value={province}>{province}</option>)}
              </select></label>
              <label className="min-w-0 text-[11px] font-bold text-slate-700">City / Municipality<select
                name="city_municipality"
                value={selectedCity}
                onChange={(event) => {
                  setSelectedCity(event.target.value);
                  setSelectedDistrict("");
                  setSelectedArea("");
                  setLocation(null);
                }}
                required
                disabled={!selectedProvince}
                className="merchant-input mt-2 block w-full bg-white disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">
                  {coverageLoading
                    ? "Loading cities…"
                    : coverageError
                      ? "Cities unavailable"
                      : "Select city / municipality"}
                </option>
                {citiesInZoneProvince(coverageOptions, selectedRegion, selectedProvince).map((city) => (
                  <option key={city.code} value={city.name}>
                    {city.name
                      .replace(/^City of /, "")
                      .replace(/ \(City\)$/, "")}
                  </option>
                ))}
              </select></label>
              </div>
              <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-3">
              <label className="min-w-0 text-[11px] font-bold text-slate-700">Local Council District<select
                name="council_district"
                value={selectedDistrict}
                onChange={(event) => {
                  setSelectedDistrict(event.target.value);
                  setSelectedArea("");
                }}
                required
                disabled={!selectedCity}
                className="merchant-input mt-2 block w-full bg-white disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">Select council district</option>
                {findZoneCity(coverageOptions, selectedCity)?.districts.map((district) => (
                    <option key={district.name} value={district.name}>
                      {district.name}
                    </option>
                  ))}
              </select></label>
              <label className="min-w-0 text-[11px] font-bold text-slate-700">Barangay / Area<select name="geographic_area" value={selectedArea} onChange={(event) => setSelectedArea(event.target.value)} required={Boolean(selectedDistrictOption?.areas.length)} disabled={!selectedDistrict || !selectedDistrictOption?.areas.length} className="merchant-input mt-2 block w-full bg-white disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400">
                <option value="">{selectedDistrictOption && !selectedDistrictOption.areas.length ? "Whole district" : "Select barangay / area"}</option>
                {selectedDistrictOption?.areas.map(area => <option key={area.code} value={area.name}>{area.name}</option>)}
              </select></label>
              <div className="hidden sm:block" aria-hidden="true" />
              </div>
            </div>
            {coverageError && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <span>{coverageError}</span>
                <button
                  type="button"
                  onClick={loadCoverageOptions}
                  disabled={coverageLoading}
                  className="font-bold underline disabled:opacity-60"
                >
                  {coverageLoading ? "Loading…" : "Retry"}
                </button>
              </div>
            )}
            <div
              className={`grid min-w-0 gap-3 ${hasBranches === "yes" ? "sm:grid-cols-2" : ""}`}
            >
              <select
                name="has_branches"
                value={hasBranches}
                onChange={(event) => setHasBranches(event.target.value)}
                required
                className="merchant-input bg-white text-slate-600"
              >
                <option value="" disabled>
                  Does the business have branches?
                </option>
                <option value="no">No branches</option>
                <option value="yes">Yes, with branches</option>
              </select>
              {hasBranches === "yes" ? (
                <input
                  name="branch_count"
                  type="number"
                  min="1"
                  step="1"
                  required
                  className="merchant-input"
                  placeholder="How many branches?"
                />
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
                placeholder={
                  isFoodBusiness
                    ? "How many products or items are on the menu?"
                    : "How many products do you sell?"
                }
              />
            )}
            <div className="min-w-0 overflow-hidden rounded-xl border border-[#ccd8e9] bg-white">
              <div className="flex items-center gap-3 border-b border-[#dbe4f0] px-4 py-3">
                <MapPin size={19} className="text-[#075cff]" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[#17223b]">
                    Pin your store location
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {geocodingAddress
                      ? "Finding the selected address…"
                      : location
                        ? `${location[0].toFixed(6)}, ${location[1].toFixed(6)}`
                        : "Select an area, use GPS, or click the map."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={locateStore}
                  disabled={locating}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#eaf1ff] px-3 py-2 text-xs font-bold text-[#075cff] transition hover:bg-[#dbe8ff] disabled:opacity-60"
                >
                  <LocateFixed size={16} /> {locating ? "Locating…" : "Use GPS"}
                </button>
                <button
                  type="button"
                  onClick={() => setMapDialogOpen(true)}
                  className="hidden rounded-lg border border-[#ccd8e9] px-3 py-2 text-xs font-bold text-[#075cff] hover:bg-blue-50 sm:block"
                >
                  Expand map
                </button>
              </div>
                <div className="relative h-64 w-full sm:h-[280px]">
                  <LocationMap
                    selectedLocation={location}
                    defaultCenter={location ?? DEFAULT_MAP_CENTER}
                    onMapClick={selectMapLocation}
                    onMarkerDrag={moveMapPin}
                    selectedZoom={locationZoom}
                  />
                  <button
                    type="button"
                    onClick={() => setMapDialogOpen(true)}
                    className="absolute bottom-3 right-3 z-[500] rounded-full bg-white/95 px-4 py-2 text-xs font-bold text-[#075cff] shadow-lg sm:hidden"
                    aria-label="Open a larger store location map"
                  >
                    Expand map
                  </button>
                </div>
              <input type="hidden" name="latitude" value={location?.[0].toFixed(7) ?? ""} />
              <input type="hidden" name="longitude" value={location?.[1].toFixed(7) ?? ""} />
            </div>
            {mapDialogOpen && (
              <div
                className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6"
                role="dialog"
                aria-modal="true"
                aria-labelledby="store-location-map-title"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget)
                    setMapDialogOpen(false);
                }}
              >
                <div className="flex h-[min(88vh,850px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                  <div className="flex items-center gap-4 border-b border-slate-200 px-4 py-3 sm:px-6">
                    <div className="min-w-0 flex-1">
                      <h2
                        id="store-location-map-title"
                        className="font-black text-[#17223b]"
                      >
                        Choose the exact store location
                      </h2>
                      <p className="text-xs text-slate-500">
                        Click the street or drag the red pin to the store
                        entrance.
                      </p>
                    </div>
                    {location && (
                      <p className="hidden text-xs font-semibold text-slate-500 sm:block">
                        {location[0].toFixed(6)}, {location[1].toFixed(6)}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setMapDialogOpen(false)}
                      className="rounded-full p-2 text-slate-600 hover:bg-slate-100"
                      aria-label="Close larger map"
                    >
                      <X size={22} />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1">
                    <LocationMap
                      selectedLocation={location}
                      defaultCenter={location ?? DEFAULT_MAP_CENTER}
                      onMapClick={selectMapLocation}
                      onMarkerDrag={moveMapPin}
                      selectedZoom={Math.max(locationZoom, 16)}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 sm:px-6">
                    <p className="text-xs text-slate-500">
                      Street names are visible at this zoom level.
                    </p>
                    <button
                      type="button"
                      onClick={() => setMapDialogOpen(false)}
                      className="rounded-xl bg-[#075cff] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#0049d8]"
                    >
                      Use this location
                    </button>
                  </div>
                </div>
              </div>
            )}
            <textarea
              name="business_description"
              rows={5}
              className="merchant-input block min-h-32 w-full resize-y"
              placeholder="Tell us about your business"
            />
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" required className="mt-0.5 size-4" />
              <span>
                I agree to the{" "}
                <Link href="#" className="font-bold text-[#075cff]">
                  Terms &amp; Conditions
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="font-bold text-[#075cff]">
                  Privacy Policy
                </Link>
              </span>
            </label>
            <button
              disabled={submitting}
              className="h-[51px] w-full rounded-xl bg-[#075cff] font-extrabold text-white transition hover:bg-[#0049d8] disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Submit for Callback"}
            </button>
          </form>
        </div>
      </section>

      <section id="services" className="px-4 pb-3 lg:px-9">
        <div className="rounded-2xl border border-[#ccd8e9] bg-white p-4 shadow-[0_10px_30px_rgba(49,91,150,0.1)]">
          <h2 className="mb-4 text-2xl font-black text-[#075cff]">
            POWERFUL IN-STORE FEATURES
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            {features.map(({ icon: Icon, color, title, image, text }) => (
              <article
                key={title}
                className="flex min-w-0 flex-col rounded-xl border border-[#ccd8e9] bg-white p-3"
              >
                <div
                  className={`mx-auto flex size-14 items-center justify-center rounded-full text-white ${color}`}
                >
                  <Icon size={30} strokeWidth={2.2} />
                </div>
                <h3 className="flex min-h-14 items-center justify-center text-center text-sm font-black leading-4">
                  {title}
                </h3>
                <div className="relative h-[220px] overflow-hidden rounded-xl bg-[#edf4ff]">
                  <Image
                    src={image}
                    alt={title}
                    fill
                    sizes="(min-width: 1536px) 15vw, (min-width: 1024px) 30vw, 50vw"
                    className="object-cover"
                  />
                </div>
                <p className="mt-4 text-[13px] leading-[19px]">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3 px-4 pb-3 lg:grid-cols-3 lg:px-9">
        <div className="relative min-h-[300px] overflow-hidden rounded-2xl border border-[#ccd8e9] bg-white">
          <Image
            src="/images/merchants.png"
            alt="Push discount notifications help merchants reach nearby customers"
            fill
            sizes="(min-width: 1024px) 33vw, 100vw"
            className="object-cover object-top"
          />
        </div>

        <div className="rounded-2xl border border-[#ccd8e9] bg-white p-6">
          <h2 className="mb-6 text-2xl font-black text-[#075cff]">
            WHY MERCHANTS LOVE WEKONNEK
          </h2>
          <div className="space-y-5">
            {benefits.map(({ icon: Icon, title, text }) => (
              <div key={title} className="flex gap-4">
                <Icon className="shrink-0 text-[#075cff]" size={31} />
                <div>
                  <h3 className="font-extrabold">{title}</h3>
                  <p className="mt-1 text-sm">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#ccd8e9] bg-white p-6">
          <h2 className="text-2xl font-black text-[#075cff]">
            Simple Flat Pricing for{" "}
            <span className="text-red-600">Local Businesses</span>
          </h2>
          <p className="mt-9 text-2xl font-black leading-snug">
            Affordable. Predictable. No Hidden Fees.
            <br />
            More savings. More customers. More growth.
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-t-[28px] bg-gradient-to-br from-[#182854] to-[#075cff] px-5 py-8 text-white lg:px-9">
        <div className="grid items-center gap-6 lg:grid-cols-[260px_1fr]">
          <div className="relative mx-auto h-56 w-52 overflow-hidden lg:h-64 lg:w-60">
            <Image
              src="/images/weko-mascot.png"
              alt="Blue WeKonnek mascot"
              fill
              sizes="240px"
              className="object-contain object-center"
            />
          </div>
          <div>
            <h2 className="text-4xl font-black tracking-tight sm:text-5xl">
              LET&apos;S GROW <span className="text-[#ffcc00]">TOGETHER!</span>
            </h2>
            <p className="mt-4 text-lg font-bold sm:text-xl">
              Join thousands of local businesses already growing with{" "}
              <span className="text-[#ffcc00]">WeKonnek.</span>
            </p>
          </div>
        </div>

        <div className="mt-5 grid overflow-hidden rounded-2xl bg-white text-[#071333] sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {marketStats.map(({ value, label, detail }) => (
            <div
              key={label}
              className="flex min-h-[220px] flex-col items-center justify-center border-b border-r border-[#ccd8e9] p-5 text-center"
            >
              <div className="mb-4 flex size-16 items-center justify-center rounded-full bg-[#1749e8] text-2xl text-white">
                •
              </div>
              <strong className="text-4xl font-black text-[#1749e8]">
                {value}
              </strong>
              <h3 className="mt-1 text-lg font-black leading-5">{label}</h3>
              {detail && (
                <p className="mt-5 text-sm text-slate-500">{detail}</p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-2xl bg-[#182854] p-8">
            <h3 className="text-4xl font-black text-[#ffcc00]">
              A ₱1.34T – ₱1.57T
            </h3>
            <p className="mt-3 text-2xl font-black">
              ONLINE SPENDING OPPORTUNITY
              <br />
              IN THE PHILIPPINES (2025)
            </p>
            <p className="mt-5 text-lg">
              Philippine e-commerce market size estimated at $24B – $28B
              annually
            </p>
          </div>
          <div className="grid gap-4 rounded-2xl bg-white p-7">
            <a
              href="#callback"
              className="flex items-center justify-center rounded-xl bg-red-600 px-5 py-4 text-center text-lg font-black text-white"
            >
              Submit for Callback
            </a>
            <Link
              href="/customer/dashboard"
              className="flex items-center justify-center rounded-xl border-2 border-[#d6dfed] px-5 py-4 text-center text-lg font-black text-[#1749e8]"
            >
              Open WeKonnek App
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function MerchantHeader() {
  const portalUrl = usePortalUrl("merchant");
  return (
    <header className="relative z-30 flex h-[114px] items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-9">
      <Link href="/" aria-label="WeKonnek home">
        <Image
          src="/images/weKonnekLogov1.png"
          alt="WeKonnek"
          width={1536}
          height={1024}
          priority
          className="h-24 w-auto object-contain"
        />
      </Link>
      <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-[52px] whitespace-nowrap text-[15px] font-semibold xl:flex">
        <Link href="/">Home</Link>
        <Link
          href="/for-merchants"
          className="relative font-black text-[#075cff] after:absolute after:-bottom-4 after:left-1/2 after:h-[3px] after:w-12 after:-translate-x-1/2 after:rounded-full after:bg-[#075cff]"
        >
          For Merchants
        </Link>
        <Link href="/coordinators">For Coordinators</Link>
        <Link href="/contact">Contact</Link>
      </nav>
      <a
        href={portalUrl}
        className="inline-flex h-[50px] items-center gap-2 rounded-xl bg-[#075cff] px-7 text-sm font-black text-white shadow-[0_12px_24px_rgba(0,86,255,0.24)]"
      >
        <Store size={17} /> Merchant Portal
      </a>
    </header>
  );
}

function FormField({
  name,
  icon: Icon,
  placeholder,
  type = "text",
  required = false,
}: {
  name: string;
  icon: typeof UserRound;
  placeholder: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="merchant-input flex items-center gap-3">
      <Icon size={19} className="shrink-0 text-slate-500" />
      <input
        name={name}
        required={required}
        type={type}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent outline-none"
      />
    </label>
  );
}
