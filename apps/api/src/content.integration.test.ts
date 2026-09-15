import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { prisma } from '@repo/database';
import { app } from './main.js';
import { hashToken } from './http.js';
import { chatgpt } from './content.js';
const token='integration-test-session';const csrf='integration-test-csrf';
let groupId='';let draftId='';
const auth=(method:'post'|'patch',path:string)=>request(app)[method](path).set('Cookie',`session=${token}`).set('x-csrf-token',csrf);
beforeAll(async()=>{
  const user=await prisma.user.create({data:{username:'tester',email:'tester@example.test',passwordHash:'unused'}});
  await prisma.session.create({data:{userId:user.id,tokenHash:hashToken(token),csrfToken:csrf,expiresAt:new Date(Date.now()+3600000)}});
  const group=await prisma.group.create({data:{name:'وظائف القاهرة',canonicalUrl:'https://www.facebook.com/groups/123',membershipStatus:'JOINED',location:'القاهرة'}});groupId=group.id;
});
describe('reviewed content publishing API',()=>{
  it('protects all content mutations with auth and CSRF',async()=>{
    await request(app).post('/api/content-drafts').send({}).expect(401);
    await request(app).post('/api/content-drafts').set('Cookie',`session=${token}`).send({}).expect(403);
  });
  it('saves a draft and generates with the chosen group context',async()=>{
    const created=await auth('post','/api/content-drafts').send({title:'وظائف فنادق',sourceData:'مطلوب موظفين للعمل في القاهرة، التواصل 01000000000',groupIds:[groupId]}).expect(201);
    draftId=created.body.id;
    const generate=vi.spyOn(chatgpt,'generate').mockResolvedValue({text:'مطلوب موظفين للعمل في القاهرة. للتواصل: 01000000000',chatUrl:'https://chatgpt.com/c/test'});
    await auth('post',`/api/content-drafts/${draftId}/generate`).send({}).expect(202);
    await vi.waitFor(async()=>{expect((await prisma.contentDraft.findUniqueOrThrow({where:{id:draftId}})).finalText).toContain('01000000000');});
    expect(generate.mock.calls[0][0]).toContain('وظائف القاهرة');generate.mockRestore();
  });
  it('requires explicit groups and review, then creates exactly one campaign on retry',async()=>{
    const input={groupIds:[groupId],reviewed:true,requestKey:crypto.randomUUID()};
    await auth('post',`/api/content-drafts/${draftId}/publish`).send({...input,reviewed:false}).expect(400);
    await auth('post',`/api/content-drafts/${draftId}/publish`).send({...input,groupIds:[]}).expect(400);
    const first=await auth('post',`/api/content-drafts/${draftId}/publish`).send(input).expect(201);
    const second=await auth('post',`/api/content-drafts/${draftId}/publish`).send(input).expect(201);
    expect(first.body.campaign.id).toBe(second.body.campaign.id);
    expect(await prisma.campaign.count()).toBe(1);expect(await prisma.job.count()).toBe(1);
    expect(await prisma.automationTask.count({where:{type:'PUBLISH_JOB'}})).toBe(1);
  });
  it('rejects blacklist changes and invalid settings or post statuses',async()=>{
    await prisma.blacklist.create({data:{groupId,reason:'Not allowed'}});
    await auth('post',`/api/content-drafts/${draftId}/publish`).send({groupIds:[groupId],reviewed:true,requestKey:crypto.randomUUID()}).expect(400);
    await auth('patch','/api/settings').send({automationState:'RUNNING'}).expect(400);
    await auth('post','/api/posts/nonexistent/status').send({status:'MADE_UP',reason:'invalid state'}).expect(400);
  });
});
