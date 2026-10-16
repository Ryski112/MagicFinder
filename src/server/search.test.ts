import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalogue, Catalogue } from '../catalogue/catalogue';
import { SourceError, type Source, type SourceListing } from '../sources/types';
import type { SourceId } from '../core/types';
import { queryFor, searchAll, type SearchCard, type SearchProgress } from './search';
import { SearchCache } from './searchCache';
import { DEFAULT_SETTINGS, type Settings } from './settings';

const dir = mkdtempSync(join(tmpdir(), 'mf-search-'));
let cat: Catalogue;
let cards: SearchCard[];
beforeAll(async () => {
  const raw = readFileSync('test/fixtures/scryfall-sample.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
  await buildCatalogue(join(dir, 'c.sqlite'), raw, 'test');
  cat = new Catalogue(join(dir, 'c.sqlite'));
  const names = ['Sol Ring', 'Counterspell', 'Fire // Ice', 'Bonecrusher Giant', 'Delver of Secrets', 'Bind', 'Lava Axe', 'Rhystic Study', 'Command Tower', 'Lava, Axe', 'Bind // Liberate'];
  cards = names.map(n => cat.findCard(n)!).map(c => ({ oracleId: c.oracleId, name: c.name }));
});
afterAll(() => {
  cat.close();
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
const freshCache = () => new SearchCache(mkdtempSync(join(dir, `cache${n++}-`)));
const settings = (over: Partial<Settings> = {}): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), ...over });

/** A Source that answers with one Listing per card, and can misbehave from the `failAt`-th search on. */
function fakeSource(id: SourceId, opts: { failAt?: number; error?: SourceError; empty?: boolean; failOn?: number[] } = {}): Source & { calls: string[] } {
  const calls: string[] = [];
  return {
    id,
    name: id === 'fetch' ? 'Fetch TCG' : 'MtgSingles',
    calls,
    async search(q: string) {
      calls.push(q);
      if (opts.failOn?.includes(calls.length)) throw new SourceError('down', 'Server error (504)');
      if (opts.failAt !== undefined && calls.length > opts.failAt) throw opts.error ?? new SourceError('blocked', 'nope');
      if (opts.empty) return [];
      const card = cat.findCard(q) ?? cat.findCard(q.split(' // ')[0]);
      if (!card) return [];
      const p = cat.printingsOf(card.oracleId)[0];
      const l: SourceListing = {
        id: `${id}:${q}`, source: id, storeKey: `${id}:store`, storeName: 'Store', title: card.name, scryfallId: p.id,
        finish: 'nonfoil', treatments: [], condition: 'NM', english: true, price: 2, quantity: 1, url: 'https://x.test', buyable: true,
      };
      return [l];
    },
  };
}

describe('queryFor', () => {
  it('searches MtgSingles by the front face of long double-faced names only', () => {
    expect(queryFor('mtgsingles', 'Delver of Secrets // Insectile Aberration')).toBe('Delver of Secrets');
    expect(queryFor('mtgsingles', 'Fire // Ice')).toBe('Fire // Ice');
    expect(queryFor('fetch', 'Delver of Secrets // Insectile Aberration')).toBe('Delver of Secrets // Insectile Aberration');
  });
});

