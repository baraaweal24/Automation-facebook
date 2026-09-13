import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@repo/database';
import { DatabaseQueue } from './index.js';

const key = `test-queue-${Date.now()}`;
const queue = new DatabaseQueue();

describe('DatabaseQueue integration', () => {
  it('deduplicates by idempotency key and atomically claims once', async () => {
    const first = await queue.enqueue('CHECK_FACEBOOK_SESSION', {}, key);
    const second = await queue.enqueue('CHECK_FACEBOOK_SESSION', { duplicate: true }, key);
    expect(second.id).toBe(first.id);
    const claimed = await queue.claim();
    expect(claimed?.id).toBe(first.id);
    const duplicateClaim = await queue.claim();
    expect(duplicateClaim?.id).not.toBe(first.id);
    await queue.complete(first.id, claimed!.leaseToken!);
    expect((await prisma.automationTask.findUnique({ where: { id: first.id } }))?.status).toBe('COMPLETED');
  });
});

afterAll(async () => { await prisma.automationTask.deleteMany({ where: { idempotencyKey: key } }); await prisma.$disconnect(); });
