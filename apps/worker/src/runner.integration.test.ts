import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@repo/database';
import { FacebookPublisherService } from '@repo/facebook-automation';
import { TaskRunner } from './runner.js';

async function fixture(size=1) {
  const job=await prisma.job.create({data:{title:'Test content',city:'Cairo',category:'محتوى عام',finalText:'Original source text',status:'ACTIVE'}});
  const groups=await Promise.all(Array.from({length:size},(_,i)=>prisma.group.create({data:{name:`Group ${i}`,canonicalUrl:`https://www.facebook.com/groups/${Date.now()}${i}`,membershipStatus:'JOINED'}})));
  const campaign=await prisma.campaign.create({data:{jobId:job.id,status:'ACTIVE',contentSnapshot:'Reviewed content snapshot',dryRun:true,groups:{create:groups.map(g=>({groupId:g.id}))}}});
  return {job,groups,campaign};
}
beforeEach(async()=>{
  vi.restoreAllMocks();
  await prisma.automationTask.deleteMany(); await prisma.post.deleteMany(); await prisma.campaign.deleteMany(); await prisma.job.deleteMany(); await prisma.group.deleteMany();
  await prisma.systemSetting.upsert({where:{key:'automationState'},create:{key:'automationState',valueJson:'"RUNNING"'},update:{valueJson:'"RUNNING"'}});
  await prisma.systemSetting.upsert({where:{key:'automationSettings'},create:{key:'automationSettings',valueJson:'{"maxPostsPerRun":2}'},update:{valueJson:'{"maxPostsPerRun":2}'}});
});
describe('campaign execution and recovery',()=>{
  it('materializes all groups and drains subsequent batches without losing targets',async()=>{
    const {campaign,job}=await fixture(5);const runner=new TaskRunner();
    await runner.prepareCampaign(campaign.id);
    expect(await prisma.post.count({where:{campaignId:campaign.id}})).toBe(5);
    expect(await prisma.automationTask.count()).toBe(2);
    await prisma.job.update({where:{id:job.id},data:{finalText:'Changed after review'}});
    const publisher=vi.spyOn(FacebookPublisherService.prototype,'publish').mockResolvedValue({status:'WOULD_POST'});
    vi.spyOn(runner.browser,'page').mockResolvedValue({} as never);
    vi.spyOn(runner.browser,'assertNoBlocker').mockResolvedValue();
    for(let batch=0;batch<3;batch++){
      let task;while((task=await runner.queue.claim())){await runner.execute(task);await runner.queue.complete(task.id,task.leaseToken!);}
      await runner.prepareCampaign(campaign.id);
    }
    expect(publisher).toHaveBeenCalledTimes(5);
    expect(await prisma.post.count({where:{status:'WOULD_POST',content:'Reviewed content snapshot'}})).toBe(5);
    expect((await prisma.campaign.findUniqueOrThrow({where:{id:campaign.id}})).status).toBe('COMPLETED');
  });
  it('never repeats a post after a crash between sending and recording the result',async()=>{
    const {campaign}=await fixture();const runner=new TaskRunner();await runner.prepareCampaign(campaign.id);
    const task=await runner.queue.claim();const post=await prisma.post.findFirstOrThrow();
    await prisma.post.update({where:{id:post.id},data:{status:'POSTING'}});
    await prisma.automationTask.update({where:{id:task!.id},data:{leaseExpiresAt:new Date(0)}});
    await runner.queue.recoverExpired();
    expect((await prisma.post.findUniqueOrThrow({where:{id:post.id}})).status).toBe('MANUAL_ACTION_REQUIRED');
    const publisher=vi.spyOn(FacebookPublisherService.prototype,'publish');
    await runner.execute(task!);
    expect(publisher).not.toHaveBeenCalled();
  });
  it('checks emergency state and changed group eligibility before sending',async()=>{
    const {campaign,groups}=await fixture();const runner=new TaskRunner();await runner.prepareCampaign(campaign.id);
    const task=await runner.queue.claim();
    await prisma.systemSetting.update({where:{key:'automationState'},data:{valueJson:'"EMERGENCY_STOPPED"'}});
    await expect(runner.guard()).rejects.toThrow();
    await prisma.systemSetting.update({where:{key:'automationState'},data:{valueJson:'"RUNNING"'}});
    await prisma.blacklist.create({data:{groupId:groups[0].id,reason:'Blocked after review'}});
    const publisher=vi.spyOn(FacebookPublisherService.prototype,'publish');await runner.execute(task!);
    expect(publisher).not.toHaveBeenCalled();
    expect((await prisma.post.findFirstOrThrow()).status).toBe('SKIPPED');
  });
  it('renewed leases survive recovery; stale owners cannot complete a task',async()=>{
    const runner=new TaskRunner();await runner.queue.enqueue('CHECK_FACEBOOK_SESSION',{},crypto.randomUUID());
    const task=await runner.queue.claim();
    expect((await runner.queue.heartbeat(task!.id,task!.leaseToken!,60000)).count).toBe(1);
    expect((await runner.queue.recoverExpired()).count).toBe(0);
    expect((await runner.queue.complete(task!.id,'stale-token')).count).toBe(0);
  });
});
