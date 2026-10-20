import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalogue, Catalogue } from '../catalogue/catalogue';
import type { CatalogueStore } from '../catalogue/updater';
import type { CardPrintingsResponse, CardSearchResponse } from '../shared/api';
import { createApp, type AppDeps } from './app';
import type { SearchCache } from './searchCache';
import { SettingsStore, type Settings } from './settings';

const dir = mkdtempSync(join(tmpdir(), 'mf-app-'));
let cat: Catalogue;

beforeAll(async () => {
  const cards = readFileSync('test/fixtures/scryfall-sample.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
  await buildCatalogue(join(dir, 'catalogue.sqlite'), cards, '2026-10-16');
  cat = new Catalogue(join(dir, 'catalogue.sqlite'));
});
afterAll(() => {
  cat.close();
  rmSync(dir, { recursive: true, force: true });
});

// Only the catalogue matters to the card searcher's routes.
const appWith = (store: Partial<CatalogueStore>) => createApp({ catalogue: store as CatalogueStore } as AppDeps);

describe('card searcher API', () => {
  it('suggests cards by name, with an image', async () => {
    const res = await appWith({ ready: true, get: () => cat }).request('/api/cards/search?q=rhystc');
    const body = (await res.json()) as CardSearchResponse;
    expect(body.results[0]).toMatchObject({ name: 'Rhystic Study', how: 'typo', matchedAlias: null });
    expect(body.results[0].image).toMatch(/^https:\/\/cards\.scryfall\.io\//);
  });

  it('lists a card\'s Printings newest first, with upper-case set codes', async () => {
    const app = appWith({ ready: true, get: () => cat });
    const [sol] = ((await (await app.request('/api/cards/search?q=sol ring')).json()) as CardSearchResponse).results;
    const { printings } = (await (await app.request(`/api/cards/${sol.oracleId}/printings`)).json()) as CardPrintingsResponse;
    expect(printings.length).toBeGreaterThan(1);
    expect(printings.map(p => p.year)).toEqual([...printings.map(p => p.year)].sort().reverse());
    expect(printings.every(p => p.setCode === p.setCode.toUpperCase())).toBe(true);
  });

  it('says the card list is still downloading', async () => {
    const app = appWith({ ready: false });
    expect((await app.request('/api/cards/search?q=sol')).status).toBe(503);
    expect((await app.request('/api/cards/x/printings')).status).toBe(503);
  });
});

describe('hosted mode', () => {
  const settingsDir = mkdtempSync(join(tmpdir(), 'mf-app-settings-'));
  const settings = new SettingsStore(settingsDir);
  const cache = { clear: () => 3 } as unknown as SearchCache;
  const app = (hosted: boolean) => createApp({ catalogue: { ready: true } as CatalogueStore, settings, cache, version: '0', hosted, update: () => ({ version: '9', url: 'x' }) } as AppDeps);

  it('says so in the status, and only then', async () => {
    expect(await (await app(true).request('/api/status')).json()).toMatchObject({ hosted: true });
    expect(await (await app(false).request('/api/status')).json()).not.toHaveProperty('hosted');
  });

  it('keeps friends\' settings in their browsers: settings.json can\'t be changed and the cache can\'t be cleared', async () => {
    expect((await app(true).request('/api/settings', { method: 'PUT', body: '{"pickupCity":"Dunedin"}' })).status).toBe(403);
    expect((await app(true).request('/api/cache/clear', { method: 'POST' })).status).toBe(403);
    expect(settings.get().pickupCity).toBe('Auckland');
    expect(await (await app(false).request('/api/cache/clear', { method: 'POST' })).json()).toEqual({ cleared: 3 });
  });

  it('merges a browser\'s settings onto the server\'s', async () => {
    const res = await app(true).request('/api/settings/friend', { method: 'POST', body: JSON.stringify({ pickupCity: 'Dunedin', staples: [] }) });
    const s = (await res.json()) as Settings;
    expect(s.pickupCity).toBe('Dunedin');
    expect(s.staples).toEqual(settings.get().staples);
    expect((await app(false).request('/api/settings/friend', { method: 'POST', body: '{}' })).status).toBe(404);
  });
});
