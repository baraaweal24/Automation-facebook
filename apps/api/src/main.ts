import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
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
import { z, ZodError } from 'zod';
import { prisma, acquireProcessLock } from '@repo/database';
import { FacebookBrowser, ManualActionRequiredError, parsePostUrl } from '@repo/facebook-automation';
import { answersSchema, jobCreateSchema, keywordCreateSchema, keywordUpdateSchema, loginSchema, paginationSchema, publishSchema, settingsSchema, postDecisionSchema } from '@repo/shared';
import { ApiError, asyncRoute, hashToken, newToken, parseJson, requireAuth, type AuthenticatedRequest } from './http.js';
import { CoreService } from './service.js';
import { createCampaign, eligibleGroups } from './campaigns.js';
import { chatgpt, registerContentRoutes } from './content.js';

process.chdir(resolve(import.meta.dirname, '../../..'));
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.cookie','req.headers.authorization','req.headers["x-csrf-token"]'] });
const core = new CoreService();
const facebook = new FacebookBrowser();
const app: express.Express = express();
const loginFailures = new Map<string, { count: number; resetAt: number }>();
const uploadRoot = resolve(process.env.UPLOAD_PATH ?? './data/uploads');
mkdirSync(uploadRoot, { recursive: true });

const enqueueJoinedGroupsSync = async () => {
  const pending = await prisma.automationTask.findFirst({ where: { type: 'SYNC_JOINED_GROUPS', status: { in: ['QUEUED','RUNNING','RETRY'] } } });
  return pending ?? core.enqueue('SYNC_JOINED_GROUPS', {}, `sync-groups:${randomUUID()}`);
};

const upload = multer({
  storage: multer.diskStorage({ destination: uploadRoot, filename: (_req, file, callback) => callback(null, `${randomUUID()}.${file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg'}`) }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => ['image/png','image/jpeg','image/webp'].includes(file.mimetype) ? callback(null, true) : callback(new ApiError(400, 'INVALID_IMAGE', 'نوع الصورة غير مسموح.')),
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
registerContentRoutes(app, core);
app.post('/api/tasks/:id/retry', asyncRoute(async(req,res)=>{
  const task=await prisma.automationTask.findUniqueOrThrow({where:{id:req.params.id}});
  if(!['FAILED','MANUAL_ACTION_REQUIRED','PAUSED'].includes(task.status))throw new ApiError(409,'TASK_NOT_RETRYABLE','المهمة لا تحتاج إعادة محاولة.');
  if(task.type==='PUBLISH_POST')throw new ApiError(409,'REVIEW_POST_FIRST','راجع المنشور من تقرير الحملة قبل إعادة الإرسال.');
  await prisma.automationTask.update({where:{id:task.id},data:{status:'RETRY',attempts:0,runAt:new Date(),lastError:null,leaseToken:null,leaseExpiresAt:null}});
  await core.log('TASK_RETRIED','AutomationTask',task.id,req.user?.id);res.json({ok:true});
}));
app.get('/api/auth/me', asyncRoute(async (req, res) => res.json({ user: req.user, csrfToken: req.dashboardSession?.csrfToken })));
app.post('/api/auth/logout', asyncRoute(async (req, res) => { const token = req.cookies?.session as string | undefined; if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } }); res.clearCookie('session', { path: '/' }); res.json({ ok: true }); }));

