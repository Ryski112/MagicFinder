// Searches every enabled Source for every card on the Want List, applying the agreed rules for Sources that
// block, slow down, go down or change. See "What happens when a Source blocks MagicFinder?".
import type { Catalogue } from '../catalogue/catalogue';
import { matchByImage, matchListing, NOT_A_CARD } from '../core/matchListing';
import type { Listing, SourceId } from '../core/types';
import { SourceError, type Source, type SourceListing, type SourceStatus } from '../sources/types';
import { FRESH_MS, STALE_MS, type SearchCache } from './searchCache';
import type { Settings } from './settings';

export const COOLDOWN_MS = 30 * 60 * 1000;
/** Server errors on this many cards in a row mean the Source itself is down for this run. */
export const MAX_DOWN_IN_A_ROW = 3;
/** Pause before retrying cards that hit a server error. */
export const RETRY_PAUSE_MS = 10_000;

export interface SearchCard {
  oracleId: string;
  name: string;
}

export interface SourceRunStatus {
  source: SourceId;
  name: string;
  status: SourceStatus | 'off' | 'cooling-down';
  /** Plain-language explanation for the buyer. */
  message?: string;
  /** Cards this Source has answered for (live or from cache). */
  searched: number;
  /** Cards this Source couldn't be asked about. */
  notSearched: string[];
  /** Oldest stand-in cache entry used for this Source while Blocked or Down (epoch ms). */
  staleSince?: number;
  /** When an automatic retry is allowed again (epoch ms). */
  cooldownUntil?: number;
  /** Technical summary to paste into a bug report when the Source has Changed. */
  details?: string;
  /** Cards skipped because the Source had a server error on that one search. */
  failedCards?: number;
  /** Hosted mode: other searches using this Source right now, and roughly how long this one has left on it. */
  sharedWith?: number;
  minutesLeft?: number;
}

export interface SearchProgress {
  done: number;
  total: number;
  current: string | null;
  sources: SourceRunStatus[];
}

/** A Listing found while searching that couldn't be matched to any card, so no Plan uses it. */
export interface UnidentifiedListing {
  title: string;
  source: SourceId;
  storeName: string;
  price: number;
  url: string;
  /** The Want List card being searched for when it turned up. */
  searchedFor: string;
}

export interface SearchResult {
  listings: Listing[];
  /** Listings no card could be identified for (tokens, art cards and the like aren't counted). */
  unidentified: UnidentifiedListing[];
  sources: SourceRunStatus[];
}

export interface SearchDeps {
  catalogue: Catalogue;
  sources: Source[];
  cache: SearchCache;
  settings: Settings;
  appVersion: string;
  /** Called when the run learns something about a Source's health (blocked or answered normally). */
  onHealth?: (source: SourceId, blocked: boolean) => void;
  /**
   * Hosted mode: when another run saw this Source block MagicFinder after this search began (epoch ms), else null.
   * This run then treats the Source as Blocked straight away and uses stale results, as a new run would.
   */
  blockedElsewhere?: (source: SourceId) => number | null;
  now?: () => number;
  /** Injectable for tests: the pause before retrying failed cards. */
  retryPause?: () => Promise<void>;
}

const MESSAGES: Record<Exclude<SourceStatus, 'ok'>, (name: string) => string> = {
  blocked: n => `${n} stopped answering (it showed a "checking your browser" page or refused the request).`,
  slowed: n => `${n} asked MagicFinder to slow down.`,
  down: n => `${n} isn't working right now (server error or no connection).`,
  changed: n => `${n} answered in a way MagicFinder doesn't understand. MagicFinder may need an update.`,
};

