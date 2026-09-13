import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { ZodError } from 'zod';
import { prisma } from '@repo/database';
import { FacebookBrowser, ManualActionRequiredError } from '@repo/facebook-automation';
import { answersSchema, jobCreateSchema, keywordCreateSchema, keywordUpdateSchema, loginSchema, paginationSchema } from '@repo/shared';
import { ApiError, asyncRoute, hashToken, newToken, parseJson, requireAuth, type AuthenticatedRequest } from './http.js';
import { CoreService } from './service.js';

process.chdir(resolve(import.meta.dirname, '../../..'));
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const core = new CoreService();
const facebook = new FacebookBrowser();
const app: express.Express = express();
const loginFailures = new Map<string, { count: number; resetAt: number }>();
const uploadRoot = resolve(process.env.UPLOAD_PATH ?? './data/uploads');
mkdirSync(uploadRoot, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({ destination: uploadRoot, filename: (_req, file, callback) => callback(null, `${randomUUID()}.${file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg'}`) }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => file.mimetype.startsWith('image/') ? callback(null, true) : callback(new ApiError(400, 'INVALID_IMAGE', 'نوع الصورة غير مسموح.')),
});

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(pinoHttp({ logger, genReqId: (req) => req.headers['x-request-id']?.toString() ?? randomUUID() }));
app.use((req, res, next) => { const allowed = process.env.DASHBOARD_ORIGIN ?? 'http://localhost:5173'; if (req.headers.origin === allowed) { res.header('Access-Control-Allow-Origin', allowed); res.header('Access-Control-Allow-Credentials', 'true'); res.header('Access-Control-Allow-Headers', 'content-type,x-csrf-token,x-request-id,idempotency-key'); res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS'); } if (req.method === 'OPTIONS') return res.sendStatus(204); next(); });
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const openapi = { openapi: '3.0.3', info: { title: 'Facebook Jobs Automation API', version: '1.0.0', description: 'REST API للوحة إدارة نشر الوظائف' }, servers: [{ url: '/api' }], components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'session' } } }, paths: { '/health': { get: { summary: 'Health check', responses: { 200: { description: 'OK' } } } }, '/auth/login': { post: { summary: 'Dashboard login', responses: { 200: { description: 'Authenticated' } } } }, '/groups': { get: { summary: 'List groups', security: [{ session: [] }], responses: { 200: { description: 'Paginated groups' } } } }, '/jobs': { get: { summary: 'List jobs', security: [{ session: [] }], responses: { 200: { description: 'Paginated jobs' } } }, post: { summary: 'Create job', security: [{ session: [] }], responses: { 201: { description: 'Created' } } } }, '/automation/status': { get: { summary: 'Automation status', security: [{ session: [] }], responses: { 200: { description: 'Status' } } } } } };
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));
app.get('/api/openapi.json', (_req, res) => res.json(openapi));
app.get('/api/health', (_req, res) => res.json({ status: 'ok', framework: 'express', dryRun: process.env.DRY_RUN !== 'false', timestamp: new Date().toISOString() }));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const ip = req.ip ?? 'local'; const rate = loginFailures.get(ip);
  if (rate && rate.count >= 5 && rate.resetAt > Date.now()) throw new ApiError(429, 'RATE_LIMITED', 'محاولات دخول كثيرة. حاول بعد 15 دقيقة.');
  const input = loginSchema.parse(req.body);
  const user = await prisma.user.findFirst({ where: { OR: [{ email: input.login }, { username: input.login }], isActive: true } });
  if (!user || !(await argon2.verify(user.passwordHash, input.password))) { loginFailures.set(ip, { count: rate && rate.resetAt > Date.now() ? rate.count + 1 : 1, resetAt: Date.now() + 15 * 60_000 }); throw new ApiError(401, 'INVALID_CREDENTIALS', 'بيانات الدخول غير صحيحة.'); }
  loginFailures.delete(ip);
  const token = newToken(); const csrfToken = newToken();
  await prisma.session.create({ data: { tokenHash: hashToken(token), csrfToken, userId: user.id, expiresAt: new Date(Date.now() + 12 * 60 * 60_000) } });
  res.cookie('session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 60 * 60_000, path: '/' });
  res.json({ user: { id: user.id, username: user.username, email: user.email }, csrfToken });
}));

