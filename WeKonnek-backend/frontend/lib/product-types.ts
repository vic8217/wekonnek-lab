export const ALL_PRODUCT_TYPES = ['Food', 'Beverage', 'Retail Product', 'Service', 'Digital Product', 'Package / Bundle'] as const;

const TYPES_BY_CATEGORY: Record<string, readonly string[]> = {
  'food-beverages': ['Food', 'Beverage', 'Service', 'Package / Bundle'],
  food: ['Food', 'Beverage', 'Service', 'Package / Bundle'],
  restaurants: ['Food', 'Beverage', 'Service', 'Package / Bundle'],
  groceries: ['Food', 'Beverage', 'Retail Product', 'Package / Bundle'],
  services: ['Service', 'Retail Product', 'Digital Product', 'Package / Bundle'],
  'retail-shopping': ['Retail Product', 'Service', 'Digital Product', 'Package / Bundle'],
  shops: ['Retail Product', 'Service', 'Digital Product', 'Package / Bundle'],
  'health-wellness': ['Retail Product', 'Service', 'Food', 'Beverage', 'Package / Bundle'],
  pharmacy: ['Retail Product', 'Service', 'Package / Bundle'],
  wellness: ['Retail Product', 'Service', 'Package / Bundle'],
  deals: ['Service', 'Digital Product', 'Package / Bundle'],
  events: ['Service', 'Digital Product', 'Package / Bundle'],
  bazaar: ['Food', 'Beverage', 'Retail Product', 'Service', 'Package / Bundle'],
};

export function productTypesForCategory(category?: { slug?: string | null } | null) {
  return TYPES_BY_CATEGORY[String(category?.slug || '').toLowerCase()] || ALL_PRODUCT_TYPES;
}
