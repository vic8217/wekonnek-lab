'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { getToken } from '@/hooks/use-auth';
import { categoriesApi, subCategoriesApi, productsApi, uploadApi } from '@/lib/api';
import {
  fetchProductCategories,
  syncProductCategories,
} from '@/lib/product-categories';
import Image from 'next/image';

interface Category {
  id: number;
  name: string;
  slug: string;
}

interface SubCategory {
  id: number;
  name: string;
  slug: string;
  categoryId: number;
}

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams();
  const productId = Number(params.id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [extraAssignments, setExtraAssignments] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    name: '',
    product_code: '',
    description: '',
    category_id: '',
    sub_category_id: '',
    price: '0.00',
    is_available: true,
  });

  useEffect(() => {
    fetchProduct();
    fetchCategories();
    fetchExtraAssignments();
  }, [productId]);

  const fetchExtraAssignments = async () => {
    const assignments = await fetchProductCategories(productId);
    const nonPrimary = assignments
      .filter((a) => !a.isPrimary)
      .map((a) => `${a.categoryId}:${a.subCategoryId ?? ''}`);
    setExtraAssignments(nonPrimary);
  };

  useEffect(() => {
    if (formData.category_id) {
      fetchSubCategories(parseInt(formData.category_id));
    } else {
      setSubCategories([]);
    }
  }, [formData.category_id]);

  const fetchProduct = async () => {
    try {
      setLoading(true);

      const product = await productsApi.getById(productId);
      setFormData({
        name: product.name || '',
        product_code: product.productCode || '',
        description: product.description || '',
        category_id: product.categoryId?.toString() || '',
        sub_category_id: product.subCategoryId?.toString() || '',
        price: product.price?.toString() || '0.00',
        is_available: product.isAvailable ?? true,
      });
      setQuantity(product.quantity || 1);
      if (product.imageUrl) setImagePreview(product.imageUrl);
    } catch (error) {
      console.error('Error fetching product:', error);
      alert('Product not found');
      router.push('/merchant/inventory');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await categoriesApi.getAll(false);
      setCategories(response || []);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const fetchSubCategories = async (categoryId: number) => {
    try {
      const subs = await subCategoriesApi.getByCategory(categoryId);
      setSubCategories((subs || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        slug: item.slug,
        categoryId: item.categoryId || item.category_id,
      })));
    } catch (error) {
      console.error('Error fetching sub-categories:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB');
        return;
      }
      if (!file.type.match(/^image\/(jpeg|jpg|png)$/)) {
        alert('Please upload a JPG or PNG image');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      // Upload new image if provided
      let imageUrl: string | undefined;
      if (fileInputRef.current?.files?.[0]) {
        try {
          imageUrl = await uploadApi.uploadFile(fileInputRef.current.files[0], 'establishment');
        } catch {
          console.error('Error uploading image');
          alert('Failed to upload image. Product will be saved without new image.');
        }
      }

      const primaryCat = parseInt(formData.category_id);
      const primarySub = parseInt(formData.sub_category_id);
      const primaryKey = `${primaryCat}:${primarySub || ''}`;
      const seen = new Set<string>([primaryKey]);
      const assignments = [
        {
          categoryId: primaryCat,
          subCategoryId: primarySub || null,
          isPrimary: true,
        },
      ];
      for (const raw of extraAssignments) {
        if (seen.has(raw)) continue;
        seen.add(raw);
        const [catStr, subStr] = raw.split(':');
        const cat = Number(catStr);
        if (!cat) continue;
        assignments.push({
          categoryId: cat,
          subCategoryId: subStr ? Number(subStr) : null,
          isPrimary: false,
        });
      }

      const updateData: any = {
        name: formData.name,
        description: formData.description || undefined,
        productCode: formData.product_code,
        price: parseFloat(formData.price) || 0,
        quantity: quantity,
        isAvailable: formData.is_available,
        categoryId: primaryCat,
        subCategoryId: Number.isNaN(primarySub) ? null : primarySub,
      };
      if (imageUrl) updateData.imageUrl = imageUrl;

      await productsApi.update(productId, updateData);
      await syncProductCategories(productId, assignments);
      alert('Product updated successfully!');
      router.push('/merchant/inventory');
    } catch (error: any) {
      console.error('Error updating product:', error);
      alert(error.message || 'Failed to update product');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading product...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Go back">
          <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-1">Edit Product</h1>
          <p className="text-gray-600">Update product or service details</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Product Information */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Product Information</h2>
            <p className="text-sm text-gray-600">Update product or service details</p>
          </div>
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Product/Service Name <span className="text-[#DB0002]">*</span>
              </label>
              <input type="text" id="name" name="name" value={formData.name} onChange={handleInputChange} required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none" />
            </div>
            <div>
              <label htmlFor="product_code" className="block text-sm font-medium text-gray-700 mb-2">
                Product Code <span className="text-[#DB0002]">*</span>
              </label>
              <input type="text" id="product_code" name="product_code" value={formData.product_code} onChange={handleInputChange} required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none" />
            </div>
            <div>
              <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 mb-2">
                Quantity <span className="text-[#DB0002]">*</span>
              </label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 border border-gray-300 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors">
                  <span className="text-gray-600 text-lg">-</span>
                </button>
                <input type="number" id="quantity" value={quantity} onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  min="1" required className="w-20 px-4 py-3 border border-gray-300 rounded-lg text-center focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none" />
                <button type="button" onClick={() => setQuantity(quantity + 1)}
                  className="w-10 h-10 border border-gray-300 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors">
                  <span className="text-gray-600 text-lg">+</span>
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <textarea id="description" name="description" value={formData.description} onChange={handleInputChange}
                rows={4} className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none resize-none" />
            </div>
            <div>
              <label htmlFor="category_id" className="block text-sm font-medium text-gray-700 mb-2">
                Category <span className="text-[#DB0002]">*</span>
              </label>
              <select id="category_id" name="category_id" value={formData.category_id} onChange={handleInputChange} required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none">
                <option value="">Select category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sub_category_id" className="block text-sm font-medium text-gray-700 mb-2">
                Subcategory <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <select id="sub_category_id" name="sub_category_id" value={formData.sub_category_id} onChange={handleInputChange}
                disabled={!formData.category_id}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none disabled:bg-gray-100">
                <option value="">
                  {formData.category_id && subCategories.length === 0
                    ? 'No subcategories for this category'
                    : 'Select subcategory'}
                </option>
                {subCategories.map((sub) => (
                  <option key={sub.id} value={sub.id}>{sub.name}</option>
                ))}
              </select>
            </div>
            <ExtraCategoriesPicker
              categories={categories}
              primaryCategoryId={formData.category_id}
              primarySubCategoryId={formData.sub_category_id}
              extraAssignments={extraAssignments}
              setExtraAssignments={setExtraAssignments}
            />
            <div>
              <label htmlFor="price" className="block text-sm font-medium text-gray-700 mb-2">
                Price (₱) <span className="text-[#DB0002]">*</span>
              </label>
              <input type="number" id="price" name="price" value={formData.price} onChange={handleInputChange}
                step="0.01" min="0" required className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Availability</label>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={formData.is_available}
                  onChange={(e) => setFormData(prev => ({ ...prev, is_available: e.target.checked }))}
                  className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#DB0002]/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#DB0002]"></div>
              </label>
            </div>
          </div>
        </div>

        {/* Product Photo */}
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Product Photo</h2>
            <p className="text-sm text-gray-600">Update product images</p>
          </div>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center cursor-pointer hover:border-[#DB0002] transition-colors bg-gray-50"
          >
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/jpg" onChange={handleImageChange} className="hidden" />
            {imagePreview ? (
              <div className="relative w-full max-w-md mx-auto">
                <div className="relative h-64 rounded-lg overflow-hidden">
                  <Image src={imagePreview} alt="Product preview" fill className="object-contain" />
                </div>
                <button type="button" onClick={(e) => { e.stopPropagation(); setImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  className="mt-4 px-4 py-2 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors text-sm">
                  Remove Image
                </button>
              </div>
            ) : (
              <div>
                <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-[#DB0002] font-medium">Click to upload a new image (JPG, PNG up to 5MB)</p>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-4 pt-4">
          <button type="button" onClick={() => router.back()}
            className="px-6 py-3 border-2 border-[#DB0002] text-[#DB0002] rounded-lg hover:bg-red-50 transition-colors font-medium">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="px-6 py-3 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors font-medium disabled:opacity-50">
            {saving ? 'Saving...' : 'Update Product'}
          </button>
        </div>
      </form>
    </div>
  );
}

interface ExtraCategoriesPickerProps {
  categories: Category[];
  primaryCategoryId: string;
  primarySubCategoryId: string;
  extraAssignments: string[];
  setExtraAssignments: (next: string[]) => void;
}

function ExtraCategoriesPicker({
  categories,
  primaryCategoryId,
  primarySubCategoryId,
  extraAssignments,
  setExtraAssignments,
}: ExtraCategoriesPickerProps) {
  const [pickerCategory, setPickerCategory] = useState('');
  const [pickerSubCategory, setPickerSubCategory] = useState('');
  const [pickerSubs, setPickerSubs] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pickerCategory) {
        if (!cancelled) {
          setPickerSubs([]);
          setPickerSubCategory('');
        }
        return;
      }
      const subs = await subCategoriesApi.getByCategory(Number(pickerCategory));
      if (cancelled) return;
      setPickerSubs((subs || []).map((s: any) => ({ id: s.id, name: s.name })));
      setPickerSubCategory('');
    })();
    return () => { cancelled = true; };
  }, [pickerCategory]);

  const primaryKey = `${primaryCategoryId}:${primarySubCategoryId || ''}`;

  const addAssignment = () => {
    if (!pickerCategory) return;
    const key = `${pickerCategory}:${pickerSubCategory || ''}`;
    if (key === primaryKey) {
      alert('That category is already set as the primary.');
      return;
    }
    if (extraAssignments.includes(key)) return;
    setExtraAssignments([...extraAssignments, key]);
    setPickerCategory('');
    setPickerSubCategory('');
  };

  const removeAssignment = (key: string) => {
    setExtraAssignments(extraAssignments.filter((k) => k !== key));
  };

  const labelFor = (key: string) => {
    const [catStr, subStr] = key.split(':');
    const cat = categories.find((c) => String(c.id) === catStr);
    if (!cat) return 'Unknown category';
    if (!subStr) return cat.name;
    return `${cat.name} › sub #${subStr}`;
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Also list under (optional)
      </label>
      <p className="text-xs text-gray-500 mb-2">
        Surface this product in additional categories or sub-categories.
      </p>
      <div className="flex gap-2 flex-wrap mb-3">
        {extraAssignments.length === 0 && (
          <span className="text-xs text-gray-400 italic">
            No additional categories assigned yet.
          </span>
        )}
        {extraAssignments.map((key) => (
          <span
            key={key}
            className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full text-xs font-medium"
          >
            {labelFor(key)}
            <button
              type="button"
              onClick={() => removeAssignment(key)}
              className="ml-1 text-blue-500 hover:text-blue-700"
              title="Remove"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select
          value={pickerCategory}
          onChange={(e) => setPickerCategory(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
        >
          <option value="">Add a category…</option>
          {categories
            .filter((c) => String(c.id) !== primaryCategoryId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <select
          value={pickerSubCategory}
          onChange={(e) => setPickerSubCategory(e.target.value)}
          disabled={!pickerCategory}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none disabled:bg-gray-100"
        >
          <option value="">Any sub-category</option>
          {pickerSubs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addAssignment}
          disabled={!pickerCategory}
          className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
