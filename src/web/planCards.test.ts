import { describe, expect, it } from 'vitest';
import type { ItemView, OfferView, StoreView } from '../shared/api';
import { cardsElsewhere, costAtStore, planCards } from './planCards';

const offer = (storeId: string, price: number, qty: number): OfferView => ({
  listingId: `${storeId}:${price}`, storeId, storeName: storeId, price, qty, condition: 'NM', finish: 'nonfoil', label: '', printingId: null, storeImage: null, image: null, url: '', cardKingdomNzd: null, overCardKingdom: false,
});

const item = (buyKey: string, qty: number, price: number): ItemView => ({
  listingId: `${buyKey}:${price}`, buyKey, lineIds: [buyKey], oracleId: buyKey, name: buyKey, qty, price, condition: 'NM', finish: 'nonfoil', printing: null,
  fallbackImage: null, title: '', storeImage: null, url: '', source: 'fetch', locked: false, cardKingdomNzd: null, overCardKingdom: false,
});

const store = (id: string, items: ItemView[]) => ({ id, name: id, items }) as StoreView;

describe('costAtStore', () => {
  const offers = [offer('a', 2, 1), offer('a', 3, 2), offer('b', 1, 1)];

  it('fills from the cheapest Listings at the Store', () => {
    expect(costAtStore(offers, 'a', 2)).toBe(5);
    expect(costAtStore(offers, 'a', 3)).toBe(8);
  });

  it('is null when the Store cannot supply every copy', () => {
    expect(costAtStore(offers, 'b', 2)).toBeNull();
    expect(costAtStore(offers, 'z', 1)).toBeNull();
  });
});

describe('cardsElsewhere', () => {
  it('lists cards bought from other Stores that this Store could supply in full', () => {
    const stores = [store('a', [item('bolt', 2, 1)]), store('b', [item('ring', 1, 4)])];
    const offers = { bolt: [offer('a', 1, 4), offer('b', 1.5, 2)], ring: [offer('b', 4, 1), offer('a', 3, 1)] };
    const cards = planCards(stores);
    expect(cardsElsewhere('a', cards, offers).map(e => [e.card.buyKey, e.cost, e.current])).toEqual([['ring', 3, 4]]);
    expect(cardsElsewhere('b', cards, offers).map(e => [e.card.buyKey, e.cost, e.current])).toEqual([['bolt', 3, 2]]);
  });
});
