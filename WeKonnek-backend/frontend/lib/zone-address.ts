import { NCR_COUNCIL_AREAS } from '@/lib/ncr-council-zones';

export type ZoneAreaOption = { code: string; name: string };
export type ZoneDistrictOption = { name: string; localCouncilDistrict?: string; areas: ZoneAreaOption[] };
export type ZoneCityOption = { code: string; name: string; regionCode?: string; regionName?: string; provinceCode?: string | null; provinceName?: string | null; districts: ZoneDistrictOption[] };

const canonicalRegionName = (value?: string | null) => {
  const normalized = normalizeZoneLabel(value);
  if (normalized === 'ncr' || normalized.includes('national capital region')) {
    return 'national capital region';
  }
  return normalized;
};

export const zoneRegions = (cities: ZoneCityOption[]) => {
  const regions = new Map<string, string>();
  cities.forEach(city => {
    if (!city.regionName) return;
    const identity = city.regionCode || canonicalRegionName(city.regionName);
    if (!identity || regions.has(identity)) return;
    regions.set(
      identity,
      canonicalRegionName(city.regionName) === 'national capital region'
        ? 'National Capital Region (NCR)'
        : city.regionName,
    );
  });
  return [...regions.values()];
};

export const citiesInZoneRegion = (cities: ZoneCityOption[], region?: string | null) =>
  region ? cities.filter(city => canonicalRegionName(city.regionName) === canonicalRegionName(region)) : [];

export const zoneProvinces = (cities: ZoneCityOption[], region?: string | null) =>
  Array.from(new Set(citiesInZoneRegion(cities, region).map(city => city.provinceName || 'NCR (no province)'))).sort();

export const citiesInZoneProvince = (cities: ZoneCityOption[], region?: string | null, province?: string | null) =>
  citiesInZoneRegion(cities, region).filter(city => (city.provinceName || 'NCR (no province)') === province);

export const normalizeZoneLabel = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(city of|municipality of)\s+/, '')
    .replace(/\s+(city|municipality)$/, '')
    .replace(/^(barangay|brgy\.?|bgy\.?)\s+/, '')
    .replace(/\b(first|1st)\b/g, '1')
    .replace(/\b(second|2nd)\b/g, '2')
    .replace(/\b(third|3rd)\b/g, '3')
    .replace(/\b(fourth|4th)\b/g, '4')
    .replace(/\b(fifth|5th)\b/g, '5')
    .replace(/\b(sixth|6th)\b/g, '6')
    .replace(/\bdistrict\s*([1-6])\b/g, '$1 district')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const findZoneCity = (cities: ZoneCityOption[], value?: string | null) =>
  cities.find(item => normalizeZoneLabel(item.name) === normalizeZoneLabel(value));

export const findZoneDistrict = (city: ZoneCityOption | undefined, value?: string | null) =>
  city?.districts.find(item => normalizeZoneLabel(item.name) === normalizeZoneLabel(value));

export const findZoneArea = (district: ZoneDistrictOption | undefined, value?: string | null) =>
  district?.areas.find(item => normalizeZoneLabel(item.name) === normalizeZoneLabel(value));

const dedupeZoneCities = (cities: ZoneCityOption[]) => cities.map(city => ({
  ...city,
  districts: city.districts.reduce<ZoneDistrictOption[]>((districts, source) => {
    let district = districts.find(item => normalizeZoneLabel(item.name) === normalizeZoneLabel(source.name));
    if (!district) {
      district = { ...source, areas: [] };
      districts.push(district);
    }
    source.areas.forEach(area => {
      if (!district!.areas.some(item => normalizeZoneLabel(item.name) === normalizeZoneLabel(area.name))) {
        district!.areas.push(area);
      }
    });
    return districts;
  }, []),
}));

export async function loadZoneCityAreas(city: ZoneCityOption, signal?: AbortSignal): Promise<ZoneAreaOption[]> {
  if (city.districts.some(district => district.areas.length)) return [];
  const response = await fetch(`/api/backend/management-zones/philippine-locations/${city.code}/barangays`, { signal, cache: 'force-cache' });
  if (!response.ok) return [];
  const body = await response.json();
  return (Array.isArray(body) ? body : []).map((area: { code: string; name: string }) => ({ code: area.code, name: area.name }));
}

export async function loadAdminZoneAddresses(signal?: AbortSignal): Promise<ZoneCityOption[]> {
  const fetchWithTimeout = async (url: string, cache: RequestCache, timeoutMs: number) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = window.setTimeout(abort, timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal, cache });
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };

  // The imported admin coverage is the source of truth for public signup forms.
  // Return it immediately instead of blocking on the external PSGC reference.
  const coverageResponse = await fetchWithTimeout(
    '/api/backend/merchant-applications/coverage-options',
    'no-store',
    8000,
  ).catch(() => null);
  const activeCoverage: ZoneCityOption[] = coverageResponse?.ok
    ? await coverageResponse.json().then(body => Array.isArray(body) ? body : [])
    : [];
  if (activeCoverage.length) return dedupeZoneCities(activeCoverage).sort((a, b) => a.name.localeCompare(b.name));

  // Keep the national reference as a bounded fallback for fresh installations
  // that do not have admin-imported coverage yet.
  const locationsResponse = await fetchWithTimeout(
    '/api/backend/management-zones/philippine-locations',
    'force-cache',
    8000,
  ).catch(() => null);
  if (!locationsResponse?.ok) {
    throw new Error('Location reference and configured coverage are unavailable');
  }
  const locations = await locationsResponse.json();
  const regions = new Map<string, { name: string }>(
    (Array.isArray(locations.regions) ? locations.regions : []).map((region: { code: string; name: string; regionName?: string }) => [
      region.code,
      { name: region.regionName ? `${region.regionName} — ${region.name}` : region.name },
    ]),
  );
  const provinces = new Map<string, string>(
    (Array.isArray(locations.provinces) ? locations.provinces : []).map((province: { code: string; name: string }) => [province.code, province.name]),
  );
  const master: ZoneCityOption[] = (Array.isArray(locations.localities) ? locations.localities : []).map((locality: {
    code: string; name: string; regionCode: string; provinceCode?: string | false;
  }) => {
    const mappedDistricts = NCR_COUNCIL_AREAS[locality.code];
    return {
      code: locality.code,
      name: locality.name,
      regionCode: locality.regionCode,
      regionName: regions.get(locality.regionCode)?.name || locality.regionCode,
      provinceCode: locality.provinceCode || null,
      provinceName: locality.provinceCode ? provinces.get(locality.provinceCode) || null : null,
      districts: mappedDistricts
        ? Object.entries(mappedDistricts).map(([name, areas]) => ({ name, localCouncilDistrict: name, areas }))
        : [{ name: 'Lone District', localCouncilDistrict: 'Lone District', areas: [] }],
    };
  });

  return dedupeZoneCities(master).sort((a, b) => a.name.localeCompare(b.name));
}
