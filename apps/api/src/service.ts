import { prisma } from '@repo/database';
import { DatabaseQueue } from '@repo/queue';
import { calculateGroupScore, DEFAULT_WEIGHTS, evaluateGroupRules, type GroupRules, type TaskType } from '@repo/shared';
import { ApiError, parseJson } from './http.js';

export class CoreService {
  readonly queue = new DatabaseQueue();
  log(action: string, entityType: string, entityId: string | null, userId?: string, details?: unknown) { return prisma.activityLog.create({ data: { action, entityType, entityId, userId, source: userId ? 'USER' : 'AUTOMATION', detailsJson: details ? JSON.stringify(details) : null } }); }
  enqueue(type: TaskType, payload: unknown, key: string) { return this.queue.enqueue(type, payload, key); }

  async analyzeGroup(id: string, userId?: string) {
    const group = await prisma.group.findUnique({ where: { id }, include: { metrics: { orderBy: { measuredAt: 'desc' }, take: 1 } } });
    if (!group) throw new ApiError(404, 'NOT_FOUND', 'الجروب غير موجود.');
    const metric = group.metrics[0];
    const settings = Object.fromEntries((await prisma.systemSetting.findMany({ where: { key: { in: ['scoreWeights', 'globalGroupRules'] } } })).map((item) => [item.key, parseJson(item.valueJson, {})]));
    const weights = settings.scoreWeights ?? DEFAULT_WEIGHTS;
    const metrics = { members: metric?.membersCount ?? group.membersCount, activity: metric?.postsPerDay ?? group.activityPerDay, engagement: metric ? ((metric.avgReactions ?? 0) + (metric.avgComments ?? 0)) : null, keywordRelevance: metric?.keywordRelevance, locationRelevance: metric?.locationRelevance };
    const scoring = calculateGroupScore(metrics, weights as typeof DEFAULT_WEIGHTS);
    const rules = (settings.globalGroupRules ?? defaultRules) as GroupRules;
    const result = evaluateGroupRules({ metrics, score: scoring.score, privacy: group.privacy, name: group.name, description: group.description, location: group.location }, rules);
    const outcome = result.accepted ? 'ACCEPTED_BY_RULES' : 'REJECTED_BY_RULES';
    await prisma.$transaction([
      prisma.group.update({ where: { id }, data: { score: scoring.score, decisionStatus: outcome, decisionReasonJson: JSON.stringify(result), lastAnalyzedAt: new Date() } }),
      prisma.groupAnalysis.create({ data: { groupId: id, score: scoring.score, outcome, reasonsJson: JSON.stringify(result), snapshotJson: JSON.stringify({ metrics, weights, scoring }) } }),
    ]);
    await this.log('GROUP_ANALYZED', 'Group', id, userId, { outcome, score: scoring.score });
    return { outcome, ...result, scoring };
  }
}

export const defaultRules: GroupRules = { minMembers: 10_000, minActivity: 5, minScore: 60, allowedPrivacy: ['PUBLIC', 'PRIVATE'], requireJobKeywords: true, allowedKeywords: ['وظائف', 'توظيف', 'فرص عمل', 'jobs', 'hiring', 'recruitment', 'career'], blockedKeywords: ['بيع وشراء', 'عقارات', 'سيارات', 'زواج', 'تعارف'], allowedLocations: [], blockedLocations: [] };
