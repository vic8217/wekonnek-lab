import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ============================================================
// Types
// ============================================================
export interface DeliveryZone {
  id: number;
  name: string;
  code: string;
  city: string;
  region: string;
  description: string | null;
  base_delivery_fee: number;
  cross_zone_fee: number;
  cross_city_fee: number;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  areas?: DeliveryZoneArea[];
}

export interface DeliveryZoneArea {
  id: number;
  zone_id: number;
  area_name: string;
  area_type: 'barangay' | 'district' | 'neighborhood' | 'subdivision' | 'zone';
  zip_code: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_km: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeliveryFeeResult {
  fee: number;
  type: 'same_zone' | 'cross_zone' | 'cross_city' | 'unknown';
  merchantZone: DeliveryZone | null;
  customerZone: DeliveryZone | null;
  label: string;
}

// ============================================================
// Helpers
// ============================================================

async function apiFetch(path: string, options?: RequestInit) {
  const token = getToken();
  const headers: Record<string, string> = { ...((options?.headers as Record<string, string>) || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (options?.body && typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  return fetch(`${API}${path}`, { ...options, headers });
}

function normalize(data: any): any[] {
  return Array.isArray(data) ? data : data?.data || [];
}

// ============================================================
// Fetch Functions
// ============================================================

export async function getDeliveryZones(includeAreas = false): Promise<DeliveryZone[]> {
  const res = await apiFetch(`/api/delivery-zones?active=true${includeAreas ? '&include=areas' : ''}`);
  if (!res.ok) return [];
  return normalize(await res.json());
}

export async function getAllDeliveryZones(): Promise<DeliveryZone[]> {
  const res = await apiFetch('/api/delivery-zones?include=areas');
  if (!res.ok) return [];
  return normalize(await res.json());
}

export async function getDeliveryZone(id: number): Promise<DeliveryZone | null> {
  const res = await apiFetch(`/api/delivery-zones/${id}?include=areas`);
  if (!res.ok) return null;
  return res.json();
}

export async function getZonesByCity(city: string): Promise<DeliveryZone[]> {
  const res = await apiFetch(`/api/delivery-zones?city=${encodeURIComponent(city)}&active=true&include=areas`);
  if (!res.ok) return [];
  return normalize(await res.json());
}

export async function findZoneByBarangay(barangayName: string): Promise<DeliveryZone | null> {
  const res = await apiFetch(`/api/delivery-zones/find-by-barangay?name=${encodeURIComponent(barangayName)}`);
  if (!res.ok) return null;
  return res.json();
}

export async function getZoneCities(): Promise<string[]> {
  const res = await apiFetch('/api/delivery-zones/cities');
  if (!res.ok) return [];
  return res.json();
}

export async function getAllBarangays(): Promise<{ area_name: string; zone_name: string; city: string }[]> {
  const res = await apiFetch('/api/delivery-zones/barangays');
  if (!res.ok) return [];
  return res.json();
}

// ============================================================
// Delivery Fee Calculation
// ============================================================

export async function calculateDeliveryFee(
  merchantZoneId: number | null,
  customerBarangay: string,
): Promise<DeliveryFeeResult> {
  const defaultResult: DeliveryFeeResult = {
    fee: 49.0,
    type: 'unknown',
    merchantZone: null,
    customerZone: null,
    label: 'Standard delivery',
  };

  if (!merchantZoneId) return defaultResult;

  try {
    const res = await apiFetch(
      `/api/delivery-zones/calculate-fee?merchantZoneId=${merchantZoneId}&barangay=${encodeURIComponent(customerBarangay)}`,
    );
    if (res.ok) {
      const data = await res.json();
      return { ...defaultResult, ...data };
    }

    const merchantZone = await getDeliveryZone(merchantZoneId);
    if (!merchantZone) return defaultResult;

    const customerZone = await findZoneByBarangay(customerBarangay);
    if (!customerZone) {
      return { fee: merchantZone.cross_city_fee, type: 'unknown', merchantZone, customerZone: null, label: 'Extended delivery area' };
    }
    if (merchantZone.id === customerZone.id) {
      return { fee: merchantZone.base_delivery_fee, type: 'same_zone', merchantZone, customerZone, label: `Same zone (${merchantZone.name})` };
    }
    if (merchantZone.city === customerZone.city) {
      return { fee: merchantZone.cross_zone_fee, type: 'cross_zone', merchantZone, customerZone, label: `Cross-zone (${merchantZone.city})` };
    }
    return { fee: merchantZone.cross_city_fee, type: 'cross_city', merchantZone, customerZone, label: 'Cross-city delivery' };
  } catch (error) {
    console.error('Error calculating delivery fee:', error);
    return defaultResult;
  }
}

// ============================================================
// Admin CRUD
// ============================================================

export async function createDeliveryZone(zone: Partial<DeliveryZone>): Promise<DeliveryZone | null> {
  const res = await apiFetch('/api/delivery-zones', {
    method: 'POST',
    body: JSON.stringify(zone),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || 'Failed to create zone'); }
  return res.json();
}

export async function updateDeliveryZone(id: number, updates: Partial<DeliveryZone>): Promise<DeliveryZone | null> {
  const res = await apiFetch(`/api/delivery-zones/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || 'Failed to update zone'); }
  return res.json();
}

export async function deleteDeliveryZone(id: number): Promise<boolean> {
  const res = await apiFetch(`/api/delivery-zones/${id}`, { method: 'DELETE' });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || 'Failed to delete zone'); }
  return true;
}

export async function addZoneArea(area: Partial<DeliveryZoneArea>): Promise<DeliveryZoneArea | null> {
  const res = await apiFetch('/api/delivery-zone-areas', {
    method: 'POST',
    body: JSON.stringify(area),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || 'Failed to add zone area'); }
  return res.json();
}

export async function removeZoneArea(id: number): Promise<boolean> {
  const res = await apiFetch(`/api/delivery-zone-areas/${id}`, { method: 'DELETE' });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || 'Failed to remove zone area'); }
  return true;
}
