import { randomUUID } from 'node:crypto';
import { prisma } from '@repo/database';
import type { TaskType } from '@repo/shared';

export class DatabaseQueue {
  async enqueue(type: TaskType, payload: unknown, idempotencyKey: string, options?: { priority?: number; runAt?: Date; maxAttempts?: number }) {
    return prisma.automationTask.upsert({
      where: { idempotencyKey },
      create: { type, payloadJson: JSON.stringify(payload), idempotencyKey, priority: options?.priority ?? 0, runAt: options?.runAt, maxAttempts: options?.maxAttempts ?? 3 },
      update: {},
    });
  }

  async claim(leaseMs = 60_000) {
    const now = new Date();
    const leaseToken = randomUUID();
    return prisma.$transaction(async (tx) => {
      const candidate = await tx.automationTask.findFirst({
        where: { status: { in: ['QUEUED', 'RETRY'] }, runAt: { lte: now }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
        orderBy: [{ priority: 'desc' }, { runAt: 'asc' }, { createdAt: 'asc' }],
      });
      if (!candidate) return null;
      const claimed = await tx.automationTask.updateMany({ where: { id: candidate.id, status: { in: ['QUEUED', 'RETRY'] }, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] }, data: { status: 'RUNNING', leaseToken, leaseExpiresAt: new Date(now.getTime() + leaseMs), heartbeatAt: now, attempts: { increment: 1 } } });
      if (claimed.count !== 1) return null;
      return tx.automationTask.findUnique({ where: { id: candidate.id } });
    });
  }

  async heartbeat(id: string, token: string, leaseMs = 60_000) {
    return prisma.automationTask.updateMany({ where: { id, leaseToken: token, status: 'RUNNING' }, data: { heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + leaseMs) } });
  }

  async complete(id: string, token: string) {
    return prisma.automationTask.updateMany({ where: { id, leaseToken: token, status: 'RUNNING' }, data: { status: 'COMPLETED', leaseToken: null, leaseExpiresAt: null } });
  }

  async fail(id: string, token: string, message: string, manual = false) {
    const task = await prisma.automationTask.findUniqueOrThrow({ where: { id } });
    const exhausted = task.attempts >= task.maxAttempts;
    const status = manual ? 'MANUAL_ACTION_REQUIRED' : exhausted ? 'FAILED' : 'RETRY';
    const delay = Math.min(60 * 60_000, 2 ** Math.max(task.attempts - 1, 0) * 5_000);
    return prisma.automationTask.updateMany({ where: { id, leaseToken: token, status: 'RUNNING' }, data: { status, lastError: message, runAt: new Date(Date.now() + delay), leaseToken: null, leaseExpiresAt: null } });
  }

  async pause(id: string, token: string) {
    return prisma.automationTask.updateMany({ where: { id, leaseToken: token, status: 'RUNNING' }, data: { status: 'PAUSED', attempts: { decrement: 1 }, leaseToken: null, leaseExpiresAt: null } });
  }

  async recoverExpired() {
    return prisma.$transaction(async tx => {
      const expired = await tx.automationTask.findMany({ where: { status: 'RUNNING', leaseExpiresAt: { lt: new Date() } } });
      for (const task of expired) {
        const payload = JSON.parse(task.payloadJson) as { postId?: string };
        const post = payload.postId ? await tx.post.findUnique({ where: { id: payload.postId } }) : null;
        const uncertain = post?.status === 'POSTING';
        const exhausted = task.attempts >= task.maxAttempts;
        if (post && (uncertain || exhausted) && !['POSTED','APPROVED','PENDING_ADMIN_APPROVAL','WOULD_POST','SKIPPED'].includes(post.status)) {
          const status = uncertain ? 'MANUAL_ACTION_REQUIRED' : 'FAILED';
          await tx.post.update({ where: { id: post.id }, data: { status, history: { create: { fromStatus: post.status, toStatus: status, source: 'AUTOMATION', reason: 'انتهت مهلة العامل. تحقق من النتيجة قبل الإعادة.' } } } });
        }
        await tx.automationTask.update({ where: { id: task.id }, data: { status: uncertain ? 'MANUAL_ACTION_REQUIRED' : exhausted ? 'FAILED' : 'RETRY', leaseToken: null, leaseExpiresAt: null, lastError: 'Worker lease expired; reconciliation required.' } });
      }
      return { count: expired.length };
    });
  }
}
