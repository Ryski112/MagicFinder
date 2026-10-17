// Smoke-tests an extracted download with its own bundled Node:
//   <app>/runtime/node[.exe] scripts/smoke-package.mjs <app folder>
// Starts the app, checks the page, a deep link and the API, checks the solver worker loads, checks a second launch
// opens the running copy instead of starting another, then stops it. Exits non-zero on any failure.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

const app = resolve(process.argv[2] ?? '.');
const node = process.execPath;
const data = mkdtempSync(join(tmpdir(), 'mf-smoke-'));
const env = { ...process.env, MAGICFINDER_NO_OPEN: '1', MAGICFINDER_DATA_DIR: data };
delete env.MAGICFINDER_PORT;
const fail = msg => {
  console.error(`FAIL: ${msg}`);
  process.exitCode = 1;
};

const start = () => {
  const p = spawn(node, ['--disable-warning=ExperimentalWarning', 'src/server/main.mjs'], { cwd: app, env });
  let out = '';
  p.stdout.on('data', d => (out += d));
  p.stderr.on('data', d => (out += d));
  return { p, output: () => out };
};

const first = start();
let port = null;
for (let i = 0; i < 60 && port === null; i++) {
  await new Promise(r => setTimeout(r, 500));
  port = first.output().match(/running at http:\/\/localhost:(\d+)/)?.[1] ?? null;
}
try {
  if (!port) throw new Error(`the app didn't start:\n${first.output()}`);
  const base = `http://127.0.0.1:${port}`;
  const status = await (await fetch(`${base}/api/status`)).json();
  if (status.app !== 'MagicFinder') fail(`/api/status: ${JSON.stringify(status)}`);
  for (const path of ['/', '/plan']) {
    const res = await fetch(base + path);
    const html = await res.text();
    if (res.status !== 200 || !html.includes('id="root"')) fail(`${path} returned ${res.status}`);
  }
  const asset = (await (await fetch(base)).text()).match(/\/assets\/[^"]+\.js/)?.[0];
  if (!asset || (await fetch(base + asset)).status !== 200) fail(`web assets not served (${asset})`);

  // The solver worker loads (with highs) in a worker thread, as the app's pool does.
  await new Promise(done => {
    const w = new Worker(pathToFileURL(join(app, 'src/server/worker.mjs')));
    const t = setTimeout(() => w.terminate().then(done), 3000);
    w.once('error', e => {
      clearTimeout(t);
      fail(`solver worker: ${e.message}`);
      w.terminate().then(done);
    });
  });

  // A second launch should hand over to the running copy and exit.
  const second = start();
  const code = await new Promise(r => second.p.once('exit', r));
  if (code !== 0 || !second.output().includes('already running')) fail(`second launch: exit ${code}\n${second.output()}`);
} catch (e) {
  fail(e.message);
} finally {
  first.p.kill();
  await new Promise(r => setTimeout(r, 500));
  rmSync(data, { recursive: true, force: true });
}
if (!process.exitCode) console.log(`OK: ${app} (Node ${process.version}, port ${port})`);
