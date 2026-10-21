// Which Australian Stores ship to NZ, and what they charge to post here. Both `npm run probe-au` (which rewrites the
// Australian part of data/stores.yaml) and the hosted server's weekly check use this. Decided in "Australian Stores:
// know which ship to NZ, and leave out the rest by default" (#61).
//
// A Shopify Store's /meta.json lists the countries it ships to, but checkout can disagree (Area52, ManaMarket and
// TheGamesDistrict list NZ and offer no rate for it), so checkout decides: one in-stock single goes in a throwaway
// cart, and /cart/shipping_rates.json is asked for an Auckland address. "Country not supported" means no shipping zone
// covers NZ. No rates for Auckland counts as "doesn't ship" only if a Sydney address does get rates; otherwise the check
// didn't work for that Store.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shopifyHandle, type StoreRecord } from '../core/stores';
import type { Source } from '../sources/types';
import { USER_AGENT } from './paths';

/** A Store's MtgSingles key ("AU/Area52"), its site, and a Listing link to try first when looking for an in-stock single. */
export interface SeenAuStore {
  key: string;
  name: string;
  site: string;
  productUrl?: string;
}

export interface AuProbe {
  /** False only when checkout posts to Australia but offers nothing for NZ; null when the check couldn't tell. */
  shipsToNz: boolean | null;
  /** The cheapest delivery option to Auckland, in AUD. */
  rate: { name: string; priceAud: number } | null;
  shopify: boolean;
  /** The host the shop's cart answers on (it can differ from the Listing links'). */
  host: string | null;
  note: string;
}

/** The site couldn't be reached or kept failing (rate limit, server error): keep what we knew. */
export class ProbeFailed extends Error {}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Cards nearly every Store has a copy of: searched on MtgSingles AU to find Stores, and at a Store to find an in-stock single. */
export const AU_STAPLES = [
  'Sol Ring', 'Lightning Bolt', 'Counterspell', 'Arcane Signet', 'Command Tower', 'Llanowar Elves', 'Swords to Plowshares',
  'Brainstorm', 'Dark Ritual', 'Cultivate', 'Evolving Wilds', 'Negate',
];

const SYDNEY = { 'shipping_address[country]': 'AU', 'shipping_address[zip]': '2000', 'shipping_address[province]': 'NSW', 'shipping_address[city]': 'Sydney' };
const AUCKLAND = { 'shipping_address[country]': 'NZ', 'shipping_address[zip]': '1010', 'shipping_address[city]': 'Auckland' };
const isPickup = (name: string) => /pick ?up|collect|in.store|local delivery/i.test(name);

/**
 * Checks one Store's checkout. `wait` paces requests to a host. Throws ProbeFailed when the site doesn't answer
 * properly, so the caller can keep the last result; answers it can't use give `shipsToNz: null`.
 */
export async function probeAuStore(store: { site: string; productUrl?: string }, opts: { fetch?: Fetch; wait?: (host: string) => Promise<void> } = {}): Promise<AuProbe> {
  const f = opts.fetch ?? fetch;
  const wait = opts.wait ?? (async () => {});
  const unknown = (note: string, shopify = false, host: string | null = null): AuProbe => ({ shipsToNz: null, rate: null, shopify, host, note });
  const get = async (url: string, init: RequestInit = {}) => {
    await wait(new URL(url).host);
    let res: Response;
    try {
      res = await f(url, { ...init, redirect: 'follow', headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init.headers as Record<string, string>) }, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new ProbeFailed(`${new URL(url).host} didn't answer (${(e as Error).message})`);
    }
    if (res.status === 429 || res.status >= 500) throw new ProbeFailed(`${new URL(url).host} answered ${res.status}`);
    return res;
  };
  const json = async (res: Response): Promise<any> => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };

  // An in-stock variant: the Listing's own product first, then the shop's search for a staple.
  const site = new URL(store.site).origin;
  const handles: string[] = [];
  const own = store.productUrl && shopifyHandle(store.productUrl);
  if (own) handles.push(own);
  let variant: number | null = null;
  let host: string | null = null;
  let shopify = false;
  let searches = 0;
  while (variant === null && (handles.length || searches < 3)) {
    if (!handles.length) {
      const q = new URLSearchParams({ q: AU_STAPLES[searches++], 'resources[type]': 'product', 'resources[limit]': '10', 'resources[options][unavailable_products]': 'hide' });
      const found = await json(await get(`${site}/search/suggest.json?${q}`));
      const products: { handle: string; available?: boolean }[] = found?.resources?.results?.products ?? [];
      handles.push(...products.filter(p => p.available !== false).slice(0, 2).map(p => p.handle));
      if (!handles.length) continue;
    }
    while (variant === null && handles.length) {
      const res = await get(`${site}/products/${handles.shift()}.js`);
      if (res.url.includes('/password')) return unknown('shop is password-protected', true);
      const p = res.ok ? await json(res) : null;
      if (!Array.isArray(p?.variants)) continue;
      shopify = true;
      host = new URL(res.url).origin;
      variant = p.variants.find((v: { available: boolean }) => v.available)?.id ?? null;
    }
  }
  if (variant === null) return unknown(shopify ? 'no in-stock single to try checkout with' : "not a Shopify shop (or its search didn't answer)", shopify, host);

  // A cart keeps the rates of the first address it was asked about, so each address gets a fresh cart.
  const rates = async (address: Record<string, string>) => {
    const add = await get(`${host}/cart/add.js`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `id=${variant}&quantity=1` });
    if (!add.ok) return 'refused' as const;
    const cookie = add.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const res = await get(`${host}/cart/shipping_rates.json?${new URLSearchParams(address)}`, { headers: { Cookie: cookie } });
    const body = await json(res);
    // 422 "Country/region not supported": no shipping zone covers that country at all.
    if (res.status === 422 && body?.country) return 'unsupported' as const;
    if (!res.ok || !Array.isArray(body?.shipping_rates)) return null;
    return (body.shipping_rates as { name: string; price: string }[])
      .map(r => ({ name: r.name.replace(/\s+/g, ' ').trim(), priceAud: Number(r.price) }))
      .filter(r => !isPickup(r.name) && Number.isFinite(r.priceAud));
  };
  const nz = await rates(AUCKLAND);
  if (nz === 'refused') return unknown('cart refused the single', true, host);
  if (nz === 'unsupported') return { shipsToNz: false, rate: null, shopify, host, note: 'checkout has no shipping zone for NZ' };
  if (nz === null) return unknown("checkout didn't answer for NZ", true, host);
  if (!nz.length) {
    // Nothing for NZ only counts if checkout does offer rates at home; otherwise this check just doesn't work there.
    const au = await rates(SYDNEY);
    if (!Array.isArray(au) || !au.length) return unknown("checkout gave no rates for Australia either, so it can't tell", true, host);
    return { shipsToNz: false, rate: null, shopify, host, note: 'checkout offers nothing for NZ' };
  }
  const rate = nz.sort((a, b) => a.priceAud - b.priceAud)[0];
  return { shipsToNz: true, rate, shopify, host, note: `ships to NZ: ${rate.name}, AU$${rate.priceAud.toFixed(2)}` };
}

