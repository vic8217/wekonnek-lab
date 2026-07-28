'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPinned, Plus, Search, X, Pencil, Trash2, Building2, Map } from 'lucide-react';
import toast from 'react-hot-toast';
import { getToken } from '@/hooks/use-auth';

type Region = { code: string; name: string; regionName?: string };
type Province = { code: string; name: string; regionCode: string };
type Locality = { code: string; name: string; regionCode: string; provinceCode?: string | false; isCity: boolean; isMunicipality: boolean };
type Area = { code: string; name: string; latitude?: number; longitude?: number };
type Coverage = { id?: string; regionCode: string; regionName: string; provinceCode: string | null; provinceName: string | null; cityMunicipalityCode: string; cityMunicipalityName: string; congressionalDistrict: string; areas: Area[] };
type Zone = { id: string; name: string; code: string; description: string | null; isActive: boolean; coverages: Coverage[] };

const DISTRICTS = ['Lone District', '1st District', '2nd District', '3rd District', '4th District', '5th District', '6th District', '7th District', '8th District'];
const GeographicAreaMap = dynamic(() => import('@/components/GeographicAreaMap'), { ssr: false });

const NCR_CITY_COUNCIL_DISTRICTS: Record<string, string[]> = {
  'City of Caloocan': ['1st District', '2nd District', '3rd District'],
  'Caloocan City': ['1st District', '2nd District', '3rd District'],
  'City of Las Piñas': ['1st District', '2nd District'],
  'Las Piñas City': ['1st District', '2nd District'],
  'City of Makati': ['1st District', '2nd District'],
  'Makati City': ['1st District', '2nd District'],
  'City of Malabon': ['1st District', '2nd District'],
  'Malabon City': ['1st District', '2nd District'],
  'City of Mandaluyong': ['1st District', '2nd District'],
  'Mandaluyong City': ['1st District', '2nd District'],
  'City of Manila': ['1st District', '2nd District', '3rd District', '4th District', '5th District', '6th District'],
  'City of Marikina': ['1st District', '2nd District'],
  'Marikina City': ['1st District', '2nd District'],
  'City of Muntinlupa': ['1st District', '2nd District'],
  'Muntinlupa City': ['1st District', '2nd District'],
  'City of Navotas': ['1st District', '2nd District'],
  'Navotas City': ['1st District', '2nd District'],
  'City of Parañaque': ['1st District', '2nd District'],
  'Parañaque City': ['1st District', '2nd District'],
  'City of Pasay': ['1st District', '2nd District'],
  'Pasay City': ['1st District', '2nd District'],
  'City of Pasig': ['1st District', '2nd District'],
  'Pasig City': ['1st District', '2nd District'],
  'Quezon City': ['1st District', '2nd District', '3rd District', '4th District', '5th District', '6th District'],
  'City of San Juan': ['1st District', '2nd District'],
  'San Juan City': ['1st District', '2nd District'],
  'City of Taguig': ['1st District', '2nd District'],
  'Taguig City': ['1st District', '2nd District'],
  'City of Valenzuela': ['1st District', '2nd District'],
  'Valenzuela City': ['1st District', '2nd District'],
  'Pateros': ['1st District', '2nd District'],
  'Municipality of Pateros': ['1st District', '2nd District'],
};

