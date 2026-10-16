// MtgSingles: an aggregator over ~40-50 NZ Stores. Its search API only answers real browsers, so it is read
// from inside a headless Chrome page, about one request a second. There is no stealth and no challenge-solving:
// if a bot check appears, the Source is Blocked. See "How can MtgSingles listings be searched and read?".
import type { Condition } from '../core/types';
import { classify, Throttle, withRetries, type HttpAnswer } from './policy';
import { SourceError, type Source, type SourceListing } from './types';
import { openBrowserPage, type BrowserPage } from './browser';

const API = 'https://api.mtgsingles.co.nz/MtgSingle';
const PAGE_SIZE = 20;
const MAX_PAGES = 15;

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
  /** Injectable for tests: performs a GET from inside the MtgSingles page. */
  pageGet?: (url: string) => Promise<HttpAnswer>;
}

export class MtgSinglesSource implements Source {
  readonly id = 'mtgsingles' as const;
  readonly name = 'MtgSingles';
  private throttle = new Throttle(1000);
  private page: Promise<BrowserPage> | null = null;

  constructor(private readonly opts: MtgSinglesOptions = {}) {}

  private async get(url: string): Promise<HttpAnswer> {
    if (this.opts.pageGet) return this.opts.pageGet(url);
    this.page ??= openBrowserPage('https://mtgsingles.co.nz/').catch(e => {
      this.page = null;
      throw e;
    });
    const page = await this.page;
    return page.fetchFromPage(url);
  }

  async search(cardName: string, signal?: AbortSignal): Promise<SourceListing[]> {
    const out: SourceListing[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${API}?query=${encodeURIComponent(cardName)}&tcgType=1&includeMarketplaces=false&sortOrder=2&page=${page}&pageSize=${PAGE_SIZE}&Country=1`;
      const rows = await withRetries(async () => {
        await this.throttle.wait();
        const a = await this.get(url);
        classify(a);
        let body: unknown;
        try {
          body = JSON.parse(a.body);
        } catch {
          throw new SourceError('changed', 'MtgSingles answered with something that is not JSON');
        }
        if (!Array.isArray(body)) throw new SourceError('changed', 'MtgSingles answer is not a list of Listings');
        return body;
      }, { signal });
      for (const r of rows) {
        const m = mapMtgSinglesListing(r, this.opts.storeName);
        if (m && !seen.has(m.id)) {
          seen.add(m.id);
          out.push(m);
        }
      }
      if (rows.length < PAGE_SIZE) break;
    }
    return out;
  }

  async close() {
    const p = this.page;
    this.page = null;
    if (p) await (await p.catch(() => null))?.close();
  }
}
