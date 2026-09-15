import type { Page } from 'playwright';
import { assertFacebookReady } from './browser.js';

export function normalizeDigits(raw: string) { return raw.replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/٫/g, '.').replace(/[٬,]/g, ''); }
export function parseCompactNumber(raw: string) {
  const match = normalizeDigits(raw).trim().match(/([\d.]+)\s*([KMB]|ألف|آلاف|مليون)?/i);
  if (!match) return null;
  const multiplier = /k|ألف|آلاف/i.test(match[2] ?? '') ? 1000 : /m|مليون/i.test(match[2] ?? '') ? 1000000 : /b/i.test(match[2] ?? '') ? 1000000000 : 1;
  const number = Number(match[1]) * multiplier;
  return Number.isFinite(number) ? Math.round(number) : null;
}
export function parseGroupMetrics(body: string) {
  const text = normalizeDigits(body);
  const count = '([\\d.]+\\s*(?:K|M|ألف|آلاف|مليون)?)';
  const members = text.match(new RegExp(`${count}\\s*(?:members|member|عضو|أعضاء)`, 'i'));
  const daily = text.match(new RegExp(`${count}\\s*(?:new\\s+)?(?:posts?|منشور(?:ات)?)\\s*(?:a day|per day|يوميًا|يوميا|في اليوم)`, 'i'));
  const monthly = text.match(new RegExp(`${count}\\s*(?:posts?|منشور(?:ات)?)\\s*(?:in the last month|in the last 30 days|خلال آخر شهر|في آخر 30 يوم)`, 'i'));
  const location = text.match(/(?:Location|الموقع)\s*[:：\n]\s*([^\n]{2,100})/i)?.[1]?.trim() ?? null;
  const description = text.match(/(?:About this group|حول هذه المجموعة|وصف المجموعة)\s*\n([\s\S]*?)(?=\n(?:Public|Private|عام|خاص|Visible|مرئية|History|السجل)|$)/i)?.[1]?.trim().slice(0, 4000) ?? null;
  return { membersCount: members ? parseCompactNumber(members[1]) : null, activityPerDay: daily ? parseCompactNumber(daily[1]) : monthly ? (parseCompactNumber(monthly[1]) ?? 0) / 30 : null, location, description,
    privacy: /Private group|مجموعة خاصة/i.test(text) ? 'PRIVATE' : /Public group|مجموعة عامة/i.test(text) ? 'PUBLIC' : null };
}
export class FacebookGroupService {
  constructor(private readonly page: Page) {}
  async analyze(url: string) {
    await this.page.goto(`${url.replace(/\/$/, '')}/about`, { waitUntil: 'domcontentloaded' });
    await assertFacebookReady(this.page);
    const body = await this.page.locator('body').innerText();
    const title = (await this.page.locator('h1').first().innerText().catch(() => '')) || (await this.page.title()).replace(/ \| Facebook$/, '');
    return { name: title.trim(), ...parseGroupMetrics(body) };
  }
}
