import type { GroupMetrics, ScoreWeights } from './types.js';

export const DEFAULT_WEIGHTS: ScoreWeights = {
  members: 20,
  activity: 30,
  engagement: 25,
  keywordRelevance: 15,
  locationRelevance: 10,
};

const clamp = (value: number) => Math.min(100, Math.max(0, value));

export function normalizeMetrics(metrics: GroupMetrics): Record<keyof ScoreWeights, number | null> {
  return {
    members: metrics.members == null ? null : clamp((Math.log10(Math.max(metrics.members, 1)) - 2) * 33.33),
    activity: metrics.activity == null ? null : clamp((metrics.activity / 10) * 100),
    engagement: metrics.engagement == null ? null : clamp(metrics.engagement),
    keywordRelevance: metrics.keywordRelevance == null ? null : clamp(metrics.keywordRelevance),
    locationRelevance: metrics.locationRelevance == null ? null : clamp(metrics.locationRelevance),
  };
}

export function calculateGroupScore(metrics: GroupMetrics, weights: ScoreWeights = DEFAULT_WEIGHTS) {
  const normalized = normalizeMetrics(metrics);
  const available = (Object.keys(weights) as Array<keyof ScoreWeights>).filter((key) => normalized[key] != null && weights[key] > 0);
  const availableWeight = available.reduce((sum, key) => sum + weights[key], 0);
  if (!availableWeight) return { score: 0, components: {}, missing: Object.keys(weights), reasons: ['لا توجد بيانات كافية لحساب التقييم.'] };

  const components: Partial<Record<keyof ScoreWeights, { value: number; effectiveWeight: number; contribution: number }>> = {};
  let score = 0;
  for (const key of available) {
    const effectiveWeight = weights[key] / availableWeight;
    const value = normalized[key] as number;
    const contribution = value * effectiveWeight;
    score += contribution;
    components[key] = { value, effectiveWeight, contribution };
  }
  const missing = (Object.keys(weights) as Array<keyof ScoreWeights>).filter((key) => normalized[key] == null);
  const reasons = available.map((key) => `${key}: ${Math.round(normalized[key] as number)}/100`).concat(missing.length ? [`مقاييس غير متاحة: ${missing.join(', ')}`] : []);
  return { score: Math.round(score * 100) / 100, components, missing, reasons };
}
