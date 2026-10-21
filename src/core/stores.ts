// Stores and how much each one costs to buy from: postage, free-postage thresholds and pickup.
import type { Listing } from './types';

export type Region = 'auckland' | 'north_island' | 'south_island';
export type RegionValue = number | Partial<Record<Region, number>>;
export type CartKind = 'shopify' | 'fetch' | 'open-listings' | 'hobbymaster-deckbuilder';

export interface PostageOption {
  name: string;
  tracked: boolean | null;
  price: RegionValue;
  rural_surcharge?: RegionValue;
}

export interface StoreRecord {
  id: string;
  name: string;
  source_keys: { mtgsingles?: string; fetch?: string };
  site?: string | null;
  location: { city: string | null; region: Region | null };
  pickup: { available: boolean | null; fee: number };
  postage?: PostageOption[];
  free_postage?: { threshold: RegionValue; applies_to: 'all' | 'singles_only' };
  cart: CartKind;
  /** Where the Store is; Australian Stores ship internationally, so their postage is a guess unless the buyer sets it. */
  country?: 'NZ' | 'AU';
  provenance?: { url: string | null; checked_on: string; confidence: 'checkout' | 'published' | 'inferred' | 'default' };
}

/** Everything about the buyer that changes what a Store costs. */
export interface BuyerContext {
  postageType: 'tracked' | 'standard';
  pickupCity: string;
  ruralAddress: boolean;
  /** Store ids the buyer has chosen to pick up from. */
  pickupStores: ReadonlySet<string>;
  /** Store ids the buyer can collect from for free: they cost no postage and don't count toward a Plan's Store limit. */
  preferredStores: ReadonlySet<string>;
  /** Per-Store postage overrides (NZD), keyed by Store id. */
  postageOverrides: Readonly<Record<string, number>>;
  defaultPostage: { tracked: number; rural: number };
  /** What an Australian Store is assumed to charge to post to NZ (NZD). */
  australiaPostage: number;
}

/** What a Store costs on top of its cards: `postage` unless the subtotal reaches `freeOver`. */
export interface StoreCost {
  postage: number;
  freeOver: number | null;
  kind: 'pickup' | 'postage';
  /** True when the postage is the default guess rather than a published or user-entered figure. */
  estimated: boolean;
}

const AUCKLAND = ['auckland', 'manukau', 'north shore', 'waitakere', 'albany', 'takapuna', 'henderson', 'silverdale', 'pukekohe', 'papakura', 'flat bush', 'newmarket', 'penrose', 'remuera', 'ponsonby'];
const SOUTH_ISLAND = ['christchurch', 'dunedin', 'invercargill', 'nelson', 'blenheim', 'timaru', 'queenstown', 'rangiora', 'ashburton', 'greymouth', 'oamaru', 'wanaka', 'rolleston', 'picton', 'motueka', 'gore', 'waimate', 'canterbury', 'otago', 'southland', 'tasman', 'marlborough', 'west coast'];

export function normaliseCity(city: string): string {
  return city.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Region of an NZ city, used for Auckland / North Island / South Island postage prices. */
export function regionOf(city: string | null | undefined): Region | null {
  if (!city) return null;
  const c = normaliseCity(city);
  if (AUCKLAND.some(a => c.includes(a))) return 'auckland';
  if (SOUTH_ISLAND.some(s => c.includes(s))) return 'south_island';
  return 'north_island';
}

export function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = normaliseCity(a);
  const nb = normaliseCity(b);
  if (na === nb) return true;
  // Auckland suburbs count as Auckland.
  return regionOf(a) === 'auckland' && regionOf(b) === 'auckland' && (na === 'auckland' || nb === 'auckland');
}

function valueFor(v: RegionValue | undefined, region: Region): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return v;
  return v[region] ?? v.north_island ?? Object.values(v)[0];
}

/** Whether the buyer can choose pickup for this Store (it's in their pickup city and doesn't rule pickup out). */
export function pickupEligible(store: StoreRecord, buyer: Pick<BuyerContext, 'pickupCity'>): boolean {
  return store.pickup.available !== false && sameCity(store.location.city, buyer.pickupCity);
}

