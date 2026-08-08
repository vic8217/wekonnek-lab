import { getToken } from '@/hooks/use-auth';

export type PropertyType = { id: string; name: string; slug: string; groupName: string; displayOrder: number };
export type PropertyListing = {
  id: string; slug: string; title: string; description: string; transactionType: 'FOR_SALE'|'FOR_RENT'; price: string|number; pricePeriod: string;
  bedrooms?: number; bathrooms?: string|number; parkingSpaces?: number; floorArea?: string|number; lotArea?: string|number; furnishedStatus?: string;
  addressLine?: string; barangay?: string; city: string; province: string; latitude?: string|number; longitude?: string|number; distanceKm?: number|null;
  sellerType: string; agencyName?: string; isVerified: boolean; isFeatured: boolean; listingStatus: string; expiresAt?: string; viewCount: number;
  propertyType: PropertyType; images: { id: string; imageUrl: string; isPrimary: boolean }[];
  owner?: { id: string; firstName?: string; lastName?: string; avatar?: string; isVerified?: boolean; _count?: { propertyListings: number } };
  _count?: { savedBy: number; viewingRequests: number; reports?: number };
};
export type PropertyPage = { page: number; limit: number; total: number; pages: number };
export type SavedPropertyRow = { id: string; listing: PropertyListing; createdAt: string };

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = getToken();
  const response = await fetch(`/api/backend/property${path}`, { ...init, headers: { ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) }, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message[0] : body.message || 'Property request failed');
  return body;
};

export const propertyApi = {
  types: () => request<PropertyType[]>('/types'),
  browse: (params: URLSearchParams) => request<{ items: PropertyListing[]; pagination: PropertyPage }>(`/listings?${params}`),
  detail: (id: string) => request<PropertyListing>(`/listings/${id}`),
  create: (body: Record<string, unknown>) => request<PropertyListing>('/listings', { method: 'POST', body: JSON.stringify(body) }),
  publish: (id: string, durationDays = 30) => request<PropertyListing>(`/listings/${id}/publish`, { method: 'POST', body: JSON.stringify({ durationDays }) }),
  mine: () => request<PropertyListing[]>('/mine'),
  saved: () => request<SavedPropertyRow[]>('/saved'),
  save: (id: string) => request(`/listings/${id}/save`, { method: 'POST' }),
  unsave: (id: string) => request(`/listings/${id}/save`, { method: 'DELETE' }),
  requestViewing: (id: string, body: Record<string, FormDataEntryValue>) => request(`/listings/${id}/viewings`, { method: 'POST', body: JSON.stringify(body) }),
  report: (id: string, body: Record<string, string>) => request(`/listings/${id}/report`, { method: 'POST', body: JSON.stringify(body) }),
};
