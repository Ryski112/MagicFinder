// Fetch TCG: an unauthenticated JSON API returns every NZ Listing for a card name in one call.
// Each seller is its own Store. See "How can Fetch TCG listings be searched and read?".
import type { Condition } from '../core/types';
import { USER_AGENT } from '../server/paths';
import { classify, Throttle, withRetries, type HttpAnswer } from './policy';
import { SourceError, type Source, type SourceListing } from './types';

const API = 'https://api.fetchtcg.com/v1/market/listings';

const CONDITIONS: Record<string, Condition> = {
  'raw-m': 'NM', 'raw-nm': 'NM', 'raw-lp': 'LP', 'raw-mp': 'MP', 'raw-hp': 'HP', 'raw-d': 'DMG',
};

const NON_ENGLISH = /\((?:[^)]*\b(?:japanese|jp|chinese|korean|german|french|italian|spanish|portuguese|russian|phyrexian)\b[^)]*)\)/i;

const TREATMENTS: [RegExp, string][] = [
  [/showcase/i, 'Showcase'],
  [/borderless/i, 'Borderless'],
  [/extended/i, 'Extended art'],
  [/retro/i, 'Retro frame'],
  [/full art/i, 'Full art'],
];

export type HttpGet = (url: string, signal?: AbortSignal) => Promise<HttpAnswer>;

export const httpGet: HttpGet = async (url, signal) => {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal });
  return { status: res.status, body: await res.text(), retryAfter: res.headers.get('retry-after'), contentType: res.headers.get('content-type') };
};

/** Maps one Fetch Listing object. Throws SourceError('changed') when fields we rely on are missing. */
export function mapFetchListing(l: any): SourceListing | null {
  if (l == null || typeof l !== 'object' || l.id == null || !l.card || typeof l.listedByUserId !== 'string') {
    throw new SourceError('changed', 'Fetch TCG Listing is missing id, card or seller');
  }
  const price = l.listedPriceInRequestedCurrency ?? l.listedPrice;
  if (typeof price !== 'number' || typeof l.condition !== 'string') throw new SourceError('changed', 'Fetch TCG Listing is missing price or condition');
  if (l.listedCountry !== 'NZ' || (l.productType && l.productType !== 'SINGLE') || (l.status && l.status !== 'ACTIVE')) return null;

  const name: string = l.card.name ?? '';
  const foil = l.card.printFinish?.name === 'foil';
  return {
    id: `fetch:${l.id}`,
    source: 'fetch',
    storeKey: `fetch:${l.listedByUserId}`,
    storeName: l.sellerBusinessName || l.sellerProfileName || 'Fetch seller',
    city: l.regionAddress?.city ?? undefined,
    pickupOffered: l.regionAddress?.allowPickups ?? undefined,
    title: name,
    scryfallId: l.card.externalReferences?.scryfallId ?? undefined,
    setCode: l.card.printVersion?.code ?? undefined,
    setName: l.card.set?.displayName ?? undefined,
    collectorNumber: l.card.cardCode ?? undefined,
    finish: foil ? (/etched/i.test(name) ? 'etched' : 'foil') : 'nonfoil',
    treatments: TREATMENTS.filter(([re]) => re.test(name)).map(([, t]) => t),
    condition: CONDITIONS[l.condition] ?? null,
    english: !NON_ENGLISH.test(name),
    price,
    quantity: typeof l.remainingQuantity === 'number' ? l.remainingQuantity : 1,
    url: `https://www.fetchtcg.com/marketplace/listings/${l.id}`,
    buyable: l.buyNowEnabled !== false && !l.sellerOnHoliday,
    extra: l.sellerProfileName ? { profile: l.sellerProfileName } : undefined,
  };
}

export class FetchTcgSource implements Source {
  readonly id = 'fetch' as const;
  readonly name = 'Fetch TCG';
  private throttle = new Throttle(1000);

  constructor(private readonly get: HttpGet = httpGet) {}

  async search(cardName: string, signal?: AbortSignal): Promise<SourceListing[]> {
    const out: SourceListing[] = [];
    for (let page = 0; page < 10; page++) {
      const url = `${API}?cardName=${encodeURIComponent(cardName)}&gameIds=mtg&countryCode=NZ&currencyCode=NZD&size=200&page=${page}`;
      const body = await withRetries(async () => {
        await this.throttle.wait();
        const a = await this.get(url, signal);
        classify(a);
        try {
          return JSON.parse(a.body);
        } catch {
          throw new SourceError('changed', 'Fetch TCG answered with something that is not JSON');
        }
      }, { signal });
      const results = body?.searchResults;
      if (!results || !Array.isArray(results.content)) throw new SourceError('changed', 'Fetch TCG answer has no searchResults.content');
      for (const l of results.content) {
        const m = mapFetchListing(l);
        if (m) out.push(m);
      }
      if (results.last !== false) break;
    }
    return out;
  }
}
