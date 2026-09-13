import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

for (const line of readFileSync(new URL('./.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
}

export default defineConfig({
  test: { environment: 'node', include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'], sequence: { concurrent: false }, coverage: { reporter: ['text', 'html'] } },
  resolve: { alias: { '@repo/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)), '@repo/database': fileURLToPath(new URL('./packages/database/src/index.ts', import.meta.url)), '@repo/queue': fileURLToPath(new URL('./packages/queue/src/index.ts', import.meta.url)) } },
});
