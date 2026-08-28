export type BenchmarkQuery = { expectedProductIds: number[]; mode: 'EXACT_PRODUCT' | 'SIMILAR_PRODUCT' };
export const reciprocalRank = (expected: number[], ranked: number[]) => { const rank = ranked.findIndex(id => expected.includes(id)); return rank < 0 ? 0 : 1 / (rank + 1); };
export const hitAt = (expected: number[], ranked: number[], limit: number) => ranked.slice(0, limit).some(id => expected.includes(id));
export const retrievalMetrics = (queries: Array<BenchmarkQuery & { ranked: number[] }>) => {
  const total = queries.length || 1;
  return { top1Accuracy: queries.filter(q => hitAt(q.expectedProductIds, q.ranked, 1)).length / total, top3Recall: queries.filter(q => hitAt(q.expectedProductIds, q.ranked, 3)).length / total, top5Recall: queries.filter(q => hitAt(q.expectedProductIds, q.ranked, 5)).length / total, top10Recall: queries.filter(q => hitAt(q.expectedProductIds, q.ranked, 10)).length / total, mrr: queries.reduce((sum, q) => sum + reciprocalRank(q.expectedProductIds, q.ranked), 0) / total };
};
