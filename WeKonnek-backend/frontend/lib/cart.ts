/**
 * Cart helper for the customer PWA.
 *
 * Carts are scoped per-merchant and persisted in localStorage under
 * the key `cart_<merchantId>`. A custom `wk:cart-updated` window event
 * is dispatched on every mutation so headers/badges can react in real time.
 */

export interface CartItem {
  product_id: number;
  product_name: string;
  price: number;
  quantity: number;
  image_url?: string;
  merchant_id?: number;
  shop_id?: number;
  variant_id?: number;
  variant_name?: string;
}

const STORAGE_PREFIX = 'cart_';
const CART_EVENT = 'wk:cart-updated';

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function storageKey(merchantId: number | string): string {
  return `${STORAGE_PREFIX}${merchantId}`;
}

function emit(merchantId: number | string): void {
  if (!isBrowser()) return;
  window.dispatchEvent(
    new CustomEvent(CART_EVENT, { detail: { merchantId: String(merchantId) } }),
  );
}

export function getCart(merchantId: number | string): CartItem[] {
  if (!isBrowser()) return [];
  try {
    const raw = localStorage.getItem(storageKey(merchantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function setCart(merchantId: number | string, items: CartItem[]): void {
  if (!isBrowser()) return;
  if (items.length === 0) {
    localStorage.removeItem(storageKey(merchantId));
  } else {
    localStorage.setItem(storageKey(merchantId), JSON.stringify(items));
  }
  emit(merchantId);
}

export function clearCart(merchantId: number | string): void {
  if (!isBrowser()) return;
  localStorage.removeItem(storageKey(merchantId));
  emit(merchantId);
}

/**
 * Add a product to the cart. If the same product already exists, its
 * quantity is incremented by `quantity` (default 1).
 */
export function addToCart(
  merchantId: number | string,
  item: Omit<CartItem, 'quantity'> & { quantity?: number },
): CartItem[] {
  const existing = getCart(merchantId);
  const qty = item.quantity ?? 1;
  const idx = existing.findIndex((c) => c.product_id === item.product_id);
  let next: CartItem[];
  if (idx >= 0) {
    next = [...existing];
    next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
  } else {
    next = [...existing, { ...item, quantity: qty }];
  }
  setCart(merchantId, next);
  return next;
}

export function updateQuantity(
  merchantId: number | string,
  productId: number,
  quantity: number,
): CartItem[] {
  const existing = getCart(merchantId);
  const next = existing
    .map((c) =>
      c.product_id === productId ? { ...c, quantity: Math.max(0, quantity) } : c,
    )
    .filter((c) => c.quantity > 0);
  setCart(merchantId, next);
  return next;
}

export function removeFromCart(
  merchantId: number | string,
  productId: number,
): CartItem[] {
  return updateQuantity(merchantId, productId, 0);
}

export function getCartCount(merchantId: number | string): number {
  return getCart(merchantId).reduce((sum, c) => sum + c.quantity, 0);
}

/**
 * Find all merchants the user currently has items for.
 * Returns the merchant IDs (as strings, since they come from storage keys).
 */
export function getActiveCartMerchantIds(): string[] {
  if (!isBrowser()) return [];
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const id = key.slice(STORAGE_PREFIX.length);
    if (!id) continue;
    const items = getCart(id);
    if (items.length > 0) ids.push(id);
  }
  return ids;
}

export function getTotalCartCount(): number {
  return getActiveCartMerchantIds().reduce(
    (sum, id) => sum + getCartCount(id),
    0,
  );
}

/**
 * Subscribe to cart updates. Returns an unsubscribe function.
 * Listens both to the in-tab custom event and cross-tab `storage` events.
 */
export function onCartChange(handler: () => void): () => void {
  if (!isBrowser()) return () => {};
  const local = () => handler();
  const cross = (e: StorageEvent) => {
    if (e.key && e.key.startsWith(STORAGE_PREFIX)) handler();
  };
  window.addEventListener(CART_EVENT, local);
  window.addEventListener('storage', cross);
  return () => {
    window.removeEventListener(CART_EVENT, local);
    window.removeEventListener('storage', cross);
  };
}
