import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@repo/database';
import { app } from './main.js';

describe('Express API integration', () => {
  it('publishes health and framework metadata', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body).toMatchObject({ status: 'ok', framework: 'express', dryRun: true });
  });

  it('exposes OpenAPI and protects operator data', async () => {
    const docs = await request(app).get('/api/openapi.json').expect(200);
    expect(docs.body.openapi).toBe('3.0.3');
    const protectedResponse = await request(app).get('/api/dashboard').expect(401);
    expect(protectedResponse.body.error.code).toBe('UNAUTHENTICATED');
  });
});

afterAll(async () => prisma.$disconnect());
