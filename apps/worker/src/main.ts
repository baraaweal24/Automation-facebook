import pino from 'pino';
import { resolve } from 'node:path';
import { prisma } from '@repo/database';
import { TaskRunner } from './runner.js';

process.chdir(resolve(import.meta.dirname, '../../..'));
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
      if (await state() !== 'RUNNING') { await wait(pollMs); continue; }
      if (Date.now() - lastScheduledAt > 60_000) { await runner.scheduleDue(); lastScheduledAt = Date.now(); }
      const task = await runner.queue.claim(leaseMs);
      if (!task?.leaseToken) { await wait(pollMs); continue; }
      logger.info({ taskId: task.id, type: task.type, attempt: task.attempts }, 'task claimed');
      try {
        await runner.execute(task);
        await runner.queue.complete(task.id, task.leaseToken);
        logger.info({ taskId: task.id }, 'task completed');
      } catch (error) {
        const manual = await runner.captureFailure(task, error);
        await runner.queue.fail(task.id, task.leaseToken, error instanceof Error ? error.message : String(error), manual);
        logger.error({ taskId: task.id, err: error, manual }, 'task failed');
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

async function shutdown() { shuttingDown = true; await runner.browser.close(); await prisma.$disconnect(); process.exit(0); }
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
await loop();