const paging = (query: unknown) => { const parsed = paginationSchema.parse(query); return { ...parsed, skip: (parsed.page - 1) * parsed.pageSize, take: parsed.pageSize }; };
const serializeJob = <T extends { vacationSystemJson: string; conditionsJson: string; benefitsJson: string; requiredDocumentsJson: string; freeCoursesJson: string }>(job: T) => ({
  ...job,
  vacationSystem: parseJson(job.vacationSystemJson, []),
  conditions: parseJson(job.conditionsJson, []),
  benefitsList: parseJson(job.benefitsJson, []),
  requiredDocuments: parseJson(job.requiredDocumentsJson, []),
  freeCourses: parseJson(job.freeCoursesJson, []),
});

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
app.post('/api/groups/:id/analyze', asyncRoute(async (req, res) => res.status(202).json(await core.enqueue('ANALYZE_GROUP', { groupId: req.params.id }, `manual-analyze:${req.params.id}:${randomUUID()}`))));
app.post('/api/groups/:id/join', asyncRoute(async (req, res) => res.status(202).json(await core.enqueue('JOIN_GROUP', { groupId: req.params.id }, `join:${req.params.id}:${process.env.DRY_RUN !== 'false' ? 'dry' : 'live'}`))));
app.post('/api/groups/:id/decision', asyncRoute(async (req, res) => { if (typeof req.body.accepted !== 'boolean' || !req.body.reason) throw new ApiError(400, 'INVALID_DECISION', 'القرار والسبب مطلوبان.'); const decisionStatus = req.body.accepted ? 'MANUALLY_ACCEPTED' : 'MANUALLY_REJECTED'; const item = await prisma.group.update({ where: { id: req.params.id }, data: { decisionStatus, decisionReasonJson: JSON.stringify({ reason: req.body.reason }) } }); await core.log('GROUP_DECISION_OVERRIDDEN', 'Group', item.id, req.user?.id, req.body); res.json(item); }));
app.post('/api/groups/:id/notes', asyncRoute(async (req, res) => { if (!req.body.text?.trim()) throw new ApiError(400, 'INVALID_NOTE', 'الملاحظة مطلوبة.'); const item = await prisma.groupNote.create({ data: { groupId: req.params.id, text: req.body.text.trim() } }); await core.log('GROUP_NOTE_ADDED', 'Group', req.params.id, req.user?.id); res.status(201).json(item); }));
app.post('/api/groups/:id/blacklist', asyncRoute(async (req, res) => { if (!req.body.reason?.trim()) throw new ApiError(400, 'INVALID_REASON', 'سبب القائمة السوداء مطلوب.'); const item = await prisma.blacklist.upsert({ where: { groupId: req.params.id }, create: { groupId: req.params.id, reason: req.body.reason }, update: { reason: req.body.reason } }); await core.log('GROUP_BLACKLISTED', 'Group', req.params.id, req.user?.id, req.body); res.json(item); }));

app.get('/api/membership/questions', asyncRoute(async (_req, res) => res.json(await prisma.membershipRequest.findMany({ where: { status: 'NEEDS_QUESTIONS' }, include: { group: true, questions: { include: { answer: true }, orderBy: { position: 'asc' } } }, orderBy: { updatedAt: 'asc' } }))));
app.post('/api/membership/:id/answers', asyncRoute(async (req, res) => { const input = answersSchema.parse(req.body); const request = await prisma.membershipRequest.findUnique({ where: { id: req.params.id }, include: { questions: true } }); if (!request) throw new ApiError(404, 'NOT_FOUND', 'طلب الانضمام غير موجود.'); const valid = new Set(request.questions.map((question) => question.id)); if (input.answers.some((answer) => !valid.has(answer.questionId))) throw new ApiError(400, 'INVALID_ANSWER', 'توجد إجابة لا تنتمي إلى هذا الطلب.'); await prisma.$transaction(input.answers.map((answer) => prisma.membershipAnswer.upsert({ where: { questionId: answer.questionId }, create: { questionId: answer.questionId, valueJson: JSON.stringify(answer.value) }, update: { valueJson: JSON.stringify(answer.value) } }))); await prisma.membershipRequest.update({ where: { id: request.id }, data: { status: 'QUESTIONS_ANSWERED' } }); await core.log('MEMBERSHIP_ANSWERS_SAVED', 'MembershipRequest', request.id, req.user?.id); res.status(202).json(await core.enqueue('SUBMIT_GROUP_QUESTIONS', { requestId: request.id }, `answers:${request.id}:${request.questionsHash}`)); }));