export async function searchAll(cards: SearchCard[], deps: SearchDeps, onProgress: (p: SearchProgress) => void, signal?: AbortSignal): Promise<SearchResult> {
  const now = deps.now ?? Date.now;
  const statuses = new Map<SourceId, SourceRunStatus>();
  const raw = new Map<SourceId, Map<string, SourceListing[]>>();
  const position = new Map<SourceId, number>();

  for (const src of deps.sources) {
    const health = deps.settings.sourceHealth[src.id];
    const enabled = deps.settings.sources[src.id];
    const blockedAt = health?.blockedAt ? Date.parse(health.blockedAt) : 0;
    const cooling = enabled && blockedAt && now() - blockedAt < COOLDOWN_MS;
    statuses.set(src.id, {
      source: src.id,
      name: src.name,
      status: !enabled ? 'off' : cooling ? 'cooling-down' : 'ok',
      message: cooling ? `${src.name} blocked MagicFinder recently, so it isn't being asked again until ${new Date(blockedAt + COOLDOWN_MS).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })}.` : undefined,
      cooldownUntil: cooling ? blockedAt + COOLDOWN_MS : undefined,
      searched: 0,
      notSearched: [],
    });
    raw.set(src.id, new Map());
    position.set(src.id, enabled ? 0 : cards.length);
  }
  const active = deps.sources.filter(s => deps.settings.sources[s.id]);

  const report = () => {
    const done = active.length ? Math.min(...active.map(s => position.get(s.id)!)) : cards.length;
    onProgress({ done, total: cards.length, current: cards[done]?.name ?? null, sources: [...statuses.values()].map(s => ({ ...s })) });
  };
  report();

  const useStale = (src: Source, card: SearchCard, st: SourceRunStatus) => {
    const c = deps.cache.get(src.id, card.name, STALE_MS);
    if (c) {
      raw.get(src.id)!.set(card.oracleId, c.listings);
      st.searched++;
      if (c.fetchedAt < now() - FRESH_MS) st.staleSince = Math.min(st.staleSince ?? Infinity, c.fetchedAt);
    } else st.notSearched.push(card.oracleId);
  };

  await Promise.all(
    active.map(async src => {
      const st = statuses.get(src.id)!;
      let downInARow = 0;
      for (let i = 0; i < cards.length; i++) {
        signal?.throwIfAborted();
        const card = cards[i];
        const q = card.name;
        const elsewhere = st.status === 'ok' ? deps.blockedElsewhere?.(src.id) : null;
        if (elsewhere) {
          st.status = 'blocked';
          st.message = MESSAGES.blocked(src.name);
          st.cooldownUntil = elsewhere + COOLDOWN_MS;
        }
        if (st.status !== 'ok') useStale(src, card, st);
        else {
          const fresh = deps.cache.get(src.id, q, FRESH_MS);
          if (fresh) {
            raw.get(src.id)!.set(card.oracleId, fresh.listings);
            st.searched++;
          } else {
            try {
              const listings = await src.search(q, signal);
              deps.cache.put(src.id, q, listings);
              raw.get(src.id)!.set(card.oracleId, listings);
              st.searched++;
              downInARow = 0;
            } catch (e) {
              if (signal?.aborted) throw e;
              const err = e instanceof SourceError ? e : new SourceError('down', (e as Error).message);
              console.warn(`${src.name}: ${err.status} while searching "${card.name}": ${err.message}`);
              // A server error on one card is usually that search, not the whole Source: skip the card and carry on.
              if (err.status === 'down' && ++downInARow < MAX_DOWN_IN_A_ROW) {
                useStale(src, card, st);
                st.failedCards = (st.failedCards ?? 0) + 1;
                position.set(src.id, i + 1);
                report();
                continue;
              }
              st.status = err.status === 'slowed' ? 'blocked' : err.status;
              st.message = MESSAGES[err.status](src.name);
              if (st.status === 'blocked') {
                st.cooldownUntil = now() + COOLDOWN_MS;
                deps.onHealth?.(src.id, true);
              }
              if (st.status === 'changed') {
                st.details = [`MagicFinder ${deps.appVersion}`, `Source: ${src.name}`, 'Source Status: Changed', `What was wrong: ${err.message}`, `Card being searched: ${card.name}`, `Time: ${new Date(now()).toISOString()}`].join('\n');
              }
              useStale(src, card, st);
            }
          }
        }
        position.set(src.id, i + 1);
        report();
      }
    }),
  );

  // Server errors are usually brief: after a short pause, give each skipped card one more try.
  for (const src of active) {
    const st = statuses.get(src.id)!;
    const failed = cards.filter(c => st.notSearched.includes(c.oracleId) && !raw.get(src.id)!.has(c.oracleId));
    if (st.status !== 'ok' || !failed.length) continue;
    await (deps.retryPause ?? (() => new Promise(r => setTimeout(r, RETRY_PAUSE_MS))))();
    for (const card of failed) {
      signal?.throwIfAborted();
      const q = card.name;
      try {
        const listings = await src.search(q, signal);
        deps.cache.put(src.id, q, listings);
        raw.get(src.id)!.set(card.oracleId, listings);
        st.notSearched = st.notSearched.filter(id => id !== card.oracleId);
        st.searched++;
        st.failedCards = Math.max(0, (st.failedCards ?? 1) - 1);
        console.warn(`${src.name}: "${card.name}" worked on the second try`);
      } catch (e) {
        if (signal?.aborted) throw e;
        console.warn(`${src.name}: "${card.name}" failed again: ${(e as Error).message}`);
      }
    }
    report();
  }

  // Match everything to the catalogue, once per Listing.
  const seen = new Set<string>();
  const listings: Listing[] = [];
  const unidentified: UnidentifiedListing[] = [];
  const nameOf = new Map(cards.map(c => [c.oracleId, c.name]));
  const matched: { source: SourceListing; listing: Listing }[] = [];
  const foundBy = new Map<SourceId, Set<string>>();
  for (const [source, byCard] of raw) {
    const found = new Set<string>();
    foundBy.set(source, found);
    for (const [oracleId, list] of byCard) {
      for (const s of list) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        const m = matchListing(deps.catalogue, s);
        matched.push({ source: s, listing: m });
        if (m.confidence === 'unmatched') {
          if (!NOT_A_CARD.test(s.title)) {
            unidentified.push({ title: s.title, source: s.source, storeName: s.storeName, price: s.price, url: s.url, searchedFor: nameOf.get(oracleId) ?? '' });
          }
        }
        else listings.push(m);
        if (m.oracleId === oracleId) found.add(oracleId);
      }
    }
  }

  matchByImage(deps.catalogue, matched);

  // A Source that answers but finds nothing for most of the list, while the other Source finds those cards, may be
  // blocking silently. Only then, ask it for a basket of everyday cards.
  for (const src of active) {
    const st = statuses.get(src.id)!;
    if (st.status !== 'ok' || cards.length < 10) continue;
    const empty = cards.filter(c => !foundBy.get(src.id)!.has(c.oracleId));
    if (empty.length / cards.length < 0.8) continue;
    const others = active.filter(o => o.id !== src.id && statuses.get(o.id)!.status === 'ok');
    const foundElsewhere = empty.filter(c => others.some(o => foundBy.get(o.id)!.has(c.oracleId)));
    if (foundElsewhere.length < empty.length / 2) continue;
    let anyStaple = false;
    for (const staple of deps.settings.staples) {
      try {
        if ((await src.search(staple, signal)).length) {
          anyStaple = true;
          break;
        }
      } catch {
        // An error here is itself a sign of trouble; keep checking the other staples.
      }
    }
    if (!anyStaple) {
      st.status = 'blocked';
      st.message = `${src.name} answered with nothing, even for everyday cards like ${deps.settings.staples[0]}, so it is probably blocking MagicFinder quietly.`;
      st.cooldownUntil = now() + COOLDOWN_MS;
      st.notSearched.push(...empty.map(c => c.oracleId));
      st.searched -= empty.length;
      deps.onHealth?.(src.id, true);
    }
  }
  for (const src of active) if (statuses.get(src.id)!.status === 'ok') deps.onHealth?.(src.id, false);

  report();
  return { listings, unidentified, sources: [...statuses.values()] };
}
