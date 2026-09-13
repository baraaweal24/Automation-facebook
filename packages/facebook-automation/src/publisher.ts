import type { Locator, Page } from 'playwright';
import { AutomationError } from './errors.js';
import { selectors } from './selectors.js';

async function visible(page: Page, candidates: readonly string[]): Promise<Locator | null> {
  for (const candidate of candidates) { const item = page.locator(candidate).last(); if (await item.isVisible().catch(() => false)) return item; }
  return null;
}

export class FacebookPublisherService {
  constructor(private readonly page: Page) {}
  async publish(input: { groupUrl: string; text: string; imagePath?: string | null; dryRun: boolean }) {
    await this.page.goto(input.groupUrl, { waitUntil: 'domcontentloaded' });
    if (input.dryRun) return { status: 'WOULD_POST' as const };
    const composer = await visible(this.page, selectors.composer);
    if (!composer) throw new AutomationError('تعذر فتح نافذة إنشاء المنشور داخل الجروب.', 'Composer trigger not found');
    await composer.click();
    const textbox = await visible(this.page, selectors.composerTextbox);
    if (!textbox) throw new AutomationError('تعذر العثور على حقل نص المنشور.', 'Composer textbox not found');
    await textbox.fill(input.text);
    if (input.imagePath) {
      const file = await visible(this.page, selectors.photoInput);
      if (file) await file.setInputFiles(input.imagePath);
    }
    const postButton = await visible(this.page, selectors.postButton);
    if (!postButton) throw new AutomationError('تعذر العثور على زر نشر الإعلان.', 'Post button not found');
    await postButton.click();
    await this.page.waitForTimeout(1500);
    const body = await this.page.locator('body').innerText();
    return { status: /pending approval|submitted for review|في انتظار الموافقة|تم إرسال.*للمراجعة/i.test(body) ? 'PENDING_ADMIN_APPROVAL' as const : 'POSTED' as const };
  }
}
