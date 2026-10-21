import { describe, expect, it } from 'vitest';
import { heuristicLadder } from './heuristic';
import { minimumStores, solveRung } from './milp';
import { evaluateStoreSet, isComplete, offersByLine, pruneDominated, type Problem } from './problem';
import { syntheticProblemForBench as syntheticProblem } from './synthetic';

/** Exhaustive search over Store subsets (tiny instances only). Ignores thresholds when assigning, like the heuristic. */
function bruteBest(p: Problem): Map<number, number> {
  const byLine = offersByLine(p);
  const n = p.stores.length;
  const best = new Map<number, number>();
  for (let mask = 1; mask < 1 << n; mask++) {
    const set = new Set<number>();
    for (let i = 0; i < n; i++) if (mask & (1 << i)) set.add(i);
    const plan = evaluateStoreSet(p, byLine, set);
    if (!plan || plan.stores.length !== set.size) continue;
    const k = plan.stores.length;
    if (!best.has(k) || plan.total < best.get(k)!) best.set(k, plan.total);
  }
  return best;
}

describe('pruneDominated', () => {
  it('keeps only offers that could be bought', () => {
    const p = syntheticProblem(40, 10);
    const q = pruneDominated(p);
    expect(q.offers.length).toBeLessThan(p.offers.length);
    // The cheapest offer per (line, Store) always survives.
    for (const o of p.offers) {
      const cheapest = Math.min(...p.offers.filter(x => x.line === o.line && x.store === o.store).map(x => x.price));
      expect(q.offers.some(x => x.line === o.line && x.store === o.store && x.price === cheapest)).toBe(true);
    }
  });
});

describe('heuristicLadder', () => {
  it('produces complete Plans quickly', () => {
    const p = pruneDominated(syntheticProblem(100, 30));
    const t = Date.now();
    const ladder = heuristicLadder(p);
    expect(Date.now() - t).toBeLessThan(1500);
    expect(ladder.size).toBeGreaterThan(2);
    for (const plan of ladder.values()) expect(isComplete(p, plan)).toBe(true);
  });
});

describe('solveRung (HiGHS)', () => {
  it('is never worse than exhaustive search over Store sets', async () => {
    const p = pruneDominated(syntheticProblem(12, 7, 3));
    const brute = bruteBest(p);
    for (const [k, cost] of brute) {
      const r = await solveRung(p, k, { timeLimitS: 10 });
      expect(r.kind).toBe('optimal');
      if (r.kind !== 'optimal') continue;
      expect(isComplete(p, r.plan)).toBe(true);
      expect(r.plan.stores.length).toBeLessThanOrEqual(k);
      expect(r.plan.total).toBeLessThanOrEqual(cost + 1e-6);
    }
  });

  it('uses free-postage thresholds when they pay off', async () => {
    const p: Problem = {
      lines: [{ key: 'a', need: 1 }, { key: 'b', need: 1 }],
      stores: [{ id: 'A', postage: 6, freeOver: 20 }, { id: 'B', postage: 6, freeOver: null }],
      offers: [
        { id: 'a@A', line: 0, store: 0, price: 12, qty: 1 },
        { id: 'b@A', line: 1, store: 0, price: 9, qty: 1 },
        { id: 'b@B', line: 1, store: 1, price: 7, qty: 1 },
      ],
    };
    const r = await solveRung(p, 2, { timeLimitS: 5 });
    expect(r.kind === 'optimal' && r.plan.total).toBe(21); // both from A, free postage beats 12+6+7+6
  });

  it('reports infeasible rungs', async () => {
    // Each Store stocks two of the three cards, so no single Store covers the list.
    const p: Problem = {
      lines: [{ key: 'a', need: 1 }, { key: 'b', need: 1 }, { key: 'c', need: 1 }],
      stores: [0, 1, 2].map(i => ({ id: `S${i}`, postage: 6, freeOver: null })),
      offers: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [0, 2]].map(([line, store], i) => ({ id: `o${i}`, line, store, price: 3, qty: 1 })),
    };
    const kmin = await minimumStores(p);
    expect(kmin).toBe(2);
    expect((await solveRung(p, kmin! - 1, { timeLimitS: 5 })).kind).toBe('infeasible');
    expect((await solveRung(p, kmin!, { timeLimitS: 10 })).kind).not.toBe('infeasible');
  });

  it('accepts a heuristic start and returns a Plan at least as cheap', async () => {
    const p = pruneDominated(syntheticProblem(60, 15, 7));
    const draft = heuristicLadder(p);
    const [k, plan] = [...draft].sort((a, b) => a[0] - b[0])[0];
    const r = await solveRung(p, k, { timeLimitS: 10, start: plan });
    expect(r.kind === 'optimal' || r.kind === 'timed-out').toBe(true);
    if (r.kind === 'optimal' || r.kind === 'timed-out') expect(r.plan.total).toBeLessThanOrEqual(plan.total + 1e-6);
  });
});

describe('a required card in a Short Plan', () => {
  const problem = (required: boolean): Problem => ({
    lines: [{ key: 'a', need: 1 }, { key: 'b', need: 1 }, { key: 'c', need: 1, required }],
    stores: [{ id: 'A', postage: 0, freeOver: null }, { id: 'B', postage: 0, freeOver: null }],
    offers: [
      { id: 'a@A', line: 0, store: 0, price: 5, qty: 1 },
      { id: 'b@A', line: 1, store: 0, price: 5, qty: 1 },
      { id: 'c@B', line: 2, store: 1, price: 30, qty: 1 },
    ],
  });

  const bought = (p: Problem, take: Map<number, number>) => [...take.keys()].map(i => p.offers[i].id).sort();

  it('is left out when other cards fill the Store limit first', async () => {
    const p = problem(false);
    const r = await solveRung(p, 1, { timeLimitS: 10, partial: true });
    expect(r.kind).toBe('optimal');
    if (r.kind === 'optimal') expect(bought(p, r.plan.take)).toEqual(['a@A', 'b@A']);
  });

  it('chooses the Stores around it when the buyer insists', async () => {
    const p = problem(true);
    const r = await solveRung(p, 1, { timeLimitS: 10, partial: true });
    expect(r.kind).toBe('optimal');
    if (r.kind === 'optimal') expect(bought(p, r.plan.take)).toEqual(['c@B']);
  });
});

describe('a card only a preferred Store has in a Short Plan', () => {
  it('is covered from the preferred Store', async () => {
    const p: Problem = {
      lines: [{ key: 'a', need: 1 }, { key: 'b', need: 1 }],
      stores: [{ id: 'P', postage: 0, freeOver: null, free: true }, { id: 'X', postage: 0, freeOver: null }],
      offers: [
        { id: 'a@P', line: 0, store: 0, price: 20, qty: 1 },
        { id: 'a@X', line: 0, store: 1, price: 2, qty: 1 },
        { id: 'b@X', line: 1, store: 1, price: 4, qty: 1 },
      ],
    };
    const r = await solveRung(p, 0, { timeLimitS: 10, partial: true });
    expect(r.kind).toBe('optimal');
    if (r.kind === 'optimal') expect([...r.plan.take.keys()].map(i => p.offers[i].id)).toEqual(['a@P']);
  });
});
