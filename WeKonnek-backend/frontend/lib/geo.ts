/** Geolocation + distance helpers shared across the customer browse UI. */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance between two points, in kilometers. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance from `from` to a merchant's coordinates, or null if unknown. */
export function distanceToMerchant(
  from: LatLng | null,
  merchant: { latitude?: number | string | null; longitude?: number | string | null },
): number | null {
  if (!from) return null;
  const lat = Number(merchant.latitude);
  const lng = Number(merchant.longitude);
  if (!lat || !lng || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return haversineKm(from, { lat, lng });
}

/** Human-friendly distance string (e.g. "850 m", "1.2 km"); null if unknown. */
export function formatDistance(km: number | null): string | null {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/**
 * Placeholder ETA range. When we know the distance we derive a rough estimate
 * (~6 min/km on top of a 10 min base); otherwise we fall back to a generic
 * range. Replace with real prep/delivery times once the backend provides them.
 */
export function estimateEta(km: number | null): string {
  const base = km == null ? 20 : Math.max(10, Math.round(10 + km * 6));
  return `${base}-${base + 10} min`;
}
