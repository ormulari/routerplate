#!/usr/bin/env node
// routerplate CLI: zero dependencies (node:util parseArgs, node:fs, node:readline).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url));
const OWN_PACKAGE = fileURLToPath(new URL('../package.json', import.meta.url));

const FRAMEWORKS = ['next', 'express'];
const VALIDATOR_NAMES = ['zod', 'valibot', 'arktype'];

const VALIDATORS = {
  zod: {
    import: "import { z } from 'zod';",
    defs: [
      'const ItemSchema = z.object({ id: z.string(), name: z.string() });',
      'const CreateItemSchema = z.object({ name: z.string().min(1) });',
      'const ItemListSchema = z.array(ItemSchema);',
      'type Item = z.infer<typeof ItemSchema>;',
    ],
    paramsDef: 'const IdParamsSchema = z.object({ id: z.string() });',
  },
  valibot: {
    import: "import * as v from 'valibot';",
    defs: [
      'const ItemSchema = v.object({ id: v.string(), name: v.string() });',
      'const CreateItemSchema = v.object({ name: v.pipe(v.string(), v.minLength(1)) });',
      'const ItemListSchema = v.array(ItemSchema);',
      'type Item = v.InferOutput<typeof ItemSchema>;',
    ],
    paramsDef: 'const IdParamsSchema = v.object({ id: v.string() });',
  },
  arktype: {
    import: "import { type } from 'arktype';",
    defs: [
      "const ItemSchema = type({ id: 'string', name: 'string' });",
      "const CreateItemSchema = type({ name: 'string > 0' });",
      'const ItemListSchema = ItemSchema.array();',
      'type Item = typeof ItemSchema.infer;',
    ],
    paramsDef: "const IdParamsSchema = type({ id: 'string' });",
  },
};

/** Minimum peer versions doctor accepts, as [major, minor]. */
const PEER_MINIMUMS = {
  next: [13, 0],
  express: [4, 18],
  zod: [3, 24],
  valibot: [1, 0],
  arktype: [2, 0],
};

