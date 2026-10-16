// Starts MagicFinder: the local server, then the browser.
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { parse } from 'yaml';
import { CatalogueStore } from '../catalogue/updater';
import { StoreDirectory, type StoreRecord } from '../core/stores';
import { SolverPool } from '../optimiser/pool';
import { FetchTcgSource } from '../sources/fetchTcg';
import { MtgSinglesSource } from '../sources/mtgSingles';
import { createApp } from './app';
import { dataDir } from './paths';
import { RunManager } from './runs';
import { SearchCache } from './searchCache';
import { SettingsStore } from './settings';

const dev = process.argv.includes('--dev');
const version: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const storesFile = new URL('../../data/stores.yaml', import.meta.url);
const webDir = new URL('../../dist/web/', import.meta.url).pathname;

const dir = dataDir();
const settings = new SettingsStore(dir);
const catalogue = new CatalogueStore(dir);
const cache = new SearchCache(dir);
const stores: StoreRecord[] = parse(readFileSync(storesFile, 'utf8'));
let directory = new StoreDirectory(stores);
const pool = new SolverPool();
const mtgsingles = new MtgSinglesSource({ storeName: key => stores.find(s => s.source_keys.mtgsingles === key)?.name });
const sources = [new FetchTcgSource(), mtgsingles];

const runs = new RunManager({
  catalogue: () => catalogue.get(),
  sources,
  cache,
  settings,
  // A fresh directory per run picks up Fetch sellers' details from that run's Listings.
  directory: () => directory,
  solve: pool.solve,
  parallel: pool.size,
  appVersion: version,
});

const app = createApp({ catalogue, settings, runs, version });
if (!dev) {
  if (!existsSync(webDir)) console.warn('The web app has not been built. Run `npm start` (it builds first).');
  app.use('/*', serveStatic({ root: webDir.replace(process.cwd(), '.') }));
  app.get('*', serveStatic({ path: `${webDir}index.html`.replace(process.cwd(), '.') }));
}

async function freePort(start: number): Promise<number> {
  for (let p = start; p < start + 20; p++) {
    const ok = await new Promise<boolean>(resolve => {
      const s = createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)));
      s.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  throw new Error('No free port found');
}

function openBrowser(url: string) {
  if (process.env.MAGICFINDER_NO_OPEN) return;
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

const port = dev ? 5180 : await freePort(5180);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  const url = `http://localhost:${port}`;
  console.log(`MagicFinder ${version} is running at ${url}${dev ? ' (API only; open the Vite dev server)' : ''}`);
  console.log('Close this window (or press Ctrl+C) to stop it.');
  if (!dev) openBrowser(url);
});

// Keep the card list fresh: now (first run downloads it) and then once a day.
void catalogue.refreshIfStale();
setInterval(() => void catalogue.refreshIfStale(), 60 * 60 * 1000).unref();
// Clear Fetch sellers learned from old runs once a day so their details stay current.
setInterval(() => (directory = new StoreDirectory(stores)), 24 * 60 * 60 * 1000).unref();

const shutdown = async () => {
  await Promise.allSettled([mtgsingles.close(), pool.close()]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
