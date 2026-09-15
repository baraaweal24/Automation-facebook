import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prisma, type AutomationTask } from '@repo/database';
import { FacebookBrowser, FacebookGroupService, FacebookMembershipService, FacebookPublisherService, FacebookSearchService, JoinedGroupsService, ManualActionRequiredError } from '@repo/facebook-automation';
import { DatabaseQueue } from '@repo/queue';
import { calculateGroupScore, DEFAULT_WEIGHTS, evaluateGroupRules, type GroupRules, type TaskType } from '@repo/shared';

export class TaskRunner {
  readonly queue = new DatabaseQueue();
  readonly browser = new FacebookBrowser();
  private readonly screenshotRoot = resolve(process.env.SCREENSHOT_PATH ?? './data/screenshots');
  currentTask: AutomationTask | null = null;
  interrupted = false;
  async guard() {
    if (this.interrupted) throw new AutomationPausedError();
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'automationState' } });
    if (!setting || JSON.parse(setting.valueJson) !== 'RUNNING') throw new AutomationPausedError();
    if (this.currentTask) {
      const task = await prisma.automationTask.findUnique({ where: { id: this.currentTask.id } });
      if (!task || task.status !== 'RUNNING' || task.leaseToken !== this.currentTask.leaseToken || !task.leaseExpiresAt || task.leaseExpiresAt <= new Date()) throw new AutomationPausedError();
    }
  }

  async execute(task: AutomationTask) {
    const payload = JSON.parse(task.payloadJson) as Record<string, string>;
    switch (task.type as TaskType) {
      case 'SYNC_JOINED_GROUPS': return this.syncJoinedGroups();
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
    await this.queue.recoverExpired();
    const campaigns = await prisma.campaign.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const campaign of campaigns) await this.prepareCampaign(campaign.id);
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

  private async page() {
    await this.guard(); const page = await this.browser.page();
    const raw=await prisma.systemSetting.findUnique({where:{key:'automationSettings'}});
    const timeout=raw ? JSON.parse(raw.valueJson).pageTimeoutMs ?? 45000 : 45000;
    page.setDefaultNavigationTimeout?.(timeout);page.setDefaultTimeout?.(timeout);
    await this.browser.assertNoBlocker(page);return page;
  }

  private async syncJoinedGroups() {
    const service = new JoinedGroupsService(await this.page(), () => this.guard());
    const { groups, truncated } = await service.list();
    let verified = 0;
    for (const found of groups) {
      if (!await service.verify(found.canonicalUrl)) continue;
      const existing = await prisma.group.findFirst({ where: { OR: [{ canonicalUrl: found.canonicalUrl }, ...(found.facebookGroupId ? [{ facebookGroupId: found.facebookGroupId }] : [])] } });
      if (existing) await prisma.group.update({ where: { id: existing.id }, data: { name: found.name, membershipStatus: 'JOINED' } });
      else await prisma.group.create({ data: { ...found, membershipStatus: 'JOINED' } });
      verified++;
    }
    await this.activity('JOINED_GROUPS_SYNCED', 'System', undefined, { found: groups.length, verified, truncated });
    await this.notify('GROUPS_SYNCED', 'اكتمل جلب جروباتك', `تم التحقق من عضوية ${verified} جروب.${truncated ? ' القائمة جزئية؛ أعد المزامنة لاستكمال التحقق.' : ''}`, 'System');
  }

  private async discover(task: AutomationTask, keywordId: string) {
    const keyword = await prisma.searchKeyword.findUniqueOrThrow({ where: { id: keywordId } });
    const blacklisted = new Set((await prisma.blacklist.findMany({ include: { group: true } })).map((b) => b.group.facebookGroupId ?? b.group.canonicalUrl));
    const page = await this.page();
    const rawSettings = await prisma.systemSetting.findUnique({ where: { key: 'automationSettings' } });
    const options = rawSettings ? JSON.parse(rawSettings.valueJson) : {};
    const groups = await new FacebookSearchService(page, () => this.guard()).discover(keyword.keyword, { maxGroups: options.maxGroupsPerSearch ?? 50, maxIdleScrolls: 4, timeoutMs: options.pageTimeoutMs ?? 60000 });
    let created = 0;
    for (const found of groups) {
      if (blacklisted.has(found.facebookGroupId ?? found.canonicalUrl)) continue;
      const existing = found.facebookGroupId ? await prisma.group.findUnique({ where: { facebookGroupId: found.facebookGroupId } }) : await prisma.group.findUnique({ where: { canonicalUrl: found.canonicalUrl } });
      const group = existing ?? await prisma.group.create({ data: found });
      if (!existing) created++;
      await prisma.groupKeyword.upsert({ where: { groupId_keywordId: { groupId: group.id, keywordId } }, create: { groupId: group.id, keywordId }, update: { foundAt: new Date() } });
      await this.queue.enqueue('ANALYZE_GROUP', { groupId: group.id }, `analyze:${group.id}:${new Date().toISOString().slice(0, 10)}`, { runAt: new Date(Date.now() + Math.floor(groups.indexOf(found) / (options.maxGroupsToAnalyzePerRun ?? 25)) * 60000), maxAttempts: options.retryCount ?? 3 });
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
    const incomplete = decision.failures.some(reason => reason.includes('غير متاح'));
    const outcome = group.decisionStatus.startsWith('MANUALLY_') ? group.decisionStatus : decision.accepted ? 'ACCEPTED_BY_RULES' : incomplete ? 'NEW' : 'REJECTED_BY_RULES';
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
    const result = await new FacebookMembershipService(page, () => this.guard()).join(group.canonicalUrl, process.env.DRY_RUN !== 'false');
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
    const result = await new FacebookMembershipService(page, () => this.guard()).submitAnswers(request.group.canonicalUrl, answers, request.questionsHash);
    if (result.status === 'QUESTIONS_CHANGED') {
      await prisma.$transaction(async tx => {
        await tx.membershipQuestion.deleteMany({ where: { requestId } });
        await tx.membershipRequest.update({ where: { id: requestId }, data: { status: 'NEEDS_QUESTIONS', questionsHash: result.hash, questions: { create: result.questions.map((text, position) => ({ text, position, type: 'TEXT', required: true })) } } });
        await tx.group.update({ where: { id: request.groupId }, data: { membershipStatus: 'NEEDS_QUESTIONS' } });
      });
      await this.notify('MEMBERSHIP_QUESTIONS_CHANGED', 'تغيرت أسئلة الانضمام', `راجع أسئلة ${request.group.name} قبل الإرسال.`, 'MembershipRequest', requestId);
      return;
    }
    await this.membershipTransition(requestId, request.status, result.status);
  }

  private async checkJoin(requestId: string) {
    const request = await prisma.membershipRequest.findUniqueOrThrow({ where: { id: requestId }, include: { group: true } });
    const page = await this.page();
    await page.goto(request.group.canonicalUrl, { waitUntil: 'domcontentloaded' });
    await this.browser.assertNoBlocker(page);
    const joined = await page.getByRole('button', { name: /^(Joined|تم الانضمام|منضم)$/i }).first().isVisible().catch(() => false);
    const status = joined ? 'JOINED' : request.status;
    await prisma.membershipRequest.update({ where: { id: requestId }, data: { lastCheckedAt: new Date(), checkCount: { increment: 1 } } });
    if (status !== request.status) await this.membershipTransition(requestId, request.status, status);
  }

  private async membershipTransition(id: string, from: string, to: string) {
    await prisma.$transaction(async tx=>{
      const request = await tx.membershipRequest.update({ where: { id }, data: { status: to, history: { create: { fromStatus: from, toStatus: to, source: 'AUTOMATION' } } } });
      await tx.group.update({ where: { id: request.groupId }, data: { membershipStatus: to } });
    });
    if (['JOINED', 'JOIN_REJECTED'].includes(to)) await this.notify(`MEMBERSHIP_${to}`, to === 'JOINED' ? 'تم قبول الانضمام' : 'تم رفض الانضمام', to === 'JOINED' ? 'أصبح الجروب متاحًا للنشر.' : 'رفض الأدمن طلب الانضمام.', 'MembershipRequest', id);
  }

  async prepareCampaign(campaignId: string) {
    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { job: true, groups: { include: { group: { include: { blacklist: true } } } } } });
    if (!['ACTIVE', 'SCHEDULED'].includes(campaign.status) || (campaign.scheduledAt && campaign.scheduledAt > new Date())) return;
    if (campaign.dryRun !== (process.env.DRY_RUN !== 'false')) {
      await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'PAUSED' } });
      await this.notify('MODE_CHANGED', 'الحملة تحتاج مراجعة', 'تغير وضع الاختبار. أنشئ حملة جديدة بعد المراجعة.', 'Campaign', campaignId);
      return;
    }
    // Materialize every target before queueing batches, including visibly skipped targets.
    for (const target of campaign.groups.filter(g => g.selected)) {
      const exists = await prisma.post.findFirst({ where: { campaignId, groupId: target.groupId } });
      if (exists) continue;
      const latest = await prisma.post.aggregate({ where: { jobId: campaign.jobId, groupId: target.groupId }, _max: { repostNumber: true } });
      const eligible = target.group.membershipStatus === 'JOINED' && !target.group.blacklist && target.group.postingEnabled && target.group.decisionStatus !== 'MANUALLY_REJECTED';
      await prisma.post.upsert({ where: { dispatchKey: `${campaignId}:${target.groupId}` }, update: {}, create: { dispatchKey: `${campaignId}:${target.groupId}`, jobId: campaign.jobId, campaignId, groupId: target.groupId, content: campaign.contentSnapshot || campaign.job.finalText, repostNumber: latest._max.repostNumber === null ? 0 : latest._max.repostNumber + 1, status: eligible ? 'QUEUED' : 'SKIPPED', history: { create: { toStatus: eligible ? 'QUEUED' : 'SKIPPED', source: 'AUTOMATION', reason: eligible ? undefined : 'الجروب غير مؤهل وقت تجهيز الحملة.' } } } });
    }
    const raw = await prisma.systemSetting.findUnique({ where: { key: 'automationSettings' } });
    const settings = raw ? JSON.parse(raw.valueJson) : {};
    const maxPosts = Math.max(1, Number(settings.maxPostsPerRun ?? 10));
    const waiting = await prisma.post.findMany({ where: { campaignId, status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
    const keys = waiting.map(post => `publish:${post.id}:0`);
    const queued = await prisma.automationTask.findMany({ where: { idempotencyKey: { in: keys } }, select: { idempotencyKey: true, status: true } });
    const present = new Set(queued.map(task => task.idempotencyKey));
    const capacity = Math.max(0, maxPosts - queued.filter(task => ['QUEUED','RETRY','RUNNING','PAUSED'].includes(task.status)).length);
    for (const post of waiting.filter(post => !present.has(`publish:${post.id}:0`)).slice(0, capacity)) {
      await this.queue.enqueue('PUBLISH_POST', { postId: post.id }, `publish:${post.id}:0`, { maxAttempts: settings.retryCount ?? 3 });
    }
    await prisma.campaign.update({ where: { id: campaignId }, data: { status: 'ACTIVE', startedAt: campaign.startedAt ?? new Date() } });
    await this.reconcileCampaign(campaignId);
  }

  async reconcileCampaign(campaignId: string) {
    const remaining = await prisma.post.count({ where: { campaignId, status: { in: ['QUEUED','POSTING','MANUAL_ACTION_REQUIRED','PENDING_ADMIN_APPROVAL'] } } });
    const count = await prisma.post.count({ where: { campaignId } });
    if (!remaining && count) await prisma.campaign.updateMany({ where: { id: campaignId, status: 'ACTIVE' }, data: { status: 'COMPLETED', completedAt: new Date() } });
  }

  private async publish(postId: string) {
    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId }, include: { job: true, group: { include: { blacklist: true } }, campaign: true } });
    if (['POSTED', 'PENDING_ADMIN_APPROVAL', 'APPROVED','WOULD_POST','SKIPPED','REJECTED'].includes(post.status)) return;
    if (['POSTING','MANUAL_ACTION_REQUIRED'].includes(post.status)) {
      await this.postTransition(postId, post.status, 'MANUAL_ACTION_REQUIRED', 'محاولة إرسال سابقة لم تؤكد؛ راجع الجروب قبل إعادة المحاولة.');
      return;
    }
    if (post.campaign.status === 'PAUSED') throw new AutomationPausedError();
    if (post.campaign.dryRun !== (process.env.DRY_RUN !== 'false')) throw new AutomationPausedError();
    if (post.campaign.status !== 'ACTIVE' || post.job.status !== 'ACTIVE' || post.group.membershipStatus !== 'JOINED' || post.group.blacklist || !post.group.postingEnabled || post.group.decisionStatus === 'MANUALLY_REJECTED') {
      await this.postTransition(postId, post.status, 'SKIPPED', 'الجروب أو الوظيفة أو الحملة غير مؤهلين حاليًا.'); return;
    }
    if (post.group.minDaysBetweenPosts) {
      const since = new Date(Date.now() - post.group.minDaysBetweenPosts * 86400000);
      const recent = await prisma.post.findFirst({ where: { groupId: post.groupId, postedAt: { gte: since }, status: { in: ['POSTED', 'PENDING_ADMIN_APPROVAL', 'APPROVED'] } } });
      if (recent) { await this.postTransition(postId, post.status, 'SKIPPED', 'فترة الانتظار الخاصة بالجروب لم تنتهِ.'); return; }
    }
    const guard = async () => {
      await this.guard();
      const current = await prisma.post.findUniqueOrThrow({ where: { id: postId }, include: { campaign: true, job: true, group: { include: { blacklist: true } } } });
      if (current.campaign.status !== 'ACTIVE' || current.job.status !== 'ACTIVE' || current.group.blacklist || !current.group.postingEnabled || current.group.membershipStatus !== 'JOINED' || current.group.decisionStatus === 'MANUALLY_REJECTED') throw new AutomationPausedError();
    };
    const page = await this.page();
    const result = await new FacebookPublisherService(page, guard).publish({
      groupUrl: post.group.canonicalUrl, text: post.content, imagePath: post.job.imagePath, dryRun: post.campaign.dryRun,
      beforeSubmit: async () => {
        await guard();
        await this.postTransition(postId, post.status, 'POSTING');
      },
    });
    await this.postTransition(postId, result.status === 'WOULD_POST' ? post.status : 'POSTING', result.status, result.reason, {
      ...(result.facebookUrl ? { facebookUrl: result.facebookUrl, facebookPostId: result.facebookPostId } : {}),
      ...(['POSTED','PENDING_ADMIN_APPROVAL'].includes(result.status) ? { postedAt: new Date() } : {}),
    });
    if (result.status === 'MANUAL_ACTION_REQUIRED') await this.notify('POST_UNCONFIRMED', 'راجع نتيجة النشر', result.reason ?? 'النتيجة غير مؤكدة.', 'Post', postId);
    await this.reconcileCampaign(post.campaignId);
  }

  private async checkPost(postId: string) {
    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId }, include: { group: true } });
    if (!['POSTED', 'PENDING_ADMIN_APPROVAL'].includes(post.status)) return;
    if (!post.facebookUrl) {
      await prisma.post.update({ where: { id:postId }, data:{ lastCheckedAt:new Date() } });
      return; // Similar text on a feed cannot establish identity of a pending post.
    }
    const page = await this.page();
    await page.goto(post.facebookUrl ?? post.group.canonicalUrl, { waitUntil: 'domcontentloaded' });
    await this.browser.assertNoBlocker(page);
    // Full content and a group-specific permalink are required, never absence of a pending banner.
    const evidence = await new FacebookPublisherService(page).findEvidence(post.group.canonicalUrl, post.content);
    if (evidence && (!post.facebookUrl || post.facebookUrl === evidence.facebookUrl)) {
      await this.postTransition(postId, post.status, 'APPROVED', undefined, { ...evidence, approvedAt: new Date(), lastCheckedAt: new Date() });
      await this.reconcileCampaign(post.campaignId);
    } else await prisma.post.update({ where: { id: postId }, data: { lastCheckedAt: new Date() } });
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
    const raw = await prisma.systemSetting.findUnique({ where: { key: 'automationSettings' } });
    const screenshotEnabled = raw ? JSON.parse(raw.valueJson).screenshotOnError !== false : true;
    const page = screenshotEnabled && this.browser.isOpen ? await this.browser.page().catch(() => null) : null;
    const captured = page ? await page.screenshot({ path, fullPage: true }).then(() => true).catch(() => false) : false;
    const message = error instanceof Error ? error.message : String(error);
    const manual = error instanceof ManualActionRequiredError;
    const payload = JSON.parse(task.payloadJson) as { postId?: string; groupId?: string };
    const post = payload.postId ? await prisma.post.findUnique({ where:{id:payload.postId} }) : null;
    const errorLog = await prisma.errorLog.create({ data: { type: manual ? error.reason : 'AUTOMATION_ERROR', message: manual ? message : 'تعذر إكمال عملية الأتمتة.', technical: message, stack: error instanceof Error ? error.stack : null, taskId: task.id, postId:post?.id, groupId:payload.groupId ?? post?.groupId, retryCount: task.attempts } });
    if (captured) await prisma.screenshot.create({ data: { path, taskId: task.id, errorId: errorLog.id, postId:post?.id, groupId:payload.groupId ?? post?.groupId } });
    if (post && (manual || post.status === 'POSTING' || task.attempts >= task.maxAttempts)) {
      const next = manual || post.status === 'POSTING' ? 'MANUAL_ACTION_REQUIRED' : 'FAILED';
      await this.postTransition(post.id,post.status,next,message);
    }
    if (manual) {
      await prisma.systemSetting.upsert({ where: { key: 'automationState' }, create: { key: 'automationState', valueJson: JSON.stringify('PAUSED') }, update: { valueJson: JSON.stringify('PAUSED') } });
      await this.notify(error.reason, 'مطلوب تدخل يدوي', message, 'AutomationTask', task.id);
    }
    return manual;
  }

  private activity(action: string, entityType: string, entityId?: string, details?: unknown) { return prisma.activityLog.create({ data: { action, entityType, entityId, detailsJson: details ? JSON.stringify(details) : null, source: 'AUTOMATION' } }); }
  private notify(type: string, title: string, message: string, entityType?: string, entityId?: string) { return prisma.notification.create({ data: { type, title, message, entityType, entityId } }); }
}

export class AutomationPausedError extends Error { constructor() { super("تم إيقاف التشغيل أو فقد ملكية المهمة."); } }
