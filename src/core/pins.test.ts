import { describe, expect, it } from 'vitest';
import { applyPin } from './pins';

const listing = (store: string, quantity: number) => ({ store, quantity });
const storeOf = (l: { store: string }) => l.store;

describe('applyPin', () => {
  const all = [listing('a', 1), listing('b', 2), listing('b', 1), listing('c', 5)];

  it('leaves the listings alone when nothing is pinned', () => {
    expect(applyPin(all, undefined, storeOf, 3)).toEqual(all);
  });

  it('restricts the card to the pinned Store when it can supply every copy', () => {
    expect(applyPin(all, 'b', storeOf, 3)).toEqual([listing('b', 2), listing('b', 1)]);
  });

  it('ignores a pin to a Store that cannot supply every copy', () => {
    expect(applyPin(all, 'a', storeOf, 2)).toEqual(all);
  });

  it('ignores a pin to a Store that does not have the card', () => {
    expect(applyPin(all, 'z', storeOf, 1)).toEqual(all);
  });
});
