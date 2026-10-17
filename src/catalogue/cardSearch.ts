// Card name autocomplete for the Want List's card searcher, over every name alias in the catalogue, in memory.
// Ranking, decided in "How should the Want List card searcher look and behave?": exact, starts with, every typed
// word starts a word of the name (any order), contains, then typos (1 edit; 2 for words of 7+ letters; a half-typed
// last word counts as a prefix). No popularity data, so ties go to the shorter name.
import { nameKey } from './names';

export interface CardName {
  alias: string;
  /** 'full' card name, a double-faced card's front 'face', or a 'flavor' name. */
  kind: 'full' | 'face' | 'flavor';
  oracleId: string;
  cardName: string;
}

export type MatchHow = 'exact' | 'starts with' | 'word starts' | 'contains' | 'typo';

export interface CardSearchHit {
  oracleId: string;
  name: string;
  /** The alias that matched when it isn't the card's own name (e.g. a flavour name). */
  matchedAlias: string | null;
  how: MatchHow;
}

interface Entry extends CardName {
  key: string;
  words: string[];
}

const HOW: MatchHow[] = ['exact', 'starts with', 'word starts', 'contains', 'typo'];

/** Edit distance between a and b, or null once it is certain to exceed `max`. */
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

/** Lower is better: 0-3 are the exact-to-contains ranks, 4+ is a typo match (4 + number of edits); null is no match. */
function score(e: Entry, q: string, qWords: string[]): number | null {
  if (e.key === q) return 0;
  if (e.key.startsWith(q)) return 1;
  if (qWords.every(w => e.words.some(n => n.startsWith(w)))) return 2;
  if (e.key.includes(q)) return 3;
  let typos = 0;
  for (const w of qWords) {
    if (e.words.some(n => n.startsWith(w))) continue;
    if (w.length < 3) return null;
    const max = w.length >= 7 ? 2 : 1;
    let best: number | null = null;
    for (const n of e.words) {
      // Compare with the start of the word too, so a half-typed word with a typo still matches.
      const d = within(w, n.slice(0, w.length), max) ?? within(w, n, max);
      if (d !== null && (best === null || d < best)) best = d;
    }
    if (best === null) return null;
    typos += best;
  }
  return 4 + typos;
}

export class CardSearchIndex {
  private entries: Entry[];

  constructor(names: CardName[]) {
    this.entries = names.map(n => {
      const key = nameKey(n.alias);
      return { ...n, key, words: key.split(' ') };
    });
  }

  search(query: string, limit = 8): CardSearchHit[] {
    const q = nameKey(query);
    if (q.length < 2) return [];
    const qWords = q.split(' ');
    // Best-scoring alias per card; on a tie the card's full name wins over a face or flavour alias.
    const best = new Map<string, { s: number; e: Entry }>();
    for (const e of this.entries) {
      const s = score(e, q, qWords);
      if (s === null) continue;
      const prior = best.get(e.oracleId);
      if (!prior || s < prior.s || (s === prior.s && e.kind === 'full' && prior.e.kind !== 'full')) best.set(e.oracleId, { s, e });
    }
    return [...best.values()]
      .sort((a, b) => a.s - b.s || a.e.cardName.length - b.e.cardName.length || a.e.cardName.localeCompare(b.e.cardName))
      .slice(0, limit)
      .map(({ s, e }) => ({
        oracleId: e.oracleId,
        name: e.cardName,
        matchedAlias: e.kind === 'flavor' ? e.alias : null,
        how: HOW[Math.min(s, 4)],
      }));
  }
}