const HELP = `routerplate: the opinionated, verifiable layer for REST API boilerplate.

Usage:
  npx routerplate init [options]   Scaffold the adapter file, an example route, and ESLint wiring
  npx routerplate doctor [options] Check that routerplate is installed and wired correctly
  npx routerplate --version
  npx routerplate --help

init options:
  --framework next|express        Target framework (detected from package.json by default)
  --validator zod|valibot|arktype Schema library (detected from package.json by default)
  --dir <path>                    Where the adapter file goes (default: lib/api)
  --eslint / --no-eslint          Wire up routerplate/eslint-plugin (default: yes)
  --eslint-glob <glob>            Files the ESLint rules apply to
  --yes, -y                       Accept all defaults, no prompts
  --force                         Overwrite existing files

doctor options:
  --dir <path>                    Where to look for the adapter file (default: common locations)

init never installs packages and never overwrites without --force; re-runs are idempotent.`;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function allDeps(pkg) {
  return { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
}

function detect(pkg, candidates) {
  const deps = allDeps(pkg);
  return candidates.filter((name) => name in deps);
}

function renderTemplate(name, tokens = {}) {
  let content = fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');
  for (const [token, value] of Object.entries(tokens)) {
    content = content.replaceAll(`{{${token}}}`, value);
  }
  return content;
}

/** Write a file: created / unchanged / overwritten / skipped (exists, no --force). */
function writeFileSafe(cwd, relPath, content, force) {
  const absPath = path.join(cwd, relPath);
  if (fs.existsSync(absPath)) {
    if (fs.readFileSync(absPath, 'utf8') === content) return { relPath, status: 'unchanged' };
    if (!force) return { relPath, status: 'skipped' };
    fs.writeFileSync(absPath, content);
    return { relPath, status: 'overwritten' };
  }
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
  return { relPath, status: 'created' };
}

function reportWrite(result) {
  const labels = {
    created: '  created  ',
    unchanged: '  unchanged',
    overwritten: '  rewrote  ',
    skipped: '  SKIPPED  ',
  };
  let line = `${labels[result.status]} ${result.relPath}`;
  if (result.status === 'skipped') line += ' (exists and differs; pass --force to overwrite)';
  console.log(line);
}

async function ask(rl, question, fallback) {
  const answer = (await rl.question(`${question} (${fallback}): `)).trim();
  return answer || fallback;
}

async function choose(rl, label, choices, fallback) {
  for (;;) {
    const answer = await ask(rl, `${label} [${choices.join('/')}]`, fallback);
    if (choices.includes(answer)) return answer;
    console.log(`  Please answer one of: ${choices.join(', ')}`);
  }
}

/** POSIX relative import path from one project file to another (no extension). */
function relativeImport(fromRel, toRelNoExt) {
  let rel = path.posix.relative(
    path.posix.dirname(fromRel.split(path.sep).join('/')),
    toRelNoExt.split(path.sep).join('/'),
  );
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function findEslintConfig(cwd) {
  for (const name of [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts',
  ]) {
    if (fs.existsSync(path.join(cwd, name))) return name;
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────────
// init
// ────────────────────────────────────────────────────────────────

async function init(values, cwd) {
  const pkg = readJson(path.join(cwd, 'package.json'));
  if (!pkg) {
    console.error(
      'routerplate init: no package.json here. Run it in your project root (npm init first).',
    );
    return 1;
  }

  const interactive = !values.yes && process.stdin.isTTY && process.stdout.isTTY;
  const rl = interactive
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : undefined;

  try {
    // 1. Framework + validator, detected from package.json and proposed as defaults.
    const detectedFrameworks = detect(pkg, FRAMEWORKS);
    let framework = values.framework;
    if (framework && !FRAMEWORKS.includes(framework)) {
      console.error(
        `routerplate init: unknown framework "${framework}" (expected next or express).`,
      );
      return 1;
    }
    if (!framework) {
      const proposed = detectedFrameworks[0];
      if (rl) framework = await choose(rl, 'Framework', FRAMEWORKS, proposed ?? 'next');
      else if (proposed) framework = proposed;
      else {
        console.error(
          'routerplate init: could not detect next or express in package.json; pass --framework.',
        );
        return 1;
      }
    }

    const detectedValidators = detect(pkg, VALIDATOR_NAMES);
    let validator = values.validator;
    if (validator && !VALIDATOR_NAMES.includes(validator)) {
      console.error(
        `routerplate init: unknown validator "${validator}" (expected zod, valibot, or arktype).`,
      );
      return 1;
    }
    if (!validator) {
      const proposed = detectedValidators[0];
      if (rl) validator = await choose(rl, 'Validator', VALIDATOR_NAMES, proposed ?? 'zod');
      else if (proposed) validator = proposed;
      else {
        console.error(
          'routerplate init: could not detect zod, valibot, or arktype in package.json; pass --validator.',
        );
        return 1;
      }
    }

    let dir = values.dir;
    if (!dir) dir = rl ? await ask(rl, 'Adapter directory', 'lib/api') : 'lib/api';

    console.log(`\nrouterplate init: ${framework} + ${validator}\n`);

    const results = [];
    const force = Boolean(values.force);

    // 2. The app's adapter file: the only place services get imported.
    const adapterRel = path.join(dir, 'route.ts');
    results.push(
      writeFileSafe(cwd, adapterRel, renderTemplate(`${framework}/route.ts.tmpl`), force),
    );

    // 3. One example route file using the typed helpers.
    const snippets = VALIDATORS[validator];
    let exampleRel;
    let schemaDefs = snippets.defs;
    if (framework === 'next') {
      const pagesDir =
        !fs.existsSync(path.join(cwd, 'pages')) && fs.existsSync(path.join(cwd, 'src', 'pages'))
          ? path.join('src', 'pages')
          : 'pages';
      exampleRel = path.join(pagesDir, 'api', 'example.ts');
    } else {
      exampleRel = path.join('src', 'routes', 'items.ts');
      schemaDefs = [...snippets.defs, snippets.paramsDef];
    }
    const adapterNoExt = adapterRel.replace(/\.ts$/, '');
    results.push(
      writeFileSafe(
        cwd,
        exampleRel,
        renderTemplate(`${framework}/example-route.ts.tmpl`, {
          VALIDATOR_IMPORT: snippets.import,
          SCHEMA_DEFS: schemaDefs.join('\n'),
          ADAPTER_IMPORT: relativeImport(exampleRel, adapterNoExt),
        }),
        force,
      ),
    );

    // 4. ESLint wiring (flat config), scoped to the API glob.
    let wantEslint = values.eslint ?? !values['no-eslint'];
    if (values.eslint === undefined && !values['no-eslint'] && rl) {
      wantEslint =
        (await choose(rl, 'Wire up routerplate/eslint-plugin?', ['yes', 'no'], 'yes')) === 'yes';
    }
    let eslintNote;
    if (wantEslint) {
      const defaultGlob =
        framework === 'next'
          ? `${path.dirname(path.dirname(exampleRel)).split(path.sep).join('/')}/api/**/*.ts`
          : 'src/routes/**/*.ts';
      let glob = values['eslint-glob'];
      if (!glob) glob = rl ? await ask(rl, 'ESLint glob for API routes', defaultGlob) : defaultGlob;

      const existing = findEslintConfig(cwd);
      const snippet = renderTemplate('eslint.config.mjs.tmpl', { API_GLOB: glob });
      if (!existing) {
        results.push(writeFileSafe(cwd, 'eslint.config.mjs', snippet, force));
      } else if (
        fs.readFileSync(path.join(cwd, existing), 'utf8').includes('routerplate/eslint-plugin')
      ) {
        eslintNote = `  ${existing} already references routerplate/eslint-plugin; left as is.`;
      } else {
        eslintNote = [
          `  ${existing} exists; add this block to it yourself:`,
          '',
          ...snippet.split('\n').map((line) => `    ${line}`),
        ].join('\n');
      }
    }

    for (const result of results) reportWrite(result);
    if (eslintNote) console.log(`\n${eslintNote}`);

    // 5. Install line for anything missing; init never installs packages itself.
    const deps = allDeps(pkg);
    const missing = ['routerplate', framework, validator].filter((name) => !(name in deps));
    if (missing.length > 0) {
      console.log(
        `\nTo finish, install the missing packages:\n\n  npm install ${missing.join(' ')}\n`,
      );
    } else {
      console.log('\nAll packages already present. You are set.\n');
    }
    return results.some((result) => result.status === 'skipped') ? 1 : 0;
  } finally {
    rl?.close();
  }
}

// ────────────────────────────────────────────────────────────────
// doctor
// ────────────────────────────────────────────────────────────────

/** Find an installed package by walking node_modules upward from cwd. */
function findInstalled(cwd, name) {
  let current = cwd;
  for (;;) {
    const candidate = path.join(current, 'node_modules', name, 'package.json');
    if (fs.existsSync(candidate)) return readJson(candidate);
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function versionAtLeast(version, [major, minor]) {
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const [gotMajor, gotMinor] = [Number(match[1]), Number(match[2])];
  return gotMajor > major || (gotMajor === major && gotMinor >= minor);
}

function doctor(values, cwd) {
  const pkg = readJson(path.join(cwd, 'package.json'));
  if (!pkg) {
    console.error('routerplate doctor: no package.json here. Run it in your project root.');
    return 1;
  }

  const failures = [];
  const pass = (message) => console.log(`  ✓ ${message}`);
  const fail = (message, hint) => {
    console.log(`  ✗ ${message}`);
    if (hint) console.log(`      → ${hint}`);
    failures.push(message);
  };

  console.log('routerplate doctor\n');

  // 1. routerplate installed
  const self = findInstalled(cwd, 'routerplate');
  if (self) pass(`routerplate ${self.version} installed`);
  else fail('routerplate is not installed', 'npm install routerplate');

  // 2. a supported validator resolvable
  const installedValidators = VALIDATOR_NAMES.filter((name) => findInstalled(cwd, name));
  if (installedValidators.length > 0) {
    pass(`validator installed (${installedValidators.join(', ')})`);
  } else {
    fail('no supported validator installed', 'npm install zod (or valibot, or arktype)');
  }

  // 3. adapter file exists
  const adapterCandidates = values.dir
    ? [path.join(values.dir, 'route.ts')]
    : ['lib/api/route.ts', 'src/lib/api/route.ts', 'src/api/route.ts', 'app/lib/api/route.ts'];
  const adapter = adapterCandidates.find((candidate) => fs.existsSync(path.join(cwd, candidate)));
  if (adapter && fs.readFileSync(path.join(cwd, adapter), 'utf8').includes('createRoute')) {
    pass(`adapter file found (${adapter})`);
  } else if (adapter) {
    fail(`adapter file ${adapter} does not call createRoute`, 'npx routerplate init');
  } else {
    fail('no adapter file found', 'npx routerplate init (or pass --dir if it lives elsewhere)');
  }

  // 4. eslint plugin wired
  const eslintConfig = findEslintConfig(cwd);
  if (
    eslintConfig &&
    fs.readFileSync(path.join(cwd, eslintConfig), 'utf8').includes('routerplate/eslint-plugin')
  ) {
    pass(`eslint plugin wired (${eslintConfig})`);
  } else if (eslintConfig) {
    fail(
      `${eslintConfig} does not reference routerplate/eslint-plugin`,
      'npx routerplate init --eslint',
    );
  } else {
    fail('no flat eslint.config.* found', 'npx routerplate init --eslint');
  }

  // 5. peer versions in range
  for (const [name, minimum] of Object.entries(PEER_MINIMUMS)) {
    const installed = findInstalled(cwd, name);
    if (!installed) continue;
    if (versionAtLeast(installed.version, minimum)) {
      pass(`${name} ${installed.version} is in the supported range (>=${minimum.join('.')})`);
    } else {
      fail(
        `${name} ${installed.version} is below the supported minimum ${minimum.join('.')}`,
        `npm install ${name}@latest`,
      );
    }
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} problem${failures.length === 1 ? '' : 's'} found.`);
    return 1;
  }
  console.log('\nEverything looks good.');
  return 0;
}

// ────────────────────────────────────────────────────────────────
// entry
// ────────────────────────────────────────────────────────────────

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      options: {
        framework: { type: 'string' },
        validator: { type: 'string' },
        dir: { type: 'string' },
        eslint: { type: 'boolean' },
        'no-eslint': { type: 'boolean' },
        'eslint-glob': { type: 'string' },
        yes: { type: 'boolean', short: 'y' },
        force: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    console.error(`routerplate: ${error.message}`);
    console.error("Run 'npx routerplate --help' for usage.");
    process.exit(1);
  }

  const { values, positionals } = parsed;
  if (values.version) {
    console.log(readJson(OWN_PACKAGE)?.version ?? 'unknown');
    return;
  }
  const command = positionals[0];
  if (values.help || !command) {
    console.log(HELP);
    process.exit(command || values.help ? 0 : 1);
  }

  const cwd = process.cwd();
  if (command === 'init') process.exit(await init(values, cwd));
  if (command === 'doctor') process.exit(doctor(values, cwd));

  console.error(`routerplate: unknown command "${command}".`);
  console.error("Run 'npx routerplate --help' for usage.");
  process.exit(1);
}

main().catch((error) => {
  console.error(`routerplate: ${error?.stack ?? error}`);
  process.exit(1);
});
