import { describe, expect, it } from 'vitest';
import { clampQuantity, leadingQuantity } from './cardQuery';

describe('leadingQuantity', () => {
  it('reads a number before the name', () => {
    expect(leadingQuantity('4 bolt')).toEqual({ quantity: 4, rest: 'bolt' });
    expect(leadingQuantity('  12 sol ring')).toEqual({ quantity: 12, rest: 'sol ring' });
  });

  it('reads "4x" and "4 x"', () => {
    expect(leadingQuantity('4x bolt')).toEqual({ quantity: 4, rest: 'bolt' });
    expect(leadingQuantity('4 x bolt')).toEqual({ quantity: 4, rest: 'bolt' });
  });

  it('takes the number as soon as a space follows it, before any name', () => {
    expect(leadingQuantity('3 ')).toEqual({ quantity: 3, rest: '' });
  });

  it('leaves a name with no leading number alone', () => {
    expect(leadingQuantity('bolt')).toBeNull();
    expect(leadingQuantity('4')).toBeNull();
  });

  it('does not read a name that starts with a long number as a quantity', () => {
    expect(leadingQuantity('1996 World Champion')).toBeNull();
  });

  it('never gives less than one', () => {
    expect(leadingQuantity('0 bolt')).toEqual({ quantity: 1, rest: 'bolt' });
  });
});

describe('clampQuantity', () => {
  it('keeps the quantity between 1 and 99', () => {
    expect(clampQuantity(0)).toBe(1);
    expect(clampQuantity(150)).toBe(99);
    expect(clampQuantity(Number.NaN)).toBe(1);
  });
});
