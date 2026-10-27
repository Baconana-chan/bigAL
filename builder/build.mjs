#!/usr/bin/env node
import { build, context } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const watch = process.argv.includes('--watch');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const metaTemplate = await readFile(path.join(root, 'tempermonkey/meta.txt'), 'utf8');
const banner = metaTemplate.replace(/\{\{version\}\}/g, pkg.version).trimEnd() + '\n';

const common = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2015'],
  charset: 'utf8',
  define: { __VERSION__: JSON.stringify(pkg.version) },
  loader: { '.css': 'text' },
  legalComments: 'none',
  logLevel: 'info',
  sourcemap: false,
  minify: false,
};

const targets = [
  {
    label: 'Manifest V2',
    entry: 'manifestv2/main.ts',
    outfile: 'dist/manifestv2/content.js',
    manifest: 'manifestv2/manifest.json',
  },
  {
    label: 'Manifest V3',
    entry: 'manifestv3/main.ts',
    outfile: 'dist/manifestv3/content.js',
    manifest: 'manifestv3/manifest.json',
  },
  {
    label: 'Userscript',
    entry: 'tempermonkey/main.ts',
    outfile: 'dist/bigAL.user.js',
    userscript: true,
  },
];

async function prepareManifest(target) {
  const source = JSON.parse(await readFile(path.join(root, target.manifest), 'utf8'));
  source.version = pkg.version;
  const outDir = path.dirname(path.join(root, target.outfile));
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(source, null, 2) + '\n', 'utf8');
}

function optionsFor(target) {
  const options = {
    ...common,
    entryPoints: [path.join(root, target.entry)],
    outfile: path.join(root, target.outfile),
  };
  if (target.userscript) {
    options.banner = { js: banner };
  }
  return options;
}

await rm(path.join(root, 'dist'), { recursive: true, force: true });

for (const target of targets) {
  if (target.manifest) {
    await prepareManifest(target);
  }
}

if (watch) {
  for (const target of targets) {
    const ctx = await context(optionsFor(target));
    await ctx.watch();
  }
  console.log('Watching shared/, manifestv2/, manifestv3/ and tempermonkey/ for changes...');
} else {
  for (const target of targets) {
    await build(optionsFor(target));
  }
  console.log('\nBuilt:');
  for (const target of targets) {
    console.log('  ' + path.relative(root, path.join(root, target.outfile)) + '  (' + target.label + ')');
  }
}
