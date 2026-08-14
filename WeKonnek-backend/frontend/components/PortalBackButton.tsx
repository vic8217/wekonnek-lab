'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

interface BackRule {
  /** Matched when the pathname equals this prefix or starts with `${prefix}/`. */
  prefix: string;
  href: string;
  label: string;
}

interface PortalBackConfig {
  /**
   * 'section' navigates to a fixed parent/section page (good for back-office portals).
   * 'history' goes to the actual previous page (good for a storefront where the
   * previous screen is context-dependent).
   */
  mode: 'section' | 'history';
  /** Fallback target when history is empty or the page isn't under a known section. */
  home: { href: string; label: string };
  /** Exact "main" pages (primary nav destinations) that should NOT show a back button. */
  roots: string[];
  /** Explicit overrides matched by longest prefix, e.g. the product flow. */
  overrides?: BackRule[];
}

const CONFIG: Record<string, PortalBackConfig> = {
  '/merchant': {
    mode: 'section',
    home: { href: '/merchant/dashboard', label: 'Back to Dashboard' },
    roots: [
      '/merchant/dashboard',
      '/merchant/analytics',
      '/merchant/orders',
      '/merchant/qr-codes',
      '/merchant/bookings',
      '/merchant/reservations',
      '/merchant/shop',
      '/merchant/branches',
      '/merchant/staff',
      '/merchant/inventory',
      '/merchant/promotions',
      '/merchant/invoices',
      '/merchant/reviews',
      '/merchant/reports',
      '/merchant/notifications',
      '/merchant/profile',
      '/merchant/settings/security',
    ],
    overrides: [
      { prefix: '/merchant/products', href: '/merchant/inventory', label: 'Back to Products' },
    ],
  },
  '/admin': {
    mode: 'section',
    home: { href: '/admin/dashboard', label: 'Back to Dashboard' },
    roots: [
      '/admin/dashboard',
      '/admin/merchants/applications',
      '/admin/merchants/register',
      '/admin/merchants',
      '/admin/subscriptions',
      '/admin/categories',
      '/admin/orders',
      '/admin/zones',
      '/admin/users',
      '/admin/posts/create',
    ],
  },
  '/customer': {
    mode: 'history',
    home: { href: '/customer/dashboard', label: 'Back' },
    roots: [
      '/customer/dashboard',
      '/customer/food',
      '/customer/mart',
      '/customer/express',
      '/customer/reserve',
      '/customer/search',
      '/customer/deals',
      '/customer/map',
      '/customer/cart',
      '/customer/bookings',
      '/customer/orders',
      '/customer/wallet',
      '/customer/profile',
      '/customer/notifications',
      '/customer/categories',
      '/customer/promotions',
      '/customer/reviews',
      '/customer/vouchers',
      '/customer/addresses',
      '/customer/scan',
    ],
  },
};

type Target =
  | { type: 'link'; href: string; label: string }
  | { type: 'back'; label: string; fallbackHref: string };

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

function resolveTarget(pathname: string): Target | null {
  const portalKey = Object.keys(CONFIG).find((key) => isUnder(pathname, key));
  if (!portalKey) return null;

  const config = CONFIG[portalKey];

  // Main/section pages don't need a back button.
  if (config.roots.includes(pathname)) return null;

  if (config.mode === 'history') {
    return { type: 'back', label: 'Back', fallbackHref: config.home.href };
  }

  // Explicit overrides win (longest matching prefix).
  const override = (config.overrides ?? [])
    .filter((rule) => isUnder(pathname, rule.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  if (override) return { type: 'link', href: override.href, label: override.label };

  // Otherwise, go back to the closest section root this page lives under.
  const parentRoot = config.roots
    .filter((root) => pathname.startsWith(root + '/'))
    .sort((a, b) => b.length - a.length)[0];
  if (parentRoot) return { type: 'link', href: parentRoot, label: 'Back' };

  // Fallback: portal home.
  return { type: 'link', href: config.home.href, label: config.home.label };
}

const BUTTON_CLASS =
  'mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 transition-colors hover:text-[#DB0002]';

const CHEVRON = (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);

export default function PortalBackButton() {
  const pathname = usePathname();
  const router = useRouter();
  const target = pathname === '/admin/coordinators' ? null : pathname ? resolveTarget(pathname) : null;

  if (!target) return null;

  if (target.type === 'back') {
    const goBack = () => {
      if (typeof window !== 'undefined' && window.history.length > 1) {
        router.back();
      } else {
        router.push(target.fallbackHref);
      }
    };
    return (
      <button type="button" onClick={goBack} className={BUTTON_CLASS}>
        {CHEVRON}
        {target.label}
      </button>
    );
  }

  return (
    <Link href={target.href} className={BUTTON_CLASS}>
      {CHEVRON}
      {target.label}
    </Link>
  );
}
