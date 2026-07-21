'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import type L from 'leaflet';
import { categoriesApi, subCategoriesApi, uploadApi } from '@/lib/api';
import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Dynamically import the map component with SSR disabled
const LocationMap = dynamic(() => import('@/components/LocationMap'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-gray-100">
      <p className="text-gray-600">Loading map...</p>
    </div>
  ),
});

export default function MerchantRegistrationPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<[number, number] | null>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [subCategories, setSubCategories] = useState<any[]>([]);
  
  const [filePreviews, setFilePreviews] = useState<{
    establishmentPhoto: string | null;
    authorizedPersonPhoto: string | null;
    businessDocuments: string[];
  }>({
    establishmentPhoto: null,
    authorizedPersonPhoto: null,
    businessDocuments: [],
  });

  const [formData, setFormData] = useState({
    // Business Information
    registeredBusinessName: '',
    businessAddress: '',
    secRegistrationNumber: '',
    dtiRegistrationNumber: '',
    categoryId: '',
    subCategoryId: '',
    businessType: 'storefront' as 'storefront' | 'mobile_cart' | 'home_based',
    
    // Contact Information
    telephoneNumber: '',
    phoneNumber: '',
    viberNumber: '',
    whatsappNumber: '',
    alternativeContactNumber1: '',
    alternativeContactNumber2: '',
    emailAddress: '',
    authorizedOfficer: '',
    
    // Subscription & Payment
    subscriptionTier: 'basic' as 'basic' | 'gold' | 'platinum',
    subscriptionPlan: 'weekly' as 'weekly' | 'monthly' | 'annual',
    paymentMethod: 'GCash' as 'GCash' | 'Maya' | 'Bank Transfer',
    
    // Location
    longitude: '',
    latitude: '',
    
    // Files
    establishmentPhoto: null as File | null,
    authorizedPersonPhoto: null as File | null,
    businessDocuments: [] as File[],
    businessPermit: null as File | null,
    dtiPermit: null as File | null,
    validId: null as File | null,
    paymentProof: null as File | null,
  });

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    if (formData.categoryId) {
      fetchSubCategories(parseInt(formData.categoryId));
    } else {
      setSubCategories([]);
      setFormData(prev => ({ ...prev, subCategoryId: '' }));
    }
  }, [formData.categoryId]);

  const fetchCategories = async () => {
    try {
      const response = await categoriesApi.getAll(false);
      setCategories(response || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchSubCategories = async (categoryId: number) => {
    try {
      const allCategories = await categoriesApi.getAll(true);
      const foundCategory = allCategories.find(c => c.id === categoryId);
      if (foundCategory?.subCategories) {
        setSubCategories(foundCategory.subCategories);
        return;
      }
    } catch (error) {
      console.error('Error fetching sub-categories:', error);
    }
    
    try {
      const subs = await subCategoriesApi.getByCategory(categoryId);
      setSubCategories(subs || []);
    } catch (error) {
      console.error('Error fetching sub-categories:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, field: string) => {
    const files = e.target.files;
    if (!files) return;

    if (field === 'businessDocuments') {
      const fileArray = Array.from(files);
      const validFiles = fileArray.filter(file => {
        if (file.size > 10 * 1024 * 1024) {
          alert(`${file.name} is larger than 10MB`);
          return false;
        }
        return true;
      });

      setFormData(prev => ({
        ...prev,
        businessDocuments: [...prev.businessDocuments, ...validFiles],
      }));

      validFiles.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result as string;
          setFilePreviews(prev => ({
            ...prev,
            businessDocuments: [...prev.businessDocuments, result],
          }));
        };
        reader.readAsDataURL(file);
      });
    } else {
      const file = files[0];
      if (file) {
        if (file.size > 10 * 1024 * 1024) {
          alert('File size must be less than 10MB');
          return;
        }

        setFormData(prev => ({ ...prev, [field]: file }));

        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result as string;
          setFilePreviews(prev => ({
            ...prev,
            [field]: result,
          }));
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const removeFile = (field: string, index?: number) => {
    if (field === 'businessDocuments' && index !== undefined) {
      setFormData(prev => ({
        ...prev,
        businessDocuments: prev.businessDocuments.filter((_, i) => i !== index),
      }));
      setFilePreviews(prev => ({
        ...prev,
        businessDocuments: prev.businessDocuments.filter((_, i) => i !== index),
      }));
    } else {
      setFormData(prev => ({ ...prev, [field]: null }));
      setFilePreviews(prev => ({ ...prev, [field]: null }));
    }
  };

  const handleMapClick = useCallback((lat: number, lng: number) => {
    setSelectedLocation([lat, lng]);
    setFormData(prev => ({
      ...prev,
      latitude: lat.toString(),
      longitude: lng.toString(),
    }));
  }, []);

  const handleMarkerDrag = useCallback((e: L.DragEndEvent) => {
    const marker = e.target;
    const position = marker.getLatLng();
    setSelectedLocation([position.lat, position.lng]);
    setFormData(prev => ({
      ...prev,
      latitude: position.lat.toString(),
      longitude: position.lng.toString(),
    }));
  }, []);

  const handleSetLocation = () => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setSelectedLocation([latitude, longitude]);
        setFormData(prev => ({
          ...prev,
          latitude: latitude.toString(),
          longitude: longitude.toString(),
        }));
      },
      (error) => {
        console.error('Error getting location:', error);
        alert('Unable to get your location. Please click on the map to set your business location.');
      }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const token = getToken();
    if (!token) {
      alert('Please log in to submit your merchant application');
      return;
    }

    setLoading(true);
    setUploadingFiles(true);

    try {
      // Upload files first
      let establishmentPhotoUrl: string | undefined;
      let authorizedPersonPhotoUrl: string | undefined;
      let businessPermitUrl: string | undefined;
      let dtiPermitUrl: string | undefined;
      let validIdUrl: string | undefined;
      let paymentProofUrl: string | undefined;
      let documentUrls: string[] = [];

      try {
        if (formData.establishmentPhoto) {
          establishmentPhotoUrl = await uploadApi.uploadFile(formData.establishmentPhoto, 'establishment');
        }
        if (formData.authorizedPersonPhoto) {
          authorizedPersonPhotoUrl = await uploadApi.uploadFile(formData.authorizedPersonPhoto, 'authorized-person');
        }
        if (formData.businessPermit) {
          businessPermitUrl = await uploadApi.uploadFile(formData.businessPermit, 'document');
        }
        if (formData.dtiPermit) {
          dtiPermitUrl = await uploadApi.uploadFile(formData.dtiPermit, 'document');
        }
        if (formData.validId) {
          validIdUrl = await uploadApi.uploadFile(formData.validId, 'document');
        }
        if (formData.paymentProof) {
          paymentProofUrl = await uploadApi.uploadFile(formData.paymentProof, 'document');
        }
        if (formData.businessDocuments.length > 0) {
          documentUrls = await uploadApi.uploadMultipleFiles(formData.businessDocuments, 'document');
        }
      } catch (uploadError) {
        console.error('File upload error:', uploadError);
        alert('Failed to upload files. Please try again.');
        setUploadingFiles(false);
        setLoading(false);
        return;
      }

      setUploadingFiles(false);

      // Calculate subscription amount
      const subscriptionAmounts: Record<string, Record<string, number>> = {
        basic: { weekly: 300, monthly: 1000, annual: 10000 },
        gold: { weekly: 500, monthly: 2000, annual: 20000 },
        platinum: { weekly: 1000, monthly: 4000, annual: 40000 },
      };

      const subscriptionAmount = subscriptionAmounts[formData.subscriptionTier]?.[formData.subscriptionPlan] || 0;

      const applicationRes = await fetch(`${API}/api/merchant-applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          business_name: formData.registeredBusinessName,
          email: formData.emailAddress,
          phone: formData.phoneNumber || formData.telephoneNumber,
          address: formData.businessAddress,
          subscription_tier: formData.subscriptionTier,
          subscription_plan: formData.subscriptionPlan,
          subscription_amount: subscriptionAmount,
          payment_method: formData.paymentMethod,
          payment_proof_url: paymentProofUrl,
          business_permit_url: businessPermitUrl,
          dti_permit_url: dtiPermitUrl,
          valid_id_url: validIdUrl,
          establishment_photo_url: establishmentPhotoUrl,
          authorized_person_photo_url: authorizedPersonPhotoUrl,
          business_documents_urls: documentUrls,
        }),
      });

      if (!applicationRes.ok) {
        const err = await applicationRes.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to submit application');
      }

      alert('Merchant application submitted successfully! We will review your application and get back to you soon.');
      router.push('/merchant/dashboard');
    } catch (error: any) {
      console.error('Registration error:', error);
      alert(error.message || 'Failed to submit registration. Please try again.');
      setUploadingFiles(false);
    } finally {
      setLoading(false);
    }
  };

  const defaultCenter: [number, number] = [14.5995, 120.9842]; // Manila, Philippines

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Merchant Registration</h1>
        <p className="text-gray-600">Register your business to start selling</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Business Information Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Business Information</h2>
            <p className="text-sm text-gray-600">Enter your business and owner details</p>
          </div>

          {/* File Upload Areas */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Establishment Photo */}
            <div className="border-2 border-dashed border-[#DB0002] rounded-lg p-6 text-center relative">
              <input
                type="file"
                id="establishmentPhoto"
                accept="image/jpeg,image/png"
                onChange={(e) => handleFileChange(e, 'establishmentPhoto')}
                className="hidden"
              />
              {filePreviews.establishmentPhoto ? (
                <div className="relative">
                  <img
                    src={filePreviews.establishmentPhoto}
                    alt="Establishment preview"
                    className="w-full h-48 object-cover rounded-lg mb-2"
                  />
                  <button
                    type="button"
                    onClick={() => removeFile('establishmentPhoto')}
                    className="absolute top-2 right-2 bg-[#DB0002] text-white rounded-full p-2 hover:bg-[#B80002]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="establishmentPhoto"
                  className="cursor-pointer flex flex-col items-center"
                >
                  <svg className="w-12 h-12 text-[#DB0002] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <p className="text-sm text-gray-600 mt-2">
                    <span className="text-[#DB0002] font-medium">Click here</span> to upload or drop{' '}
                    <span className="text-[#DB0002] font-medium">Photo of Establishment</span> (JPG, PNG up to 10MB) files here
                  </p>
                </label>
              )}
            </div>

            {/* Authorized Person Photo */}
            <div className="border-2 border-dashed border-[#DB0002] rounded-lg p-6 text-center relative">
              <input
                type="file"
                id="authorizedPersonPhoto"
                accept="image/jpeg,image/png"
                onChange={(e) => handleFileChange(e, 'authorizedPersonPhoto')}
                className="hidden"
              />
              {filePreviews.authorizedPersonPhoto ? (
                <div className="relative">
                  <img
                    src={filePreviews.authorizedPersonPhoto}
                    alt="Authorized person preview"
                    className="w-full h-48 object-cover rounded-lg mb-2"
                  />
                  <button
                    type="button"
                    onClick={() => removeFile('authorizedPersonPhoto')}
                    className="absolute top-2 right-2 bg-[#DB0002] text-white rounded-full p-2 hover:bg-[#B80002]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="authorizedPersonPhoto"
                  className="cursor-pointer flex flex-col items-center"
                >
                  <svg className="w-12 h-12 text-[#DB0002] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <p className="text-sm text-gray-600 mt-2">
                    <span className="text-[#DB0002] font-medium">Click here</span> to upload or drop{' '}
                    <span className="text-[#DB0002] font-medium">Photo of Authorized Person</span> (JPG, PNG up to 10MB) files here
                  </p>
                </label>
              )}
            </div>
          </div>

          {/* Form Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="registeredBusinessName" className="block text-sm font-medium text-gray-700 mb-2">
                Registered Business Name <span className="text-[#DB0002]">*</span>
              </label>
              <input
                type="text"
                id="registeredBusinessName"
                name="registeredBusinessName"
                value={formData.registeredBusinessName}
                onChange={handleInputChange}
                required
                placeholder="Enter business name"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="businessAddress" className="block text-sm font-medium text-gray-700 mb-2">
                Business Address <span className="text-[#DB0002]">*</span>
              </label>
              <input
                type="text"
                id="businessAddress"
                name="businessAddress"
                value={formData.businessAddress}
                onChange={handleInputChange}
                required
                placeholder="Enter address"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="secRegistrationNumber" className="block text-sm font-medium text-gray-700 mb-2">
                SEC Registration Number
              </label>
              <input
                type="text"
                id="secRegistrationNumber"
                name="secRegistrationNumber"
                value={formData.secRegistrationNumber}
                onChange={handleInputChange}
                placeholder="SEC - XXXXXXXX"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="dtiRegistrationNumber" className="block text-sm font-medium text-gray-700 mb-2">
                DTI Registration Number
              </label>
              <input
                type="text"
                id="dtiRegistrationNumber"
                name="dtiRegistrationNumber"
                value={formData.dtiRegistrationNumber}
                onChange={handleInputChange}
                placeholder="DTI - XXXXXXXX"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="categoryId" className="block text-sm font-medium text-gray-700 mb-2">
                Category <span className="text-[#DB0002]">*</span>
              </label>
              <select
                id="categoryId"
                name="categoryId"
                value={formData.categoryId}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              >
                <option value="">Select category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="subCategoryId" className="block text-sm font-medium text-gray-700 mb-2">
                Subcategory <span className="text-[#DB0002]">*</span>
              </label>
              <select
                id="subCategoryId"
                name="subCategoryId"
                value={formData.subCategoryId}
                onChange={handleInputChange}
                required
                disabled={!formData.categoryId}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                <option value="">Select subcategory</option>
                {subCategories.map((subCat) => (
                  <option key={subCat.id} value={subCat.id}>
                    {subCat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="businessType" className="block text-sm font-medium text-gray-700 mb-2">
                Business Type <span className="text-[#DB0002]">*</span>
              </label>
              <select
                id="businessType"
                name="businessType"
                value={formData.businessType}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              >
                <option value="storefront">Storefront</option>
                <option value="mobile_cart">Mobile Cart</option>
                <option value="home_based">Home Based</option>
              </select>
            </div>
          </div>
        </div>

        {/* Contact Information Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Contact Information</h2>
            <p className="text-sm text-gray-600">Provide your contact details</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="telephoneNumber" className="block text-sm font-medium text-gray-700 mb-2">
                Telephone Number
              </label>
              <input
                type="tel"
                id="telephoneNumber"
                name="telephoneNumber"
                value={formData.telephoneNumber}
                onChange={handleInputChange}
                placeholder="(022) 12345"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700 mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                id="phoneNumber"
                name="phoneNumber"
                value={formData.phoneNumber}
                onChange={handleInputChange}
                placeholder="0912-345-6789"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="viberNumber" className="block text-sm font-medium text-gray-700 mb-2">
                Viber Number
              </label>
              <input
                type="tel"
                id="viberNumber"
                name="viberNumber"
                value={formData.viberNumber}
                onChange={handleInputChange}
                placeholder="0912-345-6789"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="whatsappNumber" className="block text-sm font-medium text-gray-700 mb-2">
                WhatsApp Number
              </label>
              <input
                type="tel"
                id="whatsappNumber"
                name="whatsappNumber"
                value={formData.whatsappNumber}
                onChange={handleInputChange}
                placeholder="0912-345-6789"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="alternativeContactNumber1" className="block text-sm font-medium text-gray-700 mb-2">
                Alternative Contact Number 1
              </label>
              <input
                type="tel"
                id="alternativeContactNumber1"
                name="alternativeContactNumber1"
                value={formData.alternativeContactNumber1}
                onChange={handleInputChange}
                placeholder="0912-345-6789"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="alternativeContactNumber2" className="block text-sm font-medium text-gray-700 mb-2">
                Alternative Contact Number 2
              </label>
              <input
                type="tel"
                id="alternativeContactNumber2"
                name="alternativeContactNumber2"
                value={formData.alternativeContactNumber2}
                onChange={handleInputChange}
                placeholder="0912-345-6789"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="emailAddress" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address <span className="text-[#DB0002]">*</span>
              </label>
              <input
                type="email"
                id="emailAddress"
                name="emailAddress"
                value={formData.emailAddress}
                onChange={handleInputChange}
                required
                placeholder="email@example.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="authorizedOfficer" className="block text-sm font-medium text-gray-700 mb-2">
                Authorized Officer
              </label>
              <input
                type="text"
                id="authorizedOfficer"
                name="authorizedOfficer"
                value={formData.authorizedOfficer}
                onChange={handleInputChange}
                placeholder="Enter authorized officer"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>
          </div>
        </div>

        {/* Subscription & Payment Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Subscription & Payment</h2>
            <p className="text-sm text-gray-600">Choose your subscription plan and payment method</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div>
              <label htmlFor="subscriptionTier" className="block text-sm font-medium text-gray-700 mb-2">
                Subscription Tier <span className="text-[#DB0002]">*</span>
              </label>
              <select
                id="subscriptionTier"
                name="subscriptionTier"
                value={formData.subscriptionTier}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              >
                <option value="basic">Basic - P300/week, P1,000/month, P10,000/year</option>
                <option value="gold">Gold - P500/week, P2,000/month, P20,000/year</option>
                <option value="platinum">Platinum - P1,000/week, P4,000/month, P40,000/year</option>
              </select>
            </div>

            <div>
              <label htmlFor="subscriptionPlan" className="block text-sm font-medium text-gray-700 mb-2">
                Billing Period <span className="text-[#DB0002]">*</span>
              </label>
              <select
                id="subscriptionPlan"
                name="subscriptionPlan"
                value={formData.subscriptionPlan}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>

            <div>
              <label htmlFor="paymentMethod" className="block text-sm font-medium text-gray-700 mb-2">
                Payment Method <span className="text-[#DB0002]">*</span>
              </label>
              <select
                id="paymentMethod"
                name="paymentMethod"
                value={formData.paymentMethod}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              >
                <option value="GCash">GCash</option>
                <option value="Maya">Maya</option>
                <option value="Bank Transfer">Bank Transfer</option>
              </select>
            </div>
          </div>

          <div className="mb-6">
            <label htmlFor="paymentProof" className="block text-sm font-medium text-gray-700 mb-2">
              Payment Proof <span className="text-[#DB0002]">*</span>
            </label>
            <input
              type="file"
              id="paymentProof"
              name="paymentProof"
              accept="image/*,.pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setFormData(prev => ({ ...prev, paymentProof: file }));
                }
              }}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
            />
            <p className="text-sm text-gray-500 mt-1">Upload screenshot or receipt of payment (Image or PDF, max 10MB)</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label htmlFor="businessPermit" className="block text-sm font-medium text-gray-700 mb-2">
                Business Permit <span className="text-[#DB0002]">*</span>
              </label>
              <input
                type="file"
                id="businessPermit"
                name="businessPermit"
                accept="image/*,.pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setFormData(prev => ({ ...prev, businessPermit: file }));
                }}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="dtiPermit" className="block text-sm font-medium text-gray-700 mb-2">
                DTI Permit <span className="text-[#DB0002]">*</span>
              </label>
              <input
                type="file"
                id="dtiPermit"
                name="dtiPermit"
                accept="image/*,.pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setFormData(prev => ({ ...prev, dtiPermit: file }));
                }}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="validId" className="block text-sm font-medium text-gray-700 mb-2">
                Valid I.D. <span className="text-[#DB0002]">*</span>
              </label>
              <input
                type="file"
                id="validId"
                name="validId"
                accept="image/*,.pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setFormData(prev => ({ ...prev, validId: file }));
                }}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>
          </div>
        </div>

        {/* Location Mapping Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Location Mapping</h2>
            <p className="text-sm text-gray-600">Tag your business location on the map</p>
          </div>

          <div className="mb-6">
            <div className="border-2 border-gray-300 rounded-lg overflow-hidden" style={{ height: '400px', zIndex: 0 }}>
              <LocationMap
                selectedLocation={selectedLocation}
                defaultCenter={defaultCenter}
                onMapClick={handleMapClick}
                onMarkerDrag={handleMarkerDrag}
              />
            </div>
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={handleSetLocation}
                className="bg-[#DB0002] text-white px-6 py-2 rounded-lg hover:bg-[#B80002] transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {selectedLocation ? 'Update Location' : 'Set Location'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="longitude" className="block text-sm font-medium text-gray-700 mb-2">
                Longitude
              </label>
              <input
                type="number"
                step="any"
                id="longitude"
                name="longitude"
                value={formData.longitude}
                onChange={handleInputChange}
                placeholder="Longitude"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>

            <div>
              <label htmlFor="latitude" className="block text-sm font-medium text-gray-700 mb-2">
                Latitude
              </label>
              <input
                type="number"
                step="any"
                id="latitude"
                name="latitude"
                value={formData.latitude}
                onChange={handleInputChange}
                placeholder="Latitude"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              />
            </div>
          </div>
        </div>

        {/* Business Documents Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Business Documents</h2>
            <p className="text-sm text-gray-600">Upload your business license and permits</p>
          </div>

          <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center bg-gray-50 mb-4">
            <input
              type="file"
              id="businessDocuments"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => handleFileChange(e, 'businessDocuments')}
              className="hidden"
              multiple
            />
            <label
              htmlFor="businessDocuments"
              className="cursor-pointer flex flex-col items-center"
            >
              <svg className="w-16 h-16 text-[#DB0002] mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <p className="text-gray-600">
                <span className="text-[#DB0002] font-medium">Click here</span> to upload or drop{' '}
                <span className="text-[#DB0002] font-medium">Business License, Permits</span> (PDF, JPG, PNG up to 10MB) files here
              </p>
            </label>
          </div>

          {/* Document Previews */}
          {filePreviews.businessDocuments.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {filePreviews.businessDocuments.map((preview, index) => (
                <div key={index} className="relative border border-gray-300 rounded-lg overflow-hidden">
                  {preview.startsWith('data:image') ? (
                    <img
                      src={preview}
                      alt={`Document ${index + 1}`}
                      className="w-full h-32 object-cover"
                    />
                  ) : (
                    <div className="w-full h-32 bg-gray-100 flex items-center justify-center">
                      <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile('businessDocuments', index)}
                    className="absolute top-2 right-2 bg-[#DB0002] text-white rounded-full p-1 hover:bg-[#B80002]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <p className="text-xs text-gray-600 p-2 truncate">
                    {formData.businessDocuments[index]?.name}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-3 border-2 border-[#DB0002] text-[#DB0002] rounded-lg hover:bg-red-50 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || uploadingFiles}
            className="px-6 py-3 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadingFiles ? 'Uploading Files...' : loading ? 'Submitting...' : 'Submit Registration'}
          </button>
        </div>
      </form>
    </div>
  );
}