app.use('/api', requireAuth);
app.get('/api/auth/me', asyncRoute(async (req, res) => res.json({ user: req.user, csrfToken: req.dashboardSession?.csrfToken })));
app.post('/api/auth/logout', asyncRoute(async (req, res) => { const token = req.cookies?.session as string | undefined; if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } }); res.clearCookie('session', { path: '/' }); res.json({ ok: true }); }));

const paging = (query: unknown) => { const parsed = paginationSchema.parse(query); return { ...parsed, skip: (parsed.page - 1) * parsed.pageSize, take: parsed.pageSize }; };

app.get('/api/dashboard', asyncRoute(async (_req, res) => {
  const [groups, accepted, rejected, joined, questions, jobs, posts, pendingPosts, errors, unread] = await Promise.all([prisma.group.count(), prisma.group.count({ where: { decisionStatus: { in: ['ACCEPTED_BY_RULES', 'MANUALLY_ACCEPTED'] } } }), prisma.group.count({ where: { decisionStatus: { in: ['REJECTED_BY_RULES', 'MANUALLY_REJECTED'] } } }), prisma.group.count({ where: { membershipStatus: 'JOINED' } }), prisma.membershipRequest.count({ where: { status: 'NEEDS_QUESTIONS' } }), prisma.job.count({ where: { status: 'ACTIVE' } }), prisma.post.count({ where: { status: { in: ['POSTED', 'APPROVED'] } } }), prisma.post.count({ where: { status: 'PENDING_ADMIN_APPROVAL' } }), prisma.errorLog.count({ where: { resolvedAt: null } }), prisma.notification.count({ where: { readAt: null } })]);
  res.json({ groups, accepted, rejected, joined, questions, jobs, posts, pendingPosts, errors, unread, dryRun: process.env.DRY_RUN !== 'false' });
}));

app.get('/api/keywords', asyncRoute(async (req, res) => { const q = paging(req.query); const where = q.search ? { keyword: { contains: q.search } } : {}; const [items, total] = await Promise.all([prisma.searchKeyword.findMany({ where, skip: q.skip, take: q.take, orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }] }), prisma.searchKeyword.count({ where })]); res.json({ items, total, page: q.page, pageSize: q.pageSize }); }));
app.post('/api/keywords', asyncRoute(async (req, res) => { const input = keywordCreateSchema.parse(req.body); const item = await prisma.searchKeyword.create({ data: input }); await core.log('KEYWORD_CREATED', 'SearchKeyword', item.id, req.user?.id, input); res.status(201).json(item); }));
app.patch('/api/keywords/:id', asyncRoute(async (req, res) => { const input = keywordUpdateSchema.parse(req.body); const item = await prisma.searchKeyword.update({ where: { id: req.params.id }, data: input }); await core.log('KEYWORD_UPDATED', 'SearchKeyword', item.id, req.user?.id, input); res.json(item); }));
app.delete('/api/keywords/:id', asyncRoute(async (req, res) => { await prisma.searchKeyword.delete({ where: { id: req.params.id } }); await core.log('KEYWORD_DELETED', 'SearchKeyword', req.params.id, req.user?.id); res.json({ ok: true }); }));
app.post('/api/keywords/:id/search', asyncRoute(async (req, res) => { const item = await prisma.searchKeyword.findUnique({ where: { id: req.params.id } }); if (!item) throw new ApiError(404, 'NOT_FOUND', 'كلمة البحث غير موجودة.'); res.status(202).json(await core.enqueue('DISCOVER_GROUPS', { keywordId: item.id }, `discover:${item.id}:${new Date().toISOString().slice(0, 10)}`)); }));

