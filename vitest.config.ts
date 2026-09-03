import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    // Lets the CLI tests import the routes `routerplate init` scaffolds,
    // which import the package by name.
    alias: [
      { find: /^routerplate\/express$/, replacement: src('./src/adapters/express.ts') },
      { find: /^routerplate\/next$/, replacement: src('./src/adapters/next.ts') },
      { find: /^routerplate$/, replacement: src('./src/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/validators/**'],
      thresholds: {
        lines: 90,
      },
    },
  },
});
