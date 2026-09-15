import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll } from 'vitest';

// Every test file gets a new database. Never read .env or claim operator tasks.
const directory = mkdtempSync(resolve(tmpdir(), 'facebook-automation-test-'));
const database = resolve(directory, 'test.db');
process.env.DATABASE_URL = `file:${database.replace(/\\/g, '/')}`;
process.env.DRY_RUN = 'true'; process.env.NODE_ENV = 'test'; process.env.LOG_LEVEL = 'silent';
process.env.UPLOAD_PATH = resolve(directory,'uploads');
process.env.SCREENSHOT_PATH = resolve(directory,'screenshots');
process.env.FACEBOOK_PROFILE_PATH = resolve(directory,'facebook-profile');
process.env.CHATGPT_PROFILE_PATH = resolve(directory,'chatgpt-profile');
const db = new DatabaseSync(database);
for (const migration of readdirSync(resolve(import.meta.dirname,'../packages/database/prisma/migrations'),{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>entry.name).sort()) {
  db.exec(readFileSync(resolve(import.meta.dirname, `../packages/database/prisma/migrations/${migration}/migration.sql`), 'utf8'));
}
db.close();
afterAll(async () => {
  const { prisma } = await import('../packages/database/src/index.js');
  await prisma.$disconnect();
  rmSync(directory, {recursive:true, force:true, maxRetries:5, retryDelay:100});
});
