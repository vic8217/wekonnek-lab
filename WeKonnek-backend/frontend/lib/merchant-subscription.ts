export type MerchantSubscription = {
  tier: string;
  plan?: string;
  active: boolean;
};

const TIER_FEATURES: Record<string, string[]> = {
  basic: ["merchant-profile"],
  silver: [
    "merchant-profile",
    "product-photos",
    "discount-vouchers",
    "online-ordering",
  ],
  gold: [
    "merchant-profile",
    "product-photos",
    "discount-vouchers",
    "online-ordering",
    "push-notifications",
    "loyalty",
  ],
  platinum: [
    "merchant-profile",
    "product-photos",
    "discount-vouchers",
    "online-ordering",
    "push-notifications",
    "loyalty",
    "digital-menu",
    "qr-ordering",
    "reservations",
    "bill-out",
  ],
};

export function merchantSubscriptionFromProfile(
  profile: Record<string, unknown>,
): MerchantSubscription {
  const tier = String(
    profile.subscription_tier ?? profile.subscriptionTier ?? "basic",
  ).toLowerCase();
  const plan = String(
    profile.subscription_plan ?? profile.subscriptionPlan ?? "",
  ).toLowerCase();
  const status = String(
    profile.subscription_status ?? profile.subscriptionStatus ?? "inactive",
  ).toLowerCase();
  const expiresValue =
    profile.subscription_expires_at ?? profile.subscriptionExpiresAt;
  const expiresAt = expiresValue ? new Date(String(expiresValue)) : null;
  const hasExpired = Boolean(
    expiresAt &&
    !Number.isNaN(expiresAt.getTime()) &&
    expiresAt.getTime() <= Date.now(),
  );
  // Daily coverage is represented by the active status after the daily wallet
  // charge; a legacy fixed-plan expiry must not disable that coverage.
  return {
    tier,
    plan,
    active: status === "active" && (plan === "daily" || !hasExpired),
  };
}

export const hasPlatinumAccess = (subscription: MerchantSubscription) =>
  subscription.active && subscription.tier === "platinum";

export const hasMerchantFeature = (
  subscription: MerchantSubscription,
  feature: string,
) =>
  subscription.active &&
  (TIER_FEATURES[subscription.tier] || []).includes(feature);
