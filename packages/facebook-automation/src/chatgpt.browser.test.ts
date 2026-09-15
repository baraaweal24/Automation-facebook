import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { ChatGPTBrowser } from './chatgpt.js';
import { JoinedGroupsService } from './joined-groups.js';
let browser: Browser;
beforeAll(async()=>{browser=await chromium.launch({headless:true});});
afterAll(async()=>{await browser?.close();});
it('reads only the completed new ChatGPT answer from a local browser fixture',async()=>{
  const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<textarea id="prompt-textarea"></textarea><button data-testid="send-button" onclick="document.querySelector('main').innerHTML='<article data-testid=conversation-turn-1><div data-message-author-role=assistant>Generated draft from supplied data only.</div><button data-testid=copy-turn-action-button>Copy</button></article>'">Send</button><main></main>`}));
  const chat=new ChatGPTBrowser();vi.spyOn(chat.browser,'start').mockResolvedValue({} as never);vi.spyOn(chat.browser,'page').mockResolvedValue(page);
  const first=chat.generate('Use the supplied facts.');
  await expect(chat.generate('Concurrent request')).rejects.toThrow('جارٍ');
  expect((await first).text).toBe('Generated draft from supplied data only.');
  expect(chat.status.busy).toBe(false);await page.close();
});
it('requires manual ChatGPT login instead of submitting in logged-out mode',async()=>{
  const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<textarea id="prompt-textarea"></textarea><button>Log in</button>'}));
  const chat=new ChatGPTBrowser();vi.spyOn(chat.browser,'start').mockResolvedValue({} as never);vi.spyOn(chat.browser,'page').mockResolvedValue(page);
  await expect(chat.generate('Source')).rejects.toThrow('سجّل الدخول');expect(chat.status.busy).toBe(false);await page.close();
});
it('imports only group candidates and verifies an explicit joined button',async()=>{
  const page=await browser.newPage();await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:route.request().url().includes('/joins') ? '<main role="main"><a href="/groups/123/">My joined group</a><a href="/groups/feed/">Feed</a><a href="https://evil.test/groups/987">External</a></main>' : '<button>Joined</button>'}));
  const service=new JoinedGroupsService(page);const listed=await service.list(1);
  expect(listed.groups.map(g=>g.facebookGroupId)).toEqual(['123']);
  expect(await service.verify(listed.groups[0].canonicalUrl)).toBe(true);await page.close();
});
