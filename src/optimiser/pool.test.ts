import { describe, expect, it } from 'vitest';
import { TurnQueue } from './pool';

const drain = <T>(q: TurnQueue<T>) => {
  const out: T[] = [];
  for (let x = q.shift(); x !== undefined; x = q.shift()) out.push(x);
  return out;
};

describe('TurnQueue', () => {
  it('is first come first served with one owner', () => {
    const q = new TurnQueue<number>();
    for (const n of [1, 2, 3, 4]) q.push('run', n);
    expect(drain(q)).toEqual([1, 2, 3, 4]);
  });

  it('takes turns between runs, starting with the one that has waited longest', () => {
    const q = new TurnQueue<string>();
    for (const n of ['a1', 'a2', 'a3']) q.push('a', n);
    q.push('b', 'b1');
    q.push('b', 'b2');
    expect(q.shift()).toBe('a1');
    // A third run arriving now has waited less than a, which was served just before it arrived.
    q.push('c', 'c1');
    expect(drain(q)).toEqual(['b1', 'a2', 'c1', 'b2', 'a3']);
  });

  it('counts "Try longer" as just another job of that run', () => {
    const q = new TurnQueue<string>();
    q.push('a', 'a1');
    q.push('b', 'b1');
    expect(q.shift()).toBe('a1');
    q.push('a', 'a-longer');
    expect(drain(q)).toEqual(['b1', 'a-longer']);
  });
});
