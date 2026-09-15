import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node', include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    fileParallelism: false, setupFiles: ['./scripts/test-setup.ts'], testTimeout: 30000, hookTimeout: 60000,
    coverage: { reporter: ['text', 'html'] },
  },
  resolve: { alias: Object.fromEntries(['shared','database','queue','facebook-automation'].map(name => [`@repo/${name}`, fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))])) },
});
