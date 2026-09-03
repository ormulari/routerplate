import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const BIN = path.resolve(__dirname, '..', 'bin', 'routerplate.mjs');
const FAKE_TTY = path.resolve(__dirname, 'fake-tty.cjs');
const tempDirs: string[] = [];

function makeTempProject(pkg: Record<string, unknown> = { name: 'app', version: '0.0.0' }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routerplate-cli-'));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  return dir;
}

function run(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout?.toString() ?? '',
      stderr: failure.stderr?.toString() ?? '',
    };
  }
}

/**
 * Drive the interactive path. The child believes it has a TTY (see
 * fake-tty.cjs); each time a prompt appears on stdout, the next answer is
 * written. An empty string accepts the default.
 */
function runInteractive(
  cwd: string,
  args: string[],
  answers: string[],
): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-r', FAKE_TTY, BIN, ...args], {
      cwd,
      env: { ...process.env, TERM: 'dumb' },
    });
    const pending = [...answers];
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      // eslint-disable-next-line no-control-regex
      const visible = stdout.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
      if (visible.endsWith('): ')) child.stdin.write(`${pending.shift() ?? ''}\n`);
    });
    child.on('close', (status) => resolve({ status, stdout }));
  });
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('routerplate init', () => {
  it('scaffolds a Next.js + zod project (snapshot)', () => {
    const dir = makeTempProject();
    const result = run(dir, ['init', '--framework', 'next', '--validator', 'zod', '--yes']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('npm install routerplate next zod');

    const adapter = fs.readFileSync(path.join(dir, 'lib/api/route.ts'), 'utf8');
    const example = fs.readFileSync(path.join(dir, 'pages/api/example.ts'), 'utf8');
    const eslintConfig = fs.readFileSync(path.join(dir, 'eslint.config.mjs'), 'utf8');
    expect(adapter).toMatchSnapshot('next-adapter');
    expect(example).toMatchSnapshot('next-example');
    expect(eslintConfig).toMatchSnapshot('next-eslint-config');
    expect(eslintConfig).toContain("files: ['pages/api/**/*.ts']");
  });

  it('scaffolds an Express + zod project (snapshot)', () => {
    const dir = makeTempProject();
    const result = run(dir, ['init', '--framework', 'express', '--validator', 'zod', '--yes']);
    expect(result.status).toBe(0);

    const adapter = fs.readFileSync(path.join(dir, 'lib/api/route.ts'), 'utf8');
    const example = fs.readFileSync(path.join(dir, 'src/routes/items.ts'), 'utf8');
    expect(adapter).toMatchSnapshot('express-adapter');
    expect(example).toMatchSnapshot('express-example');
    expect(example).toContain("from '../../lib/api/route'");
    expect(fs.readFileSync(path.join(dir, 'eslint.config.mjs'), 'utf8')).toContain(
      "files: ['src/routes/**/*.ts']",
    );
  });

  it('emits valibot and arktype example schemas', () => {
    for (const validator of ['valibot', 'arktype']) {
      const dir = makeTempProject();
      run(dir, ['init', '--framework', 'express', '--validator', validator, '--yes']);
      const example = fs.readFileSync(path.join(dir, 'src/routes/items.ts'), 'utf8');
      expect(example).toMatchSnapshot(`express-example-${validator}`);
    }
  });

  it('detects framework and validator from package.json', () => {
    const dir = makeTempProject({
      name: 'app',
      dependencies: { next: '^14.0.0' },
      devDependencies: { valibot: '^1.0.0' },
    });
    const result = run(dir, ['init', '--yes']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('next + valibot');
    expect(fs.readFileSync(path.join(dir, 'pages/api/example.ts'), 'utf8')).toContain(
      "from 'valibot'",
    );
    // next + valibot already present; only routerplate itself is missing
    expect(result.stdout).toContain('npm install routerplate');
    expect(result.stdout).not.toContain('npm install routerplate next');
  });

  it('is idempotent: a re-run reports unchanged and exits 0', () => {
    const dir = makeTempProject();
    run(dir, ['init', '--framework', 'express', '--validator', 'zod', '--yes']);
    const rerun = run(dir, ['init', '--framework', 'express', '--validator', 'zod', '--yes']);
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toContain('unchanged');
    expect(rerun.stdout).not.toContain('SKIPPED');
  });

  it('never overwrites without --force', () => {
    const dir = makeTempProject();
    run(dir, ['init', '--framework', 'express', '--validator', 'zod', '--yes']);
    fs.writeFileSync(path.join(dir, 'lib/api/route.ts'), '// my customized adapter\n');

    const blocked = run(dir, ['init', '--framework', 'express', '--validator', 'zod', '--yes']);
    expect(blocked.status).toBe(1);
    expect(blocked.stdout).toContain('SKIPPED');
    expect(fs.readFileSync(path.join(dir, 'lib/api/route.ts'), 'utf8')).toBe(
      '// my customized adapter\n',
    );

    const forced = run(dir, [
      'init',
      '--framework',
      'express',
      '--validator',
      'zod',
      '--yes',
      '--force',
    ]);
    expect(forced.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, 'lib/api/route.ts'), 'utf8')).toContain('createRoute');
  });

  it('leaves an existing eslint config alone and prints the snippet instead', () => {
    const dir = makeTempProject();
    fs.writeFileSync(path.join(dir, 'eslint.config.mjs'), 'export default [];\n');
    const result = run(dir, ['init', '--framework', 'express', '--validator', 'zod', '--yes']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('add this block');
    expect(fs.readFileSync(path.join(dir, 'eslint.config.mjs'), 'utf8')).toBe(
      'export default [];\n',
    );
  });

  it('fails with an actionable message when nothing is detectable and no flags are given', () => {
    const dir = makeTempProject();
    const result = run(dir, ['init', '--yes']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--framework');
  });

  it('honors --dir', () => {
    const dir = makeTempProject();
    run(dir, [
      'init',
      '--framework',
      'express',
      '--validator',
      'zod',
      '--dir',
      'server/api',
      '--yes',
    ]);
    expect(fs.existsSync(path.join(dir, 'server/api/route.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'src/routes/items.ts'), 'utf8')).toContain(
      "from '../../server/api/route'",
    );
  });

  it('--no-eslint skips the ESLint wiring; --eslint-glob overrides the default glob', () => {
    const without = makeTempProject();
    const skipped = run(without, [
      'init',
      '--framework',
      'express',
      '--validator',
      'zod',
      '--no-eslint',
      '--yes',
    ]);
    expect(skipped.status).toBe(0);
    expect(fs.existsSync(path.join(without, 'eslint.config.mjs'))).toBe(false);
    expect(skipped.stdout).not.toContain('eslint');

    const custom = makeTempProject();
    run(custom, [
      'init',
      '--framework',
      'express',
      '--validator',
      'zod',
      '--eslint-glob',
      'server/**/*.ts',
      '--yes',
    ]);
    expect(fs.readFileSync(path.join(custom, 'eslint.config.mjs'), 'utf8')).toContain(
      "files: ['server/**/*.ts']",
    );
  });

  it('next: uses src/pages when there is no top-level pages directory', () => {
    const dir = makeTempProject();
    fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
    run(dir, ['init', '--framework', 'next', '--validator', 'zod', '--yes']);
    expect(fs.existsSync(path.join(dir, 'src/pages/api/example.ts'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'pages'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'src/pages/api/example.ts'), 'utf8')).toContain(
      "from '../../../lib/api/route'",
    );
    expect(fs.readFileSync(path.join(dir, 'eslint.config.mjs'), 'utf8')).toContain(
      "files: ['src/pages/api/**/*.ts']",
    );
  });

  it('rejects unknown --framework / --validator values', () => {
    const dir = makeTempProject();
    const framework = run(dir, ['init', '--framework', 'fastify', '--validator', 'zod', '--yes']);
    expect(framework.status).toBe(1);
    expect(framework.stderr).toContain('unknown framework "fastify"');

    const validator = run(dir, ['init', '--framework', 'express', '--validator', 'yup', '--yes']);
    expect(validator.status).toBe(1);
    expect(validator.stderr).toContain('unknown validator "yup"');
    expect(fs.existsSync(path.join(dir, 'lib'))).toBe(false);
  });
});

describe('routerplate init (interactive)', () => {
  it('prompts for everything, re-asks on a bad answer, and honors the answers', async () => {
    const dir = makeTempProject();
    const result = await runInteractive(
      dir,
      ['init'],
      [
        'fastify', // not a choice → re-asked
        'express',
        'valibot',
        'server/api',
        'yes', // wire ESLint
        '', // accept the proposed glob
      ],
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Please answer one of: next, express');
    expect(result.stdout).toContain('express + valibot');
    expect(fs.existsSync(path.join(dir, 'server/api/route.ts'))).toBe(true);
    const example = fs.readFileSync(path.join(dir, 'src/routes/items.ts'), 'utf8');
    expect(example).toContain("from 'valibot'");
    expect(example).toContain("from '../../server/api/route'");
    expect(fs.readFileSync(path.join(dir, 'eslint.config.mjs'), 'utf8')).toContain(
      "files: ['src/routes/**/*.ts']",
    );
  });

  it('proposes what it detected as defaults and lets "no" skip ESLint', async () => {
    const dir = makeTempProject({
      name: 'app',
      dependencies: { next: '^14.0.0', zod: '^3.25.0' },
    });
    const result = await runInteractive(dir, ['init'], ['', '', '', 'no']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Framework [next/express] (next)');
    expect(result.stdout).toContain('Validator [zod/valibot/arktype] (zod)');
    expect(result.stdout).toContain('next + zod');
    expect(fs.existsSync(path.join(dir, 'lib/api/route.ts'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'pages/api/example.ts'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'eslint.config.mjs'))).toBe(false);
  });

  it('flags on the command line are not asked again', async () => {
    const dir = makeTempProject();
    const result = await runInteractive(
      dir,
      ['init', '--framework', 'express', '--validator', 'zod', '--no-eslint'],
      ['', ''],
    );
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('Framework [');
    expect(result.stdout).not.toContain('Validator [');
    expect(result.stdout).toContain('Adapter directory (lib/api)');
    expect(fs.existsSync(path.join(dir, 'lib/api/route.ts'))).toBe(true);
  });
});

describe('routerplate doctor', () => {
  function stubInstall(dir: string, name: string, version: string) {
    const pkgDir = path.join(dir, 'node_modules', name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name, version }));
  }

  it('passes on a healthy project', () => {
    const dir = makeTempProject();
    run(dir, ['init', '--framework', 'express', '--validator', 'zod', '--yes']);
    stubInstall(dir, 'routerplate', '1.0.0');
    stubInstall(dir, 'zod', '3.25.76');
    stubInstall(dir, 'express', '4.19.2');

    const result = run(dir, ['doctor']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Everything looks good');
  });

  it('fails with actionable messages on a broken project', () => {
    const dir = makeTempProject();
    const result = run(dir, ['doctor']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('routerplate is not installed');
    expect(result.stdout).toContain('no supported validator installed');
    expect(result.stdout).toContain('no adapter file found');
    expect(result.stdout).toContain('npx routerplate init');
  });

  it('--dir points doctor at an adapter outside the common locations', () => {
    const dir = makeTempProject();
    run(dir, [
      'init',
      '--framework',
      'express',
      '--validator',
      'zod',
      '--dir',
      'server/api',
      '--yes',
    ]);
    stubInstall(dir, 'routerplate', '1.0.0');
    stubInstall(dir, 'zod', '3.25.76');

    expect(run(dir, ['doctor']).stdout).toContain('no adapter file found');
    const found = run(dir, ['doctor', '--dir', 'server/api']);
    expect(found.status).toBe(0);
    expect(found.stdout).toContain('adapter file found (server/api/route.ts)');
  });

  it('flags multiple validators and out-of-range peers', () => {
    const dir = makeTempProject();
    run(dir, ['init', '--framework', 'express', '--validator', 'zod', '--yes']);
    stubInstall(dir, 'routerplate', '1.0.0');
    stubInstall(dir, 'zod', '3.20.0'); // below the 3.24 minimum
    stubInstall(dir, 'valibot', '1.0.0');

    const result = run(dir, ['doctor']);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('multiple validators installed (zod, valibot)');
    expect(result.stdout).toContain('zod 3.20.0 is below the supported minimum 3.24');
  });
});

describe('cli basics', () => {
  it('--version prints the package version', () => {
    const dir = makeTempProject();
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'),
    ) as {
      version: string;
    };
    expect(run(dir, ['--version']).stdout.trim()).toBe(pkg.version);
  });

  it('--help prints usage; unknown commands fail', () => {
    const dir = makeTempProject();
    expect(run(dir, ['--help']).stdout).toContain('Usage:');
    const unknown = run(dir, ['frobnicate']);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('unknown command');
  });
});
