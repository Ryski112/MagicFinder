// Builds the friend-facing downloads: the official portable Node.js 24 runtime next to a bundled build of the app,
// as release/MagicFinder-windows-x64.zip and release/MagicFinder-linux-x64.tar.xz. Both are built from one Linux
// machine. Decided in "Which packaging approach, and where do friends download it?".
//
//   npm run package                  # latest Node 24.x
//   NODE_VERSION=24.22.0 npm run package
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'release');
const CACHE = join(OUT, '.cache');
const STAGE = join(OUT, 'stage');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const run = (cmd: string, args: string[], cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });
const has = (cmd: string) => {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

async function download(url: string, to: string): Promise<Buffer> {
  if (existsSync(to)) return readFileSync(to);
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(to, buf);
  return buf;
}

/** The Node 24 release to ship: NODE_VERSION if set, else the newest 24.x. */
async function nodeVersion(): Promise<string> {
  if (process.env.NODE_VERSION) return process.env.NODE_VERSION.replace(/^v/, '');
  const index = (await (await fetch('https://nodejs.org/dist/index.json')).json()) as { version: string }[];
  const v = index.find(r => r.version.startsWith('v24.'));
  if (!v) throw new Error('No Node 24 release found');
  return v.version.slice(1);
}

/** Downloads an official Node archive and checks it against the release's SHASUMS256.txt. */
async function nodeArchive(version: string, file: string): Promise<string> {
  const base = `https://nodejs.org/dist/v${version}`;
  const sums = (await download(`${base}/SHASUMS256.txt`, join(CACHE, `SHASUMS256-${version}.txt`))).toString();
  const want = sums.split('\n').find(l => l.endsWith(`  ${file}`))?.split(' ')[0];
  const path = join(CACHE, file);
  const got = createHash('sha256').update(await download(`${base}/${file}`, path)).digest('hex');
  if (!want || got !== want) {
    rmSync(path, { force: true });
    throw new Error(`Checksum mismatch for ${file}`);
  }
  return path;
}

/** Everything both downloads share: the bundled server and worker, the web app, the Store table and highs. */
async function stageCommon(dir: string) {
  run('npx', ['vite', 'build', '--logLevel', 'warn']);
  const shared = {
    bundle: true,
    platform: 'node' as const,
    format: 'esm' as const,
    target: 'node24',
    external: ['highs'],
    // Some bundled CommonJS packages call require(); give the ES module one.
    banner: { js: "import { createRequire as __mfRequire } from 'node:module'; const require = __mfRequire(import.meta.url);" },
    logLevel: 'warning' as const,
  };
  // main.mjs and worker.mjs sit side by side in src/server, two folders below package.json, data/ and dist/, as in the
  // source tree, so the app's relative paths work unchanged (the solver pool picks worker.mjs when it exists).
  await build({ ...shared, entryPoints: [join(ROOT, 'src/server/main.ts')], outfile: join(dir, 'src/server/main.mjs') });
  await build({ ...shared, entryPoints: [join(ROOT, 'src/optimiser/worker.ts')], outfile: join(dir, 'src/server/worker.mjs') });
  cpSync(join(ROOT, 'dist/web'), join(dir, 'dist/web'), { recursive: true });
  cpSync(join(ROOT, 'data/stores.yaml'), join(dir, 'data/stores.yaml'));
  cpSync(join(ROOT, 'LICENSE'), join(dir, 'LICENSE'));
  cpSync(join(ROOT, 'node_modules/highs'), join(dir, 'node_modules/highs'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: 'module' }, null, 2) + '\n');
}

const WINDOWS_LAUNCHER = [
  '@echo off',
  'rem Starts MagicFinder with the Node.js runtime shipped next to this file. Closing this window stops it.',
  'cd /d "%~dp0"',
  'title MagicFinder - keep this open',
  'rem Double-clicking inside the zip runs this file alone from a temporary folder, without the rest of the app.',
  'if not exist "runtime\\node.exe" goto zipped',
  'runtime\\node.exe --disable-warning=ExperimentalWarning src\\server\\main.mjs %*',
  'pause',
  'exit /b',
  ':zipped',
  'echo MagicFinder is being run from inside the zip file, which doesn\'t work.',
  'echo.',
  'echo Extract the zip first: right-click it, choose Extract All, then open MagicFinder.cmd',
  'echo in the extracted folder.',
  'echo.',
  'pause',
  '',
].join('\r\n');

const LINUX_LAUNCHER = `#!/bin/sh
# Starts MagicFinder with the Node.js runtime shipped next to this file. Press Ctrl+C (or close the terminal) to stop it.
cd "$(dirname "$0")" || exit 1
exec ./runtime/node --disable-warning=ExperimentalWarning src/server/main.mjs "$@"
`;

function zipDir(dir: string, out: string) {
  rmSync(out, { force: true });
  if (has('zip')) run('zip', ['-q', '-r', '-X', '-9', out, '.'], dir);
  else run('python3', ['-c', `import os, zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, _, files in os.walk('.'):
        for f in sorted(files):
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, '.'))`, out], dir);
}

async function main() {
  const version = await nodeVersion();
  console.log(`MagicFinder ${pkg.version} with Node ${version}`);
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(CACHE, { recursive: true });
  const common = join(STAGE, 'common');
  await stageCommon(common);

  // Windows: a zip whose root holds MagicFinder.cmd (Extract All puts it in a folder named after the zip).
  const win = join(STAGE, 'windows');
  cpSync(common, win, { recursive: true });
  const winZip = await nodeArchive(version, `node-v${version}-win-x64.zip`);
  mkdirSync(join(win, 'runtime'), { recursive: true });
  writeFileSync(join(win, 'runtime/node.exe'), execFileSync('unzip', ['-p', winZip, `node-v${version}-win-x64/node.exe`], { maxBuffer: 512 * 1024 * 1024 }));
  writeFileSync(join(win, 'MagicFinder.cmd'), WINDOWS_LAUNCHER);
  const winOut = join(OUT, 'MagicFinder-windows-x64.zip');
  zipDir(win, winOut);

  // Linux: a tarball with a MagicFinder/ folder, keeping the launcher and node executable.
  const lin = join(STAGE, 'linux/MagicFinder');
  cpSync(common, lin, { recursive: true });
  const linTar = await nodeArchive(version, `node-v${version}-linux-x64.tar.xz`);
  mkdirSync(join(lin, 'runtime'), { recursive: true });
  run('tar', ['-xJf', linTar, '-C', join(lin, 'runtime'), '--strip-components=2', `node-v${version}-linux-x64/bin/node`]);
  writeFileSync(join(lin, 'MagicFinder.sh'), LINUX_LAUNCHER);
  chmodSync(join(lin, 'MagicFinder.sh'), 0o755);
  chmodSync(join(lin, 'runtime/node'), 0o755);
  const linOut = join(OUT, 'MagicFinder-linux-x64.tar.xz');
  rmSync(linOut, { force: true });
  run('tar', ['-cJf', linOut, '-C', join(STAGE, 'linux'), '--owner=0', '--group=0', 'MagicFinder']);

  const sums = [winOut, linOut].map(f => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${f.split('/').pop()}`);
  writeFileSync(join(OUT, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  for (const f of [winOut, linOut]) console.log(`${f.split('/').pop()}: ${(readFileSync(f).length / 1e6).toFixed(1)} MB`);
}

await main();
