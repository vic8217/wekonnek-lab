"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DragEndEvent } from "leaflet";
import { getToken } from "@/hooks/use-auth";
import toast from "react-hot-toast";
import { citiesInZoneRegion, findZoneArea, findZoneCity, findZoneDistrict, loadAdminZoneAddresses, zoneRegions, type ZoneCityOption } from "@/lib/zone-address";

const LocationMap = dynamic(() => import("@/components/LocationMap"), {
  ssr: false,
});
const EMPTY = {
  label: "Home",
  addressLine: "",
  region: "",
  district: "",
  barangay: "",
  city: "",
  province: "",
  postalCode: "",
  notes: "",
};

export default function AddressPickerPage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [location, setLocation] = useState<[number, number] | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [zoneCities, setZoneCities] = useState<ZoneCityOption[]>([]);
  const selectedCity = findZoneCity(zoneCities, form.city);
  const selectedDistrict = findZoneDistrict(selectedCity, form.district);
  const query = useMemo(
    () =>
      [
        form.addressLine,
        form.barangay,
        form.district,
        form.city,
        form.region,
        form.province,
        form.postalCode,
      ]
        .filter(Boolean)
        .join(", "),
    [form],
  );

  useEffect(() => {
    loadAdminZoneAddresses()
      .then(setZoneCities)
      .catch(() => setZoneCities([]));
  }, []);

  useEffect(() => {
    if (!zoneCities.length || !form.city) return;
    const city = findZoneCity(zoneCities, form.city);
    if (!city) return;
    const district = findZoneDistrict(city, form.district);
    const area = findZoneArea(district, form.barangay);
    setForm(current => {
      const next = { ...current, region: city.regionName || current.region, city: city.name, province: city.provinceName || current.province || 'Metro Manila', district: district?.name || current.district, barangay: area?.name || current.barangay };
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [form.barangay, form.city, form.district, zoneCities]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("edit");
    setEditId(id);
    if (!id) {
      setLoading(false);
      return;
    }
    fetch("/api/backend/addresses", {
      headers: { Authorization: `Bearer ${getToken()}` },
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((rows) => {
        const item = (Array.isArray(rows) ? rows : rows.data || []).find(
          (row: { id: string }) => String(row.id) === id,
        );
        if (!item) throw new Error();
        let details: Record<string, string> = {};
        try {
          details = JSON.parse(item.details || "{}");
        } catch {
          /* Legacy plain details remain optional. */
        }
        setForm({
          label: item.label || "Home",
          addressLine: details.addressLine || item.address || "",
          region: details.region || "",
          district: details.district || "",
          barangay: details.barangay || "",
          city: details.city || "",
          province: details.province || "",
          postalCode: details.postalCode || "",
          notes: details.notes || "",
        });
        setLocation([Number(item.latitude), Number(item.longitude)]);
      })
      .catch(() => {
        toast.error("Address not found");
        router.replace("/customer/addresses");
      })
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (loading || query.trim().length < 5) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setGeocoding(true);
      try {
        const response = await fetch(
          `/api/geocode?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const body = await response.json();
        const point = body.results?.[0]?.location;
        if (point) setLocation([Number(point.lat), Number(point.lng)]);
      } catch {
        /* Keep the manually selected pin when lookup is unavailable. */
      } finally {
        setGeocoding(false);
      }
    }, 700);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loading, query]);

  const update = (key: keyof typeof EMPTY, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const useCurrentLocation = () =>
    navigator.geolocation?.getCurrentPosition(
      (position) =>
        setLocation([position.coords.latitude, position.coords.longitude]),
      () => toast.error("Location permission was not granted"),
      { enableHighAccuracy: true, timeout: 10000 },
    );

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!location) {
      toast.error("Drop a pin for this address");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        `/api/backend/addresses${editId ? `/${editId}` : ""}`,
        {
          method: editId ? "PUT" : "POST",
          headers: {
            Authorization: `Bearer ${getToken()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            label: form.label.trim(),
            address: query,
            details: JSON.stringify({
              addressLine: form.addressLine,
              district: form.district,
              barangay: form.barangay,
              city: form.city,
              province: form.province,
              postalCode: form.postalCode,
              notes: form.notes,
            }),
            latitude: location[0],
            longitude: location[1],
          }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Unable to save address");
      }
      toast.success(editId ? "Address updated" : "Address saved");
      router.push("/customer/addresses");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save address",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <div className="size-9 animate-spin rounded-full border-4 border-red-600 border-t-transparent" />
      </div>
    );
  return (
    <form onSubmit={save} className="mx-auto grid max-w-lg gap-4 px-4 py-6">
      <h1 className="text-lg font-bold">
        {editId ? "Edit Address" : "Add Address"}
      </h1>
      <label className="text-sm font-semibold">
        Address name / label
        <input
          required
          value={form.label}
          onChange={(event) => update("label", event.target.value)}
          placeholder="Home, Office, Parents' House"
          className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
        />
      </label>
      <label className="text-sm font-semibold">
        House, unit, building and street
        <input
          required
          value={form.addressLine}
          onChange={(event) => update("addressLine", event.target.value)}
          className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
        />
      </label>
      <label className="text-sm font-semibold">
        Region
        <select required value={form.region} onChange={(event) => setForm(current => ({ ...current, region: event.target.value, city: '', district: '', barangay: '' }))} className="mt-1 w-full rounded-xl border bg-white p-3 font-normal">
          <option value="">Select region</option>{zoneRegions(zoneCities).map(region => <option key={region} value={region}>{region}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">
          City / municipality
          <select
            required
            value={form.city}
            onChange={(event) => setForm(current => ({ ...current, city: event.target.value, district: '', barangay: '', province: findZoneCity(zoneCities, event.target.value)?.provinceName || 'Metro Manila' }))}
            className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
          ><option value="">Select city</option>{citiesInZoneRegion(zoneCities, form.region).map(item => <option key={item.code} value={item.name}>{item.name}</option>)}</select>
        </label>
        <label className="text-sm font-semibold">
          Local council district
          <select
            required
            value={form.district}
            onChange={(event) => setForm(current => ({ ...current, district: event.target.value, barangay: '' }))}
            disabled={!selectedCity}
            className="mt-1 w-full rounded-xl border bg-white p-3 font-normal disabled:bg-slate-100"
          ><option value="">Select district</option>{selectedCity?.districts.map(item => <option key={item.name}>{item.name}</option>)}</select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">
          Barangay / area
          <select
            required={Boolean(selectedDistrict?.areas.length)}
            value={form.barangay}
            onChange={(event) => update("barangay", event.target.value)}
            disabled={!selectedDistrict}
            className="mt-1 w-full rounded-xl border bg-white p-3 font-normal disabled:bg-slate-100"
          ><option value="">Select barangay / area</option>{selectedDistrict?.areas.map(item => <option key={item.code} value={item.name}>{item.name}</option>)}</select>
        </label>
        <label className="text-sm font-semibold">
          Province
          <input
            required
            value={form.province}
            onChange={(event) => update("province", event.target.value)}
            className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
          />
        </label>
        <label className="text-sm font-semibold">
          Postal code
          <input
            value={form.postalCode}
            onChange={(event) => update("postalCode", event.target.value)}
            className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
          />
        </label>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold">Drop the address pin</p>
            <p className="text-xs text-slate-500">
              {geocoding
                ? "Finding the typed address…"
                : "The map updates as you type. Tap or drag to correct it."}
            </p>
          </div>
          <button
            type="button"
            onClick={useCurrentLocation}
            className="rounded-lg border border-blue-600 px-3 py-2 text-xs font-bold text-blue-700"
          >
            Use my location
          </button>
        </div>
        <div className="h-72 overflow-hidden rounded-2xl border bg-slate-100">
          <LocationMap
            selectedLocation={location}
            defaultCenter={[14.5995, 120.9842]}
            selectedZoom={16}
            onMapClick={(lat, lng) => setLocation([lat, lng])}
            onMarkerDrag={(event: DragEndEvent) => {
              const point = event.target.getLatLng();
              setLocation([point.lat, point.lng]);
            }}
          />
        </div>
      </div>
      <label className="text-sm font-semibold">
        Delivery notes
        <textarea
          value={form.notes}
          onChange={(event) => update("notes", event.target.value)}
          placeholder="Landmark, gate instructions, floor, etc."
          rows={3}
          className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
        />
      </label>
      <button
        disabled={saving || !location}
        className="rounded-xl bg-[#DB0002] py-3.5 font-bold text-white disabled:opacity-40"
      >
        {saving ? "Saving…" : editId ? "Update Address" : "Save Address"}
      </button>
    </form>
  );
}