/** The Australian Stores in a Source's Listings for the staples, by MtgSingles key. Stops early (keeping what it found) if the Source fails. */
export async function discoverAuStores(source: Source, cards = AU_STAPLES, signal?: AbortSignal): Promise<{ stores: Map<string, SeenAuStore>; error: string | null }> {
  const stores = new Map<string, SeenAuStore>();
  for (const card of cards) {
    let listings;
    try {
      listings = await source.search(card, signal);
    } catch (e) {
      return { stores, error: `${source.name} failed searching "${card}": ${(e as Error).message}` };
    }
    for (const l of listings) {
      const key = l.storeKey.replace(/^mtgsingles:/, '');
      let site: string;
      try {
        site = new URL(l.url).origin;
      } catch {
        continue;
      }
      const seen = stores.get(key);
      if (!seen) stores.set(key, { key, name: l.storeName, site, productUrl: l.quantity > 0 ? l.url : undefined });
      else if (!seen.productUrl && l.quantity > 0) seen.productUrl = l.url;
    }
  }
  return { stores, error: null };
}

/** The Store-table entry for an Australian Store. Its id is the one MagicFinder gave it before it was listed, so buyers' exclusions still apply. */
export function auRecord(s: { key: string; name: string; site: string }, probe: AuProbe, audToNzd: number, today: string): StoreRecord {
  const site = probe.host ?? new URL(s.site).origin;
  return {
    id: `mtgsingles:${s.key}`,
    name: s.name,
    source_keys: { mtgsingles: s.key },
    site,
    location: { city: null, region: null },
    pickup: { available: false, fee: 0 },
    ...(probe.rate && {
      postage: [{ name: `${probe.rate.name} (AU$${probe.rate.priceAud.toFixed(2)})`, tracked: null, price: Math.round(probe.rate.priceAud * audToNzd * 100) / 100, rural_surcharge: 0 }],
    }),
    cart: probe.shopify ? 'shopify' : 'open-listings',
    country: 'AU',
    ships_to_nz: probe.shipsToNz,
    provenance: { url: `${site}/cart/shipping_rates.json`, checked_on: today, confidence: probe.shipsToNz === null ? 'default' : 'checkout' },
  };
}

export interface AuCheckResult {
  records: StoreRecord[];
  /** One line per Store whose answer changed (or is new), for the log or the commit. */
  changes: string[];
  /** Stores whose site failed, which kept their last result. */
  failed: string[];
}

/**
 * Re-checks every Australian Store we know of or just saw. A Store whose site fails keeps its last entry; a new one
 * that fails is listed as unknown. Records come back sorted by name.
 */
