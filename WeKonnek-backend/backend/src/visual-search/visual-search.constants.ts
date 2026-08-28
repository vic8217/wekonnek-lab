export const VISUAL_SEARCH_LIMITS = { initialCandidates: 200, expandedCandidates: 500, finalResults: 20, allowedRadiusKm: [3, 5, 10, 20] } as const;
export type VisualSearchScope = 'NEARBY' | 'CITY' | 'NATIONWIDE';
