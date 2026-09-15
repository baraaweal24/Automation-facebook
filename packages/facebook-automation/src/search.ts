import type { Page } from 'playwright';
import { AutomationError } from './errors.js';
import { assertFacebookReady } from './browser.js';

export interface DiscoveredGroup { name: string; canonicalUrl: string; facebookGroupId?: string }

export class FacebookSearchService {
  constructor(private readonly page: Page, private guard: () => Promise<void> = async () => {}) {}

  async discover(keyword: string, options = { maxGroups: 50, maxIdleScrolls: 4, timeoutMs: 60_000 }): Promise<DiscoveredGroup[]> {
    const url = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(keyword)}`;
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
    await assertFacebookReady(this.page);
    const started = Date.now();
    const results = new Map<string, DiscoveredGroup>();
    let idle = 0;
    while (results.size < options.maxGroups && idle < options.maxIdleScrolls && Date.now() - started < options.timeoutMs) {
      await this.guard();
      await assertFacebookReady(this.page);
      const links = await this.page.locator('a[href*="/groups/"]').evaluateAll((anchors) => anchors.map((anchor) => ({ href: (anchor as HTMLAnchorElement).href, text: (anchor.textContent ?? '').trim() })));
      const before = results.size;
      for (const link of links) {
        const match = link.href.match(/facebook\.com\/groups\/([^/?#]+)/i);
        if (!match || !link.text || ['feed', 'discover', 'joins'].includes(match[1].toLowerCase())) continue;
        const id = /^\d+$/.test(match[1]) ? match[1] : undefined;
        const canonicalUrl = `https://www.facebook.com/groups/${match[1]}`;
        results.set(id ?? canonicalUrl.toLowerCase(), { name: link.text, canonicalUrl, facebookGroupId: id });
      }
      idle = results.size === before ? idle + 1 : 0;
      await this.page.mouse.wheel(0, 1400);
      await this.page.waitForTimeout(800);
    }
    if (!results.size) throw new AutomationError('لم يتم العثور على جروبات ظاهرة لهذه الكلمة.', `No group anchors found for ${keyword}`);
    return [...results.values()].slice(0, options.maxGroups);
  }
}
