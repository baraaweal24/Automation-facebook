import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { FacebookPublisherService } from './publisher.js';
let browser: Browser;
beforeAll(async()=>{ browser=await chromium.launch({headless:true}); });
afterAll(async()=>{ await browser?.close(); });
const groupUrl='https://www.facebook.com/groups/123';
async function fixture(success: boolean) {
  const page=await browser.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body>
    <button aria-label="Write something" onclick="document.querySelector('[role=dialog]').hidden=false">Write something</button>
    <section role="dialog" hidden><div role="textbox" contenteditable="true"></div><button id="post">Post</button></section><main></main>
    <script>document.getElementById('post').onclick=()=>{document.querySelector('[role=dialog]').hidden=true;if(${success})document.querySelector('main').innerHTML='<article role="article"><p>Reviewed full text</p><a href="/groups/123/posts/456/">Now</a></article>';};</script>
  </body></html>`}));
  return page;
}
describe('browser publication evidence (local fixtures only)',()=>{
  it('records a new matching permalink after submit',async()=>{
    const page=await fixture(true);let intent=false;
    const result=await new FacebookPublisherService(page).publish({groupUrl,text:'Reviewed full text',dryRun:false,beforeSubmit:async()=>{intent=true;},confirmationTimeoutMs:1000});
    expect(intent).toBe(true);expect(result).toMatchObject({status:'POSTED',facebookPostId:'456'});await page.close();
  });
  it('treats no success evidence as uncertain, not posted',async()=>{
    const page=await fixture(false);
    const result=await new FacebookPublisherService(page).publish({groupUrl,text:'Reviewed full text',dryRun:false,confirmationTimeoutMs:100});
    expect(result.status).toBe('MANUAL_ACTION_REQUIRED');await page.close();
  });
  it('aborts before the click when the stop guard changes',async()=>{
    const page=await fixture(true);let stopped=false;
    const result=await new FacebookPublisherService(page,async()=>{if(stopped)throw new Error('stop');}).publish({groupUrl,text:'Reviewed full text',dryRun:false,beforeSubmit:async()=>{stopped=true;}});
    expect(result.status).toBe('MANUAL_ACTION_REQUIRED');expect(await page.getByRole('article').count()).toBe(0);await page.close();
  });
  it('dry run never opens the composer or submits',async()=>{
    const page=await fixture(true);
    expect((await new FacebookPublisherService(page).publish({groupUrl,text:'Reviewed full text',dryRun:true})).status).toBe('WOULD_POST');
    expect(await page.getByRole('article').count()).toBe(0);await page.close();
  });
});
