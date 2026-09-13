import { describe, expect, it } from 'vitest';
import { calculateGroupScore } from './scoring.js';

describe('calculateGroupScore', () => {
  it('redistributes weight when metrics are unavailable', () => {
    const result = calculateGroupScore({ keywordRelevance: 80, locationRelevance: 100 }, { members: 20, activity: 30, engagement: 25, keywordRelevance: 15, locationRelevance: 10 });
    expect(result.score).toBe(88);
    expect(result.missing).toEqual(['members', 'activity', 'engagement']);
  });

  it('returns an explainable zero without data', () => {
    const result = calculateGroupScore({});
    expect(result.score).toBe(0);
    expect(result.reasons[0]).toContain('لا توجد بيانات');
  });
});
