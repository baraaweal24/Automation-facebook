import type { Page } from 'playwright';
import { assertFacebookReady } from './browser.js';
import { AutomationError } from './errors.js';
import type { DiscoveredGroup } from './search.js';

export function canonicalGroup(href: string, name: string): DiscoveredGroup | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  if (!['www.facebook.com', 'facebook.com', 'm.facebook.com'].includes(url.hostname)) return null;
  const match = url.pathname.match(/^\/groups\/([^/]+)\/?$/);
  if (!match || !name.trim() || ['feed','discover','joins','create','notifications','your_groups'].includes(match[1].toLowerCase())) return null;
  return { name: name.trim(), canonicalUrl: `https://www.facebook.com/groups/${match[1]}`, facebookGroupId: /^\d+$/.test(match[1]) ? match[1] : undefined };
}

export class JoinedGroupsService {
  constructor(private page: Page, private guard: () => Promise<void> = async () => {}) {}
  async list(maxGroups = 1000) {
    await this.guard();
    await this.page.goto('https://www.facebook.com/groups/joins/', { waitUntil: 'domcontentloaded' });
    await assertFacebookReady(this.page);
    const results = new Map<string, DiscoveredGroup>();
    let idle = 0;
    const deadline = Date.now() + 180000;
    while (idle < 5 && results.size < maxGroups && Date.now() < deadline) {
      await this.guard();
      await assertFacebookReady(this.page);
      const before = results.size;
      const links = await this.page.getByRole('main').locator('a[href*="/groups/"]').evaluateAll(anchors => {
        const generic = new Set(['view group', 'joined', 'join group', 'visit group', 'عرض المجموعة', 'منضم', 'تم الانضمام']);
        const rows: { href: string; name: string }[] = [];
        for (const item of anchors) {
          const anchor = item as HTMLAnchorElement;
          const candidates: string[] = [];
          let hrefName = '';
          try {
            const segment = new URL(anchor.href).pathname.match(/^\/groups\/([^/]+)\/?$/)?.[1] ?? '';
            hrefName = decodeURIComponent(segment).replace(/[-_.]+/g, ' ').trim();
          } catch {
            hrefName = '';
          }
          let current: Element | null = anchor;
          for (let i = 0; current && i < 6; i += 1, current = current.parentElement) {
            candidates.push(current.getAttribute('aria-label') ?? '');
            candidates.push(current.textContent ?? '');
          }
          candidates.push(hrefName);
          let name = hrefName;
          for (const candidate of candidates) {
            let value = candidate.replace(/\s+/g, ' ').trim();
            for (const label of generic) value = value.replace(new RegExp(label, 'ig'), ' ').replace(/\s+/g, ' ').trim();
            value = value.replace(/You last visited.*$/i, '').replace(/آخر زيارة.*$/i, '').replace(/\s+/g, ' ').trim();
            value = value.replace(/\b\d+(?:[,.]\d+)?\s*(?:K|M|ألف|مليون)?\s*(?:members?|أعضاء?|عضو)\b/ig, ' ').replace(/\s+/g, ' ').trim();
            const lower = value.toLowerCase();
            if (value.length > 2 && value.length < 120 && !generic.has(lower) && !lower.includes('view group') && !lower.includes('joined')) {
              name = value;
              break;
            }
          }
          rows.push({ href: anchor.href, name });
        }
        return rows;
      });
      for (const link of links) { const group = canonicalGroup(link.href, link.name); if (group) results.set(group.canonicalUrl, group); }
      idle = before === results.size ? idle + 1 : 0;
      await this.page.mouse.wheel(0, 1600);
      await this.page.waitForTimeout(1000);
    }
    if (!results.size) throw new AutomationError('لم تظهر جروبات منضم إليها. افتح صفحة مجموعاتك وتأكد من الحساب والواجهة.');
    return { groups: [...results.values()].slice(0, maxGroups), truncated: results.size >= maxGroups || Date.now() >= deadline };
  }
  async verify(groupUrl: string) {
    await this.guard();
    await this.page.goto(groupUrl, { waitUntil: 'domcontentloaded' });
    await assertFacebookReady(this.page);
    return await this.page.getByRole('button', { name: /^(Joined|تم الانضمام|منضم)$/i }).first().isVisible().catch(() => false);
  }
}
