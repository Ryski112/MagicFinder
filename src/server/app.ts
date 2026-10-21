// HTTP API for the UI. Everything that talks to Sources, Archidekt or Scryfall happens here, not in the browser.
import { Hono } from 'hono';
import { stream, streamSSE } from 'hono/streaming';
import type { Catalogue } from '../catalogue/catalogue';
import { CardSearchIndex } from '../catalogue/cardSearch';
import type { CatalogueStore } from '../catalogue/updater';
import { resolveWantList } from '../core/wantList';
import type {
  ArchidektResponse, CardPrintingsResponse, CardSearchResponse, CartCheckEvent, ParseResponse, PlanChoices, PrintingsResponse, RunEvent, RunStateResponse, StartRunRequest, StatusResponse,
} from '../shared/api';
import type { SourceId } from '../core/types';
import { importArchidekt } from './archidekt';
import { checkShopifyCart } from './cart';
import { cardImage } from './planner';
import type { RunManager } from './runs';
import type { SearchCache } from './searchCache';
import { friendSettings, type Settings, type SettingsStore } from './settings';
import type { UpdateInfo } from './updates';

export interface AppDeps {
  catalogue: CatalogueStore;
  settings: SettingsStore;
  runs: RunManager;
  cache: SearchCache;
  version: string;
  /** A newer release to offer, if any. */
  update?: () => UpdateInfo | null;
  /** Hosted mode (MAGICFINDER_HOSTED). */
  hosted?: boolean;
}

