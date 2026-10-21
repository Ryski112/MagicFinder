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
import { mergeInFlight } from '../sources/inFlight';
import { MtgSinglesSource } from '../sources/mtgSingles';
import { Throttle } from '../sources/policy';
import { requestCount } from '../sources/requestCount';
import { createApp } from './app';
import { AuStoreFile, WeeklyAuCheck, withAuStores } from './auStores';
import { CardKingdom, CardKingdomPrices } from './cardKingdom';
import { storeThrottle } from './cart';
import { ExchangeRate } from './exchangeRate';
import { hostingFromEnv } from './hosting';
import { choosePort } from './instance';
import { APP_VERSION, dataDir } from './paths';
import { HOSTED_RUNS, RunManager } from './runs';
import { SearchCache } from './searchCache';
import { SettingsStore } from './settings';
import { availableUpdate, checkForUpdate } from './updates';

const dev = process.argv.includes('--dev');
const hosting = hostingFromEnv();

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
const shipped: StoreRecord[] = parse(readFileSync(storesFile, 'utf8'));
// Hosted mode swaps in the weekly Australian Store check's results; the desktop uses the shipped table as it is.
let stores = shipped;
let directory = new StoreDirectory(stores);
const exchangeRate = new ExchangeRate(dir);
const cardKingdom = new CardKingdom(new CardKingdomPrices(dir), exchangeRate);
const pool = new SolverPool(hosting.solvers);
// Both MtgSingles Sources use the same API, so they share one request pace.
const mtgsinglesThrottle = new Throttle(1500);
const mtgsingles = new MtgSinglesSource({ storeName: key => stores.find(s => s.source_keys.mtgsingles === key)?.name, throttle: mtgsinglesThrottle });
const mtgsinglesAu = new MtgSinglesSource({
  country: 'AU',
  throttle: mtgsinglesThrottle,
  audToNzd: async () => {
    await exchangeRate.refreshIfStale();
    return exchangeRate.audToNzd;
  },
});
if (hosting.hosted) {
  const auCheck = new WeeklyAuCheck({
    file: new AuStoreFile(dir),
    baseline: shipped.filter(s => s.country === 'AU'),
    // Shares the MtgSingles pace with friends' searches, and each Store's pace with their cart checks.
    source: mtgsinglesAu,
    audToNzd: async () => {
      await exchangeRate.refreshIfStale();
      return exchangeRate.audToNzd;
    },
    wait: host => storeThrottle(host).wait(),
    onUpdate: au => {
      stores = withAuStores(shipped, au);
      directory = new StoreDirectory(stores);
    },
  });
  stores = withAuStores(shipped, auCheck.current());
  directory = new StoreDirectory(stores);
  // A few minutes after start-up (so a restart loop doesn't hammer anyone), then hourly to see if a week has passed.
  setTimeout(() => void auCheck.runIfDue(), 5 * 60 * 1000).unref();
  setInterval(() => void auCheck.runIfDue(), 60 * 60 * 1000).unref();
}

// Identical searches already on their way are shared between runs.
const sources = [new FetchTcgSource(), mtgsingles, mtgsinglesAu].map(mergeInFlight);

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
}, hosting.hosted ? HOSTED_RUNS : null);
if (hosting.hosted) {
  setInterval(() => runs.sweep(), 15_000).unref();
  // Each day's Source requests go to the container log (no ceiling; the owner just sees the volume).
  requestCount.onDayEnd = line => console.log(line);
  setInterval(() => requestCount.rollover(), 10 * 60 * 1000).unref();
}

// No update notice in hosted mode: the owner cuts the releases and updates the image by hand.
const app = createApp({ catalogue, settings, runs, cache, version, stores: () => stores, update: () => (dev || hosting.hosted ? null : availableUpdate(settings, version)), hosted: hosting.hosted });
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

serve({ fetch: app.fetch, port, hostname: hosting.host }, () => {
  const url = `http://localhost:${port}`;
  console.log(`MagicFinder ${version} is running at ${url}${dev ? ' (API only; open the Vite dev server)' : ''}${hosting.hosted ? ` (hosted mode, listening on ${hosting.host})` : ''}`);
  if (!hosting.hosted) console.log('Close this window (or press Ctrl+C) to stop it.');
  if (!dev) openBrowser(url);
});

// Keep the card list fresh: now (first run downloads it) and then once a day.
void catalogue.refreshIfStale();
setInterval(() => void catalogue.refreshIfStale(), 60 * 60 * 1000).unref();
// "A new version is available": checked at most once a day (not in dev mode, where you run your own code, nor in
// hosted mode).
if (!dev && !hosting.hosted) {
  void checkForUpdate(settings);
  setInterval(() => void checkForUpdate(settings), 60 * 60 * 1000).unref();
}
// Clear Fetch sellers learned from old runs once a day so their details stay current.
setInterval(() => (directory = new StoreDirectory(stores)), 24 * 60 * 60 * 1000).unref();

const shutdown = async () => {
  if (hosting.hosted) console.log(`${requestCount.line()} (so far)`);
  await pool.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Windows sends this when the console window is closed.
process.on('SIGHUP', shutdown);
