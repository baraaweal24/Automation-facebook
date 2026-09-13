import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prisma, type AutomationTask } from '@repo/database';
import { FacebookBrowser, FacebookGroupService, FacebookMembershipService, FacebookPublisherService, FacebookSearchService, ManualActionRequiredError } from '@repo/facebook-automation';
import { DatabaseQueue } from '@repo/queue';
import { calculateGroupScore, DEFAULT_WEIGHTS, evaluateGroupRules, type GroupRules, type TaskType } from '@repo/shared';

export class TaskRunner {
  readonly queue = new DatabaseQueue();
  readonly browser = new FacebookBrowser();
  private readonly screenshotRoot = resolve(process.env.SCREENSHOT_PATH ?? './data/screenshots');

  async execute(task: AutomationTask) {
    const payload = JSON.parse(task.payloadJson) as Record<string, string>;
    switch (task.type as TaskType) {
      case 'DISCOVER_GROUPS': return this.discover(task, payload.keywordId);
      case 'ANALYZE_GROUP': return this.analyze(payload.groupId);
      case 'JOIN_GROUP': return this.join(payload.groupId);
      case 'SUBMIT_GROUP_QUESTIONS': return this.submitAnswers(payload.requestId);
      case 'CHECK_JOIN_STATUS': return this.checkJoin(payload.requestId);
      case 'PUBLISH_JOB': return this.prepareCampaign(payload.campaignId);
      case 'PUBLISH_POST': return this.publish(payload.postId);
      case 'CHECK_POST_STATUS': return this.checkPost(payload.postId);
      case 'REFRESH_GROUP_STATS': return this.analyze(payload.groupId);
      case 'CHECK_FACEBOOK_SESSION': return this.checkSession();
      case 'CLEANUP_SCREENSHOTS': return this.cleanupScreenshots();
      default: throw new Error(`Unsupported task type: ${task.type}`);
    }
  }

