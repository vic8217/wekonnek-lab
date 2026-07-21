import type { OrderStatus, ReservationStatus } from '@/types';

// ─── Order status metadata ────────────────────────────────
export interface StatusMeta {
  label: string;
  icon: string;
  /** Tailwind pill classes: background + text color */
  pill: string;
}

export const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  pending: { label: 'Pending', icon: '⏳', pill: 'bg-amber-100 text-amber-700' },
  processing: { label: 'Confirmed', icon: '✅', pill: 'bg-blue-100 text-blue-700' },
  preparing: { label: 'Preparing', icon: '👨‍🍳', pill: 'bg-blue-100 text-blue-700' },
  ready: { label: 'Ready', icon: '🛍️', pill: 'bg-green-100 text-green-700' },
  out_for_delivery: { label: 'Out for Delivery', icon: '🚚', pill: 'bg-indigo-100 text-indigo-700' },
  bill_out: { label: 'Bill Out', icon: '💳', pill: 'bg-purple-100 text-purple-700' },
  completed: { label: 'Completed', icon: '🎉', pill: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Cancelled', icon: '❌', pill: 'bg-red-100 text-red-700' },
};

export const RESERVATION_STATUS_META: Record<ReservationStatus, StatusMeta> = {
  pending: { label: 'Pending', icon: '⏳', pill: 'bg-amber-100 text-amber-700' },
  confirmed: { label: 'Confirmed', icon: '✅', pill: 'bg-blue-100 text-blue-700' },
  checked_in: { label: 'Checked In', icon: '📍', pill: 'bg-green-100 text-green-700' },
  completed: { label: 'Completed', icon: '🎉', pill: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Cancelled', icon: '❌', pill: 'bg-red-100 text-red-700' },
};

/** Order statuses that are considered "active" (still in progress). */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'processing',
  'preparing',
  'ready',
  'out_for_delivery',
  'bill_out',
];

/** Terminal statuses — no further transitions allowed. */
export const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  'completed',
  'cancelled',
];

// ─── Merchant order action transitions ────────────────────
export interface StatusAction {
  value: OrderStatus;
  label: string;
  tone: 'primary' | 'success' | 'danger' | 'neutral';
}

export const ORDER_TRANSITIONS: Record<string, StatusAction[]> = {
  pending: [
    { value: 'processing', label: 'Accept', tone: 'success' },
    { value: 'cancelled', label: 'Reject', tone: 'danger' },
  ],
  processing: [
    { value: 'preparing', label: 'Mark Preparing', tone: 'primary' },
    { value: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  preparing: [
    { value: 'ready', label: 'Mark Ready', tone: 'success' },
    { value: 'cancelled', label: 'Cancel', tone: 'danger' },
  ],
  ready: [
    { value: 'out_for_delivery', label: 'Out for Delivery', tone: 'primary' },
    { value: 'completed', label: 'Complete', tone: 'success' },
  ],
  out_for_delivery: [
    { value: 'completed', label: 'Mark Delivered', tone: 'success' },
  ],
  bill_out: [
    { value: 'completed', label: 'Complete', tone: 'success' },
  ],
  completed: [],
  cancelled: [],
};

// ─── Delivery flow (for timelines) ───────────────────────
export const DELIVERY_STATUS_FLOW: OrderStatus[] = [
  'pending', 'processing', 'preparing', 'ready', 'out_for_delivery', 'completed',
];

export const PICKUP_STATUS_FLOW: OrderStatus[] = [
  'pending', 'processing', 'preparing', 'ready', 'completed',
];

export const DINE_IN_STATUS_FLOW: OrderStatus[] = [
  'pending', 'processing', 'preparing', 'ready', 'bill_out', 'completed',
];

// ─── Route paths ──────────────────────────────────────────
export const ROUTES = {
  home: '/',
  login: '/auth/login',
  register: '/auth/login',

  // Customer
  customerDashboard: '/customer/dashboard',
  customerOrders: '/customer/orders',
  customerOrderDetail: (id: number | string) => `/customer/orders/${id}`,
  customerCategories: '/customer/categories',
  customerCheckout: '/customer/checkout',
  customerNotifications: '/customer/notifications',

  // Merchant
  merchantDashboard: '/merchant/dashboard',
  merchantOrders: '/merchant/orders',
  merchantInventory: '/merchant/inventory',
  merchantNewProduct: '/merchant/products/new',
  merchantEditProduct: (id: number | string) => `/merchant/products/${id}/edit`,
  merchantProfile: '/merchant/profile',

  // Admin
  adminDashboard: '/admin/dashboard',
  adminOrders: '/admin/orders',
  adminCategories: '/admin/categories',
  adminMerchants: '/admin/merchants',
  adminRiders: '/admin/riders',
  adminUsers: '/admin/users',

  // Public
  merchantDetail: (slug: string) => `/merchants/${slug}`,
  categoryDetail: (slug: string) => `/customer/categories/${slug}`,
} as const;

// ─── Config / magic numbers ───────────────────────────────
export const APP_NAME = 'WeKonnek';
export const BRAND_COLOR = '#DB0002';
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
export const DEFAULT_PAGE_SIZE = 15;
export const CATEGORY_IMAGES_PATH = 'category-images';
