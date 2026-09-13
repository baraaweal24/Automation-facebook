import { describe, expect, it } from 'vitest';
import { evaluateGroupRules } from './rules.js';

const rules = { minMembers: 10_000, minActivity: 5, minScore: 60, allowedPrivacy: ['PUBLIC'], requireJobKeywords: true, allowedKeywords: ['وظائف', 'jobs'], blockedKeywords: ['عقارات'], allowedLocations: ['المنصورة'], blockedLocations: [] };

describe('evaluateGroupRules', () => {
  it('accepts a group with complete evidence', () => {
    const result = evaluateGroupRules({ name: 'وظائف المنصورة', location: 'المنصورة', privacy: 'PUBLIC', score: 82, metrics: { members: 20_000, activity: 9 } }, rules);
    expect(result.accepted).toBe(true);
  });

  it('does not silently pass a missing required metric', () => {
    const result = evaluateGroupRules({ name: 'وظائف المنصورة', location: 'المنصورة', privacy: 'PUBLIC', score: 82, metrics: { activity: 9 } }, rules);
    expect(result.accepted).toBe(false);
    expect(result.failures.join(' ')).toContain('غير متاح');
  });

  it('explains blocked topics', () => {
    const result = evaluateGroupRules({ name: 'وظائف وعقارات المنصورة', location: 'المنصورة', privacy: 'PUBLIC', score: 82, metrics: { members: 20_000, activity: 9 } }, rules);
    expect(result.failures.join(' ')).toContain('محظورة');
  });
});
