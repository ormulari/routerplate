import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import tsParser from '@typescript-eslint/parser';
import { Linter } from 'eslint';
import express, { type Router } from 'express';
import type { NextApiHandler } from 'next';
import request from 'supertest';
import plugin from '../src/eslint-plugin/index';
import { shimServer } from './helpers';

const REPO = path.resolve(__dirname, '..');
const BIN = path.join(REPO, 'bin', 'routerplate.mjs');
const TSC = path.join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');
// Inside the repo on purpose: emitted files must resolve express/zod/next
// types from the repo's node_modules when compiled.
const TMP_ROOT = path.join(REPO, 'tests', '.tmp');

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

function initProject(name: string, args: string[]): string {
  const dir = path.join(TMP_ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0' }));
  execFileSync(process.execPath, [BIN, 'init', ...args, '--yes'], { cwd: dir, encoding: 'utf8' });
  return dir;
}

function typecheck(dir: string) {
  const rel = (target: string) =>
    path.relative(dir, path.join(REPO, target)).split(path.sep).join('/');
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          esModuleInterop: true,
          baseUrl: '.',
          paths: {
            routerplate: [rel('src/index.ts')],
            'routerplate/next': [rel('src/adapters/next.ts')],
            'routerplate/express': [rel('src/adapters/express.ts')],
          },
        },
        include: ['**/*.ts'],
      },
      null,
      2,
    ),
  );
  execFileSync(process.execPath, [TSC, '--noEmit', '-p', dir], { encoding: 'utf8' });
}

describe('emitted files compile (acceptance §7.4)', () => {
  it('express + zod project typechecks under strict mode', () => {
    const dir = initProject('compile-express-zod', [
      '--framework',
      'express',
      '--validator',
      'zod',
    ]);
    expect(() => typecheck(dir)).not.toThrow();
  });

  it('next + zod project typechecks under strict mode', () => {
    const dir = initProject('compile-next-zod', ['--framework', 'next', '--validator', 'zod']);
    expect(() => typecheck(dir)).not.toThrow();
  });

  it('express + valibot and express + arktype projects typecheck', () => {
    for (const validator of ['valibot', 'arktype']) {
      const dir = initProject(`compile-express-${validator}`, [
        '--framework',
        'express',
        '--validator',
        validator,
      ]);
      expect(() => typecheck(dir)).not.toThrow();
    }
  });
});

describe('emitted example passes the recommended ESLint config (acceptance §7.5)', () => {
  const linter = new Linter({ configType: 'flat' });
  const config = [
    {
      files: ['**/*.ts'],
      languageOptions: {
        parser: tsParser as never,
        ecmaVersion: 2022 as const,
        sourceType: 'module' as const,
      },
      plugins: { routerplate: plugin as never },
      rules: plugin.configs.recommended.rules as never,
    },
  ];

  it('both emitted example routes lint clean', () => {
    const expressDir = initProject('lint-express', [
      '--framework',
      'express',
      '--validator',
      'zod',
    ]);
    const nextDir = initProject('lint-next', ['--framework', 'next', '--validator', 'zod']);
    const expressExample = fs.readFileSync(path.join(expressDir, 'src/routes/items.ts'), 'utf8');
    const nextExample = fs.readFileSync(path.join(nextDir, 'pages/api/example.ts'), 'utf8');

    expect(linter.verify(expressExample, config as never, 'src/routes/items.ts')).toEqual([]);
    expect(linter.verify(nextExample, config as never, 'pages/api/example.ts')).toEqual([]);
  });
});

describe('emitted example routes run (the vitest alias maps `routerplate/*` to src/)', () => {
  it('express: the scaffolded items router serves the contract end to end', async () => {
    const dir = initProject('run-express-zod', ['--framework', 'express', '--validator', 'zod']);
    const { itemsRouter } = (await import(path.join(dir, 'src/routes/items.ts'))) as {
      itemsRouter: Router;
    };
    const app = express();
    app.use(express.json());
    app.use('/items', itemsRouter);

    const list = await request(app).get('/items');
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ data: [{ id: '1', name: 'First item' }], count: 1 });

    const created = await request(app).post('/items').send({ name: 'Second' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ data: { id: '2', name: 'Second' } });

    const invalid = await request(app).post('/items').send({ name: '' });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ code: 'VALIDATION_ERROR' });

    const one = await request(app).get('/items/2');
    expect(one.body).toEqual({ data: { id: '2', name: 'Second' } });

    const missing = await request(app).get('/items/99');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Item not found', code: 'NOT_FOUND' });

    expect((await request(app).delete('/items/2')).status).toBe(204);
    expect((await request(app).delete('/items/2')).status).toBe(404);
    expect((await request(app).patch('/items/1').send({})).status).toBe(405);
  });

  it('next: the scaffolded pages API route serves the contract end to end', async () => {
    const dir = initProject('run-next-zod', ['--framework', 'next', '--validator', 'zod']);
    const { default: handler } = (await import(path.join(dir, 'pages/api/example.ts'))) as {
      default: NextApiHandler;
    };
    const server = shimServer(handler);

    const list = await request(server).get('/api/example');
    expect(list.status).toBe(200);
    expect(list.body).toEqual({ data: [{ id: '1', name: 'First item' }], count: 1 });

    const created = await request(server).post('/api/example').send({ name: 'Second' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ data: { id: '2', name: 'Second' } });

    const invalid = await request(server).post('/api/example').send({ name: '' });
    expect(invalid.status).toBe(400);

    const notAllowed = await request(server).delete('/api/example');
    expect(notAllowed.status).toBe(405);
    expect(notAllowed.headers.allow).toBe('GET, POST');
  });
});
