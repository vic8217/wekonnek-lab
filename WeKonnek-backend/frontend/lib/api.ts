import axios from "axios";

const API_ORIGIN =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const API_BASE_URL =
  typeof window !== "undefined"
    ? "/api"
    : `${API_ORIGIN.replace(/\/$/, "")}/api`;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  // Development route compilation can briefly exceed ten seconds. Keep a
  // finite timeout without treating normal cold compilation as an API fault.
  timeout: 30000,
});

// Attach the JWT (when present) so authenticated proxy routes can forward it.
apiClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = window.location.pathname.startsWith("/merchant")
      ? sessionStorage.getItem("wk_merchant_token")
      : window.location.pathname.startsWith("/shop")
        ? sessionStorage.getItem("wk_shop_token")
        : localStorage.getItem("wk_token");
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

export interface MerchantSubCategory {
  id: number;
  categoryId: number;
  name: string;
  slug: string;
  groupName?: string;
  isActive: boolean;
  displayOrder: number;
}

export interface MerchantCategory {
  id: number;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  isActive: boolean;
  displayOrder: number;
  subCategories?: MerchantSubCategory[];
}

export interface Merchant {
  id: number;
  name: string;
  slug: string;
  description?: string;
  categoryId?: number;
  subCategoryId?: number;
  businessType: "storefront" | "mobile_cart" | "home_based";
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
  subscriptionTier?: string;
  subscriptionPlan?: string;
  subscriptionStatus?: string;
  subscriptionExpiresAt?: string | null;
  rating: number;
  totalReviews: number;
  tin?: string;
  isVatRegistered?: boolean;
  is_vat_registered?: boolean;
  registeredBusinessName?: string;
  registered_business_name?: string;
  category?: MerchantCategory;
  subCategory?: MerchantSubCategory;
  branches?: Array<{
    id: number;
    name: string;
    address?: string | null;
    city?: string | null;
    isDefault: boolean;
    is_open?: boolean;
    schedule_is_open?: boolean;
    operation_source?: "schedule" | "manual";
    operatingHours?: Record<string, unknown> | null;
  }>;
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
  getMine: async (): Promise<Category[]> => {
    const response = await apiClient.get("/categories/merchant/mine");
    return response.data;
  },
  createMine: async (name: string): Promise<Category> => {
    const response = await apiClient.post("/categories/merchant/mine", {
      name,
    });
    return response.data;
  },
  getAll: async (includeInactive = false): Promise<Category[]> => {
    const response = await apiClient.get("/categories", {
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
  getMineByCategory: async (categoryId: number): Promise<SubCategory[]> => {
    const response = await apiClient.get(
      `/sub-categories/merchant/category/${categoryId}`,
    );
    return response.data;
  },
  createMine: async (
    categoryId: number,
    name: string,
  ): Promise<SubCategory> => {
    const response = await apiClient.post("/sub-categories/merchant/mine", {
      categoryId,
      name,
    });
    return response.data;
  },
  getAll: async (includeInactive = false): Promise<SubCategory[]> => {
    const response = await apiClient.get("/sub-categories", {
      params: { includeInactive },
    });
    return response.data;
  },
  getByCategory: async (
    categoryId: number,
    includeInactive = false,
  ): Promise<SubCategory[]> => {
    const response = await apiClient.get(
      `/sub-categories/category/${categoryId}`,
      {
        params: { includeInactive },
      },
    );
    return response.data;
  },
  getById: async (id: number): Promise<SubCategory> => {
    const response = await apiClient.get(`/sub-categories/${id}`);
    return response.data;
  },
};

export const merchantCategoriesApi = {
  getAll: async (): Promise<MerchantCategory[]> => {
    const response = await apiClient.get("/backend/merchant-categories");
    return response.data;
  },
  getSubCategories: async (
    categoryId: number,
  ): Promise<MerchantSubCategory[]> => {
    const response = await apiClient.get(
      `/backend/merchant-categories/${categoryId}/sub-categories`,
    );
    return response.data;
  },
  getBySlug: async (slug: string): Promise<MerchantCategory> => {
    const response = await apiClient.get(
      `/backend/merchant-categories/slug/${slug}`,
    );
    return response.data;
  },
};

export interface CreateMerchantData {
  name: string;
  slug: string;
  description?: string;
  categoryId?: number;
  subCategoryId?: number;
  businessType: "storefront" | "mobile_cart" | "home_based";
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
  getAll: async (signal?: AbortSignal): Promise<Merchant[]> => {
    const response = await apiClient.get("/backend/merchants", { signal });
    return response.data;
  },
  search: async (
    params: SearchMerchantsParams,
    signal?: AbortSignal,
  ): Promise<PaginatedResponse<Merchant>> => {
    const response = await apiClient.get("/backend/merchants/search", {
      params,
      signal,
    });
    return response.data;
  },
  getById: async (id: number): Promise<Merchant> => {
    const response = await apiClient.get(`/backend/merchants/${id}`);
    return response.data;
  },
  getBySlug: async (slug: string): Promise<Merchant> => {
    const response = await apiClient.get(`/backend/merchants/slug/${slug}`);
    return response.data;
  },
  create: async (data: CreateMerchantData): Promise<Merchant> => {
    const response = await apiClient.post("/backend/merchants", data);
    return response.data;
  },
};

// Products API
export interface Product {
  id: number;
  merchantId: number;
  name: string;
  description?: string;
  notes?: Array<{ title: string; text?: string; iconUrl?: string }>;
  productCode?: string;
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
  productType?: string;
  brand?: string;
  unit?: string;
  baseSku?: string;
  barcode?: string;
  costPrice?: number;
  sellingPrice?: number;
  discountPrice?: number;
  hasVariants?: boolean;
  trackInventory?: boolean;
  availabilityStatus?: "Available" | "Unavailable" | "Draft" | "Archived";
  menuBadge?: "BESTSELLER" | "NEW" | "PROMO" | "FEATURED" | null;
  menuFeatured?: boolean;
  menuCategory?: string;
  menuDisplayOrder?: number;
  options?: Array<{
    id: number;
    name: string;
    values: Array<{ id: number; value: string }>;
  }>;
  variants?: Array<{
    id: number;
    sku: string;
    barcode?: string;
    price?: number;
    imageUrl?: string;
    isActive: boolean;
    availabilityStatus?:
      "Available" | "Out of Stock" | "Temporarily Unavailable";
    optionValues?: Array<{
      optionValue: { value: string; option: { name: string } };
    }>;
  }>;
}

export interface CreateProductData {
  name: string;
  productType?: string;
  description?: string;
  notes?: Array<{ title: string; text?: string; iconUrl?: string }>;
  brand?: string;
  unit: string;
  baseSku?: string;
  barcode?: string;
  sellingPrice: number;
  costPrice?: number;
  discountPrice?: number;
  imageUrl?: string;
  hasVariants: boolean;
  trackInventory: boolean;
  availabilityStatus: string;
  categoryId?: number;
  subCategoryId?: number;
  options?: Array<{ name: string; values: string[] }>;
  variants?: Array<{
    sku: string;
    barcode?: string;
    price?: number;
    imageUrl?: string;
    isActive?: boolean;
    optionValues?: Record<string, string>;
  }>;
}

export const productsApi = {
  getAll: async (): Promise<Product[]> => {
    const response = await apiClient.get("/products");
    return response.data;
  },
  getById: async (id: number): Promise<Product> => {
    const response = await apiClient.get(`/products/${id}`);
    return response.data;
  },
  getByMerchant: async (merchantId: number): Promise<Product[]> =>
    (
      await apiClient.get("/products", {
        params: { merchantId, available: true },
      })
    ).data,
  getForShop: async (merchantId: number, shopId: number): Promise<Product[]> =>
    (await apiClient.get("/products", { params: { merchantId, shopId } })).data,
  create: async (data: CreateProductData): Promise<Product> => {
    const response = await apiClient.post("/products", data);
    return response.data;
  },
  update: async (
    id: number,
    data: Partial<CreateProductData>,
  ): Promise<Product> => {
    const response = await apiClient.patch(`/products/${id}`, data);
    return response.data;
  },
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/products/${id}`);
  },
};

export interface ShopInventoryBalance {
  id: number;
  productId: number;
  variantId?: number | null;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  reorderLevel: number;
  stockStatus: "In Stock" | "Low Stock" | "Out of Stock";
}

export interface ShopProductAssignment {
  id: number;
  productId: number;
  isEnabled: boolean;
  priceOverride?: number | null;
  effectivePrice: number;
  product: Product;
  inventory: ShopInventoryBalance[];
}

export interface DigitalMenuItem {
  id: number;
  productId: number;
  isEnabled: boolean;
  isOnMenu: boolean;
  menuVisible: boolean;
  menuDescription?: string | null;
  menuBadge?: "BESTSELLER" | "NEW" | "PROMO" | "FEATURED" | null;
  menuFeatured: boolean;
  menuCategory?: string | null;
  menuDisplayOrder: number;
  menuCategoryOrder: number;
  effectivePrice: number;
  availableQuantity?: number | null;
  soldOut: boolean;
  updatedAt: string;
  product: Product;
}
export interface DigitalMenuData {
  merchant: { name: string; slug: string };
  shop: { id: number; name: string; isDefault: boolean };
  items: DigitalMenuItem[];
}

export interface MerchantInventoryRow {
  id: number;
  shopId: number;
  productId: number;
  variantId?: number | null;
  productName: string;
  variantName: string;
  sku?: string;
  unit?: string;
  categoryName?: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  reorderLevel: number;
  stockStatus: "In Stock" | "Low Stock" | "Out of Stock";
  unitCost: number;
  inventoryValue: number;
}
export interface MerchantInventorySummary {
  totals: {
    shops: number;
    items: number;
    quantity: number;
    reserved: number;
    available: number;
    inventoryValue: number;
    lowStockItems: number;
    outOfStockItems: number;
    shopsNeedingRestock: number;
  };
  shops: Array<{
    id: number;
    name: string;
    shopId?: string;
    isActive: boolean;
    isDefault: boolean;
    itemCount: number;
    totalQuantity: number;
    inventoryValue: number;
    lowStockCount: number;
    outOfStockCount: number;
    inventory: MerchantInventoryRow[];
  }>;
}

export const inventoryApi = {
  getMerchantSummary: async (): Promise<MerchantInventorySummary> =>
    (await apiClient.get("/backend/inventory/summary")).data,
  getShopInventory: async (): Promise<ShopProductAssignment[]> =>
    (await apiClient.get("/backend/inventory")).data,
  getShopProducts: async (
    shopId?: number,
  ): Promise<
    Array<{
      product: Product;
      assignment: Omit<
        ShopProductAssignment,
        "product" | "inventory" | "effectivePrice"
      > | null;
    }>
  > =>
    (
      await apiClient.get("/backend/inventory/products", {
        params: shopId ? { shopId } : undefined,
      })
    ).data,
  assignProduct: async (
    productId: number,
    data: { isEnabled: boolean; priceOverride?: number | null },
  ) =>
    (await apiClient.patch(`/backend/inventory/products/${productId}`, data))
      .data,
  getDigitalMenu: async (): Promise<DigitalMenuData> =>
    (await apiClient.get("/backend/inventory/digital-menu")).data,
  updateDigitalMenuItem: async (
    productId: number,
    data: Partial<
      Pick<
        DigitalMenuItem,
        | "isOnMenu"
        | "menuVisible"
        | "menuDescription"
        | "menuBadge"
        | "menuFeatured"
        | "menuCategory"
        | "menuDisplayOrder"
        | "menuCategoryOrder"
      >
    >,
  ) =>
    (
      await apiClient.patch(
        `/backend/inventory/digital-menu/items/${productId}`,
        data,
      )
    ).data,
  reorderDigitalMenu: async (
    items: Array<{
      productId: number;
      menuCategory: string;
      menuCategoryOrder: number;
      menuDisplayOrder: number;
    }>,
  ) =>
    (
      await apiClient.patch("/backend/inventory/digital-menu/reorder", {
        items,
      })
    ).data,
  setReorderLevel: async (data: {
    productId: number;
    variantId?: number | null;
    reorderLevel: number;
  }) => (await apiClient.patch("/backend/inventory/reorder-level", data)).data,
  recordMovement: async (data: {
    productId: number;
    variantId?: number | null;
    type: "receipt" | "sale" | "return" | "adjustment";
    quantity: number;
    reference?: string;
    referenceType?: string;
    deliveryDate?: string;
    deliveredBy?: string;
    receivedAt?: string;
    reason?: string;
    notes?: string;
  }) => (await apiClient.post("/backend/inventory/movements", data)).data,
  getMovements: async (productId?: number): Promise<any[]> =>
    (
      await apiClient.get("/backend/inventory/movements", {
        params: { productId },
      })
    ).data,
  transfer: async (data: {
    destinationShopId: number;
    productId: number;
    variantId?: number | null;
    quantity: number;
    reference?: string;
    notes?: string;
  }) => (await apiClient.post("/backend/inventory/transfers", data)).data,
  getTransferDestinations: async (): Promise<
    Array<{ id: number; name: string; city?: string | null }>
  > => (await apiClient.get("/backend/inventory/transfer-destinations")).data,
  closeInventoryDay: async (data: {
    productId: number;
    variantId?: number | null;
    businessDate: string;
    endingBalance: number;
    notes?: string;
  }) => (await apiClient.post("/backend/inventory/daily-counts", data)).data,
  getDailyCounts: async (): Promise<any[]> =>
    (await apiClient.get("/backend/inventory/daily-counts")).data,
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
    const response = await apiClient.get("/staff-posts?type=all");
    return response.data;
  },
  getActive: async (): Promise<StaffPost[]> => {
    const response = await apiClient.get("/staff-posts?type=active");
    return response.data;
  },
  getExpired: async (): Promise<StaffPost[]> => {
    const response = await apiClient.get("/staff-posts?type=expired");
    return response.data;
  },
  getStats: async (): Promise<{
    activePosts: number;
    expiredPosts: number;
    totalViews: number;
  }> => {
    const response = await apiClient.get("/staff-posts?type=stats");
    return response.data;
  },
  getById: async (id: number): Promise<StaffPost> => {
    const response = await apiClient.get(`/staff-posts/${id}`);
    return response.data;
  },
  create: async (data: CreateStaffPostData): Promise<StaffPost> => {
    const response = await apiClient.post("/staff-posts", data);
    return response.data;
  },
  update: async (
    id: number,
    data: Partial<CreateStaffPostData>,
  ): Promise<StaffPost> => {
    const response = await apiClient.patch(`/staff-posts/${id}`, data);
    return response.data;
  },
  delete: async (id: number): Promise<void> => {
    await apiClient.delete(`/staff-posts/${id}`);
  },
};

// File Upload API
export const uploadApi = {
  uploadFile: async (
    file: File,
    type: "establishment" | "authorized-person" | "document" | "review",
  ): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);

    const uploadUrl =
      typeof window !== "undefined"
        ? "/api/backend/upload"
        : `${API_BASE_URL}/upload`;
    const response = await axios.post(uploadUrl, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    return response.data.url;
  },
  uploadMultipleFiles: async (
    files: File[],
    type: "document",
  ): Promise<string[]> => {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append("files", file);
    });
    formData.append("type", type);

    const uploadUrl =
      typeof window !== "undefined"
        ? "/api/backend/upload/multiple"
        : `${API_BASE_URL}/upload/multiple`;
    const response = await axios.post(uploadUrl, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    return response.data.urls;
  },
};

export default apiClient;
