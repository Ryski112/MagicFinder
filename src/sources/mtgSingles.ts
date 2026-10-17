// MtgSingles: an aggregator over ~40-50 NZ Stores. Its search API sits behind Cloudflare, which refuses requests
// without a mtgsingles.co.nz Referer; with one, plain HTTP works, one request every 1.5 seconds. There is no stealth
// and no challenge-solving: if a bot check appears, the Source is Blocked. See "How can MtgSingles listings be searched and read?".
import type { Condition } from '../core/types';
import { USER_AGENT } from '../server/paths';
import { classify, mapRows, Throttle, withRetries } from './policy';
import { SourceError, type Source, type SourceListing } from './types';
import type { HttpGet } from './fetchTcg';

const API = 'https://api.mtgsingles.co.nz/MtgSingle';
const PAGE_SIZE = 20;
const MAX_PAGES = 15;

export const httpGet: HttpGet = async (url, signal) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', Referer: 'https://www.mtgsingles.co.nz/' },
    signal,
  });
  return { status: res.status, body: await res.text(), retryAfter: res.headers.get('retry-after'), contentType: res.headers.get('content-type') };
};

// Combined grades count as their worse half; SP is treated as Lightly Played.
const CONDITIONS: Record<string, Condition | null> = {
  'NM': 'NM', 'NM / SP': 'LP', 'SP': 'LP', 'SP / LP': 'LP', 'LP': 'LP', 'MP': 'MP', 'HP': 'HP', 'D': 'DMG', 'N/A': null,
};

const FEATURE_TREATMENTS: Record<string, string> = {
  Showcase: 'Showcase', Borderless: 'Borderless', Retro: 'Retro frame', 'Extended Art': 'Extended art', 'Full Art': 'Full art',
};

const NON_ENGLISH_TITLE = /\b(japanese|jp|chinese|korean|german|french|italian|spanish|portuguese|russian|phyrexian)\b/i;
const SCRYFALL_IMAGE = /cards\.scryfall\.io\/[^/]+\/[^/]+\/[0-9a-f]\/[0-9a-f]\/([0-9a-f-]{36})\./;

export function parsePrice(p: unknown): number | null {
  if (typeof p === 'number') return p;
  if (typeof p !== 'string') return null;
  const n = Number(p.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && /\d/.test(p) ? n : null;
}

/** "NZ/CardMerchantHamilton" -> "Card Merchant Hamilton", for Stores missing from the Store table. */
export function storeNameFromKey(key: string): string {
  return key.replace(/^[A-Z]{2}\//, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/** Maps one MtgSingles Listing. Throws SourceError('changed') when fields we rely on are missing. */
export function mapMtgSinglesListing(l: any, storeName?: (key: string) => string | undefined): SourceListing | null {
  if (l == null || typeof l !== 'object' || typeof l.store !== 'string' || typeof l.title !== 'string' || typeof l.url !== 'string') {
    throw new SourceError('changed', 'MtgSingles Listing is missing store, title or url');
  }
  const price = parsePrice(l.price);
  if (price === null || typeof l.condition !== 'string') throw new SourceError('changed', 'MtgSingles Listing is missing price or condition');
  if (!l.store.startsWith('NZ/') || l.availableQty === 0) return null;

  const features: string[] = Array.isArray(l.features) ? l.features : [];
  const title: string = l.title;
  const foilish = features.includes('Foil') || /\bfoil\b/i.test(title);
  const etched = features.includes('Foil-Etched') || /etched/i.test(title);
  const url = l.url.replace(/[?&]utm_[^&]*/g, '').replace(/\?&/, '?').replace(/[?&]$/, '');
  const collector = title.match(/\((?:[A-Z0-9]{2,5}-)?(\d{1,4}[a-z★]?)\)/)?.[1];
  const scryfallId = typeof l.imageUrl === 'string' ? l.imageUrl.match(SCRYFALL_IMAGE)?.[1] : undefined;
  const condition = l.condition in CONDITIONS ? CONDITIONS[l.condition] : null;
  return {
    id: `mtgsingles:${l.store}:${url}:${l.condition}:${foilish ? 'f' : 'n'}`,
    source: 'mtgsingles',
    storeKey: `mtgsingles:${l.store}`,
    storeName: storeName?.(l.store) ?? storeNameFromKey(l.store),
    title,
    scryfallId,
    setName: l.setName || undefined,
    collectorNumber: collector,
    finish: etched ? 'etched' : foilish ? 'foil' : 'nonfoil',
    treatments: features.map(f => FEATURE_TREATMENTS[f]).filter(Boolean),
    condition,
    english: !features.includes('Non-English') && !NON_ENGLISH_TITLE.test(title),
    price,
    quantity: typeof l.availableQty === 'number' ? l.availableQty : 1,
    url,
    buyable: true,
    extra: { features: features.join(','), rawCondition: l.condition },
  };
}

export interface MtgSinglesOptions {
  storeName?: (key: string) => string | undefined;
  /** Injectable for tests. */
  get?: HttpGet;
}

export class MtgSinglesSource implements Source {
  readonly id = 'mtgsingles' as const;
  readonly name = 'MtgSingles';
  private throttle = new Throttle(1500); // At 1/s Cloudflare answers 429 (Retry-After 10) every ~20s; 1.5s stays under its limit.

  constructor(private readonly opts: MtgSinglesOptions = {}) {}

  async search(cardName: string, signal?: AbortSignal): Promise<SourceListing[]> {
    const out: SourceListing[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${API}?query=${encodeURIComponent(cardName)}&tcgType=1&includeMarketplaces=false&sortOrder=2&page=${page}&pageSize=${PAGE_SIZE}&Country=1`;
      let rows: unknown[];
      try {
        rows = await this.fetchPage(url, signal);
      } catch (e) {
        // Results come cheapest first, so earlier pages are still worth keeping if a later one fails.
        if (page > 1 && e instanceof SourceError && e.status === 'down') {
          console.warn(`MtgSingles: page ${page} of "${cardName}" failed (${e.message}); keeping the ${out.length} cheapest Listings`);
          break;
        }
        throw e;
      }
      for (const m of mapRows(rows, r => mapMtgSinglesListing(r, this.opts.storeName))) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          out.push(m);
        }
      }
      if (rows.length < PAGE_SIZE) break;
    }
    return out;
  }

  private fetchPage(url: string, signal?: AbortSignal): Promise<unknown[]> {
    return withRetries(async () => {
      await this.throttle.wait();
      const a = await (this.opts.get ?? httpGet)(url, signal);
      classify(a);
      // No Listings at all comes back as "204 No Content" with an empty body, not as an empty list.
      if (a.status === 204 || !a.body.trim()) return [];
      let body: unknown;
      try {
        body = JSON.parse(a.body);
      } catch {
        throw new SourceError('changed', 'MtgSingles answered with something that is not JSON');
      }
      if (!Array.isArray(body)) throw new SourceError('changed', 'MtgSingles answer is not a list of Listings');
      return body;
    }, { signal });
  }
}
