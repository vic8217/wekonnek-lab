'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { getToken } from '@/hooks/use-auth';
import { uploadImage } from '@/lib/upload';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

interface Category {
  id: number;
  name: string;
  slug: string;
  description: string;
  icon: string;
  image_url: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  sub_categories?: SubCategory[];
}

interface SubCategory {
  id: number;
  category_id: number;
  name: string;
  slug: string;
  description: string;
  icon: string;
  image_url: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

const PAGE_SIZE = 10;

export default function AdminCategoriesPage() {
  const [taxonomyTab, setTaxonomyTab] = useState<'merchant' | 'product'>('merchant');
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showSubCategoryModal, setShowSubCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingSubCategory, setEditingSubCategory] = useState<SubCategory | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'category' | 'subcategory'; id: number } | null>(null);

  // List view: search, filter, pagination
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [currentPage, setCurrentPage] = useState(1);

  // Category form
  const [catForm, setCatForm] = useState<{
    name: string;
    slug: string;
    description: string;
    icon: string;
    image_url: string;
    is_active: boolean;
    display_order: number;
  }>({ name: '', slug: '', description: '', icon: '', image_url: '', is_active: true, display_order: 0 });
  // Sub-category form
  const [subForm, setSubForm] = useState<{
    name: string;
    slug: string;
    description: string;
    icon: string;
    image_url: string;
    is_active: boolean;
    display_order: number;
    category_id: number;
  }>({ name: '', slug: '', description: '', icon: '', image_url: '', is_active: true, display_order: 0, category_id: 0 });

  // Image upload state
  const [uploadingImage, setUploadingImage] = useState<'cat' | 'sub' | null>(null);
  const catImageInputRef = useRef<HTMLInputElement | null>(null);
  const subImageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const token = getToken();
      const res = await fetch(`${API}/api/categories?include=sub_categories`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch categories');
      const data = await res.json();
      setCategories(Array.isArray(data) ? data : data.data || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  };

  // Category CRUD
  const openAddCategory = () => {
    setEditingCategory(null);
    setCatForm({
      name: '',
      slug: '',
      description: '',
      icon: '',
      image_url: '',
      is_active: true,
      display_order: categories.length,
    });
    setShowCategoryModal(true);
  };

  const openEditCategory = (cat: Category) => {
    setEditingCategory(cat);
    setCatForm({
      name: cat.name,
      slug: cat.slug,
      description: cat.description || '',
      icon: cat.icon || '',
      image_url: cat.image_url || '',
      is_active: cat.is_active,
      display_order: cat.display_order,
    });
    setShowCategoryModal(true);
  };

  const uploadCategoryImage = async (file: File) => {
    setUploadingImage('cat');
    try {
      const url = await uploadImage(file, {
        bucket: 'category-images',
        folder: 'categories',
      });
      setCatForm((prev) => ({ ...prev, image_url: url }));
    } catch (err: any) {
      console.error('Image upload failed:', err);
      toast.error(err.message || 'Failed to upload image.');
    } finally {
      setUploadingImage(null);
      if (catImageInputRef.current) catImageInputRef.current.value = '';
    }
  };

  const uploadSubCategoryImage = async (file: File) => {
    setUploadingImage('sub');
    try {
      const url = await uploadImage(file, {
        bucket: 'category-images',
        folder: 'sub-categories',
      });
      setSubForm((prev) => ({ ...prev, image_url: url }));
    } catch (err: any) {
      console.error('Image upload failed:', err);
      toast.error(err.message || 'Failed to upload image.');
    } finally {
      setUploadingImage(null);
      if (subImageInputRef.current) subImageInputRef.current.value = '';
    }
  };

  const saveCategory = async () => {
    try {
      setSaving(true);
      const token = getToken();
      const slug = catForm.slug || generateSlug(catForm.name);
      const payload = {
        ...catForm,
        slug,
        image_url: catForm.image_url || null,
      };

      if (editingCategory) {
        const res = await fetch(`${API}/api/categories/${editingCategory.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to update category');
        toast.success('Category updated successfully');
      } else {
        const res = await fetch(`${API}/api/categories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to create category');
        toast.success('Category created successfully');
      }

      setShowCategoryModal(false);
      fetchCategories();
    } catch (error: any) {
      console.error('Error saving category:', error);
      toast.error(error.message || 'Failed to save category');
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (id: number) => {
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/categories/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to delete category');
      setDeleteConfirm(null);
      fetchCategories();
      toast.success('Category deleted successfully');
    } catch (error: any) {
      console.error('Error deleting category:', error);
      toast.error(error.message || 'Failed to delete category. It may have linked merchants or products.');
    }
  };

  // Sub-Category CRUD
  const openAddSubCategory = (categoryId: number) => {
    setEditingSubCategory(null);
    setSelectedCategoryId(categoryId);
    const cat = categories.find(c => c.id === categoryId);
    const subCount = cat?.sub_categories?.length || 0;
    setSubForm({
      name: '',
      slug: '',
      description: '',
      icon: '',
      image_url: '',
      is_active: true,
      display_order: subCount,
      category_id: categoryId,
    });
    setShowSubCategoryModal(true);
  };

  const openEditSubCategory = (sub: SubCategory) => {
    setEditingSubCategory(sub);
    setSelectedCategoryId(sub.category_id);
    setSubForm({
      name: sub.name,
      slug: sub.slug,
      description: sub.description || '',
      icon: sub.icon || '',
      image_url: sub.image_url || '',
      is_active: sub.is_active,
      display_order: sub.display_order,
      category_id: sub.category_id,
    });
    setShowSubCategoryModal(true);
  };

  const saveSubCategory = async () => {
    try {
      setSaving(true);
      const token = getToken();
      const slug = subForm.slug || generateSlug(subForm.name);
      const payload = {
        ...subForm,
        slug,
        image_url: subForm.image_url || null,
      };

      if (editingSubCategory) {
        const res = await fetch(`${API}/api/sub-categories/${editingSubCategory.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to update sub-category');
        toast.success('Sub-category updated successfully');
      } else {
        const res = await fetch(`${API}/api/sub-categories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to create sub-category');
        toast.success('Sub-category created successfully');
      }

      setShowSubCategoryModal(false);
      fetchCategories();
    } catch (error: any) {
      console.error('Error saving sub-category:', error);
      toast.error(error.message || 'Failed to save sub-category');
    } finally {
      setSaving(false);
    }
  };

  const deleteSubCategory = async (id: number) => {
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/sub-categories/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to delete sub-category');
      setDeleteConfirm(null);
      fetchCategories();
      toast.success('Sub-category deleted successfully');
    } catch (error: any) {
      console.error('Error deleting sub-category:', error);
      toast.error(error.message || 'Failed to delete sub-category');
    }
  };

  const toggleCategoryStatus = async (cat: Category) => {
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/categories/${cat.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ is_active: !cat.is_active }),
      });
      if (!res.ok) throw new Error('Failed to toggle status');
      fetchCategories();
      toast.success(`Category ${cat.is_active ? 'deactivated' : 'activated'} successfully`);
    } catch (error) {
      console.error('Error toggling category status:', error);
      toast.error('Failed to toggle category status');
    }
  };

  const toggleSubCategoryStatus = async (sub: SubCategory) => {
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/sub-categories/${sub.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ is_active: !sub.is_active }),
      });
      if (!res.ok) throw new Error('Failed to toggle status');
      fetchCategories();
      toast.success(`Sub-category ${sub.is_active ? 'deactivated' : 'activated'} successfully`);
    } catch (error) {
      console.error('Error toggling sub-category status:', error);
      toast.error('Failed to toggle sub-category status');
    }
  };

  // Derived: filter + paginate
  const filteredCategories = useMemo(() => {
    let list = categories;
    if (statusFilter !== 'all') {
      list = list.filter((c) =>
        statusFilter === 'active' ? c.is_active : !c.is_active,
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q) ||
          (c.description || '').toLowerCase().includes(q) ||
          (c.sub_categories || []).some((s) =>
            s.name.toLowerCase().includes(q),
          ),
      );
    }
    return list;
  }, [categories, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredCategories.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedCategories = filteredCategories.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter]);

  if (taxonomyTab === 'merchant') return <MerchantTaxonomyPanel onSelectProduct={() => setTaxonomyTab('product')} />;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#DB0002] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Loading categories...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TaxonomyTabs active="product" onMerchant={() => setTaxonomyTab('merchant')} onProduct={() => setTaxonomyTab('product')} />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Category Management</h1>
          <p className="text-gray-600">Manage product categories and sub-categories</p>
        </div>
        <button
          onClick={openAddCategory}
          className="px-6 py-3 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors font-medium flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Category
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Total Categories</p>
          <p className="text-2xl font-bold text-gray-900">{categories.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Active Categories</p>
          <p className="text-2xl font-bold text-green-600">{categories.filter(c => c.is_active).length}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Total Sub-Categories</p>
          <p className="text-2xl font-bold text-gray-900">{categories.reduce((sum, c) => sum + (c.sub_categories?.length || 0), 0)}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-200">
          <p className="text-sm text-gray-600">Inactive Categories</p>
          <p className="text-2xl font-bold text-red-600">{categories.filter(c => !c.is_active).length}</p>
        </div>
      </div>

      {/* Categories List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">All Categories</h2>
            <p className="text-sm text-gray-600">Click on a category to view and manage its sub-categories</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 md:items-center">
            <div className="relative flex-1 sm:flex-none">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search categories..."
                className="pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none w-full sm:w-64"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')
              }
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
              title="Status filter"
            >
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>
        </div>

        {filteredCategories.length === 0 ? (
          <div className="p-12 text-center">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <p className="text-gray-500 text-lg">
              {categories.length === 0 ? 'No categories yet' : 'No categories match your filters'}
            </p>
            <p className="text-gray-400 text-sm mt-1">
              {categories.length === 0 ? 'Create your first category to get started' : 'Try a different search term or status filter'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {pagedCategories.map((cat) => (
              <div key={cat.id}>
                {/* Category Row */}
                <div
                  className="p-4 hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => setExpandedCategory(expandedCategory === cat.id ? null : cat.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {cat.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cat.image_url}
                          alt={cat.name}
                          className={`w-10 h-10 rounded-lg object-cover ${cat.is_active ? '' : 'opacity-60 grayscale'}`}
                        />
                      ) : (
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white text-lg font-bold ${cat.is_active ? 'bg-[#DB0002]' : 'bg-gray-400'}`}>
                          {cat.icon || cat.name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                          {cat.name}
                          <span className={`px-2 py-0.5 rounded-full text-xs ${cat.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {cat.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </h3>
                        <p className="text-sm text-gray-500">
                          {cat.sub_categories?.length || 0} sub-categories • Slug: {cat.slug}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleCategoryStatus(cat); }}
                        className={`px-3 py-1 rounded text-xs font-medium transition-colors ${cat.is_active ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                        title={cat.is_active ? 'Deactivate' : 'Activate'}
                      >
                        {cat.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditCategory(cat); }}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="Edit Category"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ type: 'category', id: cat.id }); }}
                        className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Delete Category"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                      <svg className={`w-5 h-5 text-gray-400 transition-transform ${expandedCategory === cat.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Expanded Sub-Categories */}
                {expandedCategory === cat.id && (
                  <div className="bg-gray-50 border-t border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-medium text-gray-700">Sub-Categories of &quot;{cat.name}&quot;</h4>
                      <button
                        onClick={() => openAddSubCategory(cat.id)}
                        className="px-4 py-2 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors text-sm font-medium flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Sub-Category
                      </button>
                    </div>

                    {(!cat.sub_categories || cat.sub_categories.length === 0) ? (
                      <p className="text-gray-400 text-sm text-center py-4">No sub-categories yet</p>
                    ) : (
                      <div className="space-y-2">
                        {cat.sub_categories.map((sub) => (
                          <div key={sub.id} className="bg-white rounded-lg p-3 border border-gray-200 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              {sub.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={sub.image_url}
                                  alt={sub.name}
                                  className={`w-8 h-8 rounded object-cover ${sub.is_active ? '' : 'opacity-60 grayscale'}`}
                                />
                              ) : (
                                <div className={`w-8 h-8 rounded flex items-center justify-center text-white text-sm font-bold ${sub.is_active ? 'bg-blue-500' : 'bg-gray-400'}`}>
                                  {sub.icon || sub.name.charAt(0)}
                                </div>
                              )}
                              <div>
                                <p className="font-medium text-gray-900 flex items-center gap-2">
                                  {sub.name}
                                  <span className={`px-2 py-0.5 rounded-full text-xs ${sub.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                    {sub.is_active ? 'Active' : 'Inactive'}
                                  </span>
                                </p>
                                <p className="text-xs text-gray-500">Slug: {sub.slug}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => toggleSubCategoryStatus(sub)}
                                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${sub.is_active ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
                                title={sub.is_active ? 'Deactivate' : 'Activate'}
                              >
                                {sub.is_active ? 'Deactivate' : 'Activate'}
                              </button>
                              <button
                                onClick={() => openEditSubCategory(sub)}
                                className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                title="Edit Sub-Category"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                              <button
                                onClick={() => setDeleteConfirm({ type: 'subcategory', id: sub.id })}
                                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                title="Delete Sub-Category"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {filteredCategories.length > 0 && totalPages > 1 && (
          <div className="p-4 border-t border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-gray-500">
              Showing {(safePage - 1) * PAGE_SIZE + 1}–
              {Math.min(safePage * PAGE_SIZE, filteredCategories.length)} of{' '}
              {filteredCategories.length}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
                disabled={safePage === 1}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50 hover:bg-gray-100"
              >
                Previous
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const page = safePage <= 3 ? i + 1 : safePage + i - 2;
                if (page > totalPages || page < 1) return null;
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-1.5 rounded text-sm ${
                      safePage === page
                        ? 'bg-[#DB0002] text-white'
                        : 'border border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
                disabled={safePage === totalPages}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm disabled:opacity-50 hover:bg-gray-100"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Category Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-bold text-gray-900">
                {editingCategory ? 'Edit Category' : 'Add New Category'}
              </h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category Name *</label>
                <input
                  type="text"
                  value={catForm.name}
                  onChange={(e) => setCatForm({ ...catForm, name: e.target.value, slug: generateSlug(e.target.value) })}
                  placeholder="e.g. Food & Beverage"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
                <input
                  type="text"
                  value={catForm.slug}
                  onChange={(e) => setCatForm({ ...catForm, slug: e.target.value })}
                  placeholder="auto-generated-from-name"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={catForm.description}
                  onChange={(e) => setCatForm({ ...catForm, description: e.target.value })}
                  placeholder="Brief description of this category"
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Icon (emoji/text)</label>
                  <input
                    type="text"
                    value={catForm.icon}
                    onChange={(e) => setCatForm({ ...catForm, icon: e.target.value })}
                    placeholder="🍔"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Display Order</label>
                  <input
                    type="number"
                    value={catForm.display_order}
                    onChange={(e) => setCatForm({ ...catForm, display_order: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category Image</label>
                <p className="text-xs text-gray-500 mb-2">PNG / JPG / WEBP up to 5 MB. Displayed instead of the emoji when set.</p>
                <input
                  ref={catImageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadCategoryImage(file);
                  }}
                  className="hidden"
                />
                <div className="flex items-start gap-3">
                  <div className="w-20 h-20 rounded-lg border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {catForm.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={catForm.image_url} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl text-gray-300">{catForm.icon || '🖼️'}</span>
                    )}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => catImageInputRef.current?.click()}
                      disabled={uploadingImage === 'cat'}
                      className="self-start px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                    >
                      {uploadingImage === 'cat' ? 'Uploading…' : catForm.image_url ? 'Replace image' : 'Upload image'}
                    </button>
                    <input
                      type="text"
                      value={catForm.image_url}
                      onChange={(e) => setCatForm({ ...catForm, image_url: e.target.value })}
                      placeholder="Or paste an image URL"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002]"
                    />
                    {catForm.image_url && (
                      <button
                        type="button"
                        onClick={() => setCatForm({ ...catForm, image_url: '' })}
                        className="self-start text-xs text-red-600 hover:underline"
                      >
                        Remove image
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={catForm.is_active}
                    onChange={(e) => setCatForm({ ...catForm, is_active: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#DB0002]/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#DB0002]"></div>
                </label>
                <span className="text-sm font-medium text-gray-700">Active</span>
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowCategoryModal(false)}
                className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={saveCategory}
                disabled={saving || !catForm.name.trim()}
                className="px-6 py-2.5 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors font-medium disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingCategory ? 'Update Category' : 'Create Category'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Category Modal */}
      {showSubCategoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-bold text-gray-900">
                {editingSubCategory ? 'Edit Sub-Category' : 'Add New Sub-Category'}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Under: {categories.find(c => c.id === (selectedCategoryId || subForm.category_id))?.name}
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sub-Category Name *</label>
                <input
                  type="text"
                  value={subForm.name}
                  onChange={(e) => setSubForm({ ...subForm, name: e.target.value, slug: generateSlug(e.target.value) })}
                  placeholder="e.g. Fast Food"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
                <input
                  type="text"
                  value={subForm.slug}
                  onChange={(e) => setSubForm({ ...subForm, slug: e.target.value })}
                  placeholder="auto-generated-from-name"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={subForm.description}
                  onChange={(e) => setSubForm({ ...subForm, description: e.target.value })}
                  placeholder="Brief description"
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Icon</label>
                  <input
                    type="text"
                    value={subForm.icon}
                    onChange={(e) => setSubForm({ ...subForm, icon: e.target.value })}
                    placeholder="🍕"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Display Order</label>
                  <input
                    type="number"
                    value={subForm.display_order}
                    onChange={(e) => setSubForm({ ...subForm, display_order: parseInt(e.target.value) || 0 })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#DB0002] focus:border-[#DB0002] outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sub-Category Image</label>
                <p className="text-xs text-gray-500 mb-2">PNG / JPG / WEBP up to 5 MB.</p>
                <input
                  ref={subImageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadSubCategoryImage(file);
                  }}
                  className="hidden"
                />
                <div className="flex items-start gap-3">
                  <div className="w-20 h-20 rounded-lg border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {subForm.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={subForm.image_url} alt="Preview" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl text-gray-300">{subForm.icon || '🖼️'}</span>
                    )}
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => subImageInputRef.current?.click()}
                      disabled={uploadingImage === 'sub'}
                      className="self-start px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50"
                    >
                      {uploadingImage === 'sub' ? 'Uploading…' : subForm.image_url ? 'Replace image' : 'Upload image'}
                    </button>
                    <input
                      type="text"
                      value={subForm.image_url}
                      onChange={(e) => setSubForm({ ...subForm, image_url: e.target.value })}
                      placeholder="Or paste an image URL"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-[#DB0002]/20 focus:border-[#DB0002]"
                    />
                    {subForm.image_url && (
                      <button
                        type="button"
                        onClick={() => setSubForm({ ...subForm, image_url: '' })}
                        className="self-start text-xs text-red-600 hover:underline"
                      >
                        Remove image
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={subForm.is_active}
                    onChange={(e) => setSubForm({ ...subForm, is_active: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#DB0002]/30 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#DB0002]"></div>
                </label>
                <span className="text-sm font-medium text-gray-700">Active</span>
              </div>
            </div>
            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowSubCategoryModal(false)}
                className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={saveSubCategory}
                disabled={saving || !subForm.name.trim()}
                className="px-6 py-2.5 bg-[#DB0002] text-white rounded-lg hover:bg-[#B80002] transition-colors font-medium disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingSubCategory ? 'Update Sub-Category' : 'Create Sub-Category'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Delete {deleteConfirm.type === 'category' ? 'Category' : 'Sub-Category'}?</h3>
              <p className="text-gray-500 text-sm mb-6">
                This action cannot be undone. {deleteConfirm.type === 'category' ? 'All sub-categories will also be deleted.' : ''}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteConfirm.type === 'category' ? deleteCategory(deleteConfirm.id) : deleteSubCategory(deleteConfirm.id)}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type MerchantTaxonomySubcategory = { id: number; name: string; slug: string; groupName?: string | null };
type MerchantTaxonomyCategory = { id: number; name: string; slug: string; description?: string; subCategories?: MerchantTaxonomySubcategory[] };

function TaxonomyTabs({ active, onMerchant, onProduct }: { active: 'merchant' | 'product'; onMerchant: () => void; onProduct: () => void }) {
  return <div className="inline-flex rounded-xl bg-gray-200 p-1">
    <button onClick={onMerchant} className={`rounded-lg px-5 py-2 text-sm font-bold ${active === 'merchant' ? 'bg-white text-[#DB0002] shadow-sm' : 'text-gray-600'}`}>Merchant Categories</button>
    <button onClick={onProduct} className={`rounded-lg px-5 py-2 text-sm font-bold ${active === 'product' ? 'bg-white text-[#DB0002] shadow-sm' : 'text-gray-600'}`}>Product Categories</button>
  </div>;
}

function MerchantTaxonomyPanel({ onSelectProduct }: { onSelectProduct: () => void }) {
  const [categories, setCategories] = useState<MerchantTaxonomyCategory[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<{ type: 'category' } | { type: 'subcategory'; category: MerchantTaxonomyCategory } | null>(null);
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ categoriesCreated: number; subcategoriesCreated: number; skipped: number; errors: string[] } | null>(null);
  const loadCategories = async () => {
    setError('');
    try {
      const response = await fetch('/api/backend/merchant-categories');
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message || 'Unable to load merchant categories');
      setCategories(Array.isArray(body) ? body : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load merchant categories');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void loadCategories();
  }, []);
  const openModal = (next: { type: 'category' } | { type: 'subcategory'; category: MerchantTaxonomyCategory }) => {
    setName('');
    setDetails('');
    setModal(next);
  };
  const createTaxonomyItem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!modal || !name.trim()) return;
    setSaving(true);
    try {
      const token = getToken();
      const isCategory = modal.type === 'category';
      const endpoint = isCategory ? '/api/backend/merchant-categories' : `/api/backend/merchant-categories/${modal.category.id}/sub-categories`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(isCategory ? { name: name.trim(), description: details.trim() || undefined } : { name: name.trim(), groupName: details.trim() || undefined }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(Array.isArray(body?.message) ? body.message.join(', ') : body?.message || 'Unable to create item');
      if (!isCategory) setExpanded(modal.category.id);
      setModal(null);
      await loadCategories();
      toast.success(isCategory ? 'Merchant category created' : 'Merchant subcategory created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to create item');
    } finally {
      setSaving(false);
    }
  };
  const subcategoryCount = categories.reduce((sum, category) => sum + (category.subCategories?.length || 0), 0);
  const openImport = () => { setImportFile(null); setImportResult(null); setShowImport(true); };
  const downloadTemplate = () => {
    const csv = 'category,categoryDescription,subcategory,groupName\nFood,Food and beverage businesses,Restaurants,Dining\nFood,,Cafes,Dining\nServices,Professional and personal services,Plumbing,Home Services\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'merchant_categories_template.csv'; anchor.click();
    URL.revokeObjectURL(url);
  };
  const importCsv = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const token = getToken();
      const form = new FormData(); form.append('file', importFile);
      const response = await fetch('/api/backend/merchant-categories/import', {
        method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(Array.isArray(body?.message) ? body.message.join(', ') : body?.message || 'Unable to import CSV');
      setImportResult(body);
      await loadCategories();
      const created = body.categoriesCreated + body.subcategoriesCreated;
      if (created) toast.success(`${created} taxonomy item${created === 1 ? '' : 's'} created`);
      else if (!body.errors?.length) toast.success('CSV processed; existing items were skipped');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Unable to import CSV'); }
    finally { setImporting(false); }
  };
  return <div className="space-y-6">
    <TaxonomyTabs active="merchant" onMerchant={() => undefined} onProduct={onSelectProduct} />
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-bold text-gray-900">Merchant Category Management</h1><p className="mt-2 text-gray-600">Business classifications used for merchant onboarding and marketplace discovery. These are separate from product catalogue categories.</p></div><div className="flex flex-wrap gap-2"><button onClick={openImport} className="rounded-lg border border-[#DB0002] bg-white px-5 py-3 font-bold text-[#DB0002] transition hover:bg-red-50"><span className="mr-2">⇧</span>Upload CSV</button><button onClick={() => openModal({ type: 'category' })} className="rounded-lg bg-[#DB0002] px-5 py-3 font-bold text-white shadow-sm transition hover:bg-red-700"><span className="mr-2 text-xl leading-none">+</span>Add Category</button></div></div>
    {loading ? <div className="rounded-xl border bg-white p-12 text-center text-gray-500">Loading merchant categories…</div> : error ? <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700"><p className="font-bold">Merchant taxonomy could not be loaded.</p><p className="mt-1 text-sm">{error}</p><p className="mt-2 text-sm">Apply the latest Prisma migration and restart the backend.</p></div> : <>
      <div className="grid gap-4 md:grid-cols-3"><Stat label="Merchant Categories" value={categories.length} /><Stat label="Merchant Subcategories" value={subcategoryCount} /><Stat label="Taxonomy Source" value="PDF v2" /></div>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"><div className="border-b p-5"><h2 className="text-xl font-bold text-gray-900">All Merchant Categories</h2><p className="text-sm text-gray-500">Click a category to view its onboarding subcategories.</p></div><div className="divide-y">{categories.map(category => <div key={category.id}><div className="flex items-center gap-3 p-5 hover:bg-gray-50"><button onClick={() => setExpanded(current => current === category.id ? null : category.id)} className="flex min-w-0 flex-1 items-center justify-between text-left"><div><p className="font-bold text-gray-900">{category.name}</p><p className="mt-1 text-sm text-gray-500">{category.subCategories?.length || 0} subcategories · {category.slug}</p></div><span className={`mr-3 text-xl text-gray-400 transition-transform ${expanded === category.id ? 'rotate-180' : ''}`}>⌄</span></button><button onClick={() => openModal({ type: 'subcategory', category })} className="shrink-0 rounded-lg border border-[#DB0002] px-4 py-2 text-sm font-bold text-[#DB0002] transition hover:bg-red-50">+ Add Subcategory</button></div>{expanded === category.id && <div className="border-t bg-gray-50 p-5">{category.subCategories?.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{category.subCategories.map(subcategory => <div key={subcategory.id} className="rounded-lg border bg-white p-3"><p className="font-semibold text-gray-900">{subcategory.name}</p>{subcategory.groupName && <p className="mt-1 text-xs font-bold uppercase tracking-wide text-blue-600">{subcategory.groupName}</p>}</div>)}</div> : <p className="text-sm text-gray-500">No subcategories yet. Use Add Subcategory to create the first one.</p>}</div>}</div>)}</div></div>
    </>}
    {modal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={() => !saving && setModal(null)}><form onSubmit={createTaxonomyItem} onMouseDown={event => event.stopPropagation()} className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-gray-900">{modal.type === 'category' ? 'Add Merchant Category' : `Add Subcategory to ${modal.category.name}`}</h2><p className="mt-1 text-sm text-gray-500">This will immediately appear in merchant onboarding dropdowns.</p></div><button type="button" onClick={() => setModal(null)} className="text-2xl text-gray-400 hover:text-gray-700">×</button></div><label className="mt-6 block text-sm font-bold text-gray-700">Name <span className="text-red-600">*</span></label><input autoFocus required value={name} onChange={event => setName(event.target.value)} placeholder={modal.type === 'category' ? 'e.g. Pet Services' : 'e.g. Pet Grooming'} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-[#DB0002] focus:ring-2 focus:ring-red-100" /><label className="mt-4 block text-sm font-bold text-gray-700">{modal.type === 'category' ? 'Description (optional)' : 'Group name (optional)'}</label><input value={details} onChange={event => setDetails(event.target.value)} placeholder={modal.type === 'category' ? 'Briefly describe this business category' : 'Optional grouping label'} className="mt-2 w-full rounded-lg border border-gray-300 px-4 py-3 outline-none focus:border-[#DB0002] focus:ring-2 focus:ring-red-100" /><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={saving} onClick={() => setModal(null)} className="rounded-lg border border-gray-300 px-5 py-2.5 font-bold text-gray-700 hover:bg-gray-50">Cancel</button><button type="submit" disabled={saving || !name.trim()} className="rounded-lg bg-[#DB0002] px-5 py-2.5 font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Creating…' : modal.type === 'category' ? 'Create Category' : 'Create Subcategory'}</button></div></form></div>}
    {showImport && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={() => !importing && setShowImport(false)}><div onMouseDown={event => event.stopPropagation()} className="w-full max-w-xl rounded-xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-xl font-bold text-gray-900">Upload Merchant Categories</h2><p className="mt-1 text-sm text-gray-500">Create categories and subcategories in bulk from a CSV file.</p></div><button type="button" disabled={importing} onClick={() => setShowImport(false)} className="text-2xl text-gray-400 hover:text-gray-700">×</button></div><div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4"><p className="font-bold text-blue-900">CSV format guide</p><p className="mt-1 text-sm text-blue-800"><strong>category</strong> is required. <strong>categoryDescription</strong>, <strong>subcategory</strong>, and <strong>groupName</strong> are optional. Use one category/subcategory pair per row and repeat the category for additional subcategories. Existing names are safely skipped.</p><div className="mt-3 overflow-x-auto rounded border border-blue-200 bg-white p-2 font-mono text-xs text-gray-700">category,categoryDescription,subcategory,groupName<br />Food,Food businesses,Restaurants,Dining<br />Food,,Cafes,Dining</div><button type="button" onClick={downloadTemplate} className="mt-3 text-sm font-bold text-blue-700 underline hover:text-blue-900">Download CSV template</button></div><label className="mt-5 block cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-6 text-center transition hover:border-[#DB0002] hover:bg-red-50/30"><input type="file" accept=".csv,text/csv" className="hidden" onChange={event => { setImportFile(event.target.files?.[0] || null); setImportResult(null); }} /><p className="font-bold text-gray-800">{importFile ? importFile.name : 'Choose a CSV file'}</p><p className="mt-1 text-xs text-gray-500">CSV only, up to 2 MB</p></label>{importResult && <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm"><p className="font-bold text-gray-900">Import complete</p><p className="mt-1 text-gray-700">{importResult.categoriesCreated} categories and {importResult.subcategoriesCreated} subcategories created · {importResult.skipped} existing rows skipped</p>{importResult.errors.length > 0 && <div className="mt-3 max-h-28 overflow-y-auto text-red-700">{importResult.errors.map((message, index) => <p key={index}>{message}</p>)}</div>}</div>}<div className="mt-6 flex justify-end gap-3"><button type="button" disabled={importing} onClick={() => setShowImport(false)} className="rounded-lg border border-gray-300 px-5 py-2.5 font-bold text-gray-700 hover:bg-gray-50">{importResult ? 'Close' : 'Cancel'}</button>{!importResult && <button type="button" onClick={importCsv} disabled={!importFile || importing} className="rounded-lg bg-[#DB0002] px-5 py-2.5 font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">{importing ? 'Uploading…' : 'Upload and Import'}</button>}</div></div></div>}
  </div>;
}

function Stat({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><p className="text-sm text-gray-600">{label}</p><p className="mt-1 text-2xl font-bold text-gray-900">{value}</p></div>; }
