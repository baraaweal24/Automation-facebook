import type { Locator, Page } from 'playwright';
import { AutomationError } from './errors.js';
import { assertFacebookReady } from './browser.js';
import { selectors } from './selectors.js';

async function visible(root: Page | Locator, candidates: readonly string[]): Promise<Locator | null> {
  for (const candidate of candidates) { const item = root.locator(candidate).last(); if (await item.isVisible().catch(() => false)) return item; }
  return null;
}
export function parsePostUrl(raw: string, groupUrl?: string) {
  try {
    const url = new URL(raw);
    if (!['www.facebook.com', 'facebook.com', 'm.facebook.com'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/groups\/([^/]+)\/(?:posts|permalink)\/(\d+)\/?$/);
    if (!match || (groupUrl && new URL(groupUrl).pathname.split('/')[2] !== match[1])) return null;
    return { facebookUrl: `https://www.facebook.com/groups/${match[1]}/posts/${match[2]}/`, facebookPostId: match[2] };
  } catch { return null; }
}
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
export type PublishResult = { status: 'WOULD_POST' | 'POSTED' | 'PENDING_ADMIN_APPROVAL' | 'MANUAL_ACTION_REQUIRED'; facebookUrl?: string; facebookPostId?: string; reason?: string };
export class FacebookPublisherService {
  constructor(private readonly page: Page, private guard: () => Promise<void> = async () => {}) {}

  async findEvidence(groupUrl: string, text: string, excluded = new Set<string>()) {
    const articles = this.page.getByRole('article');
    for (let i = 0; i < Math.min(await articles.count(), 60); i++) {
      const article = articles.nth(i);
      if (!normalize(await article.innerText()).includes(normalize(text))) continue;
      const links = await article.locator('a[href]').evaluateAll(anchors => anchors.map(a => (a as HTMLAnchorElement).href));
      for (const link of links) { const post = parsePostUrl(link, groupUrl); if (post && !excluded.has(post.facebookUrl)) return post; }
    }
    return null;
  }
  async publish(input: { groupUrl: string; text: string; imagePath?: string | null; dryRun: boolean; beforeSubmit?: () => Promise<void>; confirmationTimeoutMs?: number }): Promise<PublishResult> {
    await this.guard();
    await this.page.goto(input.groupUrl, { waitUntil: 'domcontentloaded' });
    await assertFacebookReady(this.page);
    if (input.dryRun) return { status: 'WOULD_POST' };
    const oldLinks = await this.page.locator('a[href]').evaluateAll(anchors => anchors.map(a => (a as HTMLAnchorElement).href));
    const excluded = new Set(oldLinks.flatMap(link => { const parsed = parsePostUrl(link, input.groupUrl); return parsed ? [parsed.facebookUrl] : []; }));
    const composer = await visible(this.page, selectors.composer);
    if (!composer) throw new AutomationError('تعذر فتح نافذة إنشاء المنشور داخل الجروب.');
    await this.guard();
    await composer.click();
    const dialog = this.page.getByRole('dialog').last();
    await dialog.waitFor({ state: 'visible' });
    const textbox = await visible(dialog, selectors.composerTextbox);
    if (!textbox) throw new AutomationError('تعذر العثور على حقل نص المنشور.');
    await textbox.fill(input.text);
    if (input.imagePath) {
      // File inputs are normally hidden; visibility is not a requirement for setInputFiles.
      let file = dialog.locator('input[type="file"][accept*="image"]').first();
      if (!await file.count()) {
        const photo = dialog.getByRole('button', { name: /Photo\/video|صورة\/فيديو|صور\/فيديو/i }).first();
        if (await photo.isVisible().catch(() => false)) await photo.click();
        file = dialog.locator('input[type="file"][accept*="image"]').first();
      }
      if (!await file.count()) throw new AutomationError('تعذر إرفاق الصورة. لم يتم إرسال المنشور.');
      await file.setInputFiles(input.imagePath);
      await dialog.locator('img[src^="blob:"]').first().waitFor({ state: 'visible', timeout: 20000 });
    }
    const postButton = await visible(dialog, selectors.postButton);
    if (!postButton) throw new AutomationError('تعذر العثور على زر النشر.');
    await assertFacebookReady(this.page);
    await this.guard();
    await input.beforeSubmit?.(); // Persist intent before the irreversible click.
    try {
      await this.guard();
      await postButton.click();
      const deadline = Date.now() + (input.confirmationTimeoutMs ?? 25000);
      while (Date.now() < deadline) {
        await this.guard();
        await assertFacebookReady(this.page);
        const evidence = await this.findEvidence(input.groupUrl, input.text, excluded);
        if (evidence) return { status: 'POSTED', ...evidence };
        const notice = this.page.locator('[role="alert"], [role="status"], [role="dialog"]').filter({ hasText: /submitted for review|تم إرسال.*للمراجعة|post is pending approval|منشورك.*في انتظار/i });
        if (await notice.count() && !await textbox.isVisible().catch(() => false)) return { status: 'PENDING_ADMIN_APPROVAL' };
        await this.page.waitForTimeout(500);
      }
      return { status: 'MANUAL_ACTION_REQUIRED', reason: 'لم يتم تأكيد نتيجة الإرسال. راجع الجروب قبل أي إعادة نشر.' };
    } catch {
      return { status: 'MANUAL_ACTION_REQUIRED', reason: 'انقطعت العملية بعد تسجيل نية الإرسال. راجع الجروب؛ لن نعيد النشر تلقائيًا.' };
    }
  }
}
