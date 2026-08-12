'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth, getToken } from '@/hooks/use-auth';
import toast from 'react-hot-toast';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { citiesInZoneRegion, findZoneArea, findZoneCity, findZoneDistrict, loadAdminZoneAddresses, loadZoneCityAreas, zoneRegions, type ZoneCityOption } from '@/lib/zone-address';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
import dynamic from 'next/dynamic';
import { useMap, useMapEvents } from 'react-leaflet';

// Dynamically import MapContainer to avoid SSR issues
const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), {
  ssr: false,
});
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), {
  ssr: false,
});
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), {
  ssr: false,
});

// Component to handle map clicks
function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function MapViewUpdater({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => { map.setView(center, zoom); }, [center, map, zoom]);
  return null;
}

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icons
if (typeof window !== 'undefined') {
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  });
}

interface MerchantProfile {
  id?: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  description: string;
  website: string;
  logoUrl?: string;
  coverImageUrl?: string;
  latitude?: number;
  longitude?: number;
  city?: string;
  region?: string;
  councilDistrict?: string;
  geographicArea?: string;
  state?: string;
  zipCode?: string;
  tin?: string;
  isVatRegistered?: boolean;
  registeredBusinessName?: string;
  taxClassification: TaxClassification | '';
}

type TaxClassification =
  | 'vat_registered'
  | 'non_vat_percentage_tax'
  | 'vat_exempt'
  | 'zero_rated_vat'
  | 'government_entity'
  | 'boi_peza_registered';

const TAX_CLASSIFICATIONS: Record<
  TaxClassification,
  { label: string; invoiceType: string; taxComputation: string }
> = {
  vat_registered: {
    label: 'VAT Registered',
    invoiceType: 'VAT Invoice',
    taxComputation: '12% VAT',
  },
  non_vat_percentage_tax: {
    label: 'Non-VAT (Percentage Tax)',
    invoiceType: 'Non-VAT Invoice',
    taxComputation: 'Percentage Tax (if applicable)',
  },
  vat_exempt: {
    label: 'VAT-Exempt',
    invoiceType: 'VAT-Exempt Invoice',
    taxComputation: 'No VAT',
  },
  zero_rated_vat: {
    label: 'Zero-Rated VAT',
    invoiceType: 'Zero-Rated VAT Invoice',
    taxComputation: '0% VAT',
  },
  government_entity: {
    label: 'Government Entity',
    invoiceType: 'Special government rules',
    taxComputation: 'Depends on transaction',
  },
  boi_peza_registered: {
    label: 'BOI/PEZA Registered',
    invoiceType: 'Special incentives',
    taxComputation: 'Depends on registration/incentives',
  },
};

interface OperatingHours {
  monday: { open: string; close: string };
  tuesday: { open: string; close: string };
  wednesday: { open: string; close: string };
  thursday: { open: string; close: string };
  friday: { open: string; close: string };
  saturday: { open: string; close: string };
  sunday: { open: string; close: string };
}

