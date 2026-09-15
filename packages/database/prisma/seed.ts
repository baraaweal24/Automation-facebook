import { prisma } from '../src/index.js';

const settings = {
  automationState: 'STOPPED',
  scoreWeights: { members: 20, activity: 30, engagement: 25, keywordRelevance: 15, locationRelevance: 10 },
  globalGroupRules: { minMembers: 10_000, maxMembers: null, minActivity: 5, minScore: 60, allowedPrivacy: ['PUBLIC', 'PRIVATE'], requireJobKeywords: true, allowedKeywords: ['وظائف', 'توظيف', 'فرص عمل', 'jobs', 'hiring', 'recruitment', 'career', 'call center', 'customer service'], blockedKeywords: ['بيع وشراء', 'عقارات', 'سيارات', 'زواج', 'تعارف'], allowedLocations: [], blockedLocations: [] },
  automationSettings: { browserHeadless: false, maxGroupsPerSearch: 50, maxGroupsToAnalyzePerRun: 25, maxJoinAttempts: 10, maxPostsPerRun: 10, actionDelayMs: 3000, pageTimeoutMs: 45_000, retryCount: 3, pendingJoinRecheckMinutes: 360, pendingPostRecheckMinutes: 180, screenshotOnError: true, autoStartWorkers: false, browserConcurrency: 1 },
};

for (const [key, value] of Object.entries(settings)) await prisma.systemSetting.upsert({ where: { key }, create: { key, valueJson: JSON.stringify(value) }, update: {} });
for (const template of [
  { name: 'إعلان بسيط', body: 'مطلوب {{job_title}} للعمل لدى {{company}} في {{location}}.\n\nالمتطلبات:\n{{requirements}}\n\nللتقديم: {{apply_link}}' },
  { name: 'إعلان احترافي', body: 'فرصة عمل جديدة | {{job_title}}\n\nالشركة: {{company}}\nالموقع: {{location}}\nالراتب: {{salary}}\n\nالمتطلبات:\n{{requirements}}\n\nواتساب: {{whatsapp}}' },
]) await prisma.postTemplate.upsert({ where: { name: template.name }, create: template, update: { body: template.body } });

if (process.env.SEED_DEMO === 'true' && process.env.NODE_ENV !== 'production') {
  const keyword = await prisma.searchKeyword.upsert({ where: { keyword: 'وظائف المنصورة' }, create: { keyword: 'وظائف المنصورة', priority: 10 }, update: {} });
  const group = await prisma.group.upsert({ where: { canonicalUrl: 'https://www.facebook.com/groups/demo-mansoura-jobs' }, create: { canonicalUrl: 'https://www.facebook.com/groups/demo-mansoura-jobs', name: 'وظائف المنصورة — بيانات تطوير', membersCount: 42_000, activityPerDay: 8, score: 84, decisionStatus: 'ACCEPTED_BY_RULES', membershipStatus: 'JOINED', location: 'المنصورة', privacy: 'PUBLIC' }, update: {} });
  await prisma.groupKeyword.upsert({ where: { groupId_keywordId: { groupId: group.id, keywordId: keyword.id } }, create: { groupId: group.id, keywordId: keyword.id }, update: {} });
}

console.log(process.env.SEED_DEMO === 'true' ? 'Settings, templates and isolated development data seeded.' : 'Production-safe settings and templates seeded.');
await prisma.$disconnect();
