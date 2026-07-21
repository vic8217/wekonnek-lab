/**
 * Database row types — mirrors of the PostgreSQL tables (via Prisma).
 *
 * Naming convention: `<TableName>Row` so they're easy to distinguish from
 * API/UI-layer models if those ever diverge.
 */

// ─── Users ────────────────────────────────────────────────
export type UserType = 'customer' | 'merchant' | 'admin' | 'staff';

export interface UserRow {
  id: string; // UUID from auth.users
  email: string;
  first_name: string | null;
  last_name: string | null;
  user_type: UserType;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Categories ───────────────────────────────────────────
export interface CategoryRow {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  image_url: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface SubCategoryRow {
  id: number;
  category_id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  image_url: string | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// ─── Merchants ────────────────────────────────────────────
export type BusinessType = 'storefront' | 'mobile_cart' | 'home_based';
export type MerchantStatus = 'active' | 'suspended' | 'deactivated';
export type SubscriptionTier = 'basic' | 'gold' | 'platinum';
export type SubscriptionPlan = 'weekly' | 'monthly' | 'annual';

export interface MerchantRow {
  id: number;
  user_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  category_id: number | null;
  sub_category_id: number | null;
  business_type: BusinessType;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  country: string;
  logo_url: string | null;
  cover_image_url: string | null;
  is_active: boolean;
  is_verified: boolean;
  status: MerchantStatus;
  subscription_tier: SubscriptionTier;
  subscription_plan: SubscriptionPlan;
  subscription_amount: number;
  payment_method: string | null;
  suspension_reason: string | null;
  suspension_duration: number | null;
  suspended_until: string | null;
  rating: number;
  total_reviews: number;
  tin: string | null;
  is_vat_registered: boolean;
  registered_business_name: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Products ─────────────────────────────────────────────
export interface ProductRow {
  id: number;
  merchant_id: number;
  name: string;
  description: string | null;
  product_code: string | null;
  sku: string | null;
  price: number;
  quantity: number;
  image_url: string | null;
  is_available: boolean;
  category_id: number | null;
  sub_category_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProductCategoryRow {
  id: number;
  product_id: number;
  category_id: number;
  sub_category_id: number | null;
  is_primary: boolean;
  created_at: string;
}

// ─── Orders ───────────────────────────────────────────────
export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'cancelled'
  | 'bill_out';

export type OrderType = 'delivery' | 'pickup' | 'dine_in';

export interface OrderRow {
  id: number;
  order_code: string;
  user_id: string;
  merchant_id: number;
  status: OrderStatus;
  order_type: OrderType | null;
  total_amount: number;
  delivery_address: string | null;
  delivery_fee: number;
  delivery_zone_id: number | null;
  delivery_zone_name: string | null;
  customer_barangay: string | null;
  table_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: number;
  order_id: number;
  product_id: number | null;
  product_name: string;
  quantity: number;
  price: number;
  subtotal: number;
  created_at: string;
}

// ─── Reservations ─────────────────────────────────────────
export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'checked_in'
  | 'cancelled'
  | 'completed';

export interface ReservationRow {
  id: number;
  reservation_code: string;
  user_id: string;
  merchant_id: number;
  reservation_date: string;
  reservation_time: string;
  number_of_guests: number;
  table_number: string | null;
  status: ReservationStatus;
  special_requests: string | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Staff Posts ──────────────────────────────────────────
export interface StaffPostRow {
  id: number;
  merchant_id: number | null;
  title: string;
  description: string | null;
  category_tag: string | null;
  category_id: number | null;
  latitude: number | null;
  longitude: number | null;
  views_count: number;
  expires_at: string | null;
  is_active: boolean;
  document_urls: string[] | null;
  created_at: string;
  updated_at: string;
}

// ─── Merchant Applications ────────────────────────────────
export type ApplicationStatus = 'pending' | 'reviewing' | 'approved' | 'rejected';

export interface MerchantApplicationRow {
  id: number;
  user_id: string;
  business_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  subscription_tier: SubscriptionTier;
  subscription_plan: SubscriptionPlan;
  subscription_amount: number;
  payment_method: string | null;
  payment_proof_url: string | null;
  business_permit_url: string | null;
  dti_permit_url: string | null;
  valid_id_url: string | null;
  establishment_photo_url: string | null;
  authorized_person_photo_url: string | null;
  business_documents_urls: string[] | null;
  status: ApplicationStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}