export default function MerchantProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedReturnTo = searchParams.get('returnTo');
  const returnTo = requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//') ? requestedReturnTo : null;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [profileBranchId, setProfileBranchId] = useState<number | null>(null);
  const [storeDetailsConfirmed, setStoreDetailsConfirmed] = useState(false);
  const [coverageOptions, setCoverageOptions] = useState<ZoneCityOption[]>([]);
  const [selectedRegion, setSelectedRegion] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [selectedArea, setSelectedArea] = useState('');
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const [mapCenter, setMapCenter] = useState<[number, number]>([14.5995, 120.9842]); // Default to Manila
  const [mapZoom, setMapZoom] = useState(13);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    description: '',
    website: '',
    taxClassification: '' as TaxClassification | '',
    tin: '',
    registeredBusinessName: '',
  });

  const [operatingHours, setOperatingHours] = useState<OperatingHours>({
    monday: { open: '09:00', close: '18:00' },
    tuesday: { open: '09:00', close: '18:00' },
    wednesday: { open: '09:00', close: '18:00' },
    thursday: { open: '09:00', close: '18:00' },
    friday: { open: '09:00', close: '18:00' },
    saturday: { open: '09:00', close: '18:00' },
    sunday: { open: '09:00', close: '18:00' },
  });

  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    fetchMerchantProfile();
    loadAdminZoneAddresses()
      .then(setCoverageOptions)
      .catch(() => setCoverageOptions([]));
  }, []);

  useEffect(() => {
    if (!coverageOptions.length || !selectedCity) return;
    const city = findZoneCity(coverageOptions, selectedCity);
    if (!city) return;
    if (city.regionName && city.regionName !== selectedRegion) setSelectedRegion(city.regionName);
    if (city.name !== selectedCity) setSelectedCity(city.name);
    const district = findZoneDistrict(city, selectedDistrict);
    if (district && district.name !== selectedDistrict) setSelectedDistrict(district.name);
    const area = findZoneArea(district, selectedArea);
    if (area && area.name !== selectedArea) setSelectedArea(area.name);
  }, [coverageOptions, selectedArea, selectedCity, selectedDistrict, selectedRegion]);

  useEffect(() => {
    const city = findZoneCity(coverageOptions, selectedCity);
    if (!city || city.districts.some(district => district.areas.length)) return;
    const controller = new AbortController();
    loadZoneCityAreas(city, controller.signal).then(areas => {
      if (!areas.length) return;
      setCoverageOptions(current => current.map(item => item.code === city.code
        ? { ...item, districts: item.districts.map(district => ({ ...district, areas })) }
        : item));
    }).catch(() => undefined);
    return () => controller.abort();
  }, [coverageOptions, selectedCity]);

  useEffect(() => {
    if (!selectedCity) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setGeocodingAddress(true);
      try {
        const lookup = async (parts: string[]) => {
          const query = [...parts.filter(Boolean), selectedCity, 'Philippines'].join(', ');
          const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { signal: controller.signal });
          const body = response.ok ? await response.json() : null;
          const point = body?.status === 'ok' ? body.results?.[0]?.location : null;
          const lat = Number(point?.lat), lng = Number(point?.lng);
          return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
        };
        let point: { lat: number; lng: number } | null = null;
        let zoom = 12;
        if (selectedArea) {
          point = await lookup([selectedArea]);
          zoom = 16;
        } else if (selectedDistrict) {
          const district = findZoneDistrict(findZoneCity(coverageOptions, selectedCity), selectedDistrict);
          const anchors = district?.areas.length
            ? [district.areas[0], district.areas[Math.floor(district.areas.length / 2)], district.areas[district.areas.length - 1]]
            : [];
          const points = (await Promise.all(anchors.map(area => lookup([area.name])))).filter((item): item is { lat: number; lng: number } => Boolean(item));
          if (points.length) point = { lat: points.reduce((sum, item) => sum + item.lat, 0) / points.length, lng: points.reduce((sum, item) => sum + item.lng, 0) / points.length };
          if (!point) point = await lookup([selectedDistrict]);
          zoom = 13;
        }
        if (!point && formData.address.trim()) {
          point = await lookup([formData.address.trim()]);
          zoom = 16;
        }
        if (!point) point = await lookup([]);
        const lat = Number(point?.lat), lng = Number(point?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          setMapCenter([lat, lng]);
          setMapZoom(zoom);
          setStoreDetailsConfirmed(false);
        }
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) toast.error('Unable to locate that address');
      } finally {
        if (!controller.signal.aborted) setGeocodingAddress(false);
      }
    }, formData.address.trim() ? 600 : 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  // Keep this dependency signature stable for Next.js Fast Refresh. Zone options
  // are loaded before a user can select the dependent district/area fields.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.address, selectedArea, selectedCity, selectedDistrict]);

  const fetchMerchantProfile = async () => {
    setStoreDetailsConfirmed(false);
    try {
      const token = getToken();
      if (!token) return;

      const res = await fetch(`${API}/api/merchants/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const merchantData = await res.json();

      if (merchantData) {
        const merchantProfile: MerchantProfile = {
          id: merchantData.id,
          name: merchantData.name || '',
          email: merchantData.email || '',
          phone: merchantData.phone || '',
          address: merchantData.address || '',
          description: merchantData.description || '',
          website: merchantData.website || '',
          logoUrl: merchantData.logoUrl || merchantData.logo_url,
          coverImageUrl: merchantData.coverImageUrl || merchantData.cover_image_url,
          latitude: merchantData.latitude,
          longitude: merchantData.longitude,
          city: merchantData.city,
          region: merchantData.region,
          councilDistrict: merchantData.councilDistrict || merchantData.council_district,
          geographicArea: merchantData.geographicArea || merchantData.geographic_area,
          state: merchantData.state,
          zipCode: merchantData.zipCode || merchantData.zip_code,
          tin: merchantData.tin,
          isVatRegistered: merchantData.isVatRegistered || merchantData.is_vat_registered,
          registeredBusinessName: merchantData.registeredBusinessName || merchantData.registered_business_name,
          taxClassification:
            merchantData.taxClassification ||
            merchantData.tax_classification ||
            (merchantData.isVatRegistered || merchantData.is_vat_registered
              ? 'vat_registered'
              : ''),
        };
        setMerchant(merchantProfile);
        setFormData({
          name: merchantProfile.name,
          email: merchantProfile.email,
          phone: merchantProfile.phone,
          address: merchantProfile.address,
          description: merchantProfile.description,
          website: merchantProfile.website,
          taxClassification: merchantProfile.taxClassification,
          tin: merchantProfile.tin || '',
          registeredBusinessName: merchantProfile.registeredBusinessName || merchantProfile.name,
        });
        setSelectedCity(merchantProfile.city || '');
        setSelectedRegion(merchantProfile.region || '');
        setSelectedDistrict(merchantProfile.councilDistrict || '');
        setSelectedArea(merchantProfile.geographicArea || '');
        
        if (merchantProfile.coverImageUrl) setBannerPreview(merchantProfile.coverImageUrl);
        if (merchantProfile.logoUrl) setLogoPreview(merchantProfile.logoUrl);
        if (merchantProfile.latitude && merchantProfile.longitude) {
          setMapCenter([Number(merchantProfile.latitude), Number(merchantProfile.longitude)]);
        }
        const branchesResponse = await fetch(`${API}/api/merchants/${merchantData.id}/branches`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (branchesResponse.ok) {
          const branches = await branchesResponse.json();
          const branch = Array.isArray(branches) ? branches.find(item => item.isDefault || item.is_default) || branches[0] : null;
          if (branch) {
            setProfileBranchId(branch.id);
            const savedHours = branch.operatingHours || branch.operating_hours;
            if (savedHours && typeof savedHours === 'object') setOperatingHours(current => ({ ...current, ...savedHours }));
          }
        }
      }
    } catch (error) {
      console.error('Error fetching merchant profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (name === 'address') setStoreDetailsConfirmed(false);
  };

  const handleHoursChange = (day: keyof OperatingHours, field: 'open' | 'close', value: string) => {
    setStoreDetailsConfirmed(false);
    setOperatingHours(prev => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const handleFileUpload = async (file: File, type: 'banner' | 'logo') => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', type === 'banner' ? 'establishment' : 'establishment');

      const response = await fetch('/api/backend/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      const data = await response.json();
      
      if (type === 'banner') {
        setBannerPreview(data.url);
      } else {
        setLogoPreview(data.url);
      }

      return data.url;
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload file. Please try again.');
      return null;
    }
  };

  const handleMapClick = (lat: number, lng: number) => {
    setStoreDetailsConfirmed(false);
    setMapCenter([lat, lng]);
    setMapZoom(15);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const token = getToken();
      if (!token) {
        toast.error('Please log in to update profile');
        return;
      }

      const updateData: any = {
        name: formData.name,
        description: formData.description,
        phone: formData.phone,
        taxClassification: formData.taxClassification,
        tin: formData.tin,
        registeredBusinessName: formData.registeredBusinessName,
        ...(formData.email.trim() ? { email: formData.email.trim() } : {}),
        ...(formData.website.trim() ? { website: formData.website.trim() } : {}),
        coverImageUrl: bannerPreview || merchant?.coverImageUrl,
        logoUrl: logoPreview || merchant?.logoUrl,
      };

      if (merchant?.id) {
        const res = await fetch(`${API}/api/merchants/${merchant.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(updateData),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || 'Failed to update profile');
        }
      }

      toast.success('Profile updated successfully!');
      if (returnTo) {
        router.push(returnTo);
        return;
      }
      fetchMerchantProfile();
    } catch (error: any) {
      console.error('Error updating profile:', error);
      toast.error(error.message || 'Failed to update profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading profile...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Merchant Profile</h1>
        <p className="text-gray-600">Register your business to start selling</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Business Information Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Business Information</h2>
            <p className="text-sm text-gray-600">Update your business details</p>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Business Name
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="WeKonnek"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Contact Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="business@example.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                placeholder="+63 912 345 6789"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="website" className="block text-sm font-medium text-gray-700 mb-2">
                Website <span className="font-normal text-gray-500">(optional)</span>
              </label>
              <input
                type="url"
                id="website"
                name="website"
                value={formData.website}
                onChange={handleInputChange}
                placeholder="https://yourwebsite.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Business Description
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                rows={4}
                placeholder="We provide quality products and excellent service to our customers."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none resize-none"
              />
            </div>
          </div>
        </div>

        {/* BIR / Tax Information Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">BIR / Tax Information</h2>
            <p className="text-sm text-gray-600">Required for e-invoice generation (BIR compliance)</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                TIN (Tax Identification Number)
              </label>
              <input
                type="text"
                name="tin"
                value={formData.tin}
                onChange={handleInputChange}
                placeholder="Enter TIN"
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-700 outline-none focus:border-[#DB0002] focus:ring-2 focus:ring-red-100"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Registered Business Name
              </label>
              <input
                type="text"
                name="registeredBusinessName"
                value={formData.registeredBusinessName}
                onChange={handleInputChange}
                placeholder={formData.name || 'Registered business name'}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-700 outline-none focus:border-[#DB0002] focus:ring-2 focus:ring-red-100"
              />
            </div>
            <div>
              <label htmlFor="taxClassification" className="block text-sm font-medium text-gray-700 mb-2">
                Business Tax Classification
              </label>
              <select
                id="taxClassification"
                name="taxClassification"
                value={formData.taxClassification}
                onChange={handleInputChange}
                required
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-700 outline-none focus:border-[#DB0002] focus:ring-2 focus:ring-red-100"
              >
                <option value="" disabled>Select a business tax classification</option>
                {(Object.entries(TAX_CLASSIFICATIONS) as Array<
                  [TaxClassification, (typeof TAX_CLASSIFICATIONS)[TaxClassification]]
                >).map(([value, option]) => (
                  <option key={value} value={value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Invoice Type</p>
              <p className="mt-1 text-sm font-semibold text-gray-800">
                {formData.taxClassification
                  ? TAX_CLASSIFICATIONS[formData.taxClassification].invoiceType
                  : 'Select a classification'}
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Tax Computation</p>
              <p className="mt-1 text-sm font-semibold text-gray-800">
                {formData.taxClassification
                  ? TAX_CLASSIFICATIONS[formData.taxClassification].taxComputation
                  : 'Select a classification'}
              </p>
            </div>
            <div className="flex items-end">
              <a
                href="/merchant/invoices"
                className="inline-flex items-center gap-2 px-4 py-3 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors text-sm font-semibold"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                </svg>
                View All E-Invoices
              </a>
            </div>
          </div>
        </div>

        {/* Store Branding Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Store Branding</h2>
            <p className="text-sm text-gray-600">Upload your store banner and logo</p>
          </div>

          <div className="space-y-6">
            {/* Store Banner */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Store Banner
              </label>
              <div
                onClick={() => bannerInputRef.current?.click()}
                className="relative border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-[#DB0002] transition-colors bg-gray-50"
              >
                <input
                  ref={bannerInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        setBannerPreview(reader.result as string);
                      };
                      reader.readAsDataURL(file);
                      handleFileUpload(file, 'banner');
                    }
                  }}
                />
                {bannerPreview ? (
                  <div className="relative">
                    <img
                      src={bannerPreview}
                      alt="Banner preview"
                      className="w-full h-48 object-cover rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBannerPreview(null);
                        if (bannerInputRef.current) bannerInputRef.current.value = '';
                      }}
                      className="absolute top-2 right-2 bg-red-600 text-white p-2 rounded-full hover:bg-red-700"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div>
                    <svg className="mx-auto h-12 w-12 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <p className="text-sm text-[#DB0002] font-medium">
                      Click here to upload or drop Banner (Recommended: 1200x400px) files here
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Store Logo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Store Logo
              </label>
              <div
                onClick={() => logoInputRef.current?.click()}
                className="relative border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-[#DB0002] transition-colors bg-gray-50 max-w-md"
              >
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        setLogoPreview(reader.result as string);
                      };
                      reader.readAsDataURL(file);
                      handleFileUpload(file, 'logo');
                    }
                  }}
                />
                {logoPreview ? (
                  <div className="relative">
                    <img
                      src={logoPreview}
                      alt="Logo preview"
                      className="w-32 h-32 object-cover rounded-lg mx-auto"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLogoPreview(null);
                        if (logoInputRef.current) logoInputRef.current.value = '';
                      }}
                      className="absolute top-2 right-2 bg-red-600 text-white p-2 rounded-full hover:bg-red-700"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div>
                    <svg className="mx-auto h-12 w-12 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <p className="text-sm text-[#DB0002] font-medium">
                      Click here to upload or drop Logo (Recommended: 400x400px) files here
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-5">
          <h2 className="font-bold text-blue-900">Shop hours and locations are managed per shop</h2>
          <p className="mt-1 text-sm text-blue-800">Use Shops to configure each location, operating schedule, and manual Open/Close override.</p>
          <Link href="/merchant/branches" className="mt-3 inline-flex rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white">Manage Shops</Link>
        </div>

        {/* Legacy merchant-level store fields are intentionally hidden. */}
        {false && (
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Store Hours & Location</h2>
            <p className="text-sm text-gray-600">Set your operating hours and location</p>
          </div>

          <div className="space-y-6">
            {/* Store Address */}
            <div className="space-y-3">
              <label htmlFor="address" className="block text-sm font-medium text-gray-700">
                Street / Store Address
              </label>
              <input
                type="text"
                id="address"
                name="address"
                required
                value={formData.address}
                onChange={handleInputChange}
                placeholder="123 Main Street, Manila, Philippines"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
              <select required value={selectedRegion} onChange={event => { setSelectedRegion(event.target.value); setSelectedCity(''); setSelectedDistrict(''); setSelectedArea(''); setStoreDetailsConfirmed(false); }} className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 outline-none focus:border-[#DB0002] focus:ring-2 focus:ring-red-100">
                <option value="">Region</option>
                {zoneRegions(coverageOptions).map(region => <option key={region} value={region}>{region}</option>)}
              </select>
              <div className="grid gap-3 sm:grid-cols-2">
                <select required value={selectedCity} onChange={event => { setSelectedCity(event.target.value); setSelectedDistrict(''); setSelectedArea(''); setStoreDetailsConfirmed(false); }} className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 outline-none focus:border-[#DB0002] focus:ring-2 focus:ring-red-100">
                  <option value="">City / Municipality</option>
                  {citiesInZoneRegion(coverageOptions, selectedRegion).map(city => <option key={city.code || city.name} value={city.name}>{city.name}</option>)}
                </select>
                <select required value={selectedDistrict} onChange={event => { setSelectedDistrict(event.target.value); setSelectedArea(''); setStoreDetailsConfirmed(false); }} disabled={!selectedCity} className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 outline-none focus:border-[#DB0002] focus:ring-2 focus:ring-red-100 disabled:bg-gray-100">
                  <option value="">City Council District</option>
                  {findZoneCity(coverageOptions, selectedCity)?.districts.map(district => <option key={district.name} value={district.name}>{district.name}</option>)}
                </select>
              </div>
              <select required={Boolean(findZoneDistrict(findZoneCity(coverageOptions, selectedCity), selectedDistrict)?.areas.length)} value={selectedArea} onChange={event => { setSelectedArea(event.target.value); setStoreDetailsConfirmed(false); }} disabled={!selectedDistrict} className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 outline-none focus:border-[#DB0002] focus:ring-2 focus:ring-red-100 disabled:bg-gray-100">
                <option value="">Barangay / Area</option>
                {findZoneDistrict(findZoneCity(coverageOptions, selectedCity), selectedDistrict)?.areas.map(area => <option key={area.code || area.name} value={area.name}>{area.name}</option>)}
              </select>
              {geocodingAddress && <p className="text-xs font-medium text-blue-600">Finding this address and updating the map…</p>}
            </div>

            {/* Operating Hours */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-4">
                Operating Hours
              </label>
              <div className="space-y-3">
                {/* Monday-Friday */}
                <div className="flex items-center gap-4">
                  <span className="w-24 text-sm text-gray-700 font-medium">Monday-Friday</span>
                  <div className="flex items-center gap-2 flex-1">
                    <div className="relative flex-1">
                      <input
                        type="time"
                        value={operatingHours.monday.open}
                        onChange={(e) => handleHoursChange('monday', 'open', e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                      />
                      <svg className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <span className="text-gray-500">-</span>
                    <div className="relative flex-1">
                      <input
                        type="time"
                        value={operatingHours.monday.close}
                        onChange={(e) => handleHoursChange('monday', 'close', e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                      />
                      <svg className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Saturday */}
                <div className="flex items-center gap-4">
                  <span className="w-24 text-sm text-gray-700 font-medium">Saturday</span>
                  <div className="flex items-center gap-2 flex-1">
                    <div className="relative flex-1">
                      <input
                        type="time"
                        value={operatingHours.saturday.open}
                        onChange={(e) => handleHoursChange('saturday', 'open', e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                      />
                      <svg className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <span className="text-gray-500">-</span>
                    <div className="relative flex-1">
                      <input
                        type="time"
                        value={operatingHours.saturday.close}
                        onChange={(e) => handleHoursChange('saturday', 'close', e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                      />
                      <svg className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Sunday */}
                <div className="flex items-center gap-4">
                  <span className="w-24 text-sm text-gray-700 font-medium">Sunday</span>
                  <div className="flex items-center gap-2 flex-1">
                    <div className="relative flex-1">
                      <input
                        type="time"
                        value={operatingHours.sunday.open}
                        onChange={(e) => handleHoursChange('sunday', 'open', e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                      />
                      <svg className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <span className="text-gray-500">-</span>
                    <div className="relative flex-1">
                      <input
                        type="time"
                        value={operatingHours.sunday.close}
                        onChange={(e) => handleHoursChange('sunday', 'close', e.target.value)}
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                      />
                      <svg className="absolute right-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Google Maps Integration */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Location on Map
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 bg-gray-50">
                <div className="h-64 rounded-lg overflow-hidden relative">
                  <MapContainer
                    center={mapCenter}
                    zoom={mapZoom}
                    style={{ height: '100%', width: '100%' }}
                    scrollWheelZoom={true}
                  >
                    <MapViewUpdater center={mapCenter} zoom={mapZoom} />
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
                      url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                    />
                    <MapClickHandler onMapClick={handleMapClick} />
                    <Marker position={mapCenter} />
                  </MapContainer>
                </div>
                <div className="mt-4 flex items-center justify-center gap-2 text-[#DB0002]">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <p className="text-sm font-medium">Click on the map to set your location</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  // Get current location
                  if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                      (position) => {
                        setStoreDetailsConfirmed(false);
                        setMapCenter([position.coords.latitude, position.coords.longitude]);
                        setMapZoom(15);
                      },
                      () => {
                        toast.error('Unable to get your location');
                      }
                    );
                  }
                }}
                className="mt-3 px-4 py-2 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors font-medium text-sm"
              >
                Update Location
              </button>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <input
                type="checkbox"
                checked={storeDetailsConfirmed}
                onChange={event => setStoreDetailsConfirmed(event.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[#DB0002]"
              />
              <span>
                <span className="block text-sm font-semibold text-gray-900">I confirm these operating hours and map location are correct.</span>
                <span className="mt-1 block text-xs text-gray-600">This information will be shown to customers and used for store availability and location services.</span>
              </span>
            </label>
          </div>
        </div>
        )}

        {/* Footer Buttons */}
        <div className="flex justify-end gap-4 pt-4">
          <button
            type="button"
            onClick={() => fetchMerchantProfile()}
            className="px-6 py-3 border-2 border-[#DB0002] text-[#DB0002] rounded-lg hover:bg-red-50 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