describe('searchAll', () => {
  it('collects matched Listings from every Source and reports progress', async () => {
    const progress: SearchProgress[] = [];
    const r = await searchAll(cards, { catalogue: cat, sources: [fakeSource('fetch'), fakeSource('mtgsingles')], cache: freshCache(), settings: settings(), appVersion: 't' }, p => progress.push(p));
    expect(r.listings).toHaveLength(cards.length * 2);
    expect(r.sources.every(s => s.status === 'ok' && s.searched === cards.length)).toBe(true);
    expect(progress.at(-1)).toMatchObject({ done: cards.length, total: cards.length });
  });

  it('keeps going on the other Source when one blocks, keeping what it already answered', async () => {
    const health: [SourceId, boolean][] = [];
    const mts = fakeSource('mtgsingles', { failAt: 4 });
    const r = await searchAll(cards, { catalogue: cat, sources: [fakeSource('fetch'), mts], cache: freshCache(), settings: settings(), appVersion: 't', onHealth: (s, b) => health.push([s, b]) }, () => {});
    const st = r.sources.find(s => s.source === 'mtgsingles')!;
    expect(st.status).toBe('blocked');
    expect(st.searched).toBe(4);
    expect(st.notSearched).toHaveLength(cards.length - 4);
    expect(mts.calls).toHaveLength(5); // stopped straight away, no retries
    expect(r.listings.filter(l => l.source === 'mtgsingles')).toHaveLength(4);
    expect(health).toContainEqual(['mtgsingles', true]);
    expect(health).toContainEqual(['fetch', false]);
  });

  it('stands in cached Listings up to a day old for a blocked Source, and says how old they are', async () => {
    const cache = freshCache();
    const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
    const good = fakeSource('mtgsingles');
    for (const c of cards.slice(0, 6)) cache.put('mtgsingles', queryFor('mtgsingles', c.name), await good.search(queryFor('mtgsingles', c.name)), fiveHoursAgo);
    const r = await searchAll(cards, { catalogue: cat, sources: [fakeSource('mtgsingles', { failAt: 0 })], cache, settings: settings(), appVersion: 't' }, () => {});
    const st = r.sources[0];
    expect(st.status).toBe('blocked');
    expect(st.searched).toBe(6);
    expect(st.notSearched).toHaveLength(cards.length - 6);
    expect(st.staleSince).toBe(fiveHoursAgo);
    expect(r.listings).toHaveLength(6);
  });

  it('skips one card the Source has a server error on, keeps searching, and tries it again at the end', async () => {
    const mts = fakeSource('mtgsingles', { failOn: [3, cards.length + 1] });
    const r = await searchAll(cards, { catalogue: cat, sources: [mts], cache: freshCache(), settings: settings(), appVersion: 't', retryPause: async () => {} }, () => {});
    expect(r.sources[0]).toMatchObject({ status: 'ok', searched: cards.length - 1, failedCards: 1 });
    expect(r.sources[0].notSearched).toEqual([cards[2].oracleId]);
    expect(mts.calls.at(-1)).toBe(queryFor('mtgsingles', cards[2].name));
  });

  it('recovers a skipped card when the second try works', async () => {
    const mts = fakeSource('mtgsingles', { failOn: [3] });
    const r = await searchAll(cards, { catalogue: cat, sources: [mts], cache: freshCache(), settings: settings(), appVersion: 't', retryPause: async () => {} }, () => {});
    expect(r.sources[0]).toMatchObject({ status: 'ok', searched: cards.length, failedCards: 0, notSearched: [] });
  });

  it('treats server errors on several cards in a row as the Source being down', async () => {
    const mts = fakeSource('mtgsingles', { failOn: [2, 3, 4] });
    const r = await searchAll(cards, { catalogue: cat, sources: [mts], cache: freshCache(), settings: settings(), appVersion: 't' }, () => {});
    expect(r.sources[0].status).toBe('down');
    expect(mts.calls).toHaveLength(4);
  });

  it('does not ask a Source that blocked recently, and says when it will', async () => {
    const s = settings();
    s.sourceHealth.mtgsingles = { blockedAt: new Date().toISOString(), consecutiveBlockedRuns: 1 };
    const mts = fakeSource('mtgsingles');
    const r = await searchAll(cards, { catalogue: cat, sources: [fakeSource('fetch'), mts], cache: freshCache(), settings: s, appVersion: 't' }, () => {});
    expect(mts.calls).toHaveLength(0);
    expect(r.sources.find(x => x.source === 'mtgsingles')).toMatchObject({ status: 'cooling-down', notSearched: expect.any(Array) });
  });

  it('does not search a Source that is switched off', async () => {
    const mts = fakeSource('mtgsingles');
    const r = await searchAll(cards, { catalogue: cat, sources: [fakeSource('fetch'), mts], cache: freshCache(), settings: settings({ sources: { fetch: true, mtgsingles: false } }), appVersion: 't' }, () => {});
    expect(mts.calls).toHaveLength(0);
    expect(r.sources.find(x => x.source === 'mtgsingles')?.status).toBe('off');
  });

  it('gives copyable details when a Source has changed', async () => {
    const r = await searchAll(cards, { catalogue: cat, sources: [fakeSource('fetch', { failAt: 0, error: new SourceError('changed', 'no searchResults') })], cache: freshCache(), settings: settings(), appVersion: '9.9' }, () => {});
    expect(r.sources[0].status).toBe('changed');
    expect(r.sources[0].details).toMatch(/MagicFinder 9\.9[\s\S]*no searchResults/);
  });

  it('spots a Source that quietly answers with nothing, using the staples check', async () => {
    const mts = fakeSource('mtgsingles', { empty: true });
    const r = await searchAll(cards, { catalogue: cat, sources: [fakeSource('fetch'), mts], cache: freshCache(), settings: settings(), appVersion: 't' }, () => {});
    const st = r.sources.find(x => x.source === 'mtgsingles')!;
    expect(st.status).toBe('blocked');
    expect(st.notSearched).toHaveLength(cards.length);
    expect(mts.calls.slice(cards.length)).toEqual(DEFAULT_SETTINGS.staples);
  });
});
