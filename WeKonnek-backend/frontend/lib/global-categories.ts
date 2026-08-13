import type { Category } from "@/lib/api";

export type GlobalCategory = Category & {
  imageUrl?: string | null;
  ownerMerchantId?: number | null;
};

export async function fetchGlobalCategories(
  signal?: AbortSignal,
): Promise<GlobalCategory[]> {
  const response = await fetch("/api/categories", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Failed to load categories");

  const data: unknown = await response.json();
  if (!Array.isArray(data)) return [];

  return (data as GlobalCategory[])
    .filter(
      (category) =>
        category.ownerMerchantId === null && category.isActive === true,
    )
    .sort(
      (a, b) =>
        a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
    );
}
