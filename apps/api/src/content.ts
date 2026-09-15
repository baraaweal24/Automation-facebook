import type { Express } from 'express';
import { prisma } from '@repo/database';
import { ChatGPTBrowser, buildContentPrompt } from '@repo/facebook-automation';
import { contentDraftSchema, publishSchema } from '@repo/shared';
import { ApiError, asyncRoute, parseJson } from './http.js';
import { createCampaign } from './campaigns.js';
import { CoreService } from './service.js';

export const chatgpt = new ChatGPTBrowser();
const activeGenerations = new Set<string>();
export function registerContentRoutes(app: Express, core: CoreService) {
  app.get('/api/my-groups', asyncRoute(async (_req, res) => {
    const groups = await prisma.group.findMany({ where: { membershipStatus: 'JOINED' }, include: { blacklist: true }, orderBy: { name: 'asc' } });
    const task = await prisma.automationTask.findFirst({ where: { type: 'SYNC_JOINED_GROUPS' }, orderBy: { createdAt: 'desc' } });
    res.json({ groups, sync: task });
  }));
  app.post('/api/my-groups/sync', asyncRoute(async (_req, res) => {
    const pending = await prisma.automationTask.findFirst({ where: { type: 'SYNC_JOINED_GROUPS', status: { in: ['QUEUED','RUNNING','RETRY'] } } });
    res.status(202).json(pending ?? await core.enqueue('SYNC_JOINED_GROUPS', {}, `sync-groups:${crypto.randomUUID()}`));
  }));
  app.get('/api/chatgpt/status', (_req, res) => res.json(chatgpt.status));
  for (const action of ['open', 'close'] as const) app.post(`/api/chatgpt/${action}`, asyncRoute(async (_req, res) => {
    try { await chatgpt[action](); res.json(chatgpt.status); }
    catch (error) { throw new ApiError(409, 'CHATGPT_SESSION', error instanceof Error ? error.message : 'تعذر فتح الجلسة.'); }
  }));
  app.get('/api/content-drafts', asyncRoute(async (_req, res) => {
    res.json(await prisma.contentDraft.findMany({ orderBy: { updatedAt: 'desc' }, take: 100 }));
  }));
  app.get('/api/content-drafts/:id', asyncRoute(async (req, res) => {
    const draft = await prisma.contentDraft.findUnique({ where: { id: req.params.id } });
    if (!draft) throw new ApiError(404, 'NOT_FOUND', 'المسودة غير موجودة.');
    if (draft.status === 'GENERATING' && !activeGenerations.has(draft.id)) {
      res.json(await prisma.contentDraft.update({ where: { id: draft.id }, data: { status: 'FAILED', lastError: 'توقف الخادم أثناء التوليد. راجع محادثة ChatGPT قبل المحاولة مجددًا.' } })); return;
    }
    res.json(draft);
  }));
  app.post('/api/content-drafts', asyncRoute(async (req, res) => {
    const { groupIds, ...data } = contentDraftSchema.parse(req.body);
    const draft = await prisma.contentDraft.create({ data: { ...data, groupIdsJson: JSON.stringify([...new Set(groupIds)]) } });
    await core.log('CONTENT_DRAFT_CREATED', 'ContentDraft', draft.id, req.user?.id);
    res.status(201).json(draft);
  }));
  app.patch('/api/content-drafts/:id', asyncRoute(async (req, res) => {
    if (activeGenerations.has(req.params.id)) throw new ApiError(409, 'GENERATING', 'انتظر اكتمال التوليد قبل تعديل المسودة.');
    const { groupIds, ...data } = contentDraftSchema.parse(req.body);
    res.json(await prisma.contentDraft.update({ where: { id: req.params.id }, data: { ...data, groupIdsJson: JSON.stringify([...new Set(groupIds)]), status: 'DRAFT', lastError: null } }));
  }));
  app.post('/api/content-drafts/:id/generate', asyncRoute(async (req, res) => {
    if (chatgpt.status.busy || activeGenerations.size) throw new ApiError(409, 'GENERATING', 'يوجد توليد جارٍ بالفعل.');
    const draft = await prisma.contentDraft.findUnique({ where: { id: req.params.id } });
    if (!draft) throw new ApiError(404, 'NOT_FOUND', 'المسودة غير موجودة.');
    const ids: string[] = parseJson(draft.groupIdsJson, []);
    const groups = await prisma.group.findMany({ where: { id: { in: ids }, membershipStatus: 'JOINED' }, select: { name: true, description: true } });
    if (!groups.length) throw new ApiError(400, 'NO_GROUPS', 'اختر جروبات منضمًا إليها قبل التوليد.');
    if (activeGenerations.size || chatgpt.status.busy) throw new ApiError(409,'GENERATING','يوجد توليد جارٍ بالفعل.');
    activeGenerations.add(draft.id);
    try { await prisma.contentDraft.update({ where: { id: draft.id }, data: { status: 'GENERATING', lastError: null } }); }
    catch (error) { activeGenerations.delete(draft.id); throw error; }
    void (async () => {
      try {
        const generated = await chatgpt.generate(buildContentPrompt(draft.sourceData, draft.instructions, groups));
        await prisma.contentDraft.update({ where: { id: draft.id }, data: { status: 'DRAFT', finalText: generated.text, chatUrl: generated.chatUrl } });
        await core.log('CONTENT_GENERATED', 'ContentDraft', draft.id, req.user?.id);
      } catch (error) {
        await prisma.contentDraft.update({ where: { id: draft.id }, data: { status: 'FAILED', lastError: error instanceof Error ? error.message : 'تعذر توليد المحتوى.' } });
      } finally { activeGenerations.delete(draft.id); }
    })().catch(() => { activeGenerations.delete(draft.id); });
    res.status(202).json({ id: draft.id, status: 'GENERATING' });
  }));
  app.post('/api/content-drafts/:id/publish', asyncRoute(async (req, res) => {
    const input = publishSchema.parse(req.body);
    const draft = await prisma.contentDraft.findUnique({ where: { id: req.params.id } });
    if (!draft || draft.finalText.trim().length < 10) throw new ApiError(400, 'CONTENT_REQUIRED', 'احفظ نص المنشور أولًا.');
    if (activeGenerations.has(draft.id)) throw new ApiError(409, 'GENERATING', 'انتظر اكتمال التوليد.');
    const saved: string[] = parseJson(draft.groupIdsJson, []);
    if (JSON.stringify([...saved].sort()) !== JSON.stringify([...input.groupIds].sort())) throw new ApiError(409, 'AUDIENCE_CHANGED', 'احفظ الجروبات المختارة وراجع المحتوى أولًا.');
    res.status(201).json(await createCampaign({ ...input, draftId: draft.id, title: draft.title, content: draft.finalText, userId: req.user?.id }));
  }));
}
