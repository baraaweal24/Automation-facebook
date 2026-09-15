import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../packages/facebook-automation/package.json',import.meta.url));
const {chromium}=require('playwright');
const output=resolve('test-results/ui');mkdirSync(output,{recursive:true});
const groups=[{id:'g1',name:'وظائف القاهرة والجيزة',membersCount:42000,postingEnabled:true,blacklist:null,decisionStatus:'NEW',canonicalUrl:'https://www.facebook.com/groups/123'},{id:'g2',name:'فرص عمل فنادق شرم الشيخ',membersCount:18500,postingEnabled:true,blacklist:null,decisionStatus:'NEW',canonicalUrl:'https://www.facebook.com/groups/456'}];
let draft=null;let published=null;
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
    const req=route.request();const url=new URL(req.url());let body={};
    if(url.pathname==='/api/auth/me')body={user:{username:'اختبار الواجهة'},csrfToken:'fixture'};
    else if(url.pathname==='/api/my-groups')body={groups,sync:null};
    else if(url.pathname==='/api/automation/status')body={state:'STOPPED',dryRun:true};
    else if(url.pathname==='/api/jobs')body={items:[]};
    else if(url.pathname==='/api/content-drafts' && req.method()==='GET')body=draft?[draft]:[];
    else if(url.pathname==='/api/content-drafts' || (url.pathname==='/api/content-drafts/d1' && req.method()==='PATCH')){
      const data=req.postDataJSON();draft={id:'d1',...data,groupIdsJson:JSON.stringify(data.groupIds),status:'DRAFT',lastError:null,chatUrl:null};body=draft;
    } else if(url.pathname==='/api/content-drafts/d1/publish') {published=req.postDataJSON();body={campaign:{id:'c1'}};}
    else if(url.pathname==='/api/campaigns/c1')body={id:'c1',job:{title:draft.title},status:'ACTIVE',dryRun:true,groups:[{groupId:'g1'}],posts:[],contentSnapshot:draft.finalText};
    else body={};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('http://127.0.0.1:5174/content');
  await page.getByRole('heading',{name:'استوديو المحتوى'}).waitFor();
  await page.getByLabel('عنوان المسودة').fill('فرص عمل — القاهرة');
  await page.getByLabel('البيانات اللي البوست هيتبني عليها').fill('مطلوب موظفين خدمة عملاء في القاهرة. الراتب 10000 جنيه. التواصل على 01000000000.');
  const groupCheckbox=page.locator('label').filter({hasText:'وظائف القاهرة والجيزة'}).getByRole('checkbox');
  await groupCheckbox.check();
  await page.getByRole('textbox',{name:'نص المنشور النهائي'}).fill('فرصة عمل في القاهرة\nمطلوب موظفين خدمة عملاء براتب 10000 جنيه.\nللتواصل: 01000000000');
  assert.equal(await page.getByRole('button',{name:'بدء حملة تجريبية (1)'}).isEnabled(),false);
  await page.getByLabel('راجعت صحة النص والجروبات المختارة، والمحتوى مناسب للنشر فيها.').check();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:resolve(output,'content-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(output,'content-mobile.png'),fullPage:true});
  
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'mobile layout overflows');
  await page.screenshot({path:resolve(output,'content-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'إلغاء كل الاختيارات'}).click();
  assert.equal(await page.getByRole('button',{name:'بدء حملة تجريبية (0)'}).isEnabled(),false);
  await groupCheckbox.check();
  assert.equal(await page.getByLabel('راجعت صحة النص والجروبات المختارة، والمحتوى مناسب للنشر فيها.').isChecked(),false);
  await page.getByLabel('راجعت صحة النص والجروبات المختارة، والمحتوى مناسب للنشر فيها.').check();
  await page.getByRole('button',{name:'بدء حملة تجريبية (1)'}).click();
  await page.waitForURL('**/campaigns/c1');
  assert.deepEqual(published.groupIds,['g1']);assert.equal(published.reviewed,true);assert.ok(published.requestKey);
  assert.deepEqual(errors,[]);
  console.log('UI verified: desktop/mobile, review reset, empty selection, saved snapshot, selected groups only.');
} finally {await browser.close();}
