import { NCR_COUNCIL_AREAS } from '@/lib/ncr-council-zones';

export type ZoneAreaOption = { code: string; name: string };
export type ZoneDistrictOption = { name: string; localCouncilDistrict?: string; areas: ZoneAreaOption[] };
export type ZoneCityOption = { code: string; name: string; regionName?: string; provinceName?: string | null; districts: ZoneDistrictOption[] };

export const zoneRegions = (cities: ZoneCityOption[]) =>
  Array.from(new Set(cities.map(city => city.regionName).filter((name): name is string => Boolean(name))));

export const citiesInZoneRegion = (cities: ZoneCityOption[], region?: string | null) =>
  region ? cities.filter(city => normalizeZoneLabel(city.regionName) === normalizeZoneLabel(region)) : [];

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

export async function loadZoneCityAreas(city: ZoneCityOption, signal?: AbortSignal): Promise<ZoneAreaOption[]> {
  if (city.districts.some(district => district.areas.length)) return [];
  const response = await fetch(`/api/backend/management-zones/philippine-locations/${city.code}/barangays`, { signal, cache: 'force-cache' });
  if (!response.ok) return [];
  const body = await response.json();
  return (Array.isArray(body) ? body : []).map((area: { code: string; name: string }) => ({ code: area.code, name: area.name }));
}

export async function loadAdminZoneAddresses(signal?: AbortSignal): Promise<ZoneCityOption[]> {
  const [locationsResponse, coverageResponse] = await Promise.all([
    fetch('/api/backend/management-zones/philippine-locations', { signal, cache: 'force-cache' }),
    fetch('/api/backend/merchant-applications/coverage-options', { signal, cache: 'no-store' }),
  ]);
  if (!locationsResponse.ok) throw new Error('Philippine address reference is unavailable');
  const locations = await locationsResponse.json();
  const activeCoverage: ZoneCityOption[] = coverageResponse.ok ? await coverageResponse.json() : [];
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
      regionName: regions.get(locality.regionCode)?.name || locality.regionCode,
      provinceName: locality.provinceCode ? provinces.get(locality.provinceCode) || null : null,
      districts: mappedDistricts
        ? Object.entries(mappedDistricts).map(([name, areas]) => ({ name, localCouncilDistrict: name, areas }))
        : [{ name: 'Lone District', localCouncilDistrict: 'Lone District', areas: [] }],
    };
  });

  // Admin coverage supplements the master reference but never hides locations.
  activeCoverage.forEach(coveredCity => {
    const city = master.find(item => item.code === coveredCity.code) || findZoneCity(master, coveredCity.name);
    if (!city) {
      master.push(coveredCity);
      return;
    }
    coveredCity.districts.forEach(coveredDistrict => {
      const district = findZoneDistrict(city, coveredDistrict.name);
      if (!district) city.districts.push(coveredDistrict);
      else if (!district.areas.length && coveredDistrict.areas.length) district.areas = coveredDistrict.areas;
    });
  });
  return master.sort((a, b) => a.name.localeCompare(b.name));
}
