import { createHash } from 'node:crypto';
import type { Locator, Page } from 'playwright';
import { selectors } from './selectors.js';
import { assertFacebookReady } from './browser.js';

const firstVisible = async (page: Page, candidates: readonly string[]): Promise<Locator | null> => {
  for (const candidate of candidates) { const locator = page.locator(candidate).first(); if (await locator.isVisible().catch(() => false)) return locator; }
  return null;
};

export class FacebookMembershipService {
  constructor(private readonly page: Page, private guard: () => Promise<void> = async () => {}) {}
  async join(groupUrl: string, dryRun: boolean) {
    await this.page.goto(groupUrl, { waitUntil: 'domcontentloaded' });
    await assertFacebookReady(this.page);
    if (await this.page.getByRole('button', { name: /^(Joined|تم الانضمام|منضم)$/i }).first().isVisible().catch(() => false)) return { status: 'JOINED' as const, questions: [] };
    const button = await firstVisible(this.page, selectors.joinButtons);
    if (!button) return { status: 'MANUAL_ACTION_REQUIRED' as const, questions: [] };
    if (dryRun) return { status: 'WOULD_JOIN' as const, questions: [] };
    await this.guard();
    await button.click();
    await this.page.waitForTimeout(1000);
    const dialog = this.page.getByRole('dialog').last();
    if (await dialog.isVisible().catch(() => false)) {
      const labels = await dialog.locator('label, [role="heading"], legend').allInnerTexts();
      const questions = labels.map((text, position) => ({ position, text: text.trim(), type: 'TEXT', required: true })).filter((q) => q.text.length > 2);
      if (questions.length) return { status: 'NEEDS_QUESTIONS' as const, questions, hash: createHash('sha256').update(questions.map((q) => q.text).join('|')).digest('hex') };
    }
    const text = await this.page.locator('body').innerText();
    return { status: /Pending|في انتظار/i.test(text) ? 'WAITING_ADMIN' as const : 'JOIN_REQUESTED' as const, questions: [] };
  }

  async submitAnswers(groupUrl: string, answers: Array<{ text: string; type: string; value: unknown }>, expectedHash: string) {
    await this.page.goto(groupUrl, { waitUntil: 'domcontentloaded' });
    await assertFacebookReady(this.page);
    await this.guard();
    const join = await firstVisible(this.page, selectors.joinButtons);
    if (join) await join.click();
    const dialog = this.page.getByRole('dialog').last();
    await dialog.waitFor({ state: 'visible', timeout: 10_000 });
    const currentTexts = (await dialog.locator('label, [role="heading"], legend').allInnerTexts()).map((v) => v.trim()).filter((v) => v.length > 2);
    const currentHash = createHash('sha256').update(currentTexts.join('|')).digest('hex');
    if (currentHash !== expectedHash) return { status: 'QUESTIONS_CHANGED' as const, hash: currentHash, questions: currentTexts };
    const textboxes = dialog.getByRole('textbox');
    let textIndex = 0;
    for (const answer of answers) {
      if (answer.type === 'TEXT') await textboxes.nth(textIndex++).fill(String(answer.value));
      else if (typeof answer.value === 'boolean' && answer.value) await dialog.getByText(answer.text, { exact: false }).locator('..').getByRole('checkbox').check().catch(() => undefined);
      else if (typeof answer.value === 'string') await dialog.getByText(answer.value, { exact: true }).click();
    }
    const submit = await firstVisible(this.page, selectors.submitAnswers);
    if (!submit) return { status: 'MANUAL_ACTION_REQUIRED' as const };
    await assertFacebookReady(this.page);
    await this.guard();
    await submit.click();
    return { status: 'WAITING_ADMIN' as const };
  }
}
