import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalogue, Catalogue } from '../catalogue/catalogue';
import type { BuyLine } from '../core/wantList';
import { cardKingdomOffers, cardKingdomUnitNzd, CardKingdomPrices, compareAtCardKingdom, overCardKingdom, underCardKingdom } from './cardKingdom';

const dir = mkdtempSync(join(tmpdir(), 'mf-ck-'));
let cat: Catalogue;
beforeAll(async () => {
  const raw = readFileSync('test/fixtures/scryfall-sample.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
  await buildCatalogue(join(dir, 'c.sqlite'), raw, 'test');
  cat = new Catalogue(join(dir, 'c.sqlite'));
});
afterAll(() => {
  cat.close();
  rmSync(dir, { recursive: true, force: true });
});

function lineFor(name: string, quantity: number): BuyLine {
  const card = cat.findCard(name)!;
  return { key: card.oracleId, oracleId: card.oracleId, name: card.name, quantity, lock: null, lineIds: [card.oracleId] };
}

function pricesFor(name: string, rows: { usd: number; qty: number }[]) {
  const card = cat.findCard(name)!;
  const printings = cat.printingsOf(card.oracleId).filter(p => !p.nonTournament && p.finishes.includes('nonfoil'));
  const prices = new CardKingdomPrices(null);
  prices.replace(rows.map((r, i) => ({ printingId: printings[i].id, finish: 'nonfoil' as const, entry: { usd: r.usd, qty: r.qty, url: `https://www.cardkingdom.com/mtg/${i}` } })));
  return prices;
}

describe('compareAtCardKingdom', () => {
  it('prices the cheapest printing, converts to NZD and adds flat shipping', () => {
    const prices = pricesFor('Sol Ring', [{ usd: 2, qty: 10 }]);
    const view = compareAtCardKingdom([lineFor('Sol Ring', 2)], cat, { prices, usdToNzd: 1.7 }, { allowFoils: true, shippingUsd: 20 });
    expect(view.items).toHaveLength(1);
    expect(view.subtotalUsd).toBe(4);
    expect(view.shippingUsd).toBe(20);
    expect(view.totalUsd).toBe(24);
    expect(view.totalNzd).toBe(40.8);
    expect(view.gstNzd).toBe(0);
    expect(view.missing).toEqual([]);
  });

  it('adds 15% GST on cards and shipping when asked', () => {
    const prices = pricesFor('Sol Ring', [{ usd: 2, qty: 10 }]);
    const view = compareAtCardKingdom([lineFor('Sol Ring', 2)], cat, { prices, usdToNzd: 1.7, gst: true }, { allowFoils: true, shippingUsd: 20 });
    expect(view.totalUsd).toBe(24);
    expect(view.gstNzd).toBe(6.12);
    expect(view.totalNzd).toBe(46.92);
  });

  it('spreads a line over printings when one lacks stock, and reports what is short', () => {
    const prices = pricesFor('Sol Ring', [{ usd: 3, qty: 1 }, { usd: 1, qty: 1 }]);
    const view = compareAtCardKingdom([lineFor('Sol Ring', 4)], cat, { prices, usdToNzd: 2 }, { allowFoils: true, shippingUsd: 0 });
    expect(view.items.map(i => [i.qty, i.priceUsd])).toEqual([[1, 1], [1, 3]]);
    expect(view.missing).toEqual([{ buyKey: view.missing[0].buyKey, name: 'Sol Ring', missing: 2 }]);
  });

  it('charges no shipping when nothing is available there', () => {
    const view = compareAtCardKingdom([lineFor('Sol Ring', 1)], cat, { prices: new CardKingdomPrices(null), usdToNzd: 1.7 }, { allowFoils: true, shippingUsd: 20 });
    expect(view.items).toEqual([]);
    expect(view.totalNzd).toBe(0);
    expect(view.missing).toHaveLength(1);
  });
});

describe('overCardKingdom', () => {
  it('flags prices above NZ$5 that are more than 30% over CardKingdom', () => {
    expect(overCardKingdom(10, 7)).toBe(true);
    expect(overCardKingdom(10, 7.7)).toBe(false);
    expect(overCardKingdom(10, 7.69)).toBe(true);
  });

  it('never flags NZ$5 or less, or cards CardKingdom does not have', () => {
    expect(overCardKingdom(5, 1)).toBe(false);
    expect(overCardKingdom(4, 1)).toBe(false);
    expect(overCardKingdom(20, null)).toBe(false);
  });
});

describe('underCardKingdom', () => {
  it('flags prices 25% or more under CardKingdom', () => {
    expect(underCardKingdom(7.5, 10)).toBe(true);
    expect(underCardKingdom(3, 10)).toBe(true);
    expect(underCardKingdom(7.51, 10)).toBe(false);
  });

  it('never flags cards CardKingdom sells for under NZ$5, or does not have', () => {
    expect(underCardKingdom(1, 4.99)).toBe(false);
    expect(underCardKingdom(1, 5)).toBe(true);
    expect(underCardKingdom(1, null)).toBe(false);
  });
});

describe('cardKingdomUnitNzd', () => {
  it('uses the cheapest printing of the card at CardKingdom', () => {
    const prices = pricesFor('Sol Ring', [{ usd: 4, qty: 1 }, { usd: 2, qty: 1 }]);
    expect(cardKingdomUnitNzd({ prices, usdToNzd: 2 }, cat, lineFor('Sol Ring', 1), true)).toBe(4);
  });

  it('takes a cheaper foil only when foils are allowed', () => {
    const card = cat.findCard('Sol Ring')!;
    const printings = cat.printingsOf(card.oracleId).filter(p => !p.nonTournament && p.finishes.includes('foil') && p.finishes.includes('nonfoil'));
    const prices = new CardKingdomPrices(null);
    prices.replace([
      { printingId: printings[0].id, finish: 'nonfoil', entry: { usd: 4, qty: 1, url: '' } },
      { printingId: printings[1].id, finish: 'foil', entry: { usd: 3, qty: 1, url: '' } },
    ]);
    expect(cardKingdomUnitNzd({ prices, usdToNzd: 1 }, cat, lineFor('Sol Ring', 1), true)).toBe(3);
    expect(cardKingdomUnitNzd({ prices, usdToNzd: 1 }, cat, lineFor('Sol Ring', 1), false)).toBe(4);
  });

  it('uses the locked Printing, even when another is cheaper', () => {
    const card = cat.findCard('Sol Ring')!;
    const printings = cat.printingsOf(card.oracleId).filter(p => !p.nonTournament && p.finishes.includes('nonfoil'));
    const prices = pricesFor('Sol Ring', [{ usd: 4, qty: 1 }, { usd: 2, qty: 1 }]);
    const locked = (printingId: string, finish: 'nonfoil' | 'foil') => ({ ...lineFor('Sol Ring', 1), lock: { printingId, finish } });
    expect(cardKingdomUnitNzd({ prices, usdToNzd: 1 }, cat, locked(printings[0].id, 'nonfoil'), true)).toBe(4);
    expect(cardKingdomUnitNzd({ prices, usdToNzd: 1 }, cat, locked(printings[0].id, 'foil'), true)).toBeNull();
  });

  it("reads CardKingdom's foil of an etched-only Printing as the etched foil, a foil the buyer must allow", () => {
    const card = cat.findCard('Sol Ring')!;
    const etched = cat.printingsOf(card.oracleId).find(p => !p.nonTournament && p.finishes.join() === 'etched')!;
    const prices = new CardKingdomPrices(null);
    prices.replace([{ printingId: etched.id, finish: 'foil', entry: { usd: 3, qty: 1, url: '' } }]);
    const ck = { prices, usdToNzd: 1 };
    expect(cardKingdomOffers(lineFor('Sol Ring', 1), cat, ck, true).map(o => o.finish)).toEqual(['etched']);
    expect(cardKingdomUnitNzd(ck, cat, lineFor('Sol Ring', 1), false)).toBeNull();
    expect(cardKingdomUnitNzd(ck, cat, { ...lineFor('Sol Ring', 1), lock: { printingId: etched.id, finish: 'etched' } }, false)).toBe(3);
  });

  it("takes CardKingdom's word for the finish of a Printing Scryfall knows in only one finish", () => {
    const card = cat.findCard('Sol Ring')!;
    const nonfoilOnly = cat.printingsOf(card.oracleId).find(p => !p.nonTournament && p.finishes.join() === 'nonfoil')!;
    const both = cat.printingsOf(card.oracleId).find(p => !p.nonTournament && p.finishes.join() === 'nonfoil,foil')!;
    const prices = new CardKingdomPrices(null);
    prices.replace([
      { printingId: nonfoilOnly.id, finish: 'foil', entry: { usd: 2, qty: 1, url: '' } },
      { printingId: both.id, finish: 'foil', entry: { usd: 3, qty: 1, url: '' } },
    ]);
    const offers = cardKingdomOffers(lineFor('Sol Ring', 1), cat, { prices, usdToNzd: 1 }, true);
    expect(offers.map(o => [o.printingId, o.finish])).toEqual([[nonfoilOnly.id, 'foil'], [both.id, 'foil']]);
  });

  it('includes GST when asked, so the +X% chip compares like with like', () => {
    const prices = pricesFor('Sol Ring', [{ usd: 2, qty: 1 }]);
    expect(cardKingdomUnitNzd({ prices, usdToNzd: 2, gst: true }, cat, lineFor('Sol Ring', 1), true)).toBe(4.6);
  });
});