app.get('/api/jobs', asyncRoute(async (req, res) => { const q = paging(req.query); const category = typeof req.query.category === 'string' ? req.query.category : undefined; const where = { ...(q.search ? { title: { contains: q.search } } : {}), ...(category ? { category } : {}) }; const [items, total] = await Promise.all([prisma.job.findMany({ where, skip: q.skip, take: q.take, orderBy: { createdAt: 'desc' }, include: { targeting: true, campaigns: true, _count: { select: { posts: true } } } }), prisma.job.count({ where })]); res.json({ items: items.map(serializeJob), total, page: q.page, pageSize: q.pageSize }); }));
app.get('/api/jobs/:id', asyncRoute(async (req,res) => { const job = await prisma.job.findUnique({ where: { id:req.params.id }, include: { targeting:true } }); if (!job) throw new ApiError(404,'NOT_FOUND','الوظيفة غير موجودة.'); res.json(serializeJob(job)); }));
app.post('/api/jobs', asyncRoute(async (req, res) => {
  const { targeting, vacationSystem, conditions, benefitsList, requiredDocuments, freeCourses, ...input } = jobCreateSchema.parse(req.body);
  const item = await prisma.job.create({ data: {
    ...input,
    vacationSystemJson: JSON.stringify(vacationSystem), conditionsJson: JSON.stringify(conditions), benefitsJson: JSON.stringify(benefitsList),
    requiredDocumentsJson: JSON.stringify(requiredDocuments), freeCoursesJson: JSON.stringify(freeCourses),
    targeting: targeting ? { create: { locationsJson: JSON.stringify(targeting.locations), requiredKeywordsJson: JSON.stringify(targeting.requiredKeywords), minScore: targeting.minScore, minMembers: targeting.minMembers, includeGroupIdsJson: JSON.stringify(targeting.includeGroupIds), excludeGroupIdsJson: JSON.stringify(targeting.excludeGroupIds) } } : undefined,
  }, include: { targeting: true } });
  await core.log('JOB_CREATED', 'Job', item.id, req.user?.id, { category: item.category, title: item.title });
  res.status(201).json(serializeJob(item));
}));
app.post('/api/jobs/:id/image', upload.single('image'), asyncRoute(async(req,res)=>{
  if (!req.file) throw new ApiError(400,'IMAGE_REQUIRED','الصورة مطلوبة.');
  try {
    const bytes=await readFile(req.file.path);
    const valid=req.file.mimetype==='image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : req.file.mimetype==='image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 : bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
    if(!valid) throw new ApiError(400,'INVALID_IMAGE','محتوى الملف لا يطابق نوع الصورة.');
    const item=await prisma.job.update({where:{id:req.params.id},data:{imagePath:req.file.path}});
    await core.log('JOB_IMAGE_UPDATED','Job',item.id,req.user?.id);res.json({imagePath:item.imagePath});
  } catch(error) { await unlink(req.file.path).catch(()=>undefined);throw error; }
}));
app.post('/api/jobs/:id/status', asyncRoute(async (req, res) => { const allowed = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']; if (!allowed.includes(req.body.status)) throw new ApiError(400, 'INVALID_STATUS', 'حالة الوظيفة غير صالحة.'); const item = await prisma.job.update({ where: { id: req.params.id }, data: { status: req.body.status } }); await core.log('JOB_STATUS_CHANGED', 'Job', item.id, req.user?.id, req.body); res.json(item); }));


app.get('/api/jobs/:id/eligible-groups', asyncRoute(async (req, res) => res.json(await eligibleGroups(req.params.id))));
app.post('/api/jobs/:id/publish', asyncRoute(async (req, res) => {
  const input = publishSchema.parse(req.body);
  const eligible = await eligibleGroups(req.params.id);
  if (input.groupIds.some(id => !eligible.some(group => group.id === id))) throw new ApiError(400, 'INELIGIBLE_GROUP', 'بعض الجروبات لا تحقق استهداف الوظيفة.');
  const job = await prisma.job.findUniqueOrThrow({ where: { id: req.params.id } });
  res.status(201).json(await createCampaign({ ...input, jobId: job.id, title: job.title, content: job.finalText, userId: req.user?.id }));
}));
app.get('/api/campaigns/:id', asyncRoute(async (req, res) => { const item = await prisma.campaign.findUnique({ where: { id: req.params.id }, include: { job: true, groups: { include: { group: true } }, posts: { include: { group: true, history: true } } } }); if (!item) throw new ApiError(404, 'NOT_FOUND', 'الحملة غير موجودة.'); res.json(item); }));
app.get('/api/campaigns/:id/export', asyncRoute(async (req,res) => {
  const campaign = await prisma.campaign.findUniqueOrThrow({ where:{id:req.params.id}, include:{posts:{include:{group:true,history:{orderBy:{createdAt:'desc'}}}}} });
  const cell = (value: unknown) => { const text=String(value ?? ''); return '"'+(/^[=+@\-\t\r]/.test(text) ? "'"+text : text).replace(/"/g,'""')+'"'; };
  const rows = [['الجروب','الحالة','رابط المنشور','وقت النشر','السبب'],...campaign.posts.map(p=>[p.group.name,p.status,p.facebookUrl,p.postedAt?.toISOString(),p.history.find(h=>h.reason)?.reason])];
  res.type('text/csv; charset=utf-8').attachment(`campaign-${campaign.id}.csv`).send('\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n'));
}));
app.post('/api/campaigns/:id/status', asyncRoute(async (req, res) => {
  const status = z.enum(['ACTIVE','PAUSED','COMPLETED']).parse(req.body.status);
  const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: req.params.id } });
  if (status === 'ACTIVE' && campaign.dryRun !== (process.env.DRY_RUN !== 'false')) throw new ApiError(409,'MODE_CHANGED','أنشئ حملة جديدة بعد تغيير وضع الاختبار.');
  const item = await prisma.campaign.update({ where: { id: campaign.id }, data: { status } });
  if (status === 'ACTIVE') {
    const posts = await prisma.post.findMany({ where: { campaignId: campaign.id }, select: { id: true } });
    const paused = await prisma.automationTask.findMany({ where: { status: 'PAUSED' } });
    const ids = paused.filter(task => { const p = parseJson<Record<string,string>>(task.payloadJson, {}); return p.campaignId === campaign.id || posts.some(post => post.id === p.postId); }).map(t => t.id);
    await prisma.automationTask.updateMany({ where: { id: { in: ids } }, data: { status: 'RETRY', runAt: new Date() } });
    await core.enqueue('PUBLISH_JOB', { campaignId: campaign.id }, `campaign-resume:${campaign.id}:${randomUUID()}`);
  }
  await core.log('CAMPAIGN_STATUS_CHANGED','Campaign',item.id,req.user?.id,{ status });
  res.json(item);
}));

app.get('/api/posts', asyncRoute(async (req, res) => { const q = paging(req.query); const status = typeof req.query.status === 'string' ? req.query.status : undefined; const where = status ? { status } : {}; const [items, total] = await Promise.all([prisma.post.findMany({ where, skip: q.skip, take: q.take, orderBy: { createdAt: 'desc' }, include: { job: true, group: true } }), prisma.post.count({ where })]); res.json({ items, total }); }));
app.post('/api/posts/:id/status', asyncRoute(async (req, res) => {
  const input = postDecisionSchema.parse(req.body);
  const post = await prisma.post.findUniqueOrThrow({ where: { id: req.params.id }, include: { group: true, campaign: true } });
  if (!['MANUAL_ACTION_REQUIRED','FAILED','PENDING_ADMIN_APPROVAL','POSTED','WOULD_POST','SKIPPED'].includes(post.status)) throw new ApiError(409,'INVALID_TRANSITION','هذه الحالة لا تقبل القرار اليدوي.');
  if (input.status === 'QUEUED' && !input.confirmedAbsent) throw new ApiError(400,'VERIFY_ABSENCE','أكد مراجعة الجروب وعدم وجود المنشور قبل إعادة الإرسال.');
  if (input.status === 'QUEUED' && (post.campaign.dryRun !== (process.env.DRY_RUN !== 'false') || post.status === 'WOULD_POST')) throw new ApiError(409,'MODE_CHANGED','أنشئ حملة جديدة لنشر نتيجة الاختبار.');
  const link = input.facebookUrl ? parsePostUrl(input.facebookUrl, post.group.canonicalUrl) : null;
  if (['POSTED','APPROVED'].includes(input.status) && !link) throw new ApiError(400,'POST_LINK_REQUIRED','أدخل رابط المنشور داخل نفس الجروب.');
  const item = await prisma.$transaction(async tx => {
    const updated = await tx.post.update({ where: { id: post.id }, data: { status: input.status, ...(link ?? {}), ...(['POSTED','APPROVED','PENDING_ADMIN_APPROVAL'].includes(input.status) ? { postedAt: post.postedAt ?? new Date() } : {}), history: { create: { fromStatus: post.status, toStatus: input.status, reason: input.reason, source: 'USER' } } } });
    if (input.status === 'QUEUED') {
      await tx.campaign.update({ where: { id: post.campaignId }, data: { status: 'ACTIVE', completedAt: null } });
      const key = `publish:${post.id}:0`;
      await tx.automationTask.upsert({ where: { idempotencyKey: key }, create: { type: 'PUBLISH_POST', payloadJson: JSON.stringify({postId:post.id}), idempotencyKey:key }, update: { status:'RETRY', attempts:0, runAt:new Date(), leaseToken:null, leaseExpiresAt:null } });
    }
    await tx.activityLog.create({data:{action:'POST_STATUS_OVERRIDDEN',entityType:'Post',entityId:post.id,userId:req.user?.id,source:'USER',detailsJson:JSON.stringify(input)}});
    return updated;
  });
  res.json(item);
}));
app.post('/api/posts/:id/repost', asyncRoute(async(req,res)=>{
  const input=z.object({requestKey:z.string().uuid(),reviewed:z.literal(true)}).parse(req.body);
  const original=await prisma.post.findUniqueOrThrow({where:{id:req.params.id},include:{job:true}});
  if(!['POSTED','APPROVED','REJECTED','WOULD_POST'].includes(original.status))throw new ApiError(409,'REVIEW_FIRST','راجع نتيجة المحاولة السابقة من تقرير الحملة أولًا.');
  res.status(201).json(await createCampaign({jobId:original.jobId,title:original.job.title,content:original.content,groupIds:[original.groupId],requestKey:input.requestKey,userId:req.user?.id}));
}));

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
app.post('/api/automation/:action', asyncRoute(async (req, res) => { const states: Record<string, string> = { start: 'RUNNING', resume: 'RUNNING', pause: 'PAUSED', stop: 'STOPPED', emergency: 'EMERGENCY_STOPPED' }; const state = states[req.params.action]; if (!state) throw new ApiError(400, 'INVALID_ACTION', 'أمر التشغيل غير معروف.'); await prisma.systemSetting.upsert({ where: { key: 'automationState' }, create: { key: 'automationState', valueJson: JSON.stringify(state) }, update: { valueJson: JSON.stringify(state) } }); if (state === 'RUNNING') await prisma.automationTask.updateMany({ where: { status: 'PAUSED' }, data: { status: 'RETRY', runAt: new Date() } }); await core.log(`AUTOMATION_${state}`, 'System', null, req.user?.id); res.json({ state }); }));
app.get('/api/settings', asyncRoute(async (_req, res) => { const items = await prisma.systemSetting.findMany(); res.json(Object.fromEntries(items.map((item) => [item.key, parseJson(item.valueJson, null)]))); }));
app.patch('/api/settings', asyncRoute(async (req, res) => {
  const input = settingsSchema.parse(req.body);
  const entries = Object.entries(input);
  await prisma.$transaction(entries.map(([key,value]) => prisma.systemSetting.upsert({ where:{key},create:{key,valueJson:JSON.stringify(value)},update:{valueJson:JSON.stringify(value)} })));
  await core.log('SETTINGS_UPDATED','System',null,req.user?.id,{keys:entries.map(([key])=>key)});
  res.json({ok:true});
}));

app.post('/api/facebook/open-session', asyncRoute(async (_req, res) => { const page = await facebook.page(); await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' }); res.json({ status: 'OPEN', message: 'أكمل تسجيل الدخول يدويًا في نافذة المتصفح.' }); }));
app.post('/api/facebook/close-session', asyncRoute(async (_req, res) => { await facebook.close(); res.json({ ok: true }); }));
app.get('/api/facebook/status', asyncRoute(async (_req,res) => {
  const session = await prisma.facebookSession.findUnique({where:{id:'primary'}});
  res.json({status: session?.status ?? 'DISCONNECTED', message: session?.manualReason, open:facebook.isOpen});
}));
app.post('/api/facebook/check-session', asyncRoute(async (_req,res) => {
  try {
    const status = await facebook.checkSession();
    await prisma.facebookSession.upsert({where:{id:'primary'},create:{id:'primary',profilePath:facebook.profilePath,status,lastCheckedAt:new Date()},update:{status,lastCheckedAt:new Date(),manualReason:null}});
    if (status === 'CONNECTED') await facebook.close();
    const sync = status === 'CONNECTED' ? await enqueueJoinedGroupsSync() : null;
    res.json({status,sync,message:status === 'CONNECTED' ? 'تم التحقق من تسجيل الدخول وبدأ جلب الجروبات تلقائيًا.' : 'تعذر تأكيد الحساب. راجع النافذة.'});
  } catch(error) {
    const message = error instanceof Error ? error.message : 'تعذر الفحص.';
    const session = await prisma.facebookSession.findUnique({ where: { id: 'primary' } });
    if (session?.status === 'CONNECTED' && /already|مستخدمة|قيد الاستخدام/i.test(message)) {
      const sync = await enqueueJoinedGroupsSync();
      res.json({ status: 'CONNECTED', sync, message: 'جلسة فيسبوك متصلة والجلب يعمل تلقائيًا.' });
      return;
    }
    throw new ApiError(409,'FACEBOOK_SESSION',message);
  }
}));

app.use((_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'المسار المطلوب غير موجود.')));
app.use((error: unknown, req: AuthenticatedRequest, res: express.Response, _next: express.NextFunction) => {
  const status = error instanceof ApiError ? error.status : error instanceof ManualActionRequiredError ? 409 : error instanceof ZodError ? 400 : 500;
  const code = error instanceof ApiError ? error.code : error instanceof ManualActionRequiredError ? error.reason : error instanceof ZodError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR';
  const message = error instanceof ZodError ? error.issues.map((issue) => issue.message).join('، ') : error instanceof Error ? error.message : 'حدث خطأ غير متوقع.';
  if (status >= 500) req.log?.error({ err: error }, 'request failed');
  res.status(status).json({ error: { code, message: status >= 500 ? 'حدث خطأ غير متوقع.' : message, technical: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined, requestId: req.id } });
});

export { app };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  acquireProcessLock('api');
  const server = app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1', () => logger.info({ port: process.env.PORT ?? 3000, framework: 'express' }, 'API started'));
  const shutdown = async () => { server.close(); await facebook.close(); await chatgpt.browser.close(); await prisma.$disconnect(); };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
