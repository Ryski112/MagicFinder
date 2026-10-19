import { describe, expect, it } from 'vitest';
import { suggestPostage, type CheckoutRate } from '../scripts/checkoutRates';

const everywhere = (rates: CheckoutRate[]) => ({ auckland: rates, north_island: rates, south_island: rates });

describe('suggestPostage', () => {
  it('takes the urban option and turns the rural one into a surcharge', () => {
    // Card Merchant Takapuna, 2026-10-19: the policy page said $5 standard post.
    const rates = everywhere([{ name: 'Courier in bag (No Rural or PO Boxes)', price: 8 }, { name: 'Rural Delivery', price: 12 }]);
    expect(suggestPostage(rates)).toEqual({ name: 'Courier in bag (No Rural or PO Boxes)', tracked: true, price: 8, rural_surcharge: 4 });
  });

  it('ignores pickup and options for boxed or non-single parcels', () => {
    const rates = everywhere([
      { name: 'In Store Pick Up', price: 0 },
      { name: 'Singles Cards Only', price: 7.99 },
      { name: 'Standard Courier (Non Single Cards)', price: 11.99 },
      { name: 'Single Cards - RURAL DELIVERY', price: 12.99 },
      { name: 'Rural Shipping for Boxed Products (Non Single Cards)', price: 20 },
    ]);
    expect(suggestPostage(rates)).toMatchObject({ price: 7.99, rural_surcharge: 5 });
  });

  it('keeps per-region prices when they differ', () => {
    const rates = { auckland: [{ name: 'Courier', price: 6.5 }], north_island: [{ name: 'Courier', price: 7.9 }], south_island: [{ name: 'Economy Tracked', price: 9.9 }] };
    expect(suggestPostage(rates)).toMatchObject({ price: { auckland: 6.5, north_island: 7.9, south_island: 9.9 } });
    expect(suggestPostage(rates)).not.toHaveProperty('rural_surcharge');
  });

  it('gives nothing when checkout offers no delivery', () => {
    expect(suggestPostage(everywhere([]))).toBeNull();
  });
});
