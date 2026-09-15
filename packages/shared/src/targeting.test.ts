import { describe, expect, it } from 'vitest';
import { matchesTargeting, type TargetGroup } from './targeting.js';
import { settingsSchema, publishSchema } from './schemas.js';
const group: TargetGroup = { id:'g', name:'وظائف القاهرة', description:'فرص عمل فنادق', location:'القاهرة', membershipStatus:'JOINED', postingEnabled:true, decisionStatus:'NEW', blacklist:null, score:80, membersCount:20000 };
describe('publishing contracts', () => {
  it('requires location and every requested keyword', () => {
    expect(matchesTargeting(group,{locations:['القاهرة'],requiredKeywords:['فنادق','وظائف']})).toBe(true);
    expect(matchesTargeting(group,{locations:['الإسكندرية']})).toBe(false);
    expect(matchesTargeting(group,{requiredKeywords:['مصانع']})).toBe(false);
    expect(matchesTargeting({...group,location:null},{locations:['القاهرة']})).toBe(false);
  });
  it('explicit selection cannot bypass a blacklist, exclusion or lost membership', () => {
    expect(matchesTargeting({...group,score:null},{includeGroupIds:['g'],minScore:90})).toBe(true);
    expect(matchesTargeting({...group,blacklist:{}},{includeGroupIds:['g']})).toBe(false);
    expect(matchesTargeting(group,{includeGroupIds:['g'],excludeGroupIds:['g']})).toBe(false);
    expect(matchesTargeting({...group,membershipStatus:'NOT_JOINED'},{includeGroupIds:['g']})).toBe(false);
  });
  it('rejects empty selection, missing review and malformed dates', () => {
    const input={groupIds:['g'],reviewed:true,requestKey:crypto.randomUUID()};
    expect(publishSchema.safeParse(input).success).toBe(true);
    expect(publishSchema.safeParse({...input,groupIds:[]}).success).toBe(false);
    expect(publishSchema.safeParse({...input,reviewed:false}).success).toBe(false);
    expect(publishSchema.safeParse({...input,scheduledAt:'tomorrow'}).success).toBe(false);
  });
  it('rejects invalid settings instead of saving broken runtime values', () => {
    expect(settingsSchema.safeParse({unknown:true}).success).toBe(false);
    expect(settingsSchema.safeParse({scoreWeights:{members:50,activity:50,engagement:50,keywordRelevance:0,locationRelevance:0}}).success).toBe(false);
  });
});
