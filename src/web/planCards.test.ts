import { describe, expect, it } from 'vitest';
import type { ItemView, OfferView, StoreView } from '../shared/api';
import { cardsElsewhere, costAtStore, fillAtStore, planCards, printingCount } from './planCards';

const offer = (storeId: string, price: number, qty: number): OfferView => ({
  listingId: `${storeId}:${price}`, storeId, storeName: storeId, price, qty, condition: 'NM', finish: 'nonfoil', label: '', printingId: null, storeImage: null, image: null, url: '', cardKingdomNzd: null, overCardKingdom: false, underCardKingdom: false,
});

const item = (buyKey: string, qty: number, price: number): ItemView => ({
  listingId: `${buyKey}:${price}`, buyKey, lineIds: [buyKey], oracleId: buyKey, name: buyKey, qty, price, condition: 'NM', finish: 'nonfoil', printing: null,
  fallbackImage: null, title: '', storeImage: null, url: '', source: 'fetch', locked: false, cardKingdomNzd: null, overCardKingdom: false, underCardKingdom: false,
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

describe('printingCount', () => {
  const at = (listingId: string, printingId: string | null, finish: OfferView['finish'] = 'nonfoil') => ({ ...offer('a', 1, 1), listingId, printingId, finish });

  it('counts a Printing once however many Listings offer it', () => {
    expect(printingCount([at('1', 'p'), at('2', 'p'), at('3', 'q')])).toBe(2);
  });

  it('counts each finish of a Printing apart', () => {
    expect(printingCount([at('1', 'p'), at('2', 'p', 'foil')])).toBe(2);
  });

  it('leaves out Listings whose Printing is not known', () => {
    expect(printingCount([at('1', null), at('2', null), at('3', 'p')])).toBe(1);
    expect(printingCount([at('1', null)])).toBe(0);
  });
});

describe('fillAtStore', () => {
  const offers = [offer('a', 3, 2), offer('a', 2, 1), offer('b', 1, 5)];

  it('takes the cheapest Listings at the Store first, only as many as needed', () => {
    expect(fillAtStore(offers, 'a', 2)?.map(f => [f.offer.price, f.qty])).toEqual([[2, 1], [3, 1]]);
    expect(fillAtStore(offers, 'a', 1)?.map(f => [f.offer.price, f.qty])).toEqual([[2, 1]]);
  });

  it('is null when the Store has too few copies', () => {
    expect(fillAtStore(offers, 'a', 4)).toBeNull();
  });
});
