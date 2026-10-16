import { describe, expect, it } from 'vitest';
import type { Listing } from '../core/types';
import { Throttle } from '../sources/policy';
import { checkShopifyCart, pickVariant, type ShopifyVariant } from './cart';

const listing = (over: Partial<Listing> = {}): Listing => ({
  id: 'l1', source: 'mtgsingles', storeKey: 'mtgsingles:NZ/ShuffleAndCut', storeName: 'Shuffle and Cut', finish: 'nonfoil', confidence: 'exact',
  condition: 'NM', price: 7, quantity: 2, url: 'https://shuffleandcutgames.co.nz/products/lightning-bolt-msc', title: 'Lightning Bolt', english: true,
  buyable: true, extra: { rawCondition: 'NM / SP' }, ...over,
});

// Shuffle and Cut style: five conditions, then the same five in foil, SKU ...-NF-1 / -FO-1.
const shuffle: ShopifyVariant[] = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'].flatMap((t, i) => [
  { id: 100 + i, title: t, price: 500, available: i === 0, sku: `MSC-806-EN-NF-${i + 1}` },
  { id: 200 + i, title: `${t} Foil`, price: 700, available: i === 0, sku: `MSC-806-EN-FO-${i + 1}` },
]);

describe('pickVariant', () => {
  it('matches condition and finish', () => {
    expect(pickVariant(listing({ price: 5 }), shuffle)?.id).toBe(100);
    expect(pickVariant(listing({ finish: 'foil' }), shuffle)?.id).toBe(200);
  });

  it('falls back to the same-priced available variant when the foil flag was missing', () => {
    // MtgSingles said non-foil at $7, but only the foil is $7.
    expect(pickVariant(listing({ price: 7 }), shuffle)?.id).toBe(200);
  });

  it('reads titles when there is no SKU convention', () => {
    const goblin = [{ id: 1, title: 'NM-Mint', price: 300, available: true }, { id: 2, title: 'Lightly Played', price: 250, available: true }];
    expect(pickVariant(listing({ price: 2.5, extra: { rawCondition: 'SP / LP' } }), goblin)?.id).toBe(2);
  });

  it('uses the variant id in the Listing link when there is one', () => {
    expect(pickVariant(listing(), shuffle, '203')?.id).toBe(203);
  });
});

describe('checkShopifyCart', () => {
  const noWait = new Throttle(0);

  it('builds a cart link to the cart page with confirmed lines only', async () => {
    const items = [
      { listing: listing({ id: 'a', price: 5 }), qty: 1, name: 'Lightning Bolt' },
      { listing: listing({ id: 'b', price: 5, url: 'https://shuffleandcutgames.co.nz/products/sold-out', extra: { rawCondition: 'SP / LP' } }), qty: 1, name: 'Sold Out Card' },
      { listing: listing({ id: 'c', price: 6.5, url: 'https://shuffleandcutgames.co.nz/products/pricey' }), qty: 2, name: 'Pricier Now' },
    ];
    const r = await checkShopifyCart('shuffle-and-cut', 'Shuffle and Cut', items, async url => {
      if (url.includes('sold-out')) return { status: 200, body: { variants: [{ id: 9, title: 'Lightly Played', price: 500, available: false }] } };
      if (url.includes('pricey')) return { status: 200, body: { variants: [{ id: 7, title: 'Near Mint', price: 700, available: true }] } };
      return { status: 200, body: { variants: shuffle } };
    }, noWait);
    expect(r.lines.map(l => l.status)).toEqual(['ok', 'unavailable', 'price-changed']);
    expect(r.lines[2].currentPrice).toBe(7);
    expect(r.cartUrl).toBe('https://shuffleandcutgames.co.nz/cart/100:1,7:2?storefront=true');
  });

  it('falls back for a password-protected shop', async () => {
    const r = await checkShopifyCart('xp', 'XP Games', [{ listing: listing(), qty: 1, name: 'x' }], async () => ({ status: 200, redirectedTo: 'https://xpgames.co.nz/password' }), noWait);
    expect(r.cartUrl).toBeNull();
    expect(r.fallbackReason).toMatch(/password/);
  });

  it('marks lines it cannot confirm, and links nothing when none are confirmed', async () => {
    const r = await checkShopifyCart('s', 'S', [{ listing: listing({ url: 'https://x.test/cards/1' }), qty: 1, name: 'x' }], async () => ({ status: 404 }), noWait);
    expect(r.lines[0].status).toBe('unconfirmed');
    expect(r.cartUrl).toBeNull();
  });
});