  async scheduleDue() {
    const raw = await prisma.systemSetting.findUnique({ where: { key: 'automationSettings' } });
    const settings = raw ? JSON.parse(raw.valueJson) : {};
    const joinCutoff = new Date(Date.now() - Number(settings.pendingJoinRecheckMinutes ?? 360) * 60_000);
    const postCutoff = new Date(Date.now() - Number(settings.pendingPostRecheckMinutes ?? 180) * 60_000);
    const bucket = Math.floor(Date.now() / 60_000);
    const requests = await prisma.membershipRequest.findMany({ where: { status: 'WAITING_ADMIN', OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: joinCutoff } }] }, take: 25 });
    for (const request of requests) await this.queue.enqueue('CHECK_JOIN_STATUS', { requestId: request.id }, `check-join:${request.id}:${bucket}`);
    const posts = await prisma.post.findMany({ where: { status: { in: ['POSTED', 'PENDING_ADMIN_APPROVAL'] }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: postCutoff } }] }, take: 25 });
    for (const post of posts) await this.queue.enqueue('CHECK_POST_STATUS', { postId: post.id }, `check-post:${post.id}:${bucket}`);
    const day = new Date().toISOString().slice(0, 10);
    await this.queue.enqueue('CLEANUP_SCREENSHOTS', {}, `cleanup-screenshots:${day}`, { priority: -10 });
  }

  private async page() { const page = await this.browser.page(); await this.browser.assertNoBlocker(page); return page; }

  private async discover(task: AutomationTask, keywordId: string) {
    const keyword = await prisma.searchKeyword.findUniqueOrThrow({ where: { id: keywordId } });
    const blacklisted = new Set((await prisma.blacklist.findMany({ include: { group: true } })).map((b) => b.group.facebookGroupId ?? b.group.canonicalUrl));
    const page = await this.page();
    const groups = await new FacebookSearchService(page).discover(keyword.keyword);
    let created = 0;
    for (const found of groups) {
      if (blacklisted.has(found.facebookGroupId ?? found.canonicalUrl)) continue;
      const existing = found.facebookGroupId ? await prisma.group.findUnique({ where: { facebookGroupId: found.facebookGroupId } }) : await prisma.group.findUnique({ where: { canonicalUrl: found.canonicalUrl } });
      const group = existing ?? await prisma.group.create({ data: found });
      if (!existing) created++;
      await prisma.groupKeyword.upsert({ where: { groupId_keywordId: { groupId: group.id, keywordId } }, create: { groupId: group.id, keywordId }, update: { foundAt: new Date() } });
      await this.queue.enqueue('ANALYZE_GROUP', { groupId: group.id }, `analyze:${group.id}:${new Date().toISOString().slice(0, 10)}`);
    }
    await prisma.searchKeyword.update({ where: { id: keywordId }, data: { lastSearchedAt: new Date(), groupsFound: { increment: created } } });
    await this.activity('GROUPS_DISCOVERED', 'SearchKeyword', keywordId, { taskId: task.id, found: groups.length, created });
  }

  private async analyze(groupId: string) {
    const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    await prisma.group.update({ where: { id: groupId }, data: { decisionStatus: 'ANALYZING' } });
    const page = await this.page();
    const visible = await new FacebookGroupService(page).analyze(group.canonicalUrl);
    const settings = Object.fromEntries((await prisma.systemSetting.findMany({ where: { key: { in: ['scoreWeights', 'globalGroupRules'] } } })).map((v) => [v.key, JSON.parse(v.valueJson)]));
    const metrics = { members: visible.membersCount, activity: visible.activityPerDay, engagement: null, keywordRelevance: this.relevance(`${visible.name} ${visible.description ?? ''}`, ['وظائف', 'jobs', 'hiring', 'توظيف']), locationRelevance: visible.location ? 100 : null };
    const scoring = calculateGroupScore(metrics, settings.scoreWeights ?? DEFAULT_WEIGHTS);
    const rules: GroupRules = settings.globalGroupRules ?? { minMembers: 10_000, minActivity: 5, minScore: 60, allowedPrivacy: ['PUBLIC', 'PRIVATE'], requireJobKeywords: true, allowedKeywords: ['وظائف', 'توظيف', 'فرص عمل', 'jobs', 'hiring'], blockedKeywords: ['بيع وشراء', 'عقارات', 'سيارات', 'زواج', 'تعارف'], allowedLocations: [], blockedLocations: [] };
    const decision = evaluateGroupRules({ metrics, score: scoring.score, privacy: visible.privacy, name: visible.name, description: visible.description, location: visible.location }, rules);
    const outcome = decision.accepted ? 'ACCEPTED_BY_RULES' : 'REJECTED_BY_RULES';
    await prisma.$transaction([
      prisma.group.update({ where: { id: groupId }, data: { ...visible, score: scoring.score, decisionStatus: outcome, decisionReasonJson: JSON.stringify(decision), lastAnalyzedAt: new Date() } }),
      prisma.groupMetric.create({ data: { groupId, membersCount: visible.membersCount, postsPerDay: visible.activityPerDay, keywordRelevance: metrics.keywordRelevance, locationRelevance: metrics.locationRelevance } }),
      prisma.groupAnalysis.create({ data: { groupId, score: scoring.score, outcome, reasonsJson: JSON.stringify(decision), snapshotJson: JSON.stringify({ metrics, scoring }) } }),
    ]);
    await this.activity('GROUP_ANALYZED', 'Group', groupId, { score: scoring.score, outcome });
  }

  private relevance(text: string, words: string[]) { const hits = words.filter((w) => text.toLowerCase().includes(w.toLowerCase())).length; return Math.min(100, hits * 30); }

  private async join(groupId: string) {
    const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId }, include: { blacklist: true } });
    if (group.blacklist || !['ACCEPTED_BY_RULES', 'MANUALLY_ACCEPTED'].includes(group.decisionStatus)) throw new Error('الجروب غير مؤهل للانضمام.');
    if (group.membershipStatus === 'JOINED') return;
    const page = await this.page();
    const result = await new FacebookMembershipService(page).join(group.canonicalUrl, process.env.DRY_RUN !== 'false');
    if (result.status === 'WOULD_JOIN') { await this.activity('WOULD_JOIN', 'Group', groupId); return; }
    const status = result.status;
    const request = await prisma.membershipRequest.create({ data: { groupId, status, requestedAt: ['WAITING_ADMIN', 'JOIN_REQUESTED'].includes(status) ? new Date() : null, questionsHash: 'hash' in result ? result.hash : null, questions: { create: result.questions.map((q) => ({ position: q.position, text: q.text, type: q.type, required: q.required })) }, history: { create: { fromStatus: group.membershipStatus, toStatus: status, source: 'AUTOMATION' } } } });
    await prisma.group.update({ where: { id: groupId }, data: { membershipStatus: status } });
    if (status === 'NEEDS_QUESTIONS') await this.notify('MEMBERSHIP_QUESTIONS', 'أسئلة انضمام مطلوبة', `${group.name} يحتاج ${result.questions.length} إجابة.`, 'MembershipRequest', request.id);
  }

  private async submitAnswers(requestId: string) {
    const request = await prisma.membershipRequest.findUniqueOrThrow({ where: { id: requestId }, include: { group: true, questions: { include: { answer: true }, orderBy: { position: 'asc' } } } });
    if (!request.questionsHash || request.questions.some((q) => !q.answer)) throw new Error('كل الإجابات المطلوبة يجب إدخالها أولًا.');
    if (process.env.DRY_RUN !== 'false') { await this.activity('WOULD_SUBMIT_MEMBERSHIP_ANSWERS', 'MembershipRequest', requestId); return; }
    const answers = request.questions.map((q) => ({ text: q.text, type: q.type, value: JSON.parse(q.answer!.valueJson) }));
    const page = await this.page();
    const result = await new FacebookMembershipService(page).submitAnswers(request.group.canonicalUrl, answers, request.questionsHash);
    if (result.status === 'QUESTIONS_CHANGED') {
      await prisma.membershipRequest.update({ where: { id: requestId }, data: { status: 'NEEDS_QUESTIONS', questionsHash: result.hash } });
      await this.notify('MEMBERSHIP_QUESTIONS_CHANGED', 'تغيرت أسئلة الانضمام', `راجع أسئلة ${request.group.name} قبل الإرسال.`, 'MembershipRequest', requestId);
      return;
    }
    await this.membershipTransition(requestId, request.status, result.status);
  }

  private async checkJoin(requestId: string) {
    const request = await prisma.membershipRequest.findUniqueOrThrow({ where: { id: requestId }, include: { group: true } });
    const page = await this.page();
    await page.goto(request.group.canonicalUrl, { waitUntil: 'domcontentloaded' });
    const body = await page.locator('body').innerText();
    const status = /Joined|تم الانضمام/i.test(body) ? 'JOINED' : /Pending|في انتظار/i.test(body) ? 'WAITING_ADMIN' : request.status;
    await prisma.membershipRequest.update({ where: { id: requestId }, data: { lastCheckedAt: new Date(), checkCount: { increment: 1 } } });
    if (status !== request.status) await this.membershipTransition(requestId, request.status, status);
  }

  private async membershipTransition(id: string, from: string, to: string) {
    const request = await prisma.membershipRequest.update({ where: { id }, data: { status: to, history: { create: { fromStatus: from, toStatus: to, source: 'AUTOMATION' } } } });
    await prisma.group.update({ where: { id: request.groupId }, data: { membershipStatus: to } });
    if (['JOINED', 'JOIN_REJECTED'].includes(to)) await this.notify(`MEMBERSHIP_${to}`, to === 'JOINED' ? 'تم قبول الانضمام' : 'تم رفض الانضمام', to === 'JOINED' ? 'أصبح الجروب متاحًا للنشر.' : 'رفض الأدمن طلب الانضمام.', 'MembershipRequest', id);
  }

  private async prepareCampaign(campaignId: string) {
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { job: true, groups: { include: { group: { include: { blacklist: true } } } } } });
    if (campaign.status === 'PAUSED') return;
    const raw = await prisma.systemSetting.findUnique({ where: { key: 'automationSettings' } });
    const maxPosts = raw ? Number(JSON.parse(raw.valueJson).maxPostsPerRun ?? 10) : 10;
    for (const target of campaign.groups.filter((g) => g.selected && g.group.membershipStatus === 'JOINED' && !g.group.blacklist && g.group.postingEnabled).slice(0, maxPosts)) {
      const post = await prisma.post.upsert({ where: { jobId_groupId_repostNumber: { jobId: campaign.jobId, groupId: target.groupId, repostNumber: 0 } }, create: { jobId: campaign.jobId, campaignId, groupId: target.groupId, content: campaign.job.finalText }, update: {} });
      await this.queue.enqueue('PUBLISH_POST', { postId: post.id }, `publish:${post.id}:0`);
    }
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'ACTIVE', startedAt: campaign.startedAt ?? new Date() } });
  }

  private async publish(postId: string) {
    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId }, include: { job: true, group: { include: { blacklist: true } }, campaign: true } });
    if (['POSTED', 'PENDING_ADMIN_APPROVAL', 'APPROVED'].includes(post.status)) return;
    if (post.campaign.status !== 'ACTIVE' || post.group.membershipStatus !== 'JOINED' || post.group.blacklist || !post.group.postingEnabled) { await this.postTransition(postId, post.status, 'SKIPPED', 'الجروب أو الحملة غير مؤهلين حاليًا.'); return; }
    if (post.group.minDaysBetweenPosts) {
      const since = new Date(Date.now() - post.group.minDaysBetweenPosts * 86_400_000);
      const recent = await prisma.post.findFirst({ where: { groupId: post.groupId, postedAt: { gte: since }, status: { in: ['POSTED', 'PENDING_ADMIN_APPROVAL', 'APPROVED'] } } });
      if (recent) { await this.postTransition(postId, post.status, 'SKIPPED', 'فترة الانتظار الخاصة بالجروب لم تنتهِ.'); return; }
    }
    await this.postTransition(postId, post.status, 'POSTING');
    const page = await this.page();
    const result = await new FacebookPublisherService(page).publish({ groupUrl: post.group.canonicalUrl, text: post.content, imagePath: post.job.imagePath, dryRun: process.env.DRY_RUN !== 'false' });
    await this.postTransition(postId, 'POSTING', result.status, undefined, ['POSTED', 'PENDING_ADMIN_APPROVAL'].includes(result.status) ? { postedAt: new Date() } : undefined);
  }

  private async checkPost(postId: string) {
    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId }, include: { group: true } });
    if (!['POSTED', 'PENDING_ADMIN_APPROVAL'].includes(post.status)) return;
    const page = await this.page();
    await page.goto(post.facebookUrl ?? post.group.canonicalUrl, { waitUntil: 'domcontentloaded' });
    const body = await page.locator('body').innerText();
    if (post.status === 'PENDING_ADMIN_APPROVAL' && !/pending approval|في انتظار الموافقة/i.test(body) && body.includes(post.content.slice(0, 60))) await this.postTransition(postId, post.status, 'APPROVED', undefined, { approvedAt: new Date(), lastCheckedAt: new Date() });
    else await prisma.post.update({ where: { id: postId }, data: { lastCheckedAt: new Date() } });
  }

  private async postTransition(id: string, from: string, to: string, reason?: string, data?: Record<string, unknown>) {
    await prisma.post.update({ where: { id }, data: { status: to, ...(data ?? {}), history: { create: { fromStatus: from, toStatus: to, reason, source: 'AUTOMATION' } } } });
  }

  private async checkSession() { const status = await this.browser.checkSession(); await prisma.facebookSession.upsert({ where: { id: 'primary' }, create: { id: 'primary', profilePath: this.browser.profilePath, status, lastCheckedAt: new Date() }, update: { status, lastCheckedAt: new Date() } }); }

  private async cleanupScreenshots() {
    const days = Number(process.env.SCREENSHOT_RETENTION_DAYS ?? 30); const cutoff = Date.now() - days * 86_400_000;
    await mkdir(this.screenshotRoot, { recursive: true });
    for (const file of await readdir(this.screenshotRoot)) { const path = resolve(this.screenshotRoot, file); if ((await stat(path)).mtimeMs < cutoff) { await unlink(path); await prisma.screenshot.deleteMany({ where: { path } }); } }
  }

  async captureFailure(task: AutomationTask, error: unknown) {
    await mkdir(this.screenshotRoot, { recursive: true });
    const path = resolve(this.screenshotRoot, `${task.id}-${Date.now()}.png`);
    const page = await this.browser.page().catch(() => null);
    if (page) await page.screenshot({ path, fullPage: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    const manual = error instanceof ManualActionRequiredError;
    const errorLog = await prisma.errorLog.create({ data: { type: manual ? error.reason : 'AUTOMATION_ERROR', message: manual ? message : 'تعذر إكمال عملية الأتمتة.', technical: message, stack: error instanceof Error ? error.stack : null, taskId: task.id, retryCount: task.attempts } });
    if (page) await prisma.screenshot.create({ data: { path, taskId: task.id, errorId: errorLog.id } });
    if (manual) {
      await prisma.systemSetting.upsert({ where: { key: 'automationState' }, create: { key: 'automationState', valueJson: JSON.stringify('PAUSED') }, update: { valueJson: JSON.stringify('PAUSED') } });
      await this.notify(error.reason, 'مطلوب تدخل يدوي', message, 'AutomationTask', task.id);
    }
    return manual;
  }

  private activity(action: string, entityType: string, entityId?: string, details?: unknown) { return prisma.activityLog.create({ data: { action, entityType, entityId, detailsJson: details ? JSON.stringify(details) : null, source: 'AUTOMATION' } }); }
  private notify(type: string, title: string, message: string, entityType?: string, entityId?: string) { return prisma.notification.create({ data: { type, title, message, entityType, entityId } }); }
}