export async function checkAuStores(
  previous: StoreRecord[],
  seen: Map<string, SeenAuStore>,
  opts: { probe?: typeof probeAuStore; audToNzd: number; today: string; log?: (line: string) => void },
): Promise<AuCheckResult> {
  const probe = opts.probe ?? probeAuStore;
  const log = opts.log ?? (() => {});
  const byKey = new Map(previous.filter(r => r.source_keys.mtgsingles).map(r => [r.source_keys.mtgsingles!, r]));
  const keys = [...new Set([...byKey.keys(), ...seen.keys()])];
  const records: StoreRecord[] = [];
  const changes: string[] = [];
  const failed: string[] = [];
  for (const key of keys) {
    const before = byKey.get(key);
    const now = seen.get(key);
    const name = now?.name ?? before!.name;
    const site = now?.site ?? before?.site;
    if (!site) {
      if (before) records.push(before);
      continue;
    }
    let result: AuProbe;
    try {
      result = await probe({ site, productUrl: now?.productUrl });
    } catch (e) {
      failed.push(`${name}: ${(e as Error).message}`);
      log(`${name}: ${(e as Error).message}; keeping the last result`);
      records.push(before ?? auRecord({ key, name, site }, { shipsToNz: null, rate: null, shopify: false, host: null, note: '' }, opts.audToNzd, opts.today));
      continue;
    }
    const r = auRecord({ key, name, site }, result, opts.audToNzd, opts.today);
    // A Store that still answers but we can't use any more keeps a Shopify cart if it had one.
    if (before?.cart === 'shopify' && !result.shopify && result.shipsToNz === null) r.cart = 'shopify';
    log(`${name}: ${result.note}`);
    const was = before ? describe(before) : null;
    const is = describe(r);
    if (was !== is) changes.push(`${name}: ${was ? `${was} → ` : 'new, '}${is}`);
    records.push(r);
  }
  records.sort((a, b) => a.name.localeCompare(b.name));
  return { records, changes, failed };
}

const describe = (r: StoreRecord) =>
  r.ships_to_nz === true ? `ships to NZ${r.postage?.[0] ? ` (${r.postage[0].name})` : ''}` : r.ships_to_nz === false ? "doesn't ship to NZ" : 'unknown';

/** The Store table with these Australian entries in place of (or beside) the shipped ones. */
export function withAuStores(stores: StoreRecord[], au: StoreRecord[]): StoreRecord[] {
  const ids = new Set(au.map(r => r.id));
  return [...stores.filter(r => !ids.has(r.id)), ...au];
}

/** Hosted mode: the weekly check's results, kept on the data volume so they outlive a restart. */
export class AuStoreFile {
  readonly path: string;
  constructor(dataDir: string) {
    this.path = join(dataDir, 'au-stores.json');
  }

  read(): { checkedAt: string; stores: StoreRecord[] } | null {
    if (!existsSync(this.path)) return null;
    try {
      const saved = JSON.parse(readFileSync(this.path, 'utf8'));
      return typeof saved?.checkedAt === 'string' && Array.isArray(saved.stores) ? saved : null;
    } catch {
      return null;
    }
  }

  write(stores: StoreRecord[], checkedAt = new Date().toISOString()): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ checkedAt, stores }, null, 2));
    renameSync(tmp, this.path);
  }
}

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Hosted mode: runs the check when the last one is a week old, and hands the new Australian entries to `onUpdate`. */
export class WeeklyAuCheck {
  private running: Promise<void> | null = null;

  constructor(private readonly d: {
    file: AuStoreFile;
    baseline: StoreRecord[];
    source: Source;
    audToNzd: () => Promise<number>;
    wait: (host: string) => Promise<void>;
    onUpdate: (au: StoreRecord[]) => void;
    log?: (line: string) => void;
    now?: () => number;
    probe?: typeof probeAuStore;
  }) {}

  /** The Australian entries to use now: the last check's, or the shipped ones. */
  current(): StoreRecord[] {
    return this.d.file.read()?.stores ?? this.d.baseline;
  }

  runIfDue(): Promise<void> {
    const last = this.d.file.read()?.checkedAt;
    const now = this.d.now?.() ?? Date.now();
    if (last && now - Date.parse(last) < WEEK) return Promise.resolve();
    this.running ??= this.run().finally(() => (this.running = null));
    return this.running;
  }

  private async run(): Promise<void> {
    const log = this.d.log ?? (line => console.log(`Australian Store check: ${line}`));
    try {
      const { stores: seen, error } = await discoverAuStores(this.d.source);
      if (error) log(`${error}; checking the ${seen.size} Stores found so far and the known ones`);
      const today = new Date(this.d.now?.() ?? Date.now()).toLocaleDateString('en-CA');
      const result = await checkAuStores(this.current(), seen, { audToNzd: await this.d.audToNzd(), today, probe: this.d.probe, log: () => {} });
      this.d.file.write(result.records, new Date(this.d.now?.() ?? Date.now()).toISOString());
      this.d.onUpdate(result.records);
      const ships = result.records.filter(r => r.ships_to_nz === true).length;
      const not = result.records.filter(r => r.ships_to_nz === false).length;
      log(`${result.records.length} Stores: ${ships} ship to NZ, ${not} don't, ${result.records.length - ships - not} unknown${result.failed.length ? `, ${result.failed.length} didn't answer` : ''}`);
      for (const c of result.changes) log(`changed: ${c}`);
    } catch (e) {
      log(`failed (${(e as Error).message}); trying again next hour`);
    }
  }
}
