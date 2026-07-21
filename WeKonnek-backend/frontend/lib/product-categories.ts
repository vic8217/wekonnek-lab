import { getToken } from '@/hooks/use-auth';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export interface ProductCategoryAssignment {
  categoryId: number;
  subCategoryId?: number | null;
  isPrimary?: boolean;
}

export async function fetchProductCategories(
  productId: number,
): Promise<ProductCategoryAssignment[]> {
  try {
    const token = getToken();
    const res = await fetch(`${API}/api/products/${productId}/categories`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return [];
    const data = await res.json();
    const rows = Array.isArray(data) ? data : data.data || [];
    return rows.map((row: any) => ({
      categoryId: row.category_id ?? row.categoryId,
      subCategoryId: row.sub_category_id ?? row.subCategoryId ?? null,
      isPrimary: !!(row.is_primary ?? row.isPrimary),
    }));
  } catch (error) {
    console.error('Failed to fetch product categories:', error);
    return [];
  }
}

export async function syncProductCategories(
  productId: number,
  assignments: ProductCategoryAssignment[],
): Promise<void> {
  try {
    const token = getToken();
    const res = await fetch(`${API}/api/products/${productId}/categories`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ assignments }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to sync product categories');
    }
  } catch (err) {
    console.error('Failed to sync product_categories:', err);
  }
}
