import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalogue, Catalogue } from '../catalogue/catalogue';
import { StoreDirectory } from '../core/stores';
import type { SourceId } from '../core/types';
import { solveRung } from '../optimiser/milp';
import type { RunEvent } from '../shared/api';
import { SourceError, type Source, type SourceListing } from '../sources/types';
import type { CardKingdom } from './cardKingdom';
import { RunManager, type HostedRunOptions, type Run } from './runs';
import { SearchCache } from './searchCache';
import { DEFAULT_SETTINGS, friendSettings, SettingsStore } from './settings';

const dir = mkdtempSync(join(tmpdir(), 'mf-runs-'));
let cat: Catalogue;
beforeAll(async () => {
  const raw = readFileSync('test/fixtures/scryfall-sample.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
  await buildCatalogue(join(dir, 'c.sqlite'), raw, 'test');
  cat = new Catalogue(join(dir, 'c.sqlite'));
});
afterAll(() => {
  cat.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A Source whose searches wait until the test lets them through, and give up when their run stops. */
function gatedSource(id: SourceId) {
  const waiting: { q: string; go: () => void; fail: (e: Error) => void }[] = [];
  const calls: string[] = [];
  const aborted: string[] = [];
  const source: Source = {
    id,
    name: id === 'fetch' ? 'Fetch TCG' : 'MtgSingles',
    search: (q, signal) =>
      new Promise<SourceListing[]>((resolve, reject) => {
        calls.push(q);
        const card = cat.findCard(q)!;
        const p = cat.printingsOf(card.oracleId)[0];
        const listing: SourceListing = {
          id: `${id}:${q}`, source: id, storeKey: `${id}:store`, storeName: 'Store', title: card.name, scryfallId: p.id,
          finish: 'nonfoil', treatments: [], condition: 'NM', english: true, price: 2, quantity: 1, url: 'https://x.test', buyable: true,
        };
        waiting.push({ q, go: () => resolve([listing]), fail: reject });
        signal?.addEventListener('abort', () => {
          aborted.push(q);
          reject(signal.reason);
        });
      }),
  };
  /** Lets every waiting search answer, and waits for the runs to move on. */
  const release = async () => {
    for (const w of waiting.splice(0)) w.go();
    await tick();
  };
  return { source, calls, aborted, release, waiting };
}

const tick = () => new Promise(r => setTimeout(r, 20));
/** Waits for something a run does in the background (planning on a slow CI machine can take a while). */
async function until(check: () => boolean, ms = 10_000) {
  for (const end = Date.now() + ms; !check(); await tick()) if (Date.now() > end) throw new Error('timed out waiting');
}
let n = 0;

function manager(hosted: HostedRunOptions | null, sources: Source[], onSettings?: (s: SettingsStore) => void) {
  const d = mkdtempSync(join(dir, `m${n++}-`));
  const settings = new SettingsStore(d);
  settings.update({ sources: { fetch: sources.some(s => s.id === 'fetch'), mtgsingles: sources.some(s => s.id === 'mtgsingles'), 'mtgsingles-au': false } });
  onSettings?.(settings);
  return new RunManager(
    {
      catalogue: () => cat,
      sources,
      cache: new SearchCache(d),
      cardKingdom: { context: () => null, refresh: async () => {} } as unknown as CardKingdom,
      settings,
      directory: () => new StoreDirectory([]),
      solve: (p, k, o) => solveRung(p, k, o),
      parallel: 1,
      appVersion: 'test',
    },
    hosted,
  );
}

const events = (run: Run) => {
  const out: RunEvent[] = [];
  run.listen(e => out.push(e));
  return out;
};
const HOSTED: HostedRunOptions = { maxActive: 10, idleStopMs: 2 * 60 * 1000, idleDropMs: 30 * 60 * 1000 };
const choices = { included: {}, locks: {} };

describe('RunManager on the desktop', () => {
  it('cancels every run when a new search starts, whoever started it', async () => {
    const src = gatedSource('fetch');
    const runs = manager(null, [src.source]);
    const a = runs.start('1 Sol Ring', choices, 'browser-a');
    await tick();
    const b = runs.start('1 Counterspell', choices, 'browser-b');
    await tick();
    expect(runs.get(a.id)).toBeUndefined();
    expect(runs.get(b.id)).toBe(b);
    expect(src.aborted).toEqual(['Sol Ring']);
  });

  it('stops and drops a search the buyer cancels', async () => {
    const src = gatedSource('fetch');
    const runs = manager(null, [src.source]);
    const a = runs.start('1 Sol Ring', choices);
    await tick();
    expect(runs.cancel(a.id)).toBe(true);
    await tick();
    expect(runs.get(a.id)).toBeUndefined();
    expect(src.aborted).toEqual(['Sol Ring']);
    expect(runs.cancel(a.id)).toBe(false);
  });
});

describe('RunManager in hosted mode', () => {
  it('frees a cancelled search\'s slot for the next in the queue, and forgets it for a reload', async () => {
    const src = gatedSource('fetch');
    const runs = manager({ ...HOSTED, maxActive: 1 }, [src.source]);
    const a = runs.start('1 Sol Ring', choices, 'a');
    const b = runs.start('1 Counterspell', choices, 'b');
    const c = runs.start('1 Lava Axe', choices, 'c');
    await tick();
    runs.cancel(b.id);
    await tick();
    expect(runs.forBrowser('b')).toBeUndefined();
    expect(c.queuedAhead).toBe(1);
    runs.cancel(a.id);
    await until(() => src.calls.length === 2);
    expect(src.calls).toEqual(['Sol Ring', 'Lava Axe']);
    expect(src.aborted).toEqual(['Sol Ring']);
    expect(runs.forBrowser('a')).toBeUndefined();
  });

  it('runs different browsers side by side and replaces only the same browser\'s search', async () => {
    const src = gatedSource('fetch');
    const runs = manager(HOSTED, [src.source]);
    const a = runs.start('1 Sol Ring', choices, 'browser-a');
    const aEvents = events(a);
    const b = runs.start('1 Counterspell', choices, 'browser-b');
    await tick();
    expect(src.calls.sort()).toEqual(['Counterspell', 'Sol Ring']);
    const a2 = runs.start('1 Lava Axe', choices, 'browser-a');
    await tick();
    expect(aEvents.at(-1)).toEqual({ type: 'replaced' });
    expect(runs.get(a.id)).toBeUndefined();
    expect(runs.get(b.id)).toBe(b);
    expect(runs.get(a2.id)).toBe(a2);
    expect(src.aborted).toEqual(['Sol Ring']);
  });

  it('queues searches over the cap and starts them as slots free up', async () => {
    const src = gatedSource('fetch');
    const runs = manager({ ...HOSTED, maxActive: 1 }, [src.source]);
    const a = runs.start('1 Sol Ring', choices, 'a');
    const b = runs.start('1 Counterspell', choices, 'b');
    const c = runs.start('1 Lava Axe', choices, 'c');
    const bEvents = events(b);
    await tick();
    expect(src.calls).toEqual(['Sol Ring']);
    expect(b.queuedAhead).toBe(1);
    expect(c.queuedAhead).toBe(2);
    expect(events(a).some(e => e.type === 'queued')).toBe(false);
    await src.release();
    await until(() => src.calls.length === 2);
    expect(src.calls).toEqual(['Sol Ring', 'Counterspell']);
    expect(b.queuedAhead).toBeNull();
    expect(c.queuedAhead).toBe(1);
    expect(bEvents.some(e => e.type === 'progress')).toBe(true);
  });

  it('stops a search nobody is watching after 2 minutes, picks it up when the page comes back, and drops it after 30', async () => {
    const src = gatedSource('fetch');
    const runs = manager(HOSTED, [src.source]);
    const a = runs.start('1 Sol Ring', choices, 'a');
    const stop = a.listen(() => {});
    await tick();
    stop();
    const idleSince = a.idleSince!;
    runs.sweep(idleSince + 60_000);
    expect(src.aborted).toEqual([]);
    runs.sweep(idleSince + 2 * 60_000);
    await tick();
    expect(src.aborted).toEqual(['Sol Ring']);
    // The page comes back: the search starts again (the shared cache makes the repeat cheap).
    const out = events(a);
    await tick();
    expect(src.calls).toEqual(['Sol Ring', 'Sol Ring']);
    await src.release();
    await until(() => out.some(e => e.type === 'ladder'));
    // Nobody watches it again; after 30 minutes it is gone.
    const b = runs.start('1 Counterspell', choices, 'b');
    runs.sweep(Date.now() + 30 * 60_000);
    expect(runs.get(b.id)).toBeUndefined();
  });

  it('tells each search how many others share a Source, and roughly how long it has left', async () => {
    const src = gatedSource('fetch');
    const runs = manager(HOSTED, [src.source]);
    const a = runs.start('1 Sol Ring\n1 Counterspell\n1 Lava Axe', choices, 'a');
    await tick();
    expect(a.progress!.sources[0].sharedWith).toBeUndefined();
    const b = runs.start('1 Rhystic Study\n1 Command Tower', choices, 'b');
    await until(() => src.waiting.length === 2);
    await src.release();
    await until(() => a.progress!.sources[0].sharedWith !== undefined);
    const mine = a.progress!.sources[0];
    expect(mine).toMatchObject({ sharedWith: 1 });
    expect(mine.minutesLeft).toBeGreaterThanOrEqual(1);
    expect(b.progress!.sources[0]).toMatchObject({ sharedWith: 1 });
  });

  it('plans each search with its own friend\'s settings, and re-plans only that search when they change', async () => {
    const fetch = gatedSource('fetch');
    const mtg = gatedSource('mtgsingles');
    const runs = manager(HOSTED, [fetch.source, mtg.source], s => s.update({ sources: { fetch: true, mtgsingles: true, 'mtgsingles-au': false } }));
    // Card Kingdom off, so a late price refresh doesn't send an extra Plan.
    const both = friendSettings({ cardKingdom: { enabled: false } });
    const noMtg = friendSettings({ cardKingdom: { enabled: false }, sources: { mtgsingles: false } });
    const a = runs.start('1 Sol Ring', choices, 'a', both);
    const b = runs.start('1 Counterspell', choices, 'b', noMtg);
    await until(() => fetch.waiting.length === 2 && mtg.waiting.length === 1);
    expect(fetch.calls.sort()).toEqual(['Counterspell', 'Sol Ring']);
    expect(mtg.calls).toEqual(['Sol Ring']);
    expect(b.settings().sources.mtgsingles).toBe(false);
    // Server-only settings still come from settings.json.
    expect(b.settings().staples).toEqual(DEFAULT_SETTINGS.staples);
    await fetch.release();
    await mtg.release();
    await until(() => !!a.ladder?.final && !!b.ladder?.final);
    const aEvents = events(a);
    const bEvents = events(b);
    await b.replan(undefined, friendSettings({ ...noMtg, minCondition: 'NM' }));
    expect(b.settings().minCondition).toBe('NM');
    expect(a.settings().minCondition).toBe('LP');
    expect(bEvents.some(e => e.type === 'ladder')).toBe(true);
    expect(aEvents).toEqual([]);
  });

  it('applies a block seen by one search to every search at once', async () => {
    const src = gatedSource('fetch');
    const runs = manager(HOSTED, [src.source]);
    const a = runs.start('1 Sol Ring\n1 Lava Axe', choices, 'a');
    const b = runs.start('1 Counterspell\n1 Rhystic Study\n1 Command Tower', choices, 'b');
    await until(() => src.waiting.length === 2);
    // Fetch refuses A's request; B's is answered.
    const i = src.waiting.findIndex(w => w.q === 'Sol Ring');
    src.waiting.splice(i, 1)[0].fail(new SourceError('blocked', 'Refused (403)'));
    await src.release();
    await until(() => b.progress!.sources[0].status === 'blocked');
    expect(src.calls).not.toContain('Rhystic Study');
    expect(b.progress!.sources[0].status).toBe('blocked');
    expect(a.progress!.sources[0].status).toBe('blocked');
  });
});

