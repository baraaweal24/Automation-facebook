import { prisma } from '@repo/database';
import { matchesTargeting } from '@repo/shared';
import { ApiError, parseJson } from './http.js';

export async function eligibleGroups(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { targeting: true } });
  if (!job) throw new ApiError(404, 'NOT_FOUND', 'الوظيفة غير موجودة.');
  const rule = job.targeting;
  const groups = await prisma.group.findMany({ where: { membershipStatus: 'JOINED' }, include: { blacklist: true } });
  return groups.filter(group => matchesTargeting(group, {
    locations: parseJson(rule?.locationsJson, []), requiredKeywords: parseJson(rule?.requiredKeywordsJson, []),
    includeGroupIds: parseJson(rule?.includeGroupIdsJson, []), excludeGroupIds: parseJson(rule?.excludeGroupIdsJson, []),
    minMembers: rule?.minMembers, minScore: rule?.minScore,
  }));
}
export async function createCampaign(input: { jobId?: string; draftId?: string; title: string; content: string; groupIds: string[]; scheduledAt?: string; requestKey: string; userId?: string }) {
  const ids = [...new Set(input.groupIds)].sort();
  if (!ids.length) throw new ApiError(400, 'NO_GROUPS', 'اختر جروبًا واحدًا على الأقل.');
  const runAt = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
  return prisma.$transaction(async tx => {
    const existing = await tx.campaign.findUnique({ where: { requestKey: input.requestKey }, include: { groups: true } });
    if (existing) {
      if (existing.contentSnapshot !== input.content || JSON.stringify(existing.groups.map(g => g.groupId).sort()) !== JSON.stringify(ids) || (input.jobId && existing.jobId !== input.jobId)) throw new ApiError(409, 'KEY_CONFLICT', 'تغير المحتوى أو الجمهور. راجع الحملة من جديد.');
      return { campaign: existing, duplicate: true };
    }
    const groups = await tx.group.findMany({ where: { id: { in: ids } }, include: { blacklist: true } });
    if (groups.length !== ids.length || groups.some(g => !matchesTargeting(g))) throw new ApiError(400, 'INELIGIBLE_GROUP', 'أحد الجروبات المختارة غير متاح للنشر. حدّث القائمة.');
    const job = input.jobId ? await tx.job.findUniqueOrThrow({ where: { id: input.jobId } }) : await tx.job.create({ data: { title: input.title, category: 'محتوى عام', city: 'غير محدد', description: input.draftId ? `Content draft: ${input.draftId}` : undefined, finalText: input.content, status: 'ACTIVE' } });
    if (['ARCHIVED','COMPLETED'].includes(job.status)) throw new ApiError(400, 'JOB_CLOSED', 'الوظيفة مؤرشفة أو منتهية.');
    await tx.job.update({ where: { id: job.id }, data: { status: 'ACTIVE' } });
    const campaign = await tx.campaign.create({ data: { jobId: job.id, requestKey: input.requestKey, contentSnapshot: input.content, dryRun: process.env.DRY_RUN !== 'false', status: input.scheduledAt ? 'SCHEDULED' : 'ACTIVE', scheduledAt: input.scheduledAt ? runAt : null, groups: { create: ids.map(groupId => ({ groupId })) } } });
    await tx.automationTask.create({ data: { type: 'PUBLISH_JOB', payloadJson: JSON.stringify({ campaignId: campaign.id }), idempotencyKey: `campaign:${campaign.id}`, runAt } });
    await tx.activityLog.create({ data: { action: 'CAMPAIGN_REVIEWED_AND_CREATED', entityType: 'Campaign', entityId: campaign.id, source: 'USER', userId: input.userId, detailsJson: JSON.stringify({ groupIds: ids, draftId: input.draftId, dryRun: campaign.dryRun }) } });
    return { campaign, duplicate: false };
  });
}
