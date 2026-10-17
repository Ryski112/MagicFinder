// PROTOTYPE (card searcher, issue #18): throwaway autocomplete over the local catalogue. Not production code.
// GET /api/prototype/card-search?q=bolt&match=prefix|words|fuzzy&limit=8
import type { Hono } from 'hono';
import type { CatalogueStore } from '../catalogue/updater';
import { nameKey } from '../catalogue/names';
import { cardImage } from './planner';

interface Entry { alias: string; key: string; words: string[]; kind: string; oracleId: string; cardName: string }
let index: { built: object; entries: Entry[] } | null = null;

function entries(store: CatalogueStore): Entry[] {
  const cat = store.get();
  if (index?.built !== cat) {
    index = { built: cat, entries: cat.prototypeAllNames().map(n => ({ ...n, key: nameKey(n.alias), words: nameKey(n.alias).split(' ') })) };
  }
  return index.entries;
}

/** Edit distance with an early exit once it passes `max`. */
function within(a: string, b: string, max: number): number | null {
  if (Math.abs(a.length - b.length) > max) return null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return null;
    prev = cur;
  }
  return prev[b.length] <= max ? prev[b.length] : null;
}

function score(e: Entry, q: string, qWords: string[], match: string): number | null {
  if (e.key === q) return 0;
  if (e.key.startsWith(q)) return 1;
  if (match === 'prefix') return null;
  // Every typed word starts some word of the name, in any order ("bolt light", "jace mind").
  if (qWords.every(w => e.words.some(n => n.startsWith(w)))) return 2;
  if (e.key.includes(q)) return 3;
  if (match === 'words') return null;
  // Typo-tolerant: each typed word is near some word of the name (or a prefix of it).
  let typos = 0;
  for (const w of qWords) {
    if (w.length < 3) return null;
    const max = w.length >= 7 ? 2 : 1;
    let best: number | null = null;
    for (const n of e.words) {
      const d = within(w, n.slice(0, w.length), max) ?? within(w, n, max);
      if (d !== null && (best === null || d < best)) best = d;
    }
    if (best === null) return null;
    typos += best;
  }
  return 4 + typos;
}

export function registerCardSearchPrototype(app: Hono, store: CatalogueStore) {
  app.get('/api/prototype/card-search', c => {
    if (!store.ready) return c.json({ ready: false, progress: store.progress, results: [] });
    const q = nameKey(c.req.query('q') ?? '');
    const match = c.req.query('match') ?? 'words';
    const limit = Number(c.req.query('limit') ?? 8);
    if (q.length < 2) return c.json({ ready: true, results: [] });
    const t0 = performance.now();
    const qWords = q.split(' ').filter(Boolean);
    const best = new Map<string, { s: number; e: Entry }>();
    for (const e of entries(store)) {
      const s = score(e, q, qWords, match);
      if (s === null) continue;
      const prior = best.get(e.oracleId);
      if (!prior || s < prior.s || (s === prior.s && e.kind === 'full' && prior.e.kind !== 'full')) best.set(e.oracleId, { s, e });
    }
    const cat = store.get();
    const results = [...best.values()]
      .sort((a, b) => a.s - b.s || a.e.cardName.length - b.e.cardName.length || a.e.cardName.localeCompare(b.e.cardName))
      .slice(0, limit)
      .map(({ s, e }) => ({
        oracleId: e.oracleId, name: e.cardName, matchedAlias: e.alias !== e.cardName ? e.alias : null, kind: e.kind,
        how: ['exact', 'starts with', 'word starts', 'contains', 'typo'][Math.min(s, 4)], image: cardImage(cat, e.oracleId),
      }));
    return c.json({ ready: true, results, total: best.size, ms: Math.round(performance.now() - t0) });
  });
}