app.get('/api/groups', asyncRoute(async (req, res) => { const q = paging(req.query); const status = typeof req.query.status === 'string' ? req.query.status : undefined; const membershipStatus = typeof req.query.membershipStatus === 'string' ? req.query.membershipStatus : undefined; const where = { ...(q.search ? { name: { contains: q.search } } : {}), ...(status ? { decisionStatus: status } : {}), ...(membershipStatus ? { membershipStatus } : {}) }; const [items, total] = await Promise.all([prisma.group.findMany({ where, skip: q.skip, take: q.take, orderBy: { discoveredAt: 'desc' }, include: { keywords: { include: { keyword: true } }, blacklist: true } }), prisma.group.count({ where })]); res.json({ items, total, page: q.page, pageSize: q.pageSize }); }));
app.get('/api/groups/:id', asyncRoute(async (req, res) => { const item = await prisma.group.findUnique({ where: { id: req.params.id }, include: { keywords: { include: { keyword: true } }, metrics: { orderBy: { measuredAt: 'desc' }, take: 10 }, analyses: { orderBy: { createdAt: 'desc' } }, membershipRequests: { include: { questions: { include: { answer: true } }, history: true } }, posts: true, notes: true, errors: true, screenshots: true, rule: true, blacklist: true } }); if (!item) throw new ApiError(404, 'NOT_FOUND', 'الجروب غير موجود.'); res.json(item); }));
app.post('/api/groups/:id/analyze', asyncRoute(async (req, res) => res.json(await core.analyzeGroup(req.params.id, req.user?.id))));
app.post('/api/groups/:id/join', asyncRoute(async (req, res) => res.status(202).json(await core.enqueue('JOIN_GROUP', { groupId: req.params.id }, `join:${req.params.id}`))));
app.post('/api/groups/:id/decision', asyncRoute(async (req, res) => { if (typeof req.body.accepted !== 'boolean' || !req.body.reason) throw new ApiError(400, 'INVALID_DECISION', 'القرار والسبب مطلوبان.'); const decisionStatus = req.body.accepted ? 'MANUALLY_ACCEPTED' : 'MANUALLY_REJECTED'; const item = await prisma.group.update({ where: { id: req.params.id }, data: { decisionStatus, decisionReasonJson: JSON.stringify({ reason: req.body.reason }) } }); await core.log('GROUP_DECISION_OVERRIDDEN', 'Group', item.id, req.user?.id, req.body); res.json(item); }));
app.post('/api/groups/:id/notes', asyncRoute(async (req, res) => { if (!req.body.text?.trim()) throw new ApiError(400, 'INVALID_NOTE', 'الملاحظة مطلوبة.'); const item = await prisma.groupNote.create({ data: { groupId: req.params.id, text: req.body.text.trim() } }); await core.log('GROUP_NOTE_ADDED', 'Group', req.params.id, req.user?.id); res.status(201).json(item); }));
app.post('/api/groups/:id/blacklist', asyncRoute(async (req, res) => { if (!req.body.reason?.trim()) throw new ApiError(400, 'INVALID_REASON', 'سبب القائمة السوداء مطلوب.'); const item = await prisma.blacklist.upsert({ where: { groupId: req.params.id }, create: { groupId: req.params.id, reason: req.body.reason }, update: { reason: req.body.reason } }); await core.log('GROUP_BLACKLISTED', 'Group', req.params.id, req.user?.id, req.body); res.json(item); }));