const GEOGRAPHIC_AREAS: Record<string, Record<string, Area[]>> = {
  // City of Manila. These are its named geographic/administrative areas,
  // grouped under the city's six current city council districts.
  '133900000': {
    '1st District': [{ code: 'manila-tondo-west', name: 'Tondo (western portion)', latitude: 14.6215, longitude: 120.966 }],
    '2nd District': [{ code: 'manila-tondo-east', name: 'Tondo (eastern portion)', latitude: 14.625, longitude: 120.974 }],
    '3rd District': [
      { code: 'manila-binondo', name: 'Binondo', latitude: 14.6003, longitude: 120.9744 },
      { code: 'manila-quiapo', name: 'Quiapo', latitude: 14.5996, longitude: 120.989 },
      { code: 'manila-san-nicolas', name: 'San Nicolas', latitude: 14.5949, longitude: 120.9695 },
      { code: 'manila-santa-cruz', name: 'Santa Cruz', latitude: 14.618, longitude: 120.982 },
    ],
    '4th District': [{ code: 'manila-sampaloc', name: 'Sampaloc', latitude: 14.612, longitude: 120.996 }],
    '5th District': [
      { code: 'manila-ermita', name: 'Ermita', latitude: 14.5826, longitude: 120.984 },
      { code: 'manila-intramuros', name: 'Intramuros', latitude: 14.5896, longitude: 120.9753 },
      { code: 'manila-malate', name: 'Malate', latitude: 14.57, longitude: 120.991 },
      { code: 'manila-port-area', name: 'Port Area', latitude: 14.59, longitude: 120.958 },
      { code: 'manila-san-andres', name: 'San Andres', latitude: 14.574, longitude: 121.0 },
    ],
    '6th District': [
      { code: 'manila-paco', name: 'Paco', latitude: 14.58, longitude: 120.999 },
      { code: 'manila-pandacan', name: 'Pandacan', latitude: 14.592, longitude: 121.009 },
      { code: 'manila-san-miguel', name: 'San Miguel', latitude: 14.6, longitude: 121.0 },
      { code: 'manila-santa-ana', name: 'Santa Ana', latitude: 14.582, longitude: 121.012 },
      { code: 'manila-santa-mesa', name: 'Santa Mesa', latitude: 14.604, longitude: 121.018 },
    ],
  },
  '137403000': {
    '1st District': [
      'Bagong Ilog', 'Bagong Katipunan', 'Bambang', 'Buting', 'Caniogan', 'Kalawaan',
      'Kapasigan', 'Kapitolyo', 'Malinao', 'Oranbo', 'Palatiw', 'Pineda', 'Sagad',
      'San Antonio', 'San Joaquin', 'San Jose', 'San Nicolas', 'Sta. Cruz', 'Sta. Rosa',
      'Sto. Tomas', 'Sumilang', 'Ugong',
    ].map(name => ({ code: `pasig-d1-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name })),
    '2nd District': [
      'Dela Paz', 'Manggahan', 'Maybunga', 'Pinagbuhatan', 'Rosario', 'San Miguel',
      'Sta. Lucia', 'Santolan',
    ].map(name => ({ code: `pasig-d2-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name })),
  },
  // City of Parañaque council districts, grouped by the city's official barangay listing.
  '137604000': {
    '1st District': [
      'Baclaran', 'Don Galo', 'La Huerta', 'San Dionisio', 'San Isidro',
      'Santo Niño', 'Tambo', 'Vitalez',
    ].map(name => ({ code: `paranaque-d1-${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name })),
    '2nd District': [
      'BF Homes', 'Don Bosco', 'Marcelo Green', 'Merville', 'Moonwalk',
      'San Antonio', 'San Martin de Porres', 'Sun Valley',
    ].map(name => ({ code: `paranaque-d2-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, name })),
  },
};

function api(path: string, init?: RequestInit) {
  const token = getToken();
  return fetch(`/api/backend${path}`, {
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers || {}) },
  });
}

