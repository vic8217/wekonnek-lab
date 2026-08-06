'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, LocateFixed, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type L from 'leaflet';
import toast from 'react-hot-toast';
import { getToken } from '@/hooks/use-auth';

const LocationMap = dynamic(() => import('@/components/LocationMap'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center bg-slate-100 text-sm text-slate-500">Loading map…</div>,
});

type Category = { id: number; name: string; subCategories?: Array<{ id: number; name: string; groupName?: string }> };
type Area = { code: string; name: string };
type District = { name: string; areas: Area[] };
type City = { code: string; name: string; districts: District[] };

const initialForm = {
  contact_name: '', business_name: '', phone: '', email: '', category_name: '', sub_category_name: '', address: '',
  city_municipality: '', council_district: '', geographic_area: '', has_branches: '',
  latitude: '', longitude: '', business_description: '',
};

export default function NewMerchantApplicationPage() {
  const router = useRouter();
  const [form, setForm] = useState(initialForm);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cities, setCities] = useState<City[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [filteringMap, setFilteringMap] = useState(false);

  const selectedCity = cities.find(city => city.name === form.city_municipality);
  const merchantSubCategories = categories.find(category => category.name === form.category_name)?.subCategories || [];
  const districts = selectedCity?.districts || [];
  const areas = useMemo(() => districts.find(district => district.name === form.council_district)?.areas || [], [districts, form.council_district]);
  const selectedLocation: [number, number] | null = form.latitude && form.longitude
    ? [Number(form.latitude), Number(form.longitude)]
    : null;

  useEffect(() => {
    const headers = { Authorization: `Bearer ${getToken()}` };
    Promise.all([
      fetch('/api/backend/merchant-categories').then(response => response.ok ? response.json() : []),
      fetch('/api/backend/merchant-applications/coordinator/coverage-options', { headers }).then(async response => {
        const body = await response.json().catch(() => []);
        if (!response.ok) throw new Error(body?.message || 'Unable to load your coverage zone');
        return body;
      }),
    ]).then(([categoryData, coverageData]) => {
      setCategories(Array.isArray(categoryData) ? categoryData : []);
      setCities(Array.isArray(coverageData) ? coverageData : []);
    }).catch(error => toast.error(error.message)).finally(() => setLoadingOptions(false));
  }, []);

  useEffect(() => {
    if (!form.city_municipality) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const city = form.city_municipality.replace(/^City of\s+/i, '').replace(/\s+\(City\)$/i, '').trim();
      const queries = [
        [form.address.trim(), form.geographic_area, city, 'Philippines'],
        [form.geographic_area, city, 'Philippines'],
        [form.council_district, city, 'Philippines'],
        [city, 'Philippines'],
      ].map(parts => parts.filter(Boolean).join(', ')).filter((query, index, all) => query && all.indexOf(query) === index);
      setFilteringMap(true);
      try {
        const lookup = async (url: string) => {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) return null;
          const body = await response.json();
          return body.status === 'ok' ? body.results?.[0] ?? null : null;
        };
        let result = null;
        for (const query of queries) {
          const encoded = encodeURIComponent(query);
          result = await lookup(`/api/geocode?q=${encoded}`) ?? await lookup(`/api/routing/geocode?q=${encoded}&limit=1`);
          if (result) break;
        }
        const latitude = Number(result?.location?.lat);
        const longitude = Number(result?.location?.lng);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          setForm(current => ({ ...current, latitude: String(latitude), longitude: String(longitude) }));
        }
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) toast.error('Unable to center the map on the selected coverage area');
      } finally {
        if (!controller.signal.aborted) setFilteringMap(false);
      }
    }, form.address.trim() ? 600 : 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [form.address, form.city_municipality, form.council_district, form.geographic_area]);

  const update = (name: keyof typeof initialForm, value: string) => setForm(current => ({ ...current, [name]: value }));
  const useGps = () => {
    if (!navigator.geolocation) return toast.error('GPS is not supported by this browser');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      position => { update('latitude', String(position.coords.latitude)); update('longitude', String(position.coords.longitude)); setLocating(false); toast.success('Store location captured'); },
      () => { setLocating(false); toast.error('Unable to access your location'); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  const setMapLocation = (latitude: number, longitude: number) => setForm(current => ({
    ...current, latitude: String(latitude), longitude: String(longitude),
  }));
  const moveMapPin = (event: L.DragEndEvent) => {
    const point = event.target.getLatLng();
    setMapLocation(point.lat, point.lng);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      const response = await fetch('/api/backend/merchant-applications/coordinator/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` }, body: JSON.stringify(form),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.message || 'Unable to create merchant application');
      toast.success('Merchant application created and assigned to you');
      window.dispatchEvent(new Event('coordinator-leads-updated'));
      router.push(`/coordinator/applications/${body.id}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to create merchant application'); }
    finally { setSaving(false); }
  };

  return <div className="mx-auto max-w-5xl">
    <Link href="/coordinator/applications" className="inline-flex items-center gap-2 text-sm font-bold text-[#365078]"><ArrowLeft size={17} /> Back to Merchant Onboarding</Link>
    <div className="mt-5"><h2 className="text-2xl font-black text-[#071d43]">Add New Merchant</h2><p className="mt-1 text-sm text-[#4d6385]">Create an onboarding application. It will be assigned directly to your coordinator account.</p></div>
    <form onSubmit={submit} className="mt-6 space-y-6">
      <Section title="Merchant and contact information"><div className="grid gap-4 md:grid-cols-2">
        <Field label="Full Name"><input required value={form.contact_name} onChange={event => update('contact_name', event.target.value)} className="onboarding-input" placeholder="Merchant or authorized representative" /></Field>
        <Field label="Business / Store Name"><input required value={form.business_name} onChange={event => update('business_name', event.target.value)} className="onboarding-input" /></Field>
        <Field label="Mobile Number"><input required type="tel" value={form.phone} onChange={event => update('phone', event.target.value)} className="onboarding-input" /></Field>
        <Field label="Email Address"><input required type="email" value={form.email} onChange={event => update('email', event.target.value)} className="onboarding-input" /></Field>
        <Field label="Business Category"><select required disabled={loadingOptions} value={form.category_name} onChange={event => setForm(current => ({ ...current, category_name: event.target.value, sub_category_name: '' }))} className="onboarding-input"><option value="">Select business category</option>{categories.map(category => <option key={category.id} value={category.name}>{category.name}</option>)}</select></Field>
        <Field label="Business Subcategory"><select required disabled={!form.category_name} value={form.sub_category_name} onChange={event => update('sub_category_name', event.target.value)} className="onboarding-input"><option value="">Select business subcategory</option>{merchantSubCategories.map(subcategory => <option key={subcategory.id} value={subcategory.name}>{subcategory.groupName ? `${subcategory.groupName} — ` : ''}{subcategory.name}</option>)}</select></Field>
        <Field label="Does the business have branches?"><select required value={form.has_branches} onChange={event => update('has_branches', event.target.value)} className="onboarding-input"><option value="">Select an answer</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
      </div></Section>
      <Section title="Business location"><div className="space-y-4">
        <Field label="Store / Business Address"><input required value={form.address} onChange={event => update('address', event.target.value)} className="onboarding-input" placeholder="Street, building, unit, or landmark" /></Field>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="City / Municipality"><select required disabled={loadingOptions} value={form.city_municipality} onChange={event => setForm(current => ({ ...current, city_municipality: event.target.value, council_district: '', geographic_area: '', latitude: '', longitude: '' }))} className="onboarding-input"><option value="">Select city</option>{cities.map(city => <option key={city.code} value={city.name}>{city.name}</option>)}</select></Field>
          <Field label="Council District"><select required disabled={!selectedCity} value={form.council_district} onChange={event => setForm(current => ({ ...current, council_district: event.target.value, geographic_area: '', latitude: '', longitude: '' }))} className="onboarding-input"><option value="">Select district</option>{districts.map(district => <option key={district.name}>{district.name}</option>)}</select></Field>
          <Field label="Area within district"><select required disabled={!form.council_district} value={form.geographic_area} onChange={event => setForm(current => ({ ...current, geographic_area: event.target.value, latitude: '', longitude: '' }))} className="onboarding-input"><option value="">Select area</option>{areas.map(area => <option key={area.code} value={area.name}>{area.name}</option>)}</select></Field>
        </div>
        <div className="overflow-hidden rounded-xl border border-[#c9d8ef] bg-[#f8faff]"><div className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><MapPin className="text-[#4717ff]" /><div><p className="text-sm font-black text-[#071d43]">Pin the store location</p><p className="text-xs text-[#4d6385]">{filteringMap ? 'Filtering map to the selected coverage area…' : 'The map follows the selected city, district, and area. Click or drag for the exact location.'}</p></div></div><button type="button" onClick={useGps} disabled={locating} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#e8edff] px-4 py-2 text-sm font-black text-[#4717ff] disabled:opacity-50"><LocateFixed size={16} />{locating ? 'Locating…' : 'Use GPS'}</button></div><div className="relative h-72 border-y border-[#c9d8ef]"><LocationMap selectedLocation={selectedLocation} defaultCenter={[14.4793, 121.0198]} selectedZoom={form.geographic_area ? 17 : form.council_district ? 14 : 12} onMapClick={setMapLocation} onMarkerDrag={moveMapPin} />{filteringMap && <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center bg-white/35"><span className="rounded-full bg-white px-4 py-2 text-xs font-bold text-[#075cff] shadow">Filtering coverage…</span></div>}</div>{form.latitude && form.longitude && <p className="px-4 pt-3 text-xs font-semibold text-emerald-700">Pin selected: {Number(form.latitude).toFixed(6)}, {Number(form.longitude).toFixed(6)}</p>}<div className="grid gap-3 p-4 sm:grid-cols-2"><input required type="number" step="any" value={form.latitude} onChange={event => update('latitude', event.target.value)} className="onboarding-input" placeholder="Latitude" /><input required type="number" step="any" value={form.longitude} onChange={event => update('longitude', event.target.value)} className="onboarding-input" placeholder="Longitude" /></div></div>
      </div></Section>
      <Section title="Business details"><Field label="Tell us about the business" optional><textarea rows={5} value={form.business_description} onChange={event => update('business_description', event.target.value)} className="onboarding-input" placeholder="Products, services, target customers, and other useful details" /></Field></Section>
      <div className="flex justify-end gap-3"><Link href="/coordinator/applications" className="rounded-xl border border-[#ccd8e9] bg-white px-5 py-3 text-sm font-black text-[#365078]">Cancel</Link><button disabled={saving || loadingOptions} className="rounded-xl bg-[#075cff] px-6 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? 'Creating…' : 'Create Merchant Application'}</button></div>
    </form>
    <style jsx global>{`.onboarding-input{width:100%;border:1px solid #c9d8ef;border-radius:.75rem;background:white;padding:.8rem 1rem;color:#223a60;outline:none}.onboarding-input:focus{border-color:#075cff;box-shadow:0 0 0 3px rgba(7,92,255,.1)}.onboarding-input:disabled{background:#f1f5f9;color:#94a3b8}`}</style>
  </div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-[#d2ddea] bg-white p-5 shadow-sm sm:p-6"><h3 className="mb-5 text-lg font-black text-[#071d43]">{title}</h3>{children}</section>; }
function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) { return <label className="block"><span className="mb-2 block text-sm font-bold text-[#30486d]">{label}{optional ? <span className="font-normal text-slate-400"> (optional)</span> : <span className="text-red-600"> *</span>}</span>{children}</label>; }
