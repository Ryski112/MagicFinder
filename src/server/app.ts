// HTTP API for the UI. Everything that talks to Sources, Archidekt or Scryfall happens here, not in the browser.
import { Hono } from 'hono';
import { stream, streamSSE } from 'hono/streaming';
import type { CatalogueStore } from '../catalogue/updater';
import { resolveWantList } from '../core/wantList';
import type { ArchidektResponse, CartCheckEvent, ParseResponse, PlanChoices, PrintingsResponse, RunEvent, StartRunRequest, StatusResponse } from '../shared/api';
import type { SourceId } from '../core/types';
import { importArchidekt } from './archidekt';
import { checkShopifyCart } from './cart';
import { cardImage } from './planner';
import { registerCardSearchPrototype } from './prototypeCardSearch';
import type { RunManager } from './runs';
import type { Settings, SettingsStore } from './settings';

export interface AppDeps {
  catalogue: CatalogueStore;
  settings: SettingsStore;
  runs: RunManager;
  version: string;
}

export function createApp(d: AppDeps) {
  const app = new Hono();

  app.onError((err, c) => c.json({ error: err.message }, 500));

  app.get('/api/status', c =>
    c.json<StatusResponse>({ version: d.version, catalogue: { ready: d.catalogue.ready, progress: d.catalogue.progress, error: d.catalogue.error } }),
  );

  app.get('/api/settings', c => c.json<Settings>(d.settings.get()));

  app.put('/api/settings', async c => {
    const patch = await c.req.json<Partial<Settings>>();
    const s = d.settings.update(patch);
    // The theme doesn't change any Plan.
    if (Object.keys(patch).some(k => k !== 'theme')) d.runs.replanAll();
    return c.json<Settings>(s);
  });

  app.post('/api/sources/:id/try-again', c => {
    const id = c.req.param('id') as SourceId;
    const s = d.settings.get();
    if (!(id in s.sourceHealth)) return c.json({ error: 'Unknown Source' }, 404);
    d.settings.update({ sourceHealth: { ...s.sourceHealth, [id]: { ...s.sourceHealth[id], blockedAt: null } } });
    return c.json({ ok: true });
  });

  registerCardSearchPrototype(app, d.catalogue);

  app.post('/api/parse', async c => {
    if (!d.catalogue.ready) return c.json({ error: 'The card list is still downloading. Try again in a moment.' }, 503);
    const { text } = await c.req.json<{ text: string }>();
    const cat = d.catalogue.get();
    const r = resolveWantList(text ?? '', cat);
    return c.json<ParseResponse>({ lines: r.lines.map(l => ({ ...l, image: cardImage(cat, l.oracleId) })), unrecognised: r.unrecognised });
  });

  app.post('/api/archidekt', async c => {
    const { url } = await c.req.json<{ url: string }>();
    try {
      return c.json<ArchidektResponse>(await importArchidekt(url ?? ''));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post('/api/runs', async c => {
    if (!d.catalogue.ready) return c.json({ error: 'The card list is still downloading. Try again in a moment.' }, 503);
    const body = await c.req.json<StartRunRequest>();
    const run = d.runs.start(body.text ?? '', body.choices ?? { included: {}, locks: {} });
    return c.json({ runId: run.id });
  });

  app.get('/api/runs/:id/events', c => {
    const run = d.runs.get(c.req.param('id'));
    if (!run) return c.json({ error: 'That search has finished or been replaced. Search again.' }, 404);
    return streamSSE(c, async stream => {
      const queue: RunEvent[] = [];
      let wake: (() => void) | null = null;
      const listener = (e: RunEvent) => {
        queue.push(e);
        wake?.();
      };
      if (run.progress) queue.push({ type: 'progress', progress: run.progress });
      if (run.ladder) queue.push({ type: 'ladder', ladder: run.ladder });
      run.listeners.add(listener);
      stream.onAbort(() => {
        run.listeners.delete(listener);
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
      run.listeners.delete(listener);
    });
  });

  app.post('/api/runs/:id/plan', async c => {
    const run = d.runs.get(c.req.param('id'));
    if (!run) return c.json({ error: 'Search again.' }, 404);
    const { choices } = await c.req.json<{ choices: PlanChoices }>();
    void run.replan(choices).catch(e => console.error(e));
    return c.json({ ok: true });
  });

  app.post('/api/runs/:id/try-longer', async c => {
    const run = d.runs.get(c.req.param('id'));
    if (!run) return c.json({ error: 'Search again.' }, 404);
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
    if (!run?.search || !store) return c.json({ error: 'That Plan has changed. Pick it again.' }, 404);
    const byId = new Map(run.search.listings.map(l => [l.id, l]));
    const items = store.items.flatMap(i => {
      const listing = byId.get(i.listingId);
      return listing ? [{ listing, qty: i.qty, name: i.name }] : [];
    });
    // Stream progress so the dialog can show which card is being checked (about one a second).
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
