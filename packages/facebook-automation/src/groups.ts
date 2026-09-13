import type { Page } from 'playwright';

function parseCompactNumber(raw: string) {
  const normalized = raw.replace(/,/g, '').trim();
  const match = normalized.match(/([\d.]+)\s*([KMB]|ألف|مليون)?/i);
  if (!match) return null;
  const multiplier = /k|ألف/i.test(match[2] ?? '') ? 1_000 : /m|مليون/i.test(match[2] ?? '') ? 1_000_000 : /b/i.test(match[2] ?? '') ? 1_000_000_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
}

export class FacebookGroupService {
  constructor(private readonly page: Page) {}
  async analyze(url: string) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const body = await this.page.locator('body').innerText();
    const title = (await this.page.locator('h1').first().innerText().catch(() => '')) || (await this.page.title()).replace(/ \| Facebook$/, '');
    const membersMatch = body.match(/([\d.,]+\s*(?:K|M|ألف|مليون)?)\s*(?:members|member|عضو)/i);
    const privacy = /Private group|مجموعة خاصة/i.test(body) ? 'PRIVATE' : /Public group|مجموعة عامة/i.test(body) ? 'PUBLIC' : null;
    return { name: title.trim(), membersCount: membersMatch ? parseCompactNumber(membersMatch[1]) : null, privacy, description: null, location: null, activityPerDay: null };
  }
}
