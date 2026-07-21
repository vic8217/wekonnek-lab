/**
 * Single source of truth for subscription pricing & features.
 * Mirrors the matrix used on the merchant registration form.
 */

export type SubscriptionTier = 'basic' | 'gold' | 'platinum';
export type SubscriptionPlan = 'weekly' | 'monthly' | 'annual';

export const SUBSCRIPTION_PRICES: Record<
  SubscriptionTier,
  Record<SubscriptionPlan, number>
> = {
  basic: { weekly: 300, monthly: 1000, annual: 10000 },
  gold: { weekly: 500, monthly: 2000, annual: 20000 },
  platinum: { weekly: 1000, monthly: 4000, annual: 40000 },
};

export const SUBSCRIPTION_FEATURES: Record<SubscriptionTier, string[]> = {
  basic: [
    '10 Product listings',
    'Standard support',
    'Basic analytics',
    'Standard placement',
  ],
  gold: [
    '20 Product listings',
    'Priority email support',
    'Promotional badges',
    'Advanced analytics',
    'Featured placement 2x/week',
    'Customer insights',
  ],
  platinum: [
    'Unlimited Product listings',
    '24/7 priority support',
    'Promotional badges',
    'Premium analytics',
    'Daily featured placement',
    'Customer insights',
    'Dedicated account manager',
  ],
};

export const LISTING_LIMITS: Record<SubscriptionTier, number> = {
  basic: 10,
  gold: 20,
  platinum: 1_000_000, // effectively unlimited
};

export function getSubscriptionAmount(
  tier: string,
  plan: string,
): number {
  return (
    SUBSCRIPTION_PRICES[tier as SubscriptionTier]?.[plan as SubscriptionPlan] ?? 0
  );
}

/** Compute the expiry date for a plan starting from `from`. */
export function computeExpiry(plan: string, from: Date = new Date()): Date {
  const d = new Date(from);
  switch (plan) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'annual':
      d.setFullYear(d.getFullYear() + 1);
      break;
    default:
      d.setMonth(d.getMonth() + 1);
  }
  return d;
}

export function getPlansResponse() {
  const tiers: SubscriptionTier[] = ['basic', 'gold', 'platinum'];
  return tiers.map((tier) => ({
    tier,
    prices: SUBSCRIPTION_PRICES[tier],
    features: SUBSCRIPTION_FEATURES[tier],
    listingLimit: LISTING_LIMITS[tier],
  }));
}