export function createApp(d: AppDeps) {
  const app = new Hono();

  app.onError((err, c) => c.json({ error: err.message }, 500));

  app.get('/api/status', c =>
    c.json<StatusResponse>({
      app: 'MagicFinder',
      version: d.version,
      catalogue: { ready: d.catalogue.ready, progress: d.catalogue.progress, error: d.catalogue.error },
      update: d.update?.() ?? null,
      ...(d.hosted ? { hosted: true as const } : {}),
    }),
  );

  app.get('/api/stores', c => c.json<StoreChoice[]>((d.stores?.() ?? []).map(s => ({ id: s.id, name: s.name, city: s.location.city, country: s.country ?? 'NZ' }))));

  app.get('/api/settings', c => c.json<Settings>(d.settings.get()));

  // Hosted mode: the page sends the settings its browser keeps; the answer is them merged onto the server's own.
  app.post('/api/settings/friend', async c => {
    if (!d.hosted) return c.json({ error: 'Only in hosted mode' }, 404);
    const body = await c.req.json<unknown>().catch(() => ({}));
    return c.json<Settings>({ ...d.settings.get(), ...friendSettings(body) });
  });

  app.put('/api/settings', async c => {
    if (d.hosted) return c.json({ error: 'Your settings are kept in this browser.' }, 403);
    const patch = await c.req.json<Partial<Settings>>();
    const s = d.settings.update(patch);
    // The theme and the update notice don't change any Plan.
    if (Object.keys(patch).some(k => k !== 'theme' && k !== 'updateCheck')) d.runs.replanAll();
    return c.json<Settings>(s);
  });

  app.post('/api/sources/:id/try-again', c => {
    const id = c.req.param('id') as SourceId;
    const s = d.settings.get();
    if (!(id in s.sourceHealth)) return c.json({ error: 'Unknown Source' }, 404);
    d.settings.update({ sourceHealth: { ...s.sourceHealth, [id]: { ...s.sourceHealth[id], blockedAt: null } } });
    return c.json({ ok: true });
  });

  // Hosted mode: the cache is shared and at most an hour old, so friends can't clear it (the owner can, on the volume).
  app.post('/api/cache/clear', c => (d.hosted ? c.json({ error: 'Not available here' }, 403) : c.json({ cleared: d.cache.clear() })));

  app.post('/api/parse', async c => {
    if (!d.catalogue.ready) return c.json({ error: 'The card list is still downloading. Try again in a moment.' }, 503);
    const { text } = await c.req.json<{ text: string }>();
    const cat = d.catalogue.get();
    const r = resolveWantList(text ?? '', cat);
    return c.json<ParseResponse>({ lines: r.lines.map(l => ({ ...l, image: cardImage(cat, l.oracleId) })), unrecognised: r.unrecognised });
  });

  // The card searcher's index, built once per catalogue (a refreshed catalogue gets a fresh index).
  const searchIndexes = new WeakMap<Catalogue, CardSearchIndex>();
  const searchIndex = (cat: Catalogue) => {
    let index = searchIndexes.get(cat);
    if (!index) searchIndexes.set(cat, (index = new CardSearchIndex(cat.allNames())));
    return index;
  };

  app.get('/api/cards/search', c => {
    if (!d.catalogue.ready) return c.json({ error: 'The card list is still downloading. Try again in a moment.' }, 503);
    const cat = d.catalogue.get();
    const results = searchIndex(cat).search(c.req.query('q') ?? '').map(h => ({ ...h, image: cardImage(cat, h.oracleId) }));
    return c.json<CardSearchResponse>({ results });
  });

  app.get('/api/cards/:oracleId/printings', c => {
    if (!d.catalogue.ready) return c.json({ error: 'The card list is still downloading. Try again in a moment.' }, 503);
    const printings = d.catalogue.get().printingsOf(c.req.param('oracleId')).map(p => ({
      id: p.id, setCode: p.setCode.toUpperCase(), setName: p.setName, collectorNumber: p.collectorNumber, finishes: p.finishes,
      treatments: p.treatments, nonTournament: p.nonTournament, year: p.releasedAt.slice(0, 4), image: p.imageSmall, imageLarge: p.imageNormal,
    }));
    return c.json<CardPrintingsResponse>({ printings });
  });

  app.post('/api/archidekt', async c => {
    const { url } = await c.req.json<{ url: string }>();
    try {
      return c.json<ArchidektResponse>(await importArchidekt(url ?? ''));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  // Hosted mode drops runs nobody has looked at for 30 minutes; the desktop only ever replaces them.
  const gone = d.hosted ? 'This search expired — search again.' : null;

  app.post('/api/runs', async c => {
    if (!d.catalogue.ready) return c.json({ error: 'The card list is still downloading. Try again in a moment.' }, 503);
    const body = await c.req.json<StartRunRequest>();
    const run = d.runs.start(body.text ?? '', body.choices ?? { included: {}, locks: {} }, body.browserId, d.hosted ? friendSettings(body.settings) : undefined);
    return c.json({ runId: run.id });
  });

  // Hosted mode: lets a reloaded page find its browser's search, and tell a dropped run from a lost connection.
  app.get('/api/browsers/:id/run', c => {
    const run = d.hosted ? d.runs.forBrowser(c.req.param('id')) : undefined;
    if (!run) return c.json({ error: gone ?? 'Not found' }, 404);
    return c.json<RunStateResponse>({ runId: run.id, choices: run.choices });
  });

  app.get('/api/runs/:id', c => {
    const run = d.hosted ? d.runs.get(c.req.param('id')) : undefined;
    if (!run) return c.json({ error: gone ?? 'Not found' }, 404);
    return c.json<RunStateResponse>({ runId: run.id, choices: run.choices });
  });

  app.get('/api/runs/:id/events', c => {
    const run = d.runs.get(c.req.param('id'));
    if (!run) return c.json({ error: gone ?? 'That search has finished or been replaced. Search again.' }, 404);
    return streamSSE(c, async stream => {
      const queue: RunEvent[] = [];
      let wake: (() => void) | null = null;
      const listener = (e: RunEvent) => {
        queue.push(e);
        wake?.();
      };
      if (run.queuedAhead !== null) queue.push({ type: 'queued', ahead: run.queuedAhead });
      if (run.progress) queue.push({ type: 'progress', progress: run.progress });
      if (run.ladder) queue.push({ type: 'ladder', ladder: run.ladder });
      const stop = run.listen(listener);
      stream.onAbort(() => {
        stop();
        wake?.();
      });
      while (!stream.aborted) {
        while (queue.length) await stream.writeSSE({ data: JSON.stringify(queue.shift()) });
        await new Promise<void>(r => {
          wake = r;
          setTimeout(r, 15000);
        });
        wake = null;
        if (!queue.length && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '' });
      }
      stop();
    });
  });

  app.post('/api/runs/:id/plan', async c => {
    const run = d.runs.get(c.req.param('id'));
    if (!run) return c.json({ error: gone ?? 'Search again.' }, 404);
    const { choices, settings } = await c.req.json<{ choices?: PlanChoices; settings?: unknown }>();
    void run.replan(choices, d.hosted && settings ? friendSettings(settings) : undefined).catch(e => console.error(e));
    return c.json({ ok: true });
  });

  app.post('/api/runs/:id/try-longer', async c => {
    const run = d.runs.get(c.req.param('id'));
    if (!run) return c.json({ error: gone ?? 'Search again.' }, 404);
    const { k } = await c.req.json<{ k: number }>();
    void run.tryLonger(k).catch(e => console.error(e));
    return c.json({ ok: true });
  });

  app.get('/api/runs/:id/printings/:lineId', c => {
    const run = d.runs.get(c.req.param('id'));
    const lineId = c.req.param('lineId');
    const line = run?.want.lines.find(l => l.id === lineId);
    if (!run || !line) return c.json({ error: 'Not found' }, 404);
    return c.json<PrintingsResponse>({ lineId, name: line.name, hint: line.hint, options: run.printings(lineId) });
  });

  app.post('/api/runs/:id/cart', async c => {
    const run = d.runs.get(c.req.param('id'));
    const { storeId, k } = await c.req.json<{ storeId: string; k: number }>();
    const store = run?.ladder?.rungs.find(r => r.k === k)?.stores.find(s => s.id === storeId);
    if (!run) return c.json({ error: gone ?? 'That Plan has changed. Pick it again.' }, 404);
    if (!run.search || !store) return c.json({ error: 'That Plan has changed. Pick it again.' }, 404);
    const byId = new Map(run.search.listings.map(l => [l.id, l]));
    const items = store.items.flatMap(i => {
      const listing = byId.get(i.listingId);
      return listing ? [{ listing, qty: i.qty, name: i.name }] : [];
    });
    // Stream progress so the dialog can show which card is being checked (about one a second). The explicit type and
    // no-transform keep proxies such as Cloudflare from compressing (and so holding back) the lines.
    c.header('Content-Type', 'application/x-ndjson');
    c.header('Cache-Control', 'no-transform');
    return stream(c, async out => {
      const send = (e: CartCheckEvent) => out.write(JSON.stringify(e) + '\n');
      try {
        const result = await checkShopifyCart(store.id, store.name, items, undefined, undefined, (done, total, name) => {
          void send({ type: 'progress', done, total, name });
        });
        await send({ type: 'result', result });
      } catch (e) {
        await send({ type: 'error', message: (e as Error).message });
      }
    });
  });

  return app;
}
