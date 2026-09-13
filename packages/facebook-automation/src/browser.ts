import { mkdir, open, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { ManualActionRequiredError } from './errors.js';

export class FacebookBrowser {
  private context: BrowserContext | null = null;
  private lockHandle: Awaited<ReturnType<typeof open>> | null = null;
  readonly profilePath = resolve(process.env.FACEBOOK_PROFILE_PATH ?? './data/browser-profile');
  private readonly lockPath = resolve(this.profilePath, '..', 'facebook-profile.lock');

  async start(headless = process.env.FACEBOOK_HEADLESS === 'true') {
    if (this.context) return this.context;
    await mkdir(this.profilePath, { recursive: true });
    await mkdir(dirname(this.lockPath), { recursive: true });
    try { this.lockHandle = await open(this.lockPath, 'wx'); } catch { throw new Error('جلسة Facebook مفتوحة بالفعل في عملية أخرى.'); }
    try {
      this.context = await chromium.launchPersistentContext(this.profilePath, { headless, viewport: { width: 1440, height: 1000 }, locale: 'ar-EG' });
      return this.context;
    } catch (error) {
      await this.releaseLock();
      throw error;
    }
  }

  async page() {
    const context = await this.start();
    return context.pages()[0] ?? context.newPage();
  }

  async checkSession(page?: Page) {
    const target = page ?? await this.page();
    await target.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    await this.assertNoBlocker(target);
    const loginVisible = await target.locator('input[name="email"],input[name="pass"]').first().isVisible().catch(() => false);
    return loginVisible ? 'DISCONNECTED' : 'CONNECTED';
  }

  async assertNoBlocker(page: Page) {
    const url = page.url().toLowerCase();
    const text = (await page.locator('body').innerText({ timeout: 8_000 }).catch(() => '')).toLowerCase();
    if (/checkpoint|two_factor|captcha/.test(url) || /captcha|أدخل رمز الأمان/.test(text)) throw new ManualActionRequiredError('CAPTCHA', 'مطلوب تدخل يدوي لإكمال التحقق الأمني.');
    if (/login/.test(url) || /log in to facebook|تسجيل الدخول إلى فيسبوك/.test(text)) throw new ManualActionRequiredError('LOGIN_REQUIRED', 'انتهت جلسة Facebook أو يلزم تسجيل الدخول.');
    if (/security check|تأكيد هويتك|confirm your identity/.test(text)) throw new ManualActionRequiredError('SECURITY_CHECK', 'طلب Facebook تحققًا أمنيًا يدويًا.');
  }

  async close() {
    await this.context?.close();
    this.context = null;
    await this.releaseLock();
  }

  private async releaseLock() {
    await this.lockHandle?.close().catch(() => undefined);
    this.lockHandle = null;
    await rm(this.lockPath, { force: true }).catch(() => undefined);
  }
}
