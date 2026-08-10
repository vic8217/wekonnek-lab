"use client";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Camera, Images, MapPin, X } from "lucide-react";
import { getToken } from "@/hooks/use-auth";
import {
  propertyApi,
  type PropertyListing,
  type PropertyPlan,
  type PropertyType,
} from "@/lib/property";
import {
  LISTER_TYPE_OPTIONS,
  PROPERTY_GROUPS,
  propertyTypeDefinition,
} from "@/lib/property-classification";
import dynamic from "next/dynamic";
import type { DragEndEvent } from "leaflet";
import { citiesInZoneRegion, findZoneArea, findZoneCity, findZoneDistrict, loadAdminZoneAddresses, zoneRegions, type ZoneCityOption } from "@/lib/zone-address";

const LocationMap = dynamic(() => import("@/components/LocationMap"), {
  ssr: false,
});

type Photo = { file?: File; url: string };
const EXTRA_DETAIL_FIELDS = [
  ["developmentName", "Development name", "text"],
  ["buildingName", "Building name", "text"],
  ["floorLevel", "Floor level", "number"],
  ["numberOfFloors", "Number of floors", "number"],
  ["roomType", "Room type", "text"],
  ["occupancyType", "Occupancy type", "text"],
  ["maximumOccupants", "Maximum occupants", "number"],
  ["bathroomType", "Bathroom type", "text"],
  ["lotDimensions", "Lot dimensions", "text"],
  ["roadAccess", "Road access", "text"],
  ["titleType", "Title type", "text"],
  ["fitOutStatus", "Fit-out status", "text"],
  ["frontage", "Frontage", "text"],
  ["commercialUse", "Commercial use", "text"],
  ["clearHeight", "Clear height", "text"],
  ["loadingAccess", "Loading access", "text"],
  ["buildingUse", "Building use", "text"],
  ["amenities", "Amenities", "text"],
] as const;
export default function PropertyListingForm({
  displayMode = "pwa",
  mode = "create",
  listingId,
}: {
  displayMode?: "pwa" | "embedded";
  mode?: "create" | "edit";
  listingId?: string;
}) {
  const router = useRouter(),
    formRef = useRef<HTMLFormElement>(null),
    gallery = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);
  const [types, setTypes] = useState<PropertyType[]>([]),
    [plans, setPlans] = useState<PropertyPlan[]>([]),
    [initial, setInitial] = useState<PropertyListing | null>(null),
    [ready, setReady] = useState(mode === "create"),
    [selectedPlanId, setSelectedPlanId] = useState(""),
    [paymentOpen, setPaymentOpen] = useState(false),
    [paymentMethod, setPaymentMethod] = useState("gcash"),
    [photos, setPhotos] = useState<Photo[]>([]),
    [step, setStep] = useState(1),
    [transactionType, setTransactionType] = useState<
      "FOR_SALE" | "FOR_RENT" | ""
    >(""),
    [propertyGroup, setPropertyGroup] = useState("Residential"),
    [selectedPropertyTypeId, setSelectedPropertyTypeId] = useState(""),
    [addressLine, setAddressLine] = useState(""),
    [district, setDistrict] = useState(""),
    [barangay, setBarangay] = useState(""),
    [city, setCity] = useState(""),
    [region, setRegion] = useState(""),
    [province, setProvince] = useState(""),
    [zoneCities, setZoneCities] = useState<ZoneCityOption[]>([]),
    [selectedLocation, setSelectedLocation] = useState<[number, number] | null>(
      null,
    ),
    [locationError, setLocationError] = useState(""),
    [geocoding, setGeocoding] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selectedZoneCity = findZoneCity(zoneCities, city);
  const selectedZoneDistrict = findZoneDistrict(selectedZoneCity, district);
  useEffect(() => {
    loadAdminZoneAddresses()
      .then(setZoneCities)
      .catch(() => setZoneCities([]));
  }, []);
  useEffect(() => {
    if (!zoneCities.length || !city) return;
    const cityMatch = findZoneCity(zoneCities, city);
    if (!cityMatch) return;
    if (cityMatch.regionName && cityMatch.regionName !== region) setRegion(cityMatch.regionName);
    const districtMatch = findZoneDistrict(cityMatch, district);
    const areaMatch = findZoneArea(districtMatch, barangay);
    if (cityMatch.name !== city) setCity(cityMatch.name);
    if (districtMatch && districtMatch.name !== district) setDistrict(districtMatch.name);
    if (areaMatch && areaMatch.name !== barangay) setBarangay(areaMatch.name);
    if (!province && cityMatch.provinceName) setProvince(cityMatch.provinceName);
  }, [barangay, city, district, province, region, zoneCities]);
  useEffect(() => {
    if (!city || !barangay || district || !zoneCities.length) return;
    const match = findZoneCity(zoneCities, city)?.districts.find(item => Boolean(findZoneArea(item, barangay)));
    if (match) setDistrict(match.name);
  }, [barangay, city, district, zoneCities]);
  useEffect(() => {
    const token = getToken(),
      destination =
        mode === "edit" && listingId
          ? `/property/listings/${listingId}/edit${displayMode === "embedded" ? "?mode=embedded" : ""}`
          : `/property/post${displayMode === "embedded" ? "?mode=embedded" : ""}`;
    if (!token) {
      router.replace(`/auth/login?redirect=${encodeURIComponent(destination)}`);
      return;
    }
    Promise.all([
      propertyApi.types(),
      propertyApi.plans(),
      mode === "edit" && listingId
        ? propertyApi.ownedDetail(listingId)
        : Promise.resolve(null),
    ])
      .then(([typeRows, planRows, row]) => {
        setTypes(typeRows);
        setPlans(planRows);
        setSelectedPlanId((current) => current || planRows[0]?.id || "");
        if (row) {
          setInitial(row);
          setTransactionType(row.transactionType);
          setSelectedPropertyTypeId(row.propertyType.id);
          setPropertyGroup(row.propertyType.groupName);
          setAddressLine(row.addressLine || "");
          setBarangay(row.barangay || "");
          setCity(row.city || "");
          setProvince(row.province || "");
          if (row.latitude != null && row.longitude != null)
            setSelectedLocation([Number(row.latitude), Number(row.longitude)]);
          setPhotos(
            (row.images || []).map((image) => ({ url: image.imageUrl })),
          );
        }
        setReady(true);
      })
      .catch((e) => {
        setError(e.message);
        setReady(true);
      });
  }, [router, mode, listingId, displayMode]);
  useEffect(() => {
    if (city.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setGeocoding(true);
      setLocationError("");
      try {
        const query = [addressLine.trim(), barangay, district, city.trim(), province.trim(), "Philippines"]
          .filter(Boolean)
          .join(", ");
        const response = await fetch(
          `/api/geocode?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const body = await response.json().catch(() => ({}));
        const location = body?.results?.[0]?.location;
        if (
          response.ok &&
          Number.isFinite(Number(location?.lat)) &&
          Number.isFinite(Number(location?.lng))
        )
          setSelectedLocation([Number(location.lat), Number(location.lng)]);
        else
          setLocationError(
            `We could not find ${city.trim()}. Drop the pin manually or check the city and province.`,
          );
      } catch (err) {
        if ((err as Error).name !== "AbortError")
          setLocationError(
            "Area lookup is temporarily unavailable. You can still drop the pin manually.",
          );
      } finally {
        if (!controller.signal.aborted) setGeocoding(false);
      }
    }, 700);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [addressLine, barangay, city, district, province]);
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId);
  const selectedPropertyType = types.find(
    (type) => type.id === selectedPropertyTypeId,
  );
  const applicableFields = new Set<string>(
    propertyTypeDefinition(selectedPropertyType?.slug)?.fields || [],
  );
  const photoLimit = selectedPlan?.maxPhotos ?? 20;
  const add = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(
      0,
      Math.max(0, photoLimit - photos.length),
    );
    setPhotos((p) => [
      ...p,
      ...files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    ]);
    e.target.value = "";
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (mode === "create" && !selectedPlan) {
      setError("Choose an active posting plan.");
      setStep(8);
      return;
    }
    if (!photos.length) {
      setError("Add at least one property photo.");
      setStep(6);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.currentTarget),
        upload = new FormData();
      photos.forEach((p) => {
        if (p.file) upload.append("files", p.file);
      });
      upload.append("type", "property");
      let uploaded: string[] = [];
      if (photos.some((photo) => photo.file)) {
        const up = await fetch("/api/backend/upload/multiple", {
          method: "POST",
          headers: { Authorization: `Bearer ${getToken()}` },
          body: upload,
        });
        const upBody = (await up.json()) as {
          message?: string;
          urls?: string[];
        };
        if (!up.ok || !upBody.urls)
          throw new Error(upBody.message || "Photo upload failed");
        uploaded = upBody.urls;
      }
      const body: Record<string, unknown> = Object.fromEntries(form);
      for (const key of [
        "price",
        "bedrooms",
        "bathrooms",
        "parkingSpaces",
        "floorArea",
        "lotArea",
        "latitude",
        "longitude",
      ])
        if (body[key] === "") delete body[key];
      body.showExactLocation = form.get("showExactLocation") === "on";
      body.negotiable = form.get("negotiable") === "on";
      body.associationDuesIncluded =
        form.get("associationDuesIncluded") === "on";
      body.utilitiesIncluded = form.get("utilitiesIncluded") === "on";
      body.imageUrls = [
        ...photos.filter((photo) => !photo.file).map((photo) => photo.url),
        ...uploaded,
      ];
      if (mode === "edit" && listingId) {
        await propertyApi.update(listingId, body);
        router.push(`/property/${listingId}`);
        return;
      }
      const draft = await propertyApi.create(body);
      if (Number(selectedPlan!.listingFee) === 0) {
        await propertyApi.publish(draft.id, selectedPlan!.id);
        router.push(`/property/${draft.slug}`);
        return;
      }
      const gateway = paymentMethod === "maya" ? "maya" : "paymongo";
      const response = await fetch(
        `/api/backend/property/listings/${draft.id}/checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({
            planId: selectedPlan!.id,
            gateway,
            paymentMethod,
          }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(result.message || "Unable to start secure payment");
      if (!result.paymentUrl)
        throw new Error("The payment provider did not return a checkout link");
      window.location.href = result.paymentUrl;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to publish property",
      );
      setPaymentOpen(false);
    } finally {
      setBusy(false);
    }
  };
  if (!ready)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-9 animate-spin rounded-full border-4 border-red-600 border-t-transparent" />
      </div>
    );
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {displayMode === "pwa" && (
        <Link href="/property" className="text-sm font-bold text-slate-600">
          ← Back to Property
        </Link>
      )}
      <h1
        className={`${displayMode === "pwa" ? "mt-4" : ""} text-3xl font-black`}
      >
        Post a Property
      </h1>
      <p className="text-slate-500">
        Create a visual, searchable property listing.
      </p>
      <div className="relative mt-6 grid grid-cols-8 gap-0.5 before:absolute before:left-[6%] before:right-[6%] before:top-3.5 before:h-0.5 before:bg-slate-200">
        {[
          "Deal",
          "Group",
          "Type",
          "Details",
          "Location",
          "Photos",
          "Lister",
          "Review",
        ].map((label, i) => {
          const number = i + 1,
            active = step === number,
            complete = step > number;
          return (
            <button
              type="button"
              key={label}
              onClick={() => setStep(number)}
              aria-current={active ? "step" : undefined}
              className={`relative z-10 flex min-w-0 flex-col items-center gap-1.5 text-[8px] font-bold sm:text-xs ${active || complete ? "text-red-700" : "text-slate-400"}`}
            >
              <span
                className={`grid size-7 place-items-center rounded-full border-2 bg-white text-[10px] ${active ? "border-red-600 bg-red-600 text-white" : complete ? "border-red-600 text-red-600" : "border-slate-300 text-slate-400"}`}
              >
                {complete ? "✓" : number}
              </span>
              <span className="max-w-full truncate">{label}</span>
            </button>
          );
        })}
      </div>
      <form
        ref={formRef}
        onSubmit={submit}
        className="mt-5 rounded-2xl border bg-white p-5 shadow-sm sm:p-7"
      >
        <section className={step === 1 ? "" : "hidden"}>
          <h2 className="text-xl font-black">
            Is the property for sale or rent?
          </h2>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <label className="cursor-pointer rounded-xl border p-5 text-center font-black has-[:checked]:border-red-600 has-[:checked]:bg-red-50">
              <input
                required
                type="radio"
                name="transactionType"
                value="FOR_SALE"
                checked={transactionType === "FOR_SALE"}
                onChange={() => setTransactionType("FOR_SALE")}
                className="sr-only"
              />
              For Sale
            </label>
            <label className="cursor-pointer rounded-xl border p-5 text-center font-black has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">
              <input
                required
                type="radio"
                name="transactionType"
                value="FOR_RENT"
                checked={transactionType === "FOR_RENT"}
                onChange={() => setTransactionType("FOR_RENT")}
                className="sr-only"
              />
              For Rent
            </label>
          </div>
          <label
            className={`mt-5 block text-sm font-bold transition-opacity ${transactionType === "FOR_SALE" ? "opacity-45" : ""}`}
          >
            Rent price period
            <select
              name="pricePeriod"
              defaultValue="MONTHLY"
              disabled={transactionType !== "FOR_RENT"}
              aria-disabled={transactionType !== "FOR_RENT"}
              className="mt-2 w-full rounded-xl border bg-white p-3 font-normal disabled:cursor-not-allowed disabled:bg-slate-100"
            >
              <option>MONTHLY</option>
              <option>DAILY</option>
              <option>YEARLY</option>
            </select>
            {transactionType === "FOR_SALE" && (
              <span className="mt-1 block text-xs font-normal">
                Not applicable to properties for sale.
              </span>
            )}
          </label>
        </section>
        <section className={step === 2 ? "grid gap-4" : "hidden"}>
          <h2 className="text-xl font-black">Choose a property group</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {PROPERTY_GROUPS.map((group) => (
              <button
                type="button"
                key={group}
                onClick={() => {
                  setPropertyGroup(group);
                  setSelectedPropertyTypeId("");
                  setStep(3);
                }}
                className={`min-h-20 rounded-xl border p-4 font-black ${propertyGroup === group ? "border-red-600 bg-red-50 text-red-700" : "border-slate-200"}`}
              >
                {group}
              </button>
            ))}
          </div>
        </section>
        <section className={step === 3 ? "grid gap-4" : "hidden"}>
          <h2 className="text-xl font-black">What type of property is this?</h2>
          <div className="grid grid-cols-2 gap-3">
            {types
              .filter((type) => type.groupName === propertyGroup)
              .map((type) => (
                <button
                  type="button"
                  key={type.id}
                  onClick={() => setSelectedPropertyTypeId(type.id)}
                  className={`min-h-14 rounded-xl border p-3 text-sm font-bold ${selectedPropertyTypeId === type.id ? "border-red-600 bg-red-50 text-red-700" : "border-slate-200"}`}
                >
                  {type.name}
                </button>
              ))}
          </div>
          <input
            type="hidden"
            name="propertyTypeId"
            value={selectedPropertyTypeId}
          />
        </section>
        <section className={step === 4 ? "grid gap-4" : "hidden"}>
          <h2 className="text-xl font-black">Property details</h2>
          <label className="text-sm font-bold">
            Listing title
            <input
              name="title"
              required
              minLength={5}
              defaultValue={initial?.title || ""}
              placeholder="e.g. Bright 2BR condominium near BGC"
              className="mt-1 w-full rounded-xl border p-3 font-normal"
            />
          </label>
          <label className="text-sm font-bold">
            Description
            <textarea
              name="description"
              required
              minLength={20}
              rows={5}
              defaultValue={initial?.description || ""}
              className="mt-1 w-full rounded-xl border p-3 font-normal"
            />
          </label>
          <label className="text-sm font-bold">
            {transactionType === "FOR_RENT"
              ? "Monthly Rent (₱)"
              : "Selling Price (₱)"}
            <input
              name="price"
              required
              type="number"
              min="0"
              step="0.01"
              defaultValue={initial?.price || ""}
              className="mt-1 w-full rounded-xl border p-3 font-normal"
            />
          </label>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              ["bedrooms", "Bedrooms"],
              ["bathrooms", "Bathrooms"],
              ["parkingSpaces", "Parking"],
              ["floorArea", "Floor area sqm"],
              ["lotArea", "Lot area sqm"],
            ]
              .filter(([name]) => applicableFields.has(name))
              .map(([name, label]) => (
                <label key={name} className="text-xs font-bold">
                  {label}
                  <input
                    name={name}
                    type="number"
                    min="0"
                    step={name === "bathrooms" ? "0.5" : "1"}
                    defaultValue={
                      initial?.[name as keyof PropertyListing] as
                        string | number | undefined
                    }
                    className="mt-1 w-full rounded-xl border p-3 font-normal"
                  />
                </label>
              ))}
          </div>
          {applicableFields.has("furnishedStatus") && (
            <label className="text-sm font-bold">
              Furnished status
              <select
                name="furnishedStatus"
                defaultValue={initial?.furnishedStatus || ""}
                className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
              >
                <option value="">Not specified</option>
                <option>Unfurnished</option>
                <option>Semi-furnished</option>
                <option>Fully furnished</option>
              </select>
            </label>
          )}
          {transactionType === "FOR_SALE" && (
            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                name="negotiable"
                defaultChecked={initial?.negotiable}
              />{" "}
              Price is negotiable
            </label>
          )}
          {transactionType === "FOR_RENT" && (
            <div className="grid grid-cols-3 gap-3">
              {[
                ["minimumLeaseTermMonths", "Minimum lease (months)"],
                ["securityDepositMonths", "Security deposit (months)"],
                ["advanceRentMonths", "Advance rent (months)"],
              ].map(([name, label]) => (
                <label key={name} className="text-xs font-bold">
                  {label}
                  <input
                    name={name}
                    type="number"
                    min="0"
                    className="mt-1 w-full rounded-xl border p-3 font-normal"
                  />
                </label>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {EXTRA_DETAIL_FIELDS.filter(([name]) =>
              applicableFields.has(name),
            ).map(([name, label, type]) => (
              <label key={name} className="text-xs font-bold">
                {label}
                <input
                  name={name}
                  type={type}
                  min={type === "number" ? 0 : undefined}
                  defaultValue={String(initial?.propertyDetails?.[name] ?? "")}
                  className="mt-1 w-full rounded-xl border p-3 font-normal"
                />
              </label>
            ))}
          </div>
          {applicableFields.has("cornerLot") && (
            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                name="cornerLot"
                defaultChecked={Boolean(initial?.propertyDetails?.cornerLot)}
              />{" "}
              Corner lot
            </label>
          )}
          {applicableFields.has("truckAccess") && (
            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                name="truckAccess"
                defaultChecked={Boolean(initial?.propertyDetails?.truckAccess)}
              />{" "}
              Truck access
            </label>
          )}
          {transactionType === "FOR_RENT" && (
            <div className="grid gap-2">
              <label className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  name="associationDuesIncluded"
                  defaultChecked={initial?.associationDuesIncluded}
                />{" "}
                Association dues included
              </label>
              <label className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  name="utilitiesIncluded"
                  defaultChecked={initial?.utilitiesIncluded}
                />{" "}
                Utilities included
              </label>
            </div>
          )}
        </section>
        <section className={step === 5 ? "grid gap-4" : "hidden"}>
          <h2 className="flex items-center gap-2 text-xl font-black">
            <MapPin />
            Location
          </h2>
          <input
            name="addressLine"
            value={addressLine}
            onChange={(event) => setAddressLine(event.target.value)}
            placeholder="Street / building (kept private by default)"
            className="rounded-xl border p-3"
          />
          <select required value={region} onChange={(event) => { setRegion(event.target.value); setCity(''); setDistrict(''); setBarangay(''); }} className="rounded-xl border p-3">
            <option value="">Region</option>{zoneRegions(zoneCities).map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <select
              name="city"
              required
              value={city}
              onChange={(event) => { const value = event.target.value; setCity(value); setDistrict(''); setBarangay(''); setProvince(findZoneCity(zoneCities, value)?.provinceName || 'Metro Manila'); }}
              className="rounded-xl border p-3"
            ><option value="">City / municipality</option>{citiesInZoneRegion(zoneCities, region).map(item => <option key={item.code} value={item.name}>{item.name}</option>)}</select>
            <select required value={district} onChange={(event) => { setDistrict(event.target.value); setBarangay(''); }} disabled={!selectedZoneCity} className="rounded-xl border p-3 disabled:bg-slate-100"><option value="">Local council district</option>{selectedZoneCity?.districts.map(item => <option key={item.name}>{item.name}</option>)}</select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select name="barangay" required={Boolean(selectedZoneDistrict?.areas.length)} value={barangay} onChange={(event) => setBarangay(event.target.value)} disabled={!selectedZoneDistrict} className="rounded-xl border p-3 disabled:bg-slate-100"><option value="">Barangay / area</option>{selectedZoneDistrict?.areas.map(item => <option key={item.code} value={item.name}>{item.name}</option>)}</select>
            <input
              name="province"
              required
              value={province}
              onChange={(event) => setProvince(event.target.value)}
              placeholder="Province"
              className="rounded-xl border p-3"
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black">Drop the property pin</p>
                <p className="text-xs text-slate-500">
                  {geocoding
                    ? `Finding ${city.trim()}…`
                    : "Type a city to focus the map, then tap or drag the pin to adjust."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLocationError("");
                  if (!navigator.geolocation) {
                    setLocationError("Location is unavailable on this device.");
                    return;
                  }
                  navigator.geolocation.getCurrentPosition(
                    (p) =>
                      setSelectedLocation([
                        p.coords.latitude,
                        p.coords.longitude,
                      ]),
                    () =>
                      setLocationError(
                        "We could not access your location. Allow location permission or drop the pin manually.",
                      ),
                    { enableHighAccuracy: true, timeout: 10000 },
                  );
                }}
                className="shrink-0 rounded-lg border border-blue-600 px-3 py-2 text-xs font-black text-blue-700"
              >
                Use my location
              </button>
            </div>
            <div className="relative mt-3 h-72 overflow-hidden rounded-xl border border-slate-300 bg-slate-100">
              <LocationMap
                selectedLocation={selectedLocation}
                defaultCenter={[14.5995, 120.9842]}
                onMapClick={(lat, lng) => {
                  setSelectedLocation([lat, lng]);
                  setLocationError("");
                }}
                onMarkerDrag={(event: DragEndEvent) => {
                  const point = event.target.getLatLng();
                  setSelectedLocation([point.lat, point.lng]);
                }}
                selectedZoom={16}
              />
              {geocoding && (
                <div className="pointer-events-none absolute right-3 top-3 z-[500] flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-bold shadow">
                  <span className="size-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                  Locating area
                </div>
              )}
            </div>
            {locationError && (
              <p className="mt-2 text-xs font-semibold text-red-600">
                {locationError}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs font-bold text-slate-600">
              Latitude
              <input
                name="latitude"
                required
                type="number"
                step="any"
                value={selectedLocation?.[0] ?? ""}
                onChange={(event) => {
                  const lat = Number(event.target.value);
                  setSelectedLocation((current) =>
                    Number.isFinite(lat)
                      ? [lat, current?.[1] ?? 120.9842]
                      : current,
                  );
                }}
                placeholder="Drop a pin"
                className="mt-1 w-full rounded-xl border bg-slate-50 p-3 font-normal"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Longitude
              <input
                name="longitude"
                required
                type="number"
                step="any"
                value={selectedLocation?.[1] ?? ""}
                onChange={(event) => {
                  const lng = Number(event.target.value);
                  setSelectedLocation((current) =>
                    Number.isFinite(lng)
                      ? [current?.[0] ?? 14.5995, lng]
                      : current,
                  );
                }}
                placeholder="Drop a pin"
                className="mt-1 w-full rounded-xl border bg-slate-50 p-3 font-normal"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input name="showExactLocation" type="checkbox" />
            Allow exact map pin to be public
          </label>
        </section>
        <section className={step === 7 ? "grid gap-4" : "hidden"}>
          <h2 className="text-xl font-black">Who is posting?</h2>
          <select
            name="sellerType"
            defaultValue={initial?.sellerType || "OWNER"}
            className="rounded-xl border bg-white p-3"
          >
            {LISTER_TYPE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            name="agencyName"
            placeholder="Agency or developer company (optional)"
            className="rounded-xl border p-3"
          />
          <input
            name="prcLicenseNumber"
            placeholder="PRC license number (brokers, optional)"
            className="rounded-xl border p-3"
          />
          <input
            name="contactName"
            placeholder="Public contact name"
            className="rounded-xl border p-3"
          />
          <p className="text-xs text-slate-500">
            Phone and email remain private; inquiries are routed through
            WEKONNEK.
          </p>
        </section>
        <section className={step === 6 ? "" : "hidden"}>
          <h2 className="text-xl font-black">
            Property photos{" "}
            <span className="text-sm text-slate-500">
              ({photos.length}/{photoLimit})
            </span>
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Photo allowance is based on your currently selected posting tier.
          </p>
          <input
            ref={gallery}
            type="file"
            accept="image/jpeg,image/png"
            multiple
            onChange={add}
            className="sr-only"
          />
          <input
            ref={camera}
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            onChange={add}
            className="sr-only"
          />
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
            {photos.map((p, i) => (
              <div
                key={p.url}
                className="relative aspect-square overflow-hidden rounded-xl"
              >
                <img src={p.url} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() =>
                    setPhotos((v) => v.filter((x) => x.url !== p.url))
                  }
                  className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"
                >
                  <X size={14} />
                </button>
                {i === 0 && (
                  <span className="absolute bottom-1 left-1 rounded bg-white px-1 text-[9px] font-bold">
                    COVER
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={photos.length >= photoLimit}
              onClick={() => gallery.current?.click()}
              className="flex min-h-24 flex-col items-center justify-center rounded-xl border-2 border-dashed font-bold disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Images />
              Gallery
            </button>
            <button
              type="button"
              disabled={photos.length >= photoLimit}
              onClick={() => camera.current?.click()}
              className="flex min-h-24 flex-col items-center justify-center rounded-xl border-2 border-dashed font-bold disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Camera />
              Camera
            </button>
          </div>
        </section>
        <section className={step === 8 ? "grid gap-4" : "hidden"}>
          <h2 className="text-xl font-black">
            {mode === "edit"
              ? "Review listing changes"
              : "Choose a posting plan"}
          </h2>
          <p className="rounded-xl bg-blue-50 p-4 text-sm">
            Your listing will be searchable by property type and location.
            WEKONNEK may suspend listings that violate property policies.
          </p>
          {mode === "create" &&
            (plans.length ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {plans.map((plan) => (
                  <label
                    key={plan.id}
                    className="cursor-pointer rounded-xl border p-4 has-[:checked]:border-red-600 has-[:checked]:bg-red-50"
                  >
                    <input
                      type="radio"
                      name="planId"
                      value={plan.id}
                      checked={selectedPlanId === plan.id}
                      onChange={() => setSelectedPlanId(plan.id)}
                      className="sr-only"
                    />
                    <p className="font-black">{plan.name}</p>
                    <p className="mt-2 text-2xl font-black text-[#DB0002]">
                      {Number(plan.listingFee) === 0
                        ? "FREE"
                        : `₱${Number(plan.listingFee).toLocaleString()}`}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Active for {plan.durationDays} days
                    </p>
                    <p className="text-xs text-slate-500">
                      Up to {plan.maxPhotos} photos
                      {plan.featuredDays
                        ? ` · Featured ${plan.featuredDays} days`
                        : ""}
                    </p>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">
                No active posting plans are available. Please contact WEKONNEK
                support.
              </p>
            ))}
          <button
            type="button"
            onClick={() =>
              mode === "edit"
                ? formRef.current?.requestSubmit()
                : setPaymentOpen(true)
            }
            disabled={busy || (mode === "create" && !selectedPlanId)}
            className="rounded-xl bg-[#DB0002] py-4 font-black text-white disabled:opacity-50"
          >
            {mode === "edit"
              ? "Save Listing Changes"
              : "Continue with Selected Plan"}
          </button>
        </section>
        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700"
          >
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-between">
          <button
            type="button"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className="rounded-xl border px-5 py-2.5 font-bold disabled:opacity-30"
          >
            Back
          </button>
          {step < 8 && (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(8, s + 1))}
              className="rounded-xl bg-blue-700 px-6 py-2.5 font-black text-white"
            >
              Continue
            </button>
          )}
        </div>
      </form>
      {paymentOpen && selectedPlan && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="property-payment-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 id="property-payment-title" className="text-2xl font-black">
                  Posting Payment
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Review your selected Property posting plan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPaymentOpen(false)}
                aria-label="Close payment options"
                className="rounded-full p-2 hover:bg-slate-100"
              >
                <X />
              </button>
            </div>
            <div className="mt-5 rounded-xl bg-slate-50 p-4">
              <div className="flex justify-between text-sm">
                <span>
                  {selectedPlan.name} · {selectedPlan.durationDays} days
                </span>
                <b>
                  {Number(selectedPlan.listingFee) === 0
                    ? "FREE"
                    : `₱${Number(selectedPlan.listingFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                </b>
              </div>
              <div className="mt-3 flex justify-between border-t pt-3 font-black">
                <span>Total</span>
                <span>
                  {Number(selectedPlan.listingFee) === 0
                    ? "₱0.00"
                    : `₱${Number(selectedPlan.listingFee).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                </span>
              </div>
            </div>
            {Number(selectedPlan.listingFee) > 0 ? (
              <fieldset className="mt-5">
                <legend className="text-sm font-black">
                  Choose payment method
                </legend>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[
                    ["gcash", "GCash"],
                    ["maya", "Maya"],
                    ["card", "Card"],
                  ].map(([value, label]) => (
                    <label
                      key={value}
                      className={`cursor-pointer rounded-xl border p-3 text-center text-sm font-bold ${paymentMethod === value ? "border-red-500 bg-red-50 text-red-700" : ""}`}
                    >
                      <input
                        type="radio"
                        name="propertyPaymentMethod"
                        value={value}
                        checked={paymentMethod === value}
                        onChange={() => setPaymentMethod(value)}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                No payment is required for this plan. Your listing will be
                published immediately.
              </div>
            )}
            {error && (
              <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => formRef.current?.requestSubmit()}
              disabled={busy}
              className="mt-5 min-h-12 w-full rounded-xl bg-[#DB0002] font-black text-white disabled:opacity-60"
            >
              {busy
                ? "Preparing listing…"
                : Number(selectedPlan.listingFee) > 0
                  ? `Pay ₱${Number(selectedPlan.listingFee).toLocaleString()} & Publish`
                  : "Publish Free Listing"}
            </button>
            <p className="mt-3 text-center text-[11px] text-slate-500">
              Paid listings remain private drafts until payment is confirmed.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
