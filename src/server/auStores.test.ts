import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StoreRecord } from '../core/stores';
import type { Source, SourceListing } from '../sources/types';
import { AuStoreFile, auRecord, checkAuStores, discoverAuStores, ProbeFailed, probeAuStore, WeeklyAuCheck, withAuStores, type AuProbe, type Fetch } from './auStores';

/** A fake Shopify shop: answers by path, and records the requests. */
function shop(rates: { NZ: [number, unknown]; AU?: [number, unknown] }, opts: { productStatus?: number; variants?: { id: number; available: boolean }[] } = {}) {
  const calls: string[] = [];
  const reply = (status: number, body: unknown, url: string) => {
    const res = new Response(JSON.stringify(body), { status, headers: { 'set-cookie': 'cart=abc; path=/' } });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  };
  const f: Fetch = async url => {
    calls.push(url.replace('https://shop.example', ''));
    const u = new URL(url);
    if (u.pathname === '/search/suggest.json') return reply(200, { resources: { results: { products: [{ handle: 'sol-ring', available: true }] } } }, url);
    if (u.pathname.startsWith('/products/')) return reply(opts.productStatus ?? 200, { variants: opts.variants ?? [{ id: 1, available: false }, { id: 2, available: true }] }, url);
    if (u.pathname === '/cart/add.js') return reply(200, {}, url);
    if (u.pathname === '/cart/shipping_rates.json') {
      const [status, body] = u.searchParams.get('shipping_address[country]') === 'NZ' ? rates.NZ : rates.AU ?? [200, { shipping_rates: [] }];
      return reply(status, body, url);
    }
    return reply(404, {}, url);
  };
  return { f, calls };
}
const rate = (name: string, price: string) => ({ name, price });

describe('probeAuStore', () => {
  it('reads the cheapest delivery option to Auckland, leaving out pickup', async () => {
    const { f, calls } = shop({ NZ: [200, { shipping_rates: [rate('Express International', '60.00'), rate('Pickup from store', '0.00'), rate('Standard  International', '12.95')] }] });
    const p = await probeAuStore({ site: 'https://shop.example', productUrl: 'https://shop.example/collections/x/products/sol-ring?utm_source=a' }, { fetch: f });
    expect(p).toMatchObject({ shipsToNz: true, rate: { name: 'Standard International', priceAud: 12.95 }, shopify: true, host: 'https://shop.example' });
    // The Listing's own product, so no search; one cart, no Sydney check.
    expect(calls).toEqual(['/products/sol-ring.js', '/cart/add.js', expect.stringMatching(/^\/cart\/shipping_rates\.json\?.*NZ/)]);
  });

  it('says no when checkout has no shipping zone for NZ', async () => {
    const { f } = shop({ NZ: [422, { country: ['Country/region not supported'] }] });
    expect(await probeAuStore({ site: 'https://shop.example' }, { fetch: f })).toMatchObject({ shipsToNz: false });
  });

  it('says no when checkout offers nothing for NZ but does for Sydney, asking each in a fresh cart', async () => {
    const { f, calls } = shop({ NZ: [200, { shipping_rates: [] }], AU: [200, { shipping_rates: [rate('AusPost', '8.50')] }] });
    expect(await probeAuStore({ site: 'https://shop.example' }, { fetch: f })).toMatchObject({ shipsToNz: false, rate: null });
    expect(calls.filter(c => c === '/cart/add.js')).toHaveLength(2);
  });

  it("can't tell when checkout offers nothing for Sydney either", async () => {
    const { f } = shop({ NZ: [200, { shipping_rates: [] }], AU: [200, { shipping_rates: [] }] });
    expect(await probeAuStore({ site: 'https://shop.example' }, { fetch: f })).toMatchObject({ shipsToNz: null, shopify: true });
  });

  it("can't tell for a shop that isn't Shopify or has nothing in stock", async () => {
    expect(await probeAuStore({ site: 'https://shop.example' }, { fetch: shop({ NZ: [200, {}] }, { productStatus: 404 }).f })).toMatchObject({ shipsToNz: null, shopify: false });
    expect(await probeAuStore({ site: 'https://shop.example' }, { fetch: shop({ NZ: [200, {}] }, { variants: [{ id: 1, available: false }] }).f })).toMatchObject({ shipsToNz: null, shopify: true });
  });

  it('throws when the shop fails, so the last result is kept', async () => {
    const { f } = shop({ NZ: [503, {}] });
    await expect(probeAuStore({ site: 'https://shop.example' }, { fetch: f })).rejects.toBeInstanceOf(ProbeFailed);
    await expect(probeAuStore({ site: 'https://shop.example' }, { fetch: async () => { throw new Error('ECONNRESET'); } })).rejects.toBeInstanceOf(ProbeFailed);
  });
});

const ships = (priceAud: number): AuProbe => ({ shipsToNz: true, rate: { name: 'Standard', priceAud }, shopify: true, host: null, note: '' });
const doesnt: AuProbe = { shipsToNz: false, rate: null, shopify: true, host: null, note: '' };

