import type { MerchantCategory } from "@/lib/api";

/**
 * Marketplace discovery categories managed by Admin > Merchant Categories.
 * Product/menu categories use a separate taxonomy and must not be displayed
 * as top-level customer discovery categories.
 */
export async function fetchCustomerCategories(
  signal?: AbortSignal,
): Promise<MerchantCategory[]> {
  const response = await fetch("/api/backend/merchant-categories", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Failed to load customer categories");

  const data: unknown = await response.json();
  if (!Array.isArray(data)) return [];

  return (data as MerchantCategory[])
    .filter((category) => category.isActive === true)
    .sort(
      (a, b) =>
        a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
    );
}
