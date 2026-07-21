'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { staffPostsApi, merchantsApi, categoriesApi, uploadApi } from '@/lib/api';
import dynamic from 'next/dynamic';
import type L from 'leaflet';

// Dynamically import the map component with SSR disabled
const LocationMap = dynamic(() => import('@/components/LocationMap'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-gray-100">
      <p className="text-gray-600">Loading map...</p>
    </div>
  ),
});

export default function CreatePostPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<[number, number] | null>(null);
  const [merchants, setMerchants] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [documentPreviews, setDocumentPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    merchantId: '',
    title: '',
    description: '',
    categoryTag: '',
    categoryId: '',
    expiryHours: '3',
    latitude: '',
    longitude: '',
    documents: [] as File[],
  });

  const [expiryDate, setExpiryDate] = useState<string>('');

  useEffect(() => {
    fetchMerchants();
    fetchCategories();
  }, []);

  useEffect(() => {
    // Calculate expiry date based on hours
    if (formData.expiryHours) {
      const hours = parseInt(formData.expiryHours) || 3;
      const expiry = new Date();
      expiry.setHours(expiry.getHours() + hours);
      setExpiryDate(expiry.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }));
    }
  }, [formData.expiryHours]);

  const fetchMerchants = async () => {
    try {
      const response = await merchantsApi.getAll();
      setMerchants(response || []);
    } catch (error) {
      console.error('Error fetching merchants:', error);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await categoriesApi.getAll(false);
      setCategories(response || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

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
      documents: [...prev.documents, ...validFiles],
    }));

    // Create previews
    validFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setDocumentPreviews(prev => [...prev, result]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (index: number) => {
    setFormData(prev => ({
      ...prev,
      documents: prev.documents.filter((_, i) => i !== index),
    }));
    setDocumentPreviews(prev => prev.filter((_, i) => i !== index));
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
        alert('Unable to get your location. Please click on the map to set the location.');
      }
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setUploadingFiles(true);

    try {
      // Upload documents first
      let documentUrls: string[] = [];
      if (formData.documents.length > 0) {
        try {
          documentUrls = await uploadApi.uploadMultipleFiles(formData.documents, 'document');
        } catch (uploadError) {
          console.error('File upload error:', uploadError);
          alert('Failed to upload documents. Please try again.');
          setUploadingFiles(false);
          setLoading(false);
          return;
        }
      }

      setUploadingFiles(false);

      // Calculate expiry date
      const hours = parseInt(formData.expiryHours) || 3;
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + hours);

      // Create post data
      const postData = {
        title: formData.title,
        description: formData.description || undefined,
        categoryTag: formData.categoryTag || undefined,
        categoryId: formData.categoryId ? parseInt(formData.categoryId) : undefined,
        merchantId: formData.merchantId ? parseInt(formData.merchantId) : undefined,
        latitude: formData.latitude ? parseFloat(formData.latitude) : undefined,
        longitude: formData.longitude ? parseFloat(formData.longitude) : undefined,
        expiresAt: expiresAt.toISOString(),
        isActive: true,
        documentUrls: documentUrls.length > 0 ? documentUrls : undefined,
      };

      await staffPostsApi.create(postData);
      alert('Post created successfully!');
      router.push('/admin/dashboard');
    } catch (error: any) {
      console.error('Error creating post:', error);
      alert(error.message || 'Failed to create post. Please try again.');
    } finally {
      setLoading(false);
      setUploadingFiles(false);
    }
  };

  const defaultCenter: [number, number] = [14.5995, 120.9842]; // Manila, Philippines

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Create Time-Limited Post</h1>
        <p className="text-gray-600">Post offers, announcements, or promotions with automatic expiry</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Select Business Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Select Business</h2>
            <p className="text-sm text-gray-600">Choose which business this post is for</p>
          </div>

          <div>
            <label htmlFor="merchantId" className="block text-sm font-medium text-gray-700 mb-2">
              Business
            </label>
            <select
              id="merchantId"
              name="merchantId"
              value={formData.merchantId}
              onChange={handleInputChange}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
            >
              <option value="">Select Business</option>
              {merchants.map((merchant) => (
                <option key={merchant.id} value={merchant.id}>
                  {merchant.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Post Details Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Post Details</h2>
            <p className="text-sm text-gray-600">What do you want to announce?</p>
          </div>

          <div className="space-y-4">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                Post Title / Caption <span className="text-[#DB0002]">*</span>
              </label>
              <input
                type="text"
                id="title"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                required
                placeholder="Enter post title"
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
                placeholder="We provide quality products and excellent service to our customers."
                rows={4}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none resize-none"
              />
            </div>

            <div>
              <label htmlFor="categoryTag" className="block text-sm font-medium text-gray-700 mb-2">
                Category / Tag <span className="text-[#DB0002]">*</span>
              </label>
              <select
                id="categoryTag"
                name="categoryTag"
                value={formData.categoryTag}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              >
                <option value="">Select category</option>
                <option value="Promotion">Promotion</option>
                <option value="Announcement">Announcement</option>
                <option value="Event">Event</option>
                <option value="Sale">Sale</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.name}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Post Duration Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Post Duration</h2>
            <p className="text-sm text-gray-600">How long should this post be visible?</p>
          </div>

          <div>
            <label htmlFor="expiryHours" className="block text-sm font-medium text-gray-700 mb-2">
              Expiry Time <span className="text-[#DB0002]">*</span>
            </label>
            <select
              id="expiryHours"
              name="expiryHours"
              value={formData.expiryHours}
              onChange={handleInputChange}
              required
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
            >
              <option value="1">1 Hour</option>
              <option value="3">3 Hours</option>
              <option value="6">6 Hours</option>
              <option value="12">12 Hours</option>
              <option value="24">24 Hours</option>
              <option value="48">48 Hours</option>
              <option value="72">72 Hours</option>
            </select>
          </div>

          {expiryDate && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-700">
                <span className="font-medium">Post will expire on:</span> {expiryDate}
              </p>
            </div>
          )}
        </div>

        {/* Location Mapping Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Location Mapping</h2>
            <p className="text-sm text-gray-600">Tag your business location on the map</p>
          </div>

          <div className="mb-6">
            <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden" style={{ height: '400px', zIndex: 0 }}>
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

          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center cursor-pointer hover:border-[#DB0002] transition-colors bg-gray-50"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleFileChange}
              className="hidden"
              multiple
            />
            <svg className="w-16 h-16 text-[#DB0002] mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-gray-600">
              <span className="text-[#DB0002] font-medium">Click here</span> to upload or drop{' '}
              <span className="text-[#DB0002] font-medium">Business License, Permits</span> (PDF, JPG, PNG up to 10MB) files here
            </p>
          </div>

          {/* Document Previews */}
          {documentPreviews.length > 0 && (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              {documentPreviews.map((preview, index) => (
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
                    onClick={() => removeFile(index)}
                    className="absolute top-2 right-2 bg-[#DB0002] text-white rounded-full p-1 hover:bg-[#B80002]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <p className="text-xs text-gray-600 p-2 truncate">
                    {formData.documents[index]?.name}
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
            {uploadingFiles ? 'Uploading Files...' : loading ? 'Creating...' : 'Create Post'}
          </button>
        </div>
      </form>
    </div>
  );
}