app.get('/api/membership/questions', asyncRoute(async (_req, res) => res.json(await prisma.membershipRequest.findMany({ where: { status: 'NEEDS_QUESTIONS' }, include: { group: true, questions: { include: { answer: true }, orderBy: { position: 'asc' } } }, orderBy: { updatedAt: 'asc' } }))));
app.post('/api/membership/:id/answers', asyncRoute(async (req, res) => { const input = answersSchema.parse(req.body); const request = await prisma.membershipRequest.findUnique({ where: { id: req.params.id }, include: { questions: true } }); if (!request) throw new ApiError(404, 'NOT_FOUND', 'طلب الانضمام غير موجود.'); const valid = new Set(request.questions.map((question) => question.id)); if (input.answers.some((answer) => !valid.has(answer.questionId))) throw new ApiError(400, 'INVALID_ANSWER', 'توجد إجابة لا تنتمي إلى هذا الطلب.'); await prisma.$transaction(input.answers.map((answer) => prisma.membershipAnswer.upsert({ where: { questionId: answer.questionId }, create: { questionId: answer.questionId, valueJson: JSON.stringify(answer.value) }, update: { valueJson: JSON.stringify(answer.value) } }))); await prisma.membershipRequest.update({ where: { id: request.id }, data: { status: 'QUESTIONS_ANSWERED' } }); await core.log('MEMBERSHIP_ANSWERS_SAVED', 'MembershipRequest', request.id, req.user?.id); res.status(202).json(await core.enqueue('SUBMIT_GROUP_QUESTIONS', { requestId: request.id }, `answers:${request.id}:${request.questionsHash}`)); }));

