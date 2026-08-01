import axios from 'axios';

const API_BASE_URL = typeof window !== 'undefined'
  ? '/api'
  : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api');

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 10000, // 10 second timeout
});

// Attach the JWT (when present) so authenticated proxy routes can forward it.
apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = window.location.pathname.startsWith('/merchant')
      ? sessionStorage.getItem('wk_merchant_token')
      : localStorage.getItem('wk_token');
    if (token) {
      config.headers = config.headers || {};
      (config.headers as any).Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Types
export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  isActive: boolean;
  displayOrder: number;
  subCategories?: SubCategory[];
  createdAt: string;
  updatedAt: string;
}

export interface SubCategory {
  id: number;
  categoryId: number;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  isActive: boolean;
  displayOrder: number;
  category?: Category;
  createdAt: string;
  updatedAt: string;
}

export interface Merchant {
  id: number;
  name: string;
  slug: string;
  description?: string;
  categoryId?: number;
  subCategoryId?: number;
  businessType: 'storefront' | 'mobile_cart' | 'home_based';
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  city?: string;
  state?: string;
  zipCode?: string;
  country: string;
  logoUrl?: string;
  coverImageUrl?: string;
  isActive: boolean;
  isVerified: boolean;
  rating: number;
  totalReviews: number;
  tin?: string;
  isVatRegistered?: boolean;
  is_vat_registered?: boolean;
  registeredBusinessName?: string;
  registered_business_name?: string;
  category?: Category;
  subCategory?: SubCategory;
  createdAt: string;
  updatedAt: string;
}

export interface SearchMerchantsParams {
  search?: string;
  categoryId?: number;
  subCategoryId?: number;
  city?: string;
  latitude?: number;
  longitude?: number;
  radius?: number;
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// API Functions
export const categoriesApi = {
  getAll: async (includeInactive = false): Promise<Category[]> => {
    const response = await apiClient.get('/categories', {
      params: { includeInactive },
    });
    return response.data;
  },
  getById: async (id: number): Promise<Category> => {
    const response = await apiClient.get(`/categories/${id}`);
    return response.data;
  },
  getBySlug: async (slug: string): Promise<Category> => {
    const response = await apiClient.get(`/categories/slug/${slug}`);
    return response.data;
  },
};

export const subCategoriesApi = {
  getAll: async (includeInactive = false): Promise<SubCategory[]> => {
    const response = await apiClient.get('/sub-categories', {
      params: { includeInactive },
    });
    return response.data;
  },
  getByCategory: async (
    categoryId: number,
    includeInactive = false,
  ): Promise<SubCategory[]> => {
    const response = await apiClient.get(`/sub-categories/category/${categoryId}`, {
      params: { includeInactive },
    });
    return response.data;
  },
  getById: async (id: number): Promise<SubCategory> => {
    const response = await apiClient.get(`/sub-categories/${id}`);
    return response.data;
  },
};

export interface CreateMerchantData {
  name: string;
  slug: string;
  description?: string;
  categoryId?: number;
  subCategoryId?: number;
  businessType: 'storefront' | 'mobile_cart' | 'home_based';
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  isActive?: boolean;
  isVerified?: boolean;
}

export const merchantsApi = {
  getAll: async (): Promise<Merchant[]> => {
    const response = await apiClient.get('/merchants');
    return response.data;
  },
  search: async (params: SearchMerchantsParams): Promise<PaginatedResponse<Merchant>> => {
    const response = await apiClient.get('/merchants/search', { params });
    return response.data;
  },
  getById: async (id: number): Promise<Merchant> => {
    const response = await apiClient.get(`/merchants/${id}`);
    return response.data;
  },
  getBySlug: async (slug: string): Promise<Merchant> => {
    const response = await apiClient.get(`/merchants/slug/${slug}`);
    return response.data;
  },
  create: async (data: CreateMerchantData): Promise<Merchant> => {
    const response = await apiClient.post('/merchants', data);
    return response.data;
  },
};

// Products API
export interface Product {
  id: number;
  merchantId: number;
  name: string;
  description?: string;
  productCode: string;
  sku?: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  isAvailable: boolean;
  lowStockThreshold?: number;
  categoryId?: number;
  subCategoryId?: number;
  category?: Category;
  subCategory?: SubCategory;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductData {
  name: string;
  description?: string;
  productCode: string;
  sku?: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  isAvailable?: boolean;
  categoryId: number;
  subCategoryId?: number;
}

export const productsApi = {
  getAll: async (): Promise<Product[]> => {
    const response = await apiClient.get('/products');
    return response.data;
  },
  getById: async (id: number): Promise<Product> => {
    const response = await apiClient.get(`/products/${id}`);
    return response.data;
  },
  create: async (data: CreateProductData): Promise<Product> => {
    const response = await apiClient.post('/products', data);
    return response.data;
  },
  update: async (id: number, data: Partial<CreateProductData>): Promise<Product> => {
    const response = await apiClient.patch(`/products/${id}`, data);
    return response.data;
  },
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/products/${id}`);
  },
};

// Staff Posts API
export interface StaffPost {
  id: number;
  merchantId?: number | null;
  merchant?: Merchant | null;
  title: string;
  description?: string;
  categoryTag?: string;
  categoryId?: number | null;
  category?: Category | null;
  latitude?: number | null;
  longitude?: number | null;
  viewsCount: number;
  expiresAt?: string | null;
  isActive: boolean;
  documentUrls?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateStaffPostData {
  title: string;
  description?: string;
  categoryTag?: string;
  categoryId?: number;
  merchantId?: number;
  latitude?: number;
  longitude?: number;
  expiresAt?: string;
  isActive?: boolean;
  documentUrls?: string[];
}

export const staffPostsApi = {
  getAll: async (): Promise<StaffPost[]> => {
    const response = await apiClient.get('/staff-posts?type=all');
    return response.data;
  },
  getActive: async (): Promise<StaffPost[]> => {
    const response = await apiClient.get('/staff-posts?type=active');
    return response.data;
  },
  getExpired: async (): Promise<StaffPost[]> => {
    const response = await apiClient.get('/staff-posts?type=expired');
    return response.data;
  },
  getStats: async (): Promise<{ activePosts: number; expiredPosts: number; totalViews: number }> => {
    const response = await apiClient.get('/staff-posts?type=stats');
    return response.data;
  },
  getById: async (id: number): Promise<StaffPost> => {
    const response = await apiClient.get(`/staff-posts/${id}`);
    return response.data;
  },
  create: async (data: CreateStaffPostData): Promise<StaffPost> => {
    const response = await apiClient.post('/staff-posts', data);
    return response.data;
  },
  update: async (id: number, data: Partial<CreateStaffPostData>): Promise<StaffPost> => {
    const response = await apiClient.patch(`/staff-posts/${id}`, data);
    return response.data;
  },
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/staff-posts/${id}`);
  },
};

// File Upload API
export const uploadApi = {
  uploadFile: async (file: File, type: 'establishment' | 'authorized-person' | 'document'): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);
    
    const response = await axios.post(`${API_BASE_URL}/upload`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data.url;
  },
  uploadMultipleFiles: async (files: File[], type: 'document'): Promise<string[]> => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });
    formData.append('type', type);
    
    const response = await axios.post(`${API_BASE_URL}/upload/multiple`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data.urls;
  },
};

export default apiClient;
