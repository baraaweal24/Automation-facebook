import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { ManualActionRequiredError } from './errors.js';

export class FacebookBrowser {
  private context: BrowserContext | null = null;
  private opening: Promise<BrowserContext> | null = null;
  private closing: Promise<void> = Promise.resolve();
  private lockHandle: Awaited<ReturnType<typeof open>> | null = null;
  readonly profilePath: string;
  private readonly lockPath: string;
  constructor(profilePath = process.env.FACEBOOK_PROFILE_PATH ?? './data/browser-profile', lockPath?: string) {
    this.profilePath = resolve(profilePath);
    this.lockPath = resolve(lockPath ?? resolve(this.profilePath, '..', 'facebook-profile.lock'));
  }
  get isOpen() { return this.context !== null; }
  async start(headless = process.env.FACEBOOK_HEADLESS === 'true'): Promise<BrowserContext> {
    await this.closing;
    if (this.context) return this.context;
    if (this.opening) return this.opening;
    this.opening = this.launch(headless);
    try { return await this.opening; } finally { this.opening = null; }
  }
  private async launch(headless: boolean) {
    await mkdir(this.profilePath, { recursive: true });
    await mkdir(dirname(this.lockPath), { recursive: true });
    try { this.lockHandle = await open(this.lockPath, 'wx'); }
    catch {
      let owner: { pid?: number } = {};
      try { owner = JSON.parse(await readFile(this.lockPath, 'utf8')); } catch { /* Unknown legacy lock requires operator review. */ }
      if (!Number.isInteger(owner.pid)) throw new Error('ملف قفل جلسة قديم أو غير صالح. أغلق المتصفحات ثم استخدم browser:unlock.');
      let alive = true;
      try { process.kill(owner.pid!, 0); } catch (error) { alive = (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
      if (alive) throw new Error('الجلسة مستخدمة بالفعل. أغلق نافذة تسجيل الدخول وسلّمها للتشغيل.');
      await rm(this.lockPath);
      this.lockHandle = await open(this.lockPath, 'wx');
    }
    await this.lockHandle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    try {
      const context = await chromium.launchPersistentContext(this.profilePath, { headless, viewport: { width: 1440, height: 1000 }, locale: 'ar-EG' });
      this.context = context;
      context.once('close', () => { if (this.context === context) { this.context = null; this.closing = this.releaseLock(); } });
      return context;
    } catch (error) { await this.releaseLock(); throw error; }
  }
  async page() {
    const context = await this.start();
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(Number(process.env.PAGE_TIMEOUT_MS ?? 15000));
    return page;
  }
  async checkSession(page?: Page) {
    const target = page ?? await this.page();
    await target.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded' });
    await this.assertNoBlocker(target);
    const account = target.locator('[aria-label="Account"], [aria-label="الحساب"], [aria-label="Your profile"], [aria-label="ملفك الشخصي"]').first();
    return await account.isVisible().catch(() => false) ? 'CONNECTED' : 'MANUAL_ACTION_REQUIRED';
  }
  assertNoBlocker(page: Page) { return assertFacebookReady(page); }
  async close() {
    if (this.opening) await this.opening.catch(() => undefined);
    const context = this.context;
    this.context = null;
    await context?.close().catch(() => undefined);
    await this.releaseLock();
  }
  private async releaseLock() {
    const handle = this.lockHandle;
    if (!handle) return;
    this.lockHandle = null;
    await handle.close().catch(() => undefined);
    await rm(this.lockPath, { force: true }).catch(() => undefined);
  }
}

export async function assertFacebookReady(page: Page) {
  const url = page.url().toLowerCase();
  const text = (await page.locator('body').innerText({ timeout: 8000 }).catch(() => '')).toLowerCase();
  if (/checkpoint|two_factor|captcha/.test(url) || /captcha|أدخل رمز الأمان/.test(text)) throw new ManualActionRequiredError('CAPTCHA', 'أكمل التحقق الأمني يدويًا.');
  if (/\/login/.test(url) || await page.locator('input[name="email"], input[name="pass"]').first().isVisible().catch(() => false)) throw new ManualActionRequiredError('LOGIN_REQUIRED', 'سجّل الدخول إلى Facebook يدويًا.');
  if (/security check|تأكيد هويتك|confirm your identity/.test(text)) throw new ManualActionRequiredError('SECURITY_CHECK', 'يلزم تحقق أمني يدوي.');
}