app.get('/api/jobs', asyncRoute(async (req, res) => { const q = paging(req.query); const where = q.search ? { title: { contains: q.search } } : {}; const [items, total] = await Promise.all([prisma.job.findMany({ where, skip: q.skip, take: q.take, orderBy: { createdAt: 'desc' }, include: { targeting: true, campaigns: true, _count: { select: { posts: true } } } }), prisma.job.count({ where })]); res.json({ items, total, page: q.page, pageSize: q.pageSize }); }));
app.post('/api/jobs', asyncRoute(async (req, res) => { const { targeting, ...input } = jobCreateSchema.parse(req.body); const item = await prisma.job.create({ data: { ...input, targeting: targeting ? { create: { locationsJson: JSON.stringify(targeting.locations), requiredKeywordsJson: JSON.stringify(targeting.requiredKeywords), minScore: targeting.minScore, minMembers: targeting.minMembers, includeGroupIdsJson: JSON.stringify(targeting.includeGroupIds), excludeGroupIdsJson: JSON.stringify(targeting.excludeGroupIds) } } : undefined }, include: { targeting: true } }); await core.log('JOB_CREATED', 'Job', item.id, req.user?.id); res.status(201).json(item); }));
app.post('/api/jobs/:id/image', upload.single('image'), asyncRoute(async (req, res) => { if (!req.file) throw new ApiError(400, 'IMAGE_REQUIRED', 'الصورة مطلوبة.'); const item = await prisma.job.update({ where: { id: req.params.id }, data: { imagePath: req.file.path } }); await core.log('JOB_IMAGE_UPDATED', 'Job', item.id, req.user?.id); res.json({ imagePath: item.imagePath }); }));
app.post('/api/jobs/:id/status', asyncRoute(async (req, res) => { const allowed = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']; if (!allowed.includes(req.body.status)) throw new ApiError(400, 'INVALID_STATUS', 'حالة الوظيفة غير صالحة.'); const item = await prisma.job.update({ where: { id: req.params.id }, data: { status: req.body.status } }); await core.log('JOB_STATUS_CHANGED', 'Job', item.id, req.user?.id, req.body); res.json(item); }));

async function eligibleGroups(jobId: string) { const job = await prisma.job.findUnique({ where: { id: jobId }, include: { targeting: true } }); if (!job) throw new ApiError(404, 'NOT_FOUND', 'الوظيفة غير موجودة.'); const included = new Set<string>(parseJson(job.targeting?.includeGroupIdsJson, [])); const excluded = new Set<string>(parseJson(job.targeting?.excludeGroupIdsJson, [])); const groups = await prisma.group.findMany({ where: { membershipStatus: 'JOINED', postingEnabled: true, blacklist: null } }); return groups.filter((group) => !excluded.has(group.id) && (included.has(group.id) || ((!job.targeting?.minScore || (group.score ?? 0) >= job.targeting.minScore) && (!job.targeting?.minMembers || (group.membersCount ?? 0) >= job.targeting.minMembers)))); }
app.get('/api/jobs/:id/eligible-groups', asyncRoute(async (req, res) => res.json(await eligibleGroups(req.params.id))));
app.post('/api/jobs/:id/publish', asyncRoute(async (req, res) => { const eligible = await eligibleGroups(req.params.id); const ids = Array.isArray(req.body.groupIds) ? req.body.groupIds as string[] : []; const selected = ids.length ? eligible.filter((group) => ids.includes(group.id)) : eligible; if (!selected.length) throw new ApiError(400, 'NO_ELIGIBLE_GROUPS', 'لا توجد جروبات مؤهلة مختارة.'); const scheduledAt = req.body.scheduledAt ? new Date(req.body.scheduledAt) : null; const campaign = await prisma.campaign.create({ data: { jobId: req.params.id, status: scheduledAt ? 'SCHEDULED' : 'ACTIVE', scheduledAt, groups: { create: selected.map((group) => ({ groupId: group.id })) } } }); await prisma.job.update({ where: { id: req.params.id }, data: { status: 'ACTIVE' } }); const task = await core.queue.enqueue('PUBLISH_JOB', { campaignId: campaign.id }, `campaign:${campaign.id}`, { runAt: scheduledAt ?? undefined }); await core.log('CAMPAIGN_CREATED', 'Campaign', campaign.id, req.user?.id, { groups: selected.length }); res.status(201).json({ campaign, task }); }));
app.get('/api/campaigns/:id', asyncRoute(async (req, res) => { const item = await prisma.campaign.findUnique({ where: { id: req.params.id }, include: { job: true, groups: { include: { group: true } }, posts: { include: { group: true, history: true } } } }); if (!item) throw new ApiError(404, 'NOT_FOUND', 'الحملة غير موجودة.'); res.json(item); }));
app.post('/api/campaigns/:id/status', asyncRoute(async (req, res) => { if (!['ACTIVE', 'PAUSED', 'COMPLETED'].includes(req.body.status)) throw new ApiError(400, 'INVALID_STATUS', 'حالة الحملة غير صالحة.'); const item = await prisma.campaign.update({ where: { id: req.params.id }, data: { status: req.body.status } }); await core.log('CAMPAIGN_STATUS_CHANGED', 'Campaign', item.id, req.user?.id, req.body); res.json(item); }));

app.get('/api/posts', asyncRoute(async (req, res) => { const q = paging(req.query); const status = typeof req.query.status === 'string' ? req.query.status : undefined; const where = status ? { status } : {}; const [items, total] = await Promise.all([prisma.post.findMany({ where, skip: q.skip, take: q.take, orderBy: { createdAt: 'desc' }, include: { job: true, group: true } }), prisma.post.count({ where })]); res.json({ items, total }); }));
app.post('/api/posts/:id/status', asyncRoute(async (req, res) => { const post = await prisma.post.findUnique({ where: { id: req.params.id } }); if (!post) throw new ApiError(404, 'NOT_FOUND', 'المنشور غير موجود.'); const item = await prisma.post.update({ where: { id: post.id }, data: { status: req.body.status, history: { create: { fromStatus: post.status, toStatus: req.body.status, reason: req.body.reason, source: 'USER' } } } }); await core.log('POST_STATUS_OVERRIDDEN', 'Post', item.id, req.user?.id, req.body); res.json(item); }));
app.post('/api/posts/:id/repost', asyncRoute(async (req, res) => { const original = await prisma.post.findUnique({ where: { id: req.params.id } }); if (!original) throw new ApiError(404, 'NOT_FOUND', 'المنشور غير موجود.'); const latest = await prisma.post.aggregate({ where: { jobId: original.jobId, groupId: original.groupId }, _max: { repostNumber: true } }); const repostNumber = (latest._max.repostNumber ?? 0) + 1; const item = await prisma.post.create({ data: { jobId: original.jobId, groupId: original.groupId, campaignId: original.campaignId, content: original.content, repostNumber, originalPostId: original.originalPostId ?? original.id } }); await core.enqueue('PUBLISH_POST', { postId: item.id }, `publish:${item.id}:${repostNumber}`); await core.log('POST_REPOST_REQUESTED', 'Post', item.id, req.user?.id, { originalId: original.id, repostNumber }); res.status(201).json(item); }));

app.get('/api/notifications', asyncRoute(async (req, res) => { const q = paging(req.query); const [items, total] = await Promise.all([prisma.notification.findMany({ skip: q.skip, take: q.take, orderBy: { createdAt: 'desc' } }), prisma.notification.count()]); res.json({ items, total }); }));
app.post('/api/notifications/:id/read', asyncRoute(async (req, res) => res.json(await prisma.notification.update({ where: { id: req.params.id }, data: { readAt: new Date() } }))));
app.get('/api/activity', asyncRoute(async (req, res) => { const q = paging(req.query); const [items, total] = await Promise.all([prisma.activityLog.findMany({ skip: q.skip, take: q.take, orderBy: { createdAt: 'desc' }, include: { user: { select: { username: true } } } }), prisma.activityLog.count()]); res.json({ items, total }); }));
app.get('/api/tasks', asyncRoute(async (req, res) => { const q = paging(req.query); const status = typeof req.query.status === 'string' ? req.query.status : undefined; const where = status ? { status } : {}; const [items, total] = await Promise.all([prisma.automationTask.findMany({ where, skip: q.skip, take: q.take, orderBy: { createdAt: 'desc' } }), prisma.automationTask.count({ where })]); res.json({ items, total }); }));
app.get('/api/errors', asyncRoute(async (req, res) => { const q = paging(req.query); const where = req.query.resolved === 'true' ? { resolvedAt: { not: null } } : req.query.resolved === 'all' ? {} : { resolvedAt: null }; const [items, total] = await Promise.all([prisma.errorLog.findMany({ where, skip: q.skip, take: q.take, orderBy: { createdAt: 'desc' }, include: { screenshots: true } }), prisma.errorLog.count({ where })]); res.json({ items, total }); }));
app.post('/api/errors/:id/resolve', asyncRoute(async (req, res) => { const item = await prisma.errorLog.update({ where: { id: req.params.id }, data: { resolvedAt: new Date() } }); await core.log('ERROR_RESOLVED', 'ErrorLog', item.id, req.user?.id); res.json(item); }));
app.get('/api/screenshots/:id', asyncRoute(async (req, res) => { const item = await prisma.screenshot.findUnique({ where: { id: req.params.id } }); if (!item) throw new ApiError(404, 'NOT_FOUND', 'لقطة الشاشة غير موجودة.'); const absolute = resolve(item.path); const root = resolve(process.env.SCREENSHOT_PATH ?? './data/screenshots'); const pathFromRoot = relative(root, absolute); if (pathFromRoot.startsWith('..') || pathFromRoot.includes(':')) throw new ApiError(400, 'INVALID_PATH', 'مسار لقطة الشاشة غير صالح.'); res.sendFile(absolute); }));
app.get('/api/templates', asyncRoute(async (_req, res) => res.json(await prisma.postTemplate.findMany({ orderBy: { name: 'asc' } }))));
app.post('/api/templates', asyncRoute(async (req, res) => { if (!req.body.name?.trim() || !req.body.body?.trim()) throw new ApiError(400, 'INVALID_TEMPLATE', 'اسم القالب ومحتواه مطلوبان.'); const item = await prisma.postTemplate.create({ data: { name: req.body.name.trim(), body: req.body.body } }); await core.log('TEMPLATE_CREATED', 'PostTemplate', item.id, req.user?.id); res.status(201).json(item); }));

app.get('/api/automation/status', asyncRoute(async (_req, res) => { const item = await prisma.systemSetting.findUnique({ where: { key: 'automationState' } }); res.json({ state: parseJson(item?.valueJson, 'STOPPED'), dryRun: process.env.DRY_RUN !== 'false' }); }));
app.post('/api/automation/:action', asyncRoute(async (req, res) => { const states: Record<string, string> = { start: 'RUNNING', resume: 'RUNNING', pause: 'PAUSED', stop: 'STOPPED', emergency: 'EMERGENCY_STOPPED' }; const state = states[req.params.action]; if (!state) throw new ApiError(400, 'INVALID_ACTION', 'أمر التشغيل غير معروف.'); await prisma.systemSetting.upsert({ where: { key: 'automationState' }, create: { key: 'automationState', valueJson: JSON.stringify(state) }, update: { valueJson: JSON.stringify(state) } }); await core.log(`AUTOMATION_${state}`, 'System', null, req.user?.id); res.json({ state }); }));
app.get('/api/settings', asyncRoute(async (_req, res) => { const items = await prisma.systemSetting.findMany(); res.json(Object.fromEntries(items.map((item) => [item.key, parseJson(item.valueJson, null)]))); }));
app.patch('/api/settings', asyncRoute(async (req, res) => { const allowed = ['globalGroupRules', 'scoreWeights', 'automationSettings']; const entries = Object.entries(req.body as Record<string, unknown>).filter(([key]) => allowed.includes(key)); await prisma.$transaction(entries.map(([key, value]) => prisma.systemSetting.upsert({ where: { key }, create: { key, valueJson: JSON.stringify(value) }, update: { valueJson: JSON.stringify(value) } }))); await core.log('SETTINGS_UPDATED', 'System', null, req.user?.id, { keys: entries.map(([key]) => key) }); res.json({ ok: true }); }));

app.post('/api/facebook/open-session', asyncRoute(async (_req, res) => { const page = await facebook.page(); await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' }); res.json({ status: 'OPEN', message: 'أكمل تسجيل الدخول يدويًا في نافذة المتصفح.' }); }));
app.post('/api/facebook/close-session', asyncRoute(async (_req, res) => { await facebook.close(); res.json({ ok: true }); }));
app.get('/api/facebook/status', asyncRoute(async (_req, res) => { try { const status = await facebook.checkSession(); await prisma.facebookSession.upsert({ where: { id: 'primary' }, create: { id: 'primary', profilePath: facebook.profilePath, status, lastCheckedAt: new Date(), lastConnectedAt: status === 'CONNECTED' ? new Date() : null }, update: { status, lastCheckedAt: new Date(), lastConnectedAt: status === 'CONNECTED' ? new Date() : undefined, manualReason: null } }); res.json({ status }); } catch (error) { const status = error instanceof ManualActionRequiredError ? 'MANUAL_ACTION_REQUIRED' : 'DISCONNECTED'; await prisma.facebookSession.upsert({ where: { id: 'primary' }, create: { id: 'primary', profilePath: facebook.profilePath, status, manualReason: error instanceof Error ? error.message : String(error) }, update: { status, manualReason: error instanceof Error ? error.message : String(error), lastCheckedAt: new Date() } }); res.json({ status, message: error instanceof Error ? error.message : String(error) }); } }));

app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'المسار المطلوب غير موجود.')));
app.use((error: unknown, req: AuthenticatedRequest, res: express.Response, _next: express.NextFunction) => {
  const status = error instanceof ApiError ? error.status : error instanceof ZodError ? 400 : 500;
  const code = error instanceof ApiError ? error.code : error instanceof ZodError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR';
  const message = error instanceof ZodError ? error.issues.map((issue) => issue.message).join('، ') : error instanceof Error ? error.message : 'حدث خطأ غير متوقع.';
  if (status >= 500) req.log?.error({ err: error }, 'request failed');
  res.status(status).json({ error: { code, message: status >= 500 ? 'حدث خطأ غير متوقع.' : message, technical: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined, requestId: req.id } });
});

export { app };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => logger.info({ port: process.env.PORT ?? 3000, framework: 'express' }, 'API started'));
  const shutdown = async () => { server.close(); await facebook.close(); await prisma.$disconnect(); };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