export function storeCost(store: StoreRecord, buyer: BuyerContext): StoreCost {
  // What the buyer says a Store costs them wins, whether they post it or collect it.
  const override = buyer.postageOverrides[store.id];
  if (buyer.preferredStores.has(store.id)) return { postage: override ?? store.pickup.fee, freeOver: null, kind: 'pickup', estimated: false };
  if (buyer.pickupStores.has(store.id) && pickupEligible(store, buyer)) {
    return { postage: override ?? store.pickup.fee, freeOver: null, kind: 'pickup', estimated: false };
  }
  const region = regionOf(buyer.pickupCity) ?? 'north_island';
  const threshold = store.free_postage ? valueFor(store.free_postage.threshold, region) ?? null : null;
  if (override !== undefined) return { postage: override, freeOver: threshold, kind: 'postage', estimated: false };

  if (store.country === 'AU') return { postage: buyer.australiaPostage, freeOver: threshold, kind: 'postage', estimated: true };

  const options = (store.postage ?? []).filter(o => buyer.postageType === 'standard' || o.tracked !== false);
  if (!options.length) {
    const { tracked, rural } = buyer.defaultPostage;
    return { postage: tracked + (buyer.ruralAddress ? rural : 0), freeOver: threshold, kind: 'postage', estimated: true };
  }
  const prices = options.map(o => (valueFor(o.price, region) ?? 0) + (buyer.ruralAddress ? valueFor(o.rural_surcharge, region) ?? buyer.defaultPostage.rural : 0));
  return { postage: Math.min(...prices), freeOver: threshold, kind: 'postage', estimated: false };
}

/** Postage actually charged for a parcel with this subtotal. */
export function postageFor(cost: StoreCost, subtotal: number): number {
  return cost.freeOver !== null && subtotal >= cost.freeOver ? 0 : cost.postage;
}

// A Listing link to a Shopify product page; Stores not in the Store table (the Australian ones) that link like this get
// "Add all to cart", and the cart pre-check falls back to Open Listings if the shop turns out not to be Shopify.
const SHOPIFY_PRODUCT = /^https?:\/\/[^/]+(?:\/[^?#]*)?\/products\/[^/?#]+/;

/** Looks up the Store a Listing belongs to; Fetch sellers and unknown Stores get a default record. */
export class StoreDirectory {
  private byKey = new Map<string, StoreRecord>();
  private dynamic = new Map<string, StoreRecord>();
  /** Source store keys seen in Listings that aren't in the Store table, for diagnostics. */
  readonly unknownKeys = new Set<string>();

  constructor(readonly records: StoreRecord[]) {
    for (const r of records) {
      if (r.source_keys.mtgsingles) this.byKey.set(`mtgsingles:${r.source_keys.mtgsingles}`, r);
      if (r.source_keys.fetch) this.byKey.set(`fetch:${r.source_keys.fetch}`, r);
    }
  }

  get(id: string): StoreRecord | undefined {
    return this.records.find(r => r.id === id) ?? this.dynamic.get(id);
  }

  forListing(l: Listing): StoreRecord {
    const known = this.byKey.get(l.storeKey);
    if (known) return known;
    let r = this.dynamic.get(l.storeKey);
    if (!r) {
      if (l.source.startsWith('mtgsingles')) this.unknownKeys.add(l.storeKey);
      r = {
        id: l.storeKey,
        name: l.storeName,
        source_keys: {},
        site: null,
        location: { city: l.city ?? null, region: regionOf(l.city) },
        pickup: { available: l.pickupOffered ?? null, fee: 0 },
        cart: l.source === 'fetch' ? 'fetch' : SHOPIFY_PRODUCT.test(l.url) ? 'shopify' : 'open-listings',
        country: l.source === 'mtgsingles-au' ? 'AU' : undefined,
      };
      this.dynamic.set(l.storeKey, r);
    }
    return r;
  }
}
