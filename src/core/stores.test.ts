import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { pickupEligible, postageFor, regionOf, storeCost, type BuyerContext, type StoreRecord } from './stores';

const stores: StoreRecord[] = parse(readFileSync('data/stores.yaml', 'utf8'));
const byId = (id: string) => stores.find(s => s.id === id)!;

const buyer = (over: Partial<BuyerContext> = {}): BuyerContext => ({
  postageType: 'tracked',
  pickupCity: 'Auckland',
  ruralAddress: false,
  pickupStores: new Set(),
  postageOverrides: {},
  defaultPostage: { tracked: 7, rural: 5 },
  ...over,
});

describe('Store table', () => {
  it('has unique ids, MtgSingles keys and valid cart kinds', () => {
    const ids = stores.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = stores.map(s => s.source_keys.mtgsingles).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of stores) expect(['shopify', 'open-listings', 'hobbymaster-deckbuilder']).toContain(s.cart);
  });
});

describe('regionOf', () => {
  it('places cities in Auckland, North Island or South Island', () => {
    expect(regionOf('Auckland')).toBe('auckland');
    expect(regionOf('Albany')).toBe('auckland');
    expect(regionOf('Wellington')).toBe('north_island');
    expect(regionOf('Taupō')).toBe('north_island');
    expect(regionOf('Christchurch')).toBe('south_island');
    expect(regionOf(null)).toBeNull();
  });
});

describe('storeCost', () => {
  it("charges an Australian Store the buyer's Australia postage guess, marked as estimated", () => {
    const au = { ...stores[0], id: 'mtgsingles:AU/X', country: 'AU' as const };
    expect(storeCost(au, buyer({ australiaPostage: 18 }))).toMatchObject({ postage: 18, estimated: true, kind: 'postage' });
    expect(storeCost(au, buyer({ australiaPostage: 18, postageOverrides: { [au.id]: 12 } }))).toMatchObject({ postage: 12, estimated: false });
  });

  it('uses the published tracked price and free-postage threshold', () => {
    const c = storeCost(byId('hobby-master'), buyer());
    expect(c).toMatchObject({ postage: 6, freeOver: 100, kind: 'postage', estimated: false });
    expect(postageFor(c, 99.99)).toBe(6);
    expect(postageFor(c, 100)).toBe(0);
  });

  it('adds the rural surcharge for rural addresses', () => {
    expect(storeCost(byId('hobby-master'), buyer({ ruralAddress: true })).postage).toBe(15);
  });

  it('prices by the region of the buyer pickup city', () => {
    expect(storeCost(byId('meta-life'), buyer()).postage).toBe(5.8);
    expect(storeCost(byId('meta-life'), buyer()).freeOver).toBe(120);
    expect(storeCost(byId('meta-life'), buyer({ pickupCity: 'Dunedin' }))).toMatchObject({ postage: 9.6, freeOver: 160 });
    expect(storeCost(byId('game-roost'), buyer({ pickupCity: 'Christchurch' })).postage).toBe(10);
  });

  it('falls back to the editable default when a Store publishes no rates, and marks it estimated', () => {
    expect(storeCost(byId('card-bard'), buyer())).toMatchObject({ postage: 7, estimated: true, freeOver: null });
    expect(storeCost(byId('card-bard'), buyer({ ruralAddress: true })).postage).toBe(12);
  });

  it('uses a buyer override over everything but pickup', () => {
    expect(storeCost(byId('shuffle-and-cut'), buyer({ postageOverrides: { 'shuffle-and-cut': 5.5 } }))).toMatchObject({ postage: 5.5, estimated: false });
  });

  it('charges only the pickup fee when the buyer picks up', () => {
    const b = buyer({ pickupStores: new Set(['hobby-master']) });
    expect(storeCost(byId('hobby-master'), b)).toMatchObject({ postage: 2, freeOver: null, kind: 'pickup' });
  });

  it('ignores pickup for Stores outside the pickup city or that rule it out', () => {
    expect(pickupEligible(byId('tcg-collector-nz'), buyer())).toBe(false);
    expect(pickupEligible(byId('tcg-collector-nz'), buyer({ pickupCity: 'Christchurch' }))).toBe(true);
    expect(pickupEligible(byId('otaku-mart'), buyer({ pickupCity: 'Pōkeno' }))).toBe(false);
    const b = buyer({ pickupStores: new Set(['tcg-collector-nz']) });
    expect(storeCost(byId('tcg-collector-nz'), b).kind).toBe('postage');
  });

  it('skips untracked options when tracked postage is required', () => {
    const s: StoreRecord = { ...byId('hobby-master'), postage: [{ name: 'Letter', tracked: false, price: 2 }, { name: 'Courier', tracked: true, price: 6 }] };
    expect(storeCost(s, buyer()).postage).toBe(6);
    expect(storeCost(s, buyer({ postageType: 'standard' })).postage).toBe(2);
  });
});
