import { describe, expect, it } from 'vitest';
import type { StoreRecord } from '../core/stores';
import { storeLeftOut } from './planner';

describe('storeLeftOut', () => {
  const au = (ships_to_nz: boolean | null | undefined) => ({ id: 'mtgsingles:AU/X', country: 'AU', ships_to_nz }) as StoreRecord;
  const on = { excludedStores: {}, excludeAuNoNzShipping: true };

  it("leaves out Australian Stores that don't ship to NZ, unless the buyer turns that off", () => {
    expect(storeLeftOut(au(false), on)).toBe(true);
    expect(storeLeftOut(au(false), { ...on, excludeAuNoNzShipping: false })).toBe(false);
  });

  it('keeps Australian Stores that ship to NZ or that nobody could check', () => {
    for (const s of [true, null, undefined]) expect(storeLeftOut(au(s), on)).toBe(false);
  });

  it('leaves out any Store the buyer excluded', () => {
    expect(storeLeftOut(au(true), { ...on, excludedStores: { 'mtgsingles:AU/X': 'X' } })).toBe(true);
    expect(storeLeftOut({ id: 'nz' } as StoreRecord, { ...on, excludedStores: { nz: 'NZ' } })).toBe(true);
  });
});