describe('auRecord', () => {
  it('keeps the id MagicFinder gave the Store before it was listed, and converts postage to NZD', () => {
    const r = auRecord({ key: 'AU/CardHouse', name: 'Card House', site: 'https://cardhouse.com.au/x' }, ships(21), 1.2, '2026-10-22');
    expect(r).toMatchObject({ id: 'mtgsingles:AU/CardHouse', source_keys: { mtgsingles: 'AU/CardHouse' }, site: 'https://cardhouse.com.au', country: 'AU', ships_to_nz: true, cart: 'shopify' });
    expect(r.postage).toEqual([{ name: 'Standard (AU$21.00)', tracked: null, price: 25.2, rural_surcharge: 0 }]);
    expect(auRecord({ key: 'AU/X', name: 'X', site: 'https://x.au' }, doesnt, 1.2, '2026-10-22').postage).toBeUndefined();
  });
});

describe('checkAuStores', () => {
  const known = auRecord({ key: 'AU/Known', name: 'Known', site: 'https://known.au' }, ships(20), 1.2, '2026-10-01');

  it('checks known and newly seen Stores, and lists what changed', async () => {
    const seen = new Map([['AU/New', { key: 'AU/New', name: 'New', site: 'https://new.au' }]]);
    const r = await checkAuStores([known], seen, { audToNzd: 1.2, today: '2026-10-22', probe: async s => (s.site === 'https://new.au' ? doesnt : ships(20)) });
    expect(r.records.map(x => [x.name, x.ships_to_nz, x.provenance?.checked_on])).toEqual([['Known', true, '2026-10-22'], ['New', false, '2026-10-22']]);
    expect(r.changes).toEqual(["New: new, doesn't ship to NZ"]);
  });

  it("keeps a Store's last result when its site fails, and lists a new one that fails as unknown", async () => {
    const seen = new Map([['AU/New', { key: 'AU/New', name: 'New', site: 'https://new.au' }]]);
    const r = await checkAuStores([known], seen, { audToNzd: 1.2, today: '2026-10-22', probe: async () => { throw new ProbeFailed('503'); } });
    expect(r.records.find(x => x.name === 'Known')).toBe(known);
    expect(r.records.find(x => x.name === 'New')?.ships_to_nz).toBeNull();
    expect(r.failed).toHaveLength(2);
  });
});

describe('discoverAuStores', () => {
  const listing = (store: string, url: string, quantity = 1) => ({ storeKey: `mtgsingles:${store}`, storeName: store.slice(3), url, quantity }) as SourceListing;

  it('finds each Store once, with an in-stock Listing to try checkout with', async () => {
    const source = { id: 'mtgsingles-au', name: 'MtgSingles Australia', search: async (card: string) => card === 'A'
      ? [listing('AU/One', 'https://one.au/products/a', 0), listing('AU/Two', 'https://two.au/products/a')]
      : [listing('AU/One', 'https://one.au/products/b')] } as Source;
    const { stores, error } = await discoverAuStores(source, ['A', 'B']);
    expect(error).toBeNull();
    expect([...stores.values()]).toEqual([
      { key: 'AU/One', name: 'One', site: 'https://one.au', productUrl: 'https://one.au/products/b' },
      { key: 'AU/Two', name: 'Two', site: 'https://two.au', productUrl: 'https://two.au/products/a' },
    ]);
  });

  it('keeps what it found when the Source fails part way', async () => {
    const source = { id: 'mtgsingles-au', name: 'MtgSingles Australia', search: async (card: string) => {
      if (card === 'B') throw new Error('blocked');
      return [listing('AU/One', 'https://one.au/products/a')];
    } } as Source;
    const { stores, error } = await discoverAuStores(source, ['A', 'B']);
    expect(stores.size).toBe(1);
    expect(error).toMatch(/blocked/);
  });
});

describe('withAuStores', () => {
  it('replaces shipped Australian entries by id and adds new ones', () => {
    const nz = { id: 'nz', name: 'NZ' } as StoreRecord;
    const old = { id: 'mtgsingles:AU/A', name: 'A', ships_to_nz: null } as StoreRecord;
    const fresh = { ...old, ships_to_nz: false };
    const extra = { id: 'mtgsingles:AU/B', name: 'B' } as StoreRecord;
    expect(withAuStores([nz, old], [fresh, extra])).toEqual([nz, fresh, extra]);
  });
});

describe('WeeklyAuCheck', () => {
  it('runs when no check has been saved or the last is a week old, and saves the result for after a restart', async () => {
    const file = new AuStoreFile(mkdtempSync(join(tmpdir(), 'mf-au-')));
    let now = Date.parse('2026-10-22T00:00:00Z');
    const updates: StoreRecord[][] = [];
    const source = { id: 'mtgsingles-au', name: 'MtgSingles Australia', search: async () => [{ storeKey: 'mtgsingles:AU/One', storeName: 'One', url: 'https://one.au/products/a', quantity: 1 } as SourceListing] } as Source;
    let probes = 0;
    const check = new WeeklyAuCheck({
      file, baseline: [], source, audToNzd: async () => 1.2, wait: async () => {}, onUpdate: au => updates.push(au), log: () => {}, now: () => now,
      probe: async () => (probes++, ships(15)),
    });
    expect(check.current()).toEqual([]);
    await check.runIfDue();
    expect(probes).toBe(1);
    expect(updates[0].map(r => r.id)).toEqual(['mtgsingles:AU/One']);
    expect(check.current()[0].ships_to_nz).toBe(true);

    now += 6 * 24 * 60 * 60 * 1000;
    await check.runIfDue();
    expect(probes).toBe(1);
    now += 2 * 24 * 60 * 60 * 1000;
    await check.runIfDue();
    expect(probes).toBe(2);
  });
});