export default function ZoneManagementPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [loading, setLoading] = useState(true);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Zone | null>(null);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [coverage, setCoverage] = useState<Coverage[]>([]);
  const [regionCode, setRegionCode] = useState('');
  const [provinceCode, setProvinceCode] = useState('');
  const [localityCode, setLocalityCode] = useState('');
  const [district, setDistrict] = useState('Lone District');
  const [areas, setAreas] = useState<Area[]>([]);
  const [selectedAreaCodes, setSelectedAreaCodes] = useState<string[]>([]);
  const [areaSearch, setAreaSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const loadZones = useCallback(async () => {
    try {
      const response = await api('/management-zones');
      if (!response.ok) throw new Error('Unable to load zones');
      setZones(await response.json());
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to load zones'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadZones(); }, [loadZones]);

  const loadLocations = async () => {
    if (regions.length) return;
    setReferenceLoading(true);
    try {
      let loaded = false;
      for (let attempt = 1; attempt <= 3 && !loaded; attempt += 1) {
        const response = await api('/management-zones/philippine-locations');
        if (response.ok) {
          const data = await response.json();
          setRegions(data.regions || []); setProvinces(data.provinces || []); setLocalities(data.localities || []);
          loaded = true;
        } else if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, attempt * 600));
        }
      }
      if (!loaded) throw new Error('Unable to load Philippine locations');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to load locations'); }
    finally { setReferenceLoading(false); }
  };

  const openCreate = () => {
    setEditing(null); setName(''); setCode(''); setDescription(''); setActive(true); setCoverage([]);
    setRegionCode(''); setProvinceCode(''); setLocalityCode(''); setDistrict('Lone District'); setAreas([]); setSelectedAreaCodes([]); setModal(true); loadLocations();
  };
  const openEdit = (zone: Zone) => {
    setEditing(zone); setName(zone.name); setCode(zone.code); setDescription(zone.description || ''); setActive(zone.isActive); setCoverage(zone.coverages);
    setRegionCode(''); setProvinceCode(''); setLocalityCode(''); setDistrict('Lone District'); setAreas([]); setSelectedAreaCodes([]); setModal(true); loadLocations();
  };

  const availableProvinces = useMemo(() => provinces.filter((p) => p.regionCode === regionCode), [provinces, regionCode]);
  const availableLocalities = useMemo(() => localities.filter((item) => item.regionCode === regionCode && (!provinceCode || item.provinceCode === provinceCode)).sort((a, b) => a.name.localeCompare(b.name)), [localities, regionCode, provinceCode]);
  const shownAreas = useMemo(() => areas.filter((item) => item.name.toLowerCase().includes(areaSearch.toLowerCase())), [areas, areaSearch]);
  const availableDistricts = useMemo(() => {
    const locality = localities.find(item => item.code === localityCode);
    if (!locality) return DISTRICTS;
    if (GEOGRAPHIC_AREAS[localityCode]) return Object.keys(GEOGRAPHIC_AREAS[localityCode]);
    if (locality.regionCode === '130000000') return NCR_CITY_COUNCIL_DISTRICTS[locality.name] || ['1st District', '2nd District'];
    return DISTRICTS;
  }, [localities, localityCode]);
  const areaReservations = useMemo(() => {
    const areaOwners = new globalThis.Map<string, string>();
    let districtOwner: string | null = null;
    zones.filter(zone => zone.id !== editing?.id).forEach(zone => {
      zone.coverages.forEach(item => {
        if (item.cityMunicipalityCode !== localityCode || item.congressionalDistrict !== district) return;
        if (!item.areas?.length) districtOwner = zone.name;
        else item.areas.forEach(area => areaOwners.set(area.code, zone.name));
      });
    });
    return { areaOwners, districtOwner };
  }, [zones, editing, localityCode, district]);
  const selectableAreas = useMemo(() => areas.filter(area => !areaReservations.districtOwner && !areaReservations.areaOwners.has(area.code)), [areas, areaReservations]);
  const mapSelectedAreaCodes = selectedAreaCodes.length ? selectedAreaCodes : areaReservations.areaOwners.size ? selectableAreas.map(area => area.code) : [];

  const selectLocality = (value: string) => {
    setLocalityCode(value); setAreas([]); setSelectedAreaCodes([]); setAreaSearch('');
    if (!value) return;
    const mapping = GEOGRAPHIC_AREAS[value];
    const locality = localities.find(item => item.code === value);
    const districtOptions = mapping ? Object.keys(mapping) : locality?.regionCode === '130000000' ? (NCR_CITY_COUNCIL_DISTRICTS[locality.name] || ['1st District', '2nd District']) : DISTRICTS;
    const nextDistrict = districtOptions[0];
    setDistrict(nextDistrict);
    setAreas(mapping?.[nextDistrict] || []);
  };

  const selectDistrict = (value: string) => {
    setDistrict(value); setSelectedAreaCodes([]); setAreaSearch('');
    setAreas(GEOGRAPHIC_AREAS[localityCode]?.[value] || []);
  };

  const addCoverage = () => {
    const region = regions.find((item) => item.code === regionCode);
    const province = provinces.find((item) => item.code === provinceCode);
    const locality = localities.find((item) => item.code === localityCode);
    if (!region || !locality || !district) return toast.error('Select a region, city/municipality, and district');
    if (coverage.some((item) => item.cityMunicipalityCode === locality.code && item.congressionalDistrict === district)) return toast.error('This coverage is already assigned');
    if (areaReservations.districtOwner) return toast.error(`This entire district is already assigned to ${areaReservations.districtOwner}`);
    if (areas.length && !selectableAreas.length) return toast.error('All areas in this district are already assigned');
    const chosenAreas = areas.filter((area) => selectedAreaCodes.includes(area.code) && !areaReservations.areaOwners.has(area.code));
    const assignedAreas = chosenAreas.length ? chosenAreas : areaReservations.areaOwners.size ? selectableAreas : [];
    setCoverage((items) => [...items, {
      regionCode: region.code, regionName: region.regionName ? `${region.regionName} — ${region.name}` : region.name,
      provinceCode: province?.code || null, provinceName: province?.name || null,
      cityMunicipalityCode: locality.code, cityMunicipalityName: locality.name, congressionalDistrict: district,
      areas: assignedAreas,
    }]);
    setLocalityCode(''); setDistrict('Lone District'); setAreas([]); setSelectedAreaCodes([]); setAreaSearch('');
  };

  const save = async () => {
    if (!name.trim() || !code.trim() || !coverage.length) return toast.error('Enter a zone name, code, and at least one coverage area');
    setSaving(true);
    try {
      const response = await api(editing ? `/management-zones/${editing.id}` : '/management-zones', {
        method: editing ? 'PATCH' : 'POST', body: JSON.stringify({ name, code, description, isActive: active, coverages: coverage }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(Array.isArray(result.message) ? result.message[0] : result.message || 'Unable to save zone');
      toast.success(editing ? 'Zone updated' : 'Zone created'); setModal(false); await loadZones();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Unable to save zone'); }
    finally { setSaving(false); }
  };

  const remove = async (zone: Zone) => {
    if (!window.confirm(`Delete ${zone.name}?`)) return;
    const response = await api(`/management-zones/${zone.id}`, { method: 'DELETE' });
    if (!response.ok) return toast.error('Unable to delete zone');
    toast.success('Zone deleted'); loadZones();
  };

  const shown = zones.filter((zone) => `${zone.name} ${zone.code} ${zone.coverages.map((c) => `${c.cityMunicipalityName} ${c.congressionalDistrict} ${c.areas?.map((area) => area.name).join(' ') || ''}`).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const coverageCount = zones.reduce((sum, zone) => sum + zone.coverages.length, 0);
  const localityCount = new Set(zones.flatMap((zone) => zone.coverages.map((c) => c.cityMunicipalityCode))).size;

  return <div className="w-full space-y-6 pb-10">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-bold text-slate-900">Coordinator Zone Management</h1><p className="mt-1 text-sm text-slate-500">Define the cities, municipalities, and city council districts assigned to each coordinator area.</p></div>
      <button onClick={openCreate} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#DB0002] px-5 text-sm font-bold text-white shadow-lg shadow-red-200 transition hover:-translate-y-0.5 hover:bg-red-700"><Plus size={18}/>Create zone</button>
    </div>

    <div className="grid gap-4 sm:grid-cols-3">
      {[{ label: 'Coordinator zones', value: zones.length, Icon: MapPinned }, { label: 'Assigned districts', value: coverageCount, Icon: Map }, { label: 'Covered localities', value: localityCount, Icon: Building2 }].map(({ label, value, Icon }) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold text-slate-900">{value}</p></div><span className="rounded-xl bg-red-50 p-3 text-[#DB0002]"><Icon size={22}/></span></div></div>)}
    </div>

    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4"><label className="relative block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search zones, cities, or districts..." className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-4 text-sm outline-none focus:border-red-400 focus:ring-4 focus:ring-red-50"/></label></div>
      {loading ? <div className="p-16 text-center text-slate-500">Loading zones…</div> : shown.length === 0 ? <div className="p-16 text-center"><MapPinned className="mx-auto text-slate-300" size={42}/><p className="mt-3 font-semibold text-slate-700">No zones found</p><p className="mt-1 text-sm text-slate-500">Create a zone and assign its city or district coverage.</p></div> : <div className="grid gap-4 p-4 xl:grid-cols-2">{shown.map((zone) => <article key={zone.id} className="rounded-2xl border border-slate-200 p-5 transition hover:border-red-200 hover:shadow-md"><div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-slate-900">{zone.name}</h2><span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-600">{zone.code}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${zone.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{zone.isActive ? 'ACTIVE' : 'INACTIVE'}</span></div><p className="mt-1 text-sm text-slate-500">{zone.description || `${zone.coverages.length} assigned coverage area${zone.coverages.length === 1 ? '' : 's'}`}</p></div><div className="flex gap-1"><button onClick={() => openEdit(zone)} title="Edit zone" className="rounded-lg p-2 text-slate-500 hover:bg-blue-50 hover:text-blue-600"><Pencil size={16}/></button><button onClick={() => remove(zone)} title="Delete zone" className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600"><Trash2 size={16}/></button></div></div><div className="mt-4 space-y-2">{zone.coverages.map((item) => <div key={`${item.cityMunicipalityCode}-${item.congressionalDistrict}`} className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800"><p className="font-semibold">{item.cityMunicipalityName} · {item.congressionalDistrict}</p><p className="mt-0.5 text-blue-600">{item.areas?.length ? item.areas.map((area) => area.name).join(', ') : 'All areas'}</p></div>)}</div></article>)}</div>}
    </div>

    {modal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 backdrop-blur-sm"><div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-3xl bg-white shadow-2xl"><header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-5"><div><h2 className="text-xl font-bold text-slate-900">{editing ? 'Edit zone' : 'Create a zone'}</h2><p className="text-sm text-slate-500">Assign one or more Philippine localities and city council districts.</p></div><button onClick={() => setModal(false)} className="rounded-full p-2 hover:bg-slate-100"><X size={20}/></button></header>
      <div className="space-y-6 p-6">
        <section className="grid gap-4 sm:grid-cols-2"><Field label="Zone name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Parañaque South Zone" className="form-input"/></Field><Field label="Zone code"><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="PAR-SOUTH" className="form-input font-mono"/></Field><Field label="Description" wide><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional operational notes" className="form-input resize-none"/></Field><label className="flex items-center gap-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-5 w-5 accent-[#DB0002]"/>Active zone</label></section>
        <section className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
          <div className="mb-4"><h3 className="font-bold text-slate-900">Add city / municipality coverage</h3><p className="text-xs text-slate-500">Choose a city council district, then select its named geographic areas. Leaving every area unselected assigns the whole district.</p></div>
          {referenceLoading ? <div className="rounded-xl bg-white p-8 text-center text-sm text-slate-500">Loading Philippine locations…</div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Select label="Region" value={regionCode} onChange={(value) => { setRegionCode(value); setProvinceCode(''); selectLocality(''); }} options={regions.map((r) => ({ value: r.code, label: r.regionName ? `${r.regionName} — ${r.name}` : r.name }))}/>
            <Select label="Province / district" value={provinceCode} onChange={(value) => { setProvinceCode(value); selectLocality(''); }} options={[{ value: '', label: regionCode === '130000000' ? 'NCR (no province)' : 'All provinces' }, ...availableProvinces.map((p) => ({ value: p.code, label: p.name }))]} disabled={!regionCode}/>
            <Select label="City / municipality" value={localityCode} onChange={selectLocality} options={availableLocalities.map((c) => ({ value: c.code, label: `${c.name} (${c.isCity ? 'City' : 'Municipality'})` }))} disabled={!regionCode}/>
            <Select label="City council district" value={district} onChange={selectDistrict} options={availableDistricts.map((item) => ({ value: item, label: item }))} disabled={!localityCode}/>
            {localityCode && <div className="md:col-span-2 xl:col-span-4 rounded-xl border border-blue-100 bg-white p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Areas in {district}</p><p className="text-xs text-slate-500">{areaReservations.districtOwner ? `Entire district assigned to ${areaReservations.districtOwner}` : selectedAreaCodes.length ? `${selectedAreaCodes.length} selected` : areaReservations.areaOwners.size ? `${areaReservations.areaOwners.size} unavailable · remaining areas will be covered` : 'All areas will be covered'}</p></div>{selectableAreas.length > 0 && <button type="button" onClick={() => setSelectedAreaCodes(selectedAreaCodes.length === selectableAreas.length ? [] : selectableAreas.map((area) => area.code))} className="text-xs font-bold text-blue-700 hover:underline">{selectedAreaCodes.length === selectableAreas.length ? 'Clear selection' : 'Select available'}</button>}</div>
              {areas.length === 0 ? <p className="py-3 text-sm text-slate-500">Named geographic areas have not yet been mapped for this locality. The whole district will be assigned.</p> : <><input value={areaSearch} onChange={(event) => setAreaSearch(event.target.value)} placeholder="Search geographic areas…" className="form-input mb-3"/><div className="grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{shownAreas.map((area) => { const owner = areaReservations.districtOwner || areaReservations.areaOwners.get(area.code); return <label key={area.code} title={owner ? `Already assigned to ${owner}` : undefined} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${owner ? 'cursor-not-allowed border-slate-100 bg-slate-100 text-slate-400' : 'cursor-pointer border-slate-100 hover:bg-blue-50'}`}><input type="checkbox" disabled={Boolean(owner)} checked={!owner && selectedAreaCodes.includes(area.code)} onChange={() => setSelectedAreaCodes((current) => current.includes(area.code) ? current.filter((code) => code !== area.code) : [...current, area.code])} className="h-4 w-4 accent-blue-600"/><span className="min-w-0 flex-1">{area.name}</span>{owner && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">Assigned</span>}</label>; })}</div><div className="mt-3 overflow-hidden rounded-xl border border-slate-200"><GeographicAreaMap city={localities.find(item => item.code === localityCode)?.name || ''} district={district} areas={areas} selectedAreaCodes={mapSelectedAreaCodes}/></div><p className="mt-2 text-[11px] text-slate-500">Selected coverage boundaries are shown in red. Assigned areas are unavailable.</p></>}
            </div>}
            <button onClick={addCoverage} disabled={!localityCode} className="md:col-span-2 xl:col-span-4 min-h-11 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Add coverage to zone</button>
          </div>}
        </section>
        <section><div className="mb-3 flex items-center justify-between"><h3 className="font-bold text-slate-900">Assigned coverage</h3><span className="text-sm text-slate-500">{coverage.length} district{coverage.length === 1 ? '' : 's'}</span></div>{coverage.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No city or district assigned yet.</div> : <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200">{coverage.map((item, index) => {
          const mappedAreas = GEOGRAPHIC_AREAS[item.cityMunicipalityCode]?.[item.congressionalDistrict] || [];
          return <div key={`${item.cityMunicipalityCode}-${item.congressionalDistrict}`} className="p-4"><div className="flex items-start justify-between gap-4"><div><p className="font-semibold text-slate-900">{item.cityMunicipalityName} · {item.congressionalDistrict}</p><p className="text-xs text-slate-500">{item.provinceName ? `${item.provinceName} · ` : ''}{item.regionName}</p><p className="mt-1 text-xs font-medium text-blue-700">{item.areas?.length ? item.areas.map((area) => area.name).join(', ') : 'All areas'}</p></div><button onClick={() => setCoverage((items) => items.filter((_, i) => i !== index))} className="rounded-lg p-2 text-red-500 hover:bg-red-50"><X size={17}/></button></div>{mappedAreas.length > 0 && <div className="mt-3 overflow-hidden rounded-xl border border-slate-200"><GeographicAreaMap city={item.cityMunicipalityName} district={item.congressionalDistrict} areas={mappedAreas} selectedAreaCodes={item.areas?.map((area) => area.code) || []}/></div>}</div>;
        })}</div>}</section>
      </div><footer className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-100 bg-white px-6 py-4"><button onClick={() => setModal(false)} className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-700">Cancel</button><button onClick={save} disabled={saving} className="min-h-11 rounded-xl bg-[#DB0002] px-6 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : editing ? 'Save changes' : 'Create zone'}</button></footer></div></div>}
    <style jsx global>{`.form-input{width:100%;min-height:44px;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;font-size:14px;outline:none}.form-input:focus{border-color:#f87171;box-shadow:0 0 0 4px #fef2f2}`}</style>
  </div>;
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <label className={`block ${wide ? 'sm:col-span-2' : ''}`}><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span>{children}</label>; }
function Select({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; disabled?: boolean }) { return <label><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">{label}</span><select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="form-input bg-white disabled:bg-slate-100"><option value="">Select {label.toLowerCase()}</option>{options.filter((option, index, all) => all.findIndex((item) => item.value === option.value) === index).map((option) => <option key={`${label}-${option.value}`} value={option.value}>{option.label}</option>)}</select></label>; }
