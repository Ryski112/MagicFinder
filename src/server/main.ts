// Starts MagicFinder: the local server, then the browser.
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { parse } from 'yaml';
import { CatalogueStore } from '../catalogue/updater';
import { StoreDirectory, type StoreRecord } from '../core/stores';
import { SolverPool } from '../optimiser/pool';
import { FetchTcgSource } from '../sources/fetchTcg';
import { MtgSinglesSource } from '../sources/mtgSingles';
import { createApp } from './app';
import { CardKingdom, CardKingdomPrices } from './cardKingdom';
import { ExchangeRate } from './exchangeRate';
import { choosePort } from './instance';
import { APP_VERSION, dataDir } from './paths';
import { RunManager } from './runs';
import { SearchCache } from './searchCache';
import { SettingsStore } from './settings';
import { availableUpdate, checkForUpdate } from './updates';

const dev = process.argv.includes('--dev');

// A second launch opens the copy that's already running, except in dev mode or on a chosen port, so a source copy can
// run beside a packaged one.
let port = Number(process.env.MAGICFINDER_PORT) || 5180;
if (!dev && !process.env.MAGICFINDER_PORT) {
  const choice = await choosePort(5180);
  if ('running' in choice) {
    console.log(`MagicFinder is already running, opening it (http://localhost:${choice.running}).`);
    openBrowser(`http://localhost:${choice.running}`);
    process.exit(0);
  }
  port = choice.free;
}
const version = APP_VERSION;
const storesFile = new URL('../../data/stores.yaml', import.meta.url);
// fileURLToPath, not URL.pathname: on Windows .pathname gives "/C:/…", which serveStatic can't find (the UI 404s).
const webDir = fileURLToPath(new URL('../../dist/web/', import.meta.url));

const dir = dataDir();
const settings = new SettingsStore(dir);
const catalogue = new CatalogueStore(dir);
const cache = new SearchCache(dir);
const stores: StoreRecord[] = parse(readFileSync(storesFile, 'utf8'));
let directory = new StoreDirectory(stores);
const cardKingdom = new CardKingdom(new CardKingdomPrices(dir), new ExchangeRate(dir));
const pool = new SolverPool();
const mtgsingles = new MtgSinglesSource({ storeName: key => stores.find(s => s.source_keys.mtgsingles === key)?.name });
const sources = [new FetchTcgSource(), mtgsingles];

const runs = new RunManager({
  catalogue: () => catalogue.get(),
  sources,
  cache,
  cardKingdom,
  settings,
  // A fresh directory per run picks up Fetch sellers' details from that run's Listings.
  directory: () => directory,
  solve: pool.solve,
  parallel: pool.size,
  appVersion: version,
});

const app = createApp({ catalogue, settings, runs, cache, version, update: () => (dev ? null : availableUpdate(settings, version)) });
if (!dev) {
  if (!existsSync(webDir)) console.warn('The web app has not been built. Run `npm start` (it builds first).');
  app.use('/*', serveStatic({ root: webDir }));
  app.get('*', serveStatic({ path: join(webDir, 'index.html') }));
}

function openBrowser(url: string) {
  if (process.env.MAGICFINDER_NO_OPEN) return;
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  const url = `http://localhost:${port}`;
  console.log(`MagicFinder ${version} is running at ${url}${dev ? ' (API only; open the Vite dev server)' : ''}`);
  console.log('Close this window (or press Ctrl+C) to stop it.');
  if (!dev) openBrowser(url);
});

// Keep the card list fresh: now (first run downloads it) and then once a day.
void catalogue.refreshIfStale();
setInterval(() => void catalogue.refreshIfStale(), 60 * 60 * 1000).unref();
// "A new version is available": checked at most once a day (not in dev mode, where you run your own code).
if (!dev) {
  void checkForUpdate(settings);
  setInterval(() => void checkForUpdate(settings), 60 * 60 * 1000).unref();
}
// Clear Fetch sellers learned from old runs once a day so their details stay current.
setInterval(() => (directory = new StoreDirectory(stores)), 24 * 60 * 60 * 1000).unref();

const shutdown = async () => {
  await pool.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Windows sends this when the console window is closed.
process.on('SIGHUP', shutdown);
