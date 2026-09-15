import pino from 'pino';
import { resolve } from 'node:path';
import { prisma, acquireProcessLock } from '@repo/database';
import { AutomationPausedError, TaskRunner } from './runner.js';

process.chdir(resolve(import.meta.dirname, '../../..'));
acquireProcessLock('worker');
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const runner = new TaskRunner();
const pollMs = Number(process.env.TASK_POLL_MS ?? 1500);
const leaseMs = Number(process.env.TASK_LEASE_MS ?? 60_000);
let shuttingDown = false;
let lastScheduledAt = 0;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

await runner.queue.recoverExpired();
logger.info({ dryRun: process.env.DRY_RUN !== 'false' }, 'worker started');

async function state() {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'automationState' } });
  return setting ? JSON.parse(setting.valueJson) as string : 'STOPPED';
}

async function loop() {
  while (!shuttingDown) {
    try {
      if (await state() !== 'RUNNING') { await runner.browser.close(); await wait(pollMs); continue; }
      if (Date.now() - lastScheduledAt > 60_000) { await runner.scheduleDue(); lastScheduledAt = Date.now(); }
      const task = await runner.queue.claim(leaseMs);
      if (!task?.leaseToken) { await wait(pollMs); continue; }
      logger.info({ taskId: task.id, type: task.type, attempt: task.attempts }, 'task claimed');
      runner.currentTask = task;
      runner.interrupted = false;
      let monitoring = false;
      let lastHeartbeat = 0;
      let lostLease = false;
      const monitor = setInterval(() => {
        if (monitoring) return;
        monitoring = true;
        void (async () => {
          if (await state() !== 'RUNNING' || shuttingDown) { runner.interrupted = true; await runner.browser.close(); return; }
          if (Date.now() - lastHeartbeat >= leaseMs / 3) {
            const renewed = await runner.queue.heartbeat(task.id, task.leaseToken!, leaseMs);
            lastHeartbeat = Date.now();
            if (!renewed.count) { lostLease = true; runner.interrupted = true; await runner.browser.close(); }
          }
        })().catch(async () => { lostLease = true; runner.interrupted = true; await runner.browser.close(); }).finally(() => { monitoring = false; });
      }, 300);
      try {
        await runner.guard();
        await runner.execute(task);
        if (!lostLease) await runner.queue.complete(task.id, task.leaseToken);
        logger.info({ taskId: task.id }, 'task completed');
      } catch (error) {
        if (error instanceof AutomationPausedError || await state() !== 'RUNNING' || shuttingDown) {
          await runner.queue.pause(task.id, task.leaseToken);
        } else if (!lostLease) {
          const manual = await runner.captureFailure(task, error);
          await runner.queue.fail(task.id, task.leaseToken, error instanceof Error ? error.message : String(error), manual);
          logger.error({ taskId: task.id, err: error, manual }, 'task failed');
        }
      } finally {
        clearInterval(monitor);
        while (monitoring) await wait(20);
        runner.currentTask = null;
        await runner.browser.close();
      }
      const settings = await prisma.systemSetting.findUnique({ where: { key: 'automationSettings' } });
      const delay = settings ? Number(JSON.parse(settings.valueJson).actionDelayMs ?? 3000) : 3000;
      await wait(delay);
    } catch (error) {
      logger.error({ err: error }, 'worker loop error');
      await wait(Math.max(pollMs, 3000));
    }
  }
}

async function shutdown() { shuttingDown = true; await runner.browser.close(); }
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
await loop();
await prisma.$disconnect();
