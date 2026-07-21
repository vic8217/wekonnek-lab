'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { categoriesApi, subCategoriesApi } from '@/lib/api';
import Link from 'next/link';

interface Category {
  id: number;
  name: string;
}

interface SubCategory {
  id: number;
  name: string;
}

export default function PostAdPage() {
  const router = useRouter();
  const { user: authUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [formData, setFormData] = useState({
    adType: 'items' as 'items' | 'services' | 'labor',
    title: '',
    description: '',
    categoryId: '',
    subCategoryId: '',
    minPrice: '500',
    maxPrice: '2000',
    barangay: '',
    city: '',
    preferredDate: '',
    contactMethod: 'in-app',
    attachments: [] as File[],
  });

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    if (formData.categoryId) {
      fetchSubCategories(parseInt(formData.categoryId));
    } else {
      setSubCategories([]);
    }
  }, [formData.categoryId]);

  const fetchCategories = async () => {
    try {
      const data = await categoriesApi.getAll();
      setCategories(data);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchSubCategories = async (categoryId: number) => {
    try {
      const data = await subCategoriesApi.getByCategory(categoryId);
      setSubCategories(data);
    } catch (error) {
      console.error('Error fetching sub-categories:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const fileArray = Array.from(files).slice(0, 5); // Max 5 files
    setFormData(prev => ({
      ...prev,
      attachments: [...prev.attachments, ...fileArray].slice(0, 5),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (!authUser) {
        alert('Please log in to post an ad');
        router.push('/auth/login?redirect=/customer/promotions/new');
        return;
      }

      alert('Ad submitted successfully! It will be reviewed before going live.');
      router.push('/customer/promotions');
    } catch (error: any) {
      console.error('Error submitting ad:', error);
      alert(error.message || 'Failed to submit ad. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Post a 'Looking For' Ad</h1>
        <p className="text-gray-600">Let local merchants and service providers know what you need</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Ad Type Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Ad Type</h2>
          <p className="text-gray-600 mb-4">Select what you're looking for</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { id: 'items', label: 'Items', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
              { id: 'services', label: 'Services', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
              { id: 'labor', label: 'Labor', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
            ].map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, adType: type.id as any }))}
                className={`p-6 border-2 rounded-lg transition-colors text-left ${
                  formData.adType === type.id
                    ? 'border-red-600 bg-red-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <svg className="w-8 h-8 text-gray-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={type.icon} />
                </svg>
                <p className="font-semibold text-gray-900">{type.label}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Ad Details Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Ad Details</h2>
          <p className="text-gray-600 mb-4">Provide clear information about what you need</p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Ad Title <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                placeholder="e.g. Looking for a plumber, Need custom T-shirts"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description <span className="text-red-600">*</span>
              </label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="Describe what you need in detail (quantity, specifications, timeline, etc.)"
                required
                rows={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category <span className="text-red-600">*</span>
                </label>
                <select
                  name="categoryId"
                  value={formData.categoryId}
                  onChange={handleInputChange}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                >
                  <option value="">Select Category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Subcategory <span className="text-red-600">*</span>
                </label>
                <select
                  name="subCategoryId"
                  value={formData.subCategoryId}
                  onChange={handleInputChange}
                  required
                  disabled={!formData.categoryId}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100"
                >
                  <option value="">Select subcategory</option>
                  {subCategories.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Budget Range Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Budget Range</h2>
          <p className="text-gray-600 mb-4">Optional - Set your expected budget</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Minimum (P)</label>
              <input
                type="number"
                name="minPrice"
                value={formData.minPrice}
                onChange={handleInputChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Maximum (P)</label>
              <input
                type="number"
                name="maxPrice"
                value={formData.maxPrice}
                onChange={handleInputChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Location Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Location</h2>
          <p className="text-gray-600 mb-4">Where do you need this service or item?</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Barangay</label>
              <input
                type="text"
                name="barangay"
                value={formData.barangay}
                onChange={handleInputChange}
                placeholder="e.g. Poblacion"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                City <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                name="city"
                value={formData.city}
                onChange={handleInputChange}
                placeholder="e.g. Manila"
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Preferred Date / Deadline</label>
              <div className="relative">
                <input
                  type="date"
                  name="preferredDate"
                  value={formData.preferredDate}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Photos & Attachments Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Photos & Attachments</h2>
          <p className="text-gray-600 mb-4">Upload reference images (optional, max 5)</p>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
            <input
              type="file"
              id="attachments"
              multiple
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <label
              htmlFor="attachments"
              className="cursor-pointer flex flex-col items-center"
            >
              <svg className="w-12 h-12 text-red-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <p className="text-red-600 font-medium mb-1">Click here to upload or drop Photos (JPG, PNG up to 10MB)</p>
              <p className="text-gray-500 text-sm">files here</p>
            </label>
            {formData.attachments.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-gray-600 mb-2">{formData.attachments.length} file(s) selected</p>
                <div className="flex flex-wrap gap-2">
                  {formData.attachments.map((file, index) => (
                    <span key={index} className="px-3 py-1 bg-gray-100 rounded text-sm text-gray-700">
                      {file.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Contact Reference Section */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Contact Reference</h2>
          <p className="text-gray-600 mb-4">How should merchants contact you?</p>
          <select
            name="contactMethod"
            value={formData.contactMethod}
            onChange={handleInputChange}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            <option value="in-app">In-app Chat Only (Recommended)</option>
            <option value="phone">Phone Number</option>
            <option value="email">Email Address</option>
            <option value="both">Both Phone and Email</option>
          </select>
        </div>

        {/* Submit Buttons */}
        <div className="flex justify-end space-x-4">
          <Link
            href="/customer/promotions"
            className="px-6 py-3 border-2 border-red-600 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50"
          >
            {loading ? 'Submitting...' : 'Submit Ad for Review'}
          </button>
        </div>
      </form>
    </div>
  );
}
