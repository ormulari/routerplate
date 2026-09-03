import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    next: 'src/adapters/next.ts',
    express: 'src/adapters/express.ts',
    'eslint-plugin': 'src/eslint-plugin/index.ts',
  },
  format: ['esm', 'cjs'],
  // resolve inlines types from `@standard-schema/spec` (a types-only
  // devDependency) so consumers never need it installed.
  dts: { resolve: ['@standard-schema/spec'] },
  sourcemap: true,
  clean: true,
  splitting: false,
  target: 'node18',
  // Frameworks are optional peers resolved at the consumer; only type
  // imports exist for them. Validators are never imported at all.
  external: ['next', 'express'],
});
