import { describe, expect, it } from 'vitest';
import { buildLadder, findRunnerUp, LadderKnowledge, type LadderState } from './ladder';
import { minimumStores, solveRung } from './milp';
import { planFrom, pruneDominated, shortScore, type Plan, type Problem } from './problem';
import { syntheticProblemForBench } from './synthetic';

const fakePlan = (stores: number, total: number): Plan => ({
  take: new Map(),
  stores: Array.from({ length: stores }, (_, i) => ({ store: i, subtotal: 0, postage: 0 })),
  cards: total,
  postage: 0,
  total,
  paid: stores,
});

describe('LadderKnowledge.state', () => {
  it('runs from k_min to the cheapest Plan and hides rungs that save nothing', () => {
    const k = new LadderKnowledge();
    k.kmin = 2;
    k.offer(fakePlan(2, 100));
    k.offer(fakePlan(3, 90));
    k.offer(fakePlan(4, 95)); // dearer than 3 Stores: hidden
    k.offer(fakePlan(5, 85));
    const s = k.state(false);
    expect(s.rungs.map(r => [r.k, r.plan?.total, r.saves])).toEqual([[2, 100, null], [3, 90, 10], [5, 85, 5]]);
    expect(s.rungs.at(-1)!.cheapestOverall).toBe(true);
    expect(s.rungs.every(r => r.status === 'refining')).toBe(true);
  });

  it('marks rungs settled by an "at most K" solve as optimal', () => {
    const k = new LadderKnowledge();
    k.kmin = 1;
    k.offer(fakePlan(1, 50));
    k.record(10, { kind: 'optimal', plan: fakePlan(3, 40) });
    const s = k.state(false);
    expect(s.rungs.find(r => r.k === 3)?.status).toBe('optimal');
  });

  it('drops a rung once a solve proves fewer Stores are just as cheap', () => {
    const k = new LadderKnowledge();
    k.kmin = 1;
    k.offer(fakePlan(1, 50));
    k.offer(fakePlan(2, 45));
    k.offer(fakePlan(3, 44));
    k.record(3, { kind: 'optimal', plan: fakePlan(2, 43) });
    expect(k.state(false).rungs.map(r => r.k)).toEqual([1, 2]);
  });

  it('shows timed-out rungs with how much cheaper they might be', () => {
    const k = new LadderKnowledge();
    k.kmin = 2;
    k.record(2, { kind: 'timed-out', plan: fakePlan(2, 100), bound: 97.5 });
    const r = k.state(true).rungs[0];
    expect(r).toMatchObject({ status: 'timed-out', mightSave: 2.5 });
  });

  it('keeps a rung with no Plan found in time, never dropping it silently', () => {
    const k = new LadderKnowledge();
    k.kmin = 2;
    k.offer(fakePlan(3, 80));
    k.record(2, { kind: 'no-plan-in-time' });
    const s = k.state(true);
    expect(s.rungs[0]).toMatchObject({ k: 2, plan: null, status: 'no-plan-in-time' });
  });
});

describe('buildLadder', () => {
  it('streams a draft, then a final Ladder whose rungs are optimal and get cheaper', async () => {
    const p = pruneDominated(syntheticProblemForBench(30, 8, 5));
    const updates: LadderState[] = [];
    const final = await buildLadder(p, { solve: solveRung, timeLimitS: 10, onUpdate: s => updates.push(s) });
    expect(updates[0].rungs.length).toBeGreaterThan(0);
    expect(final.final).toBe(true);
    expect(final.rungs.every(r => r.status === 'optimal')).toBe(true);
    for (let i = 1; i < final.rungs.length; i++) expect(final.rungs[i].plan!.total).toBeLessThan(final.rungs[i - 1].plan!.total);
    expect(final.rungs[0].k).toBe(final.kmin);
  });

  it('returns an empty Ladder for an empty problem', async () => {
    const p: Problem = { lines: [], stores: [], offers: [] };
    const s = await buildLadder(p, { solve: solveRung, onUpdate: () => {} });
    expect(s).toMatchObject({ rungs: [], final: true });
  });

  it('never shows a refined price above the draft', async () => {
    const p = pruneDominated(syntheticProblemForBench(40, 10, 9));
    const seen = new Map<number, number>();
    await buildLadder(p, {
      solve: solveRung, timeLimitS: 10,
      onUpdate: s => {
        for (const r of s.rungs) {
          if (!r.plan) continue;
          if (seen.has(r.k)) expect(r.plan.total).toBeLessThanOrEqual(seen.get(r.k)! + 1e-9);
          seen.set(r.k, r.plan.total);
        }
      },
    });
  });
});

describe('Short Plans', () => {
  // Three cards; each Store stocks two of them, so the whole list needs 2 Stores.
  const p: Problem = {
    lines: [{ key: 'a', need: 1 }, { key: 'b', need: 2 }, { key: 'c', need: 1 }],
    stores: [0, 1, 2].map(i => ({ id: `S${i}`, postage: 6, freeOver: null })),
    offers: [
      { id: 'a0', line: 0, store: 0, price: 5, qty: 1 },
      { id: 'b0', line: 1, store: 0, price: 3, qty: 2 },
      { id: 'b1', line: 1, store: 1, price: 1, qty: 2 },
      { id: 'c1', line: 2, store: 1, price: 9, qty: 1 },
      { id: 'c2', line: 2, store: 2, price: 1, qty: 1 },
      { id: 'a2', line: 0, store: 2, price: 2, qty: 1 },
    ],
  };

  it('solves a 1-Store Plan that leaves out the fewest copies, then is cheapest', async () => {
    const r = await solveRung(p, 1, { timeLimitS: 5, partial: true });
    expect(r.kind).toBe('optimal');
    if (r.kind !== 'optimal') return;
    // S0 and S1 each supply 3 of the 4 copies, both for $17; S2 supplies only 2.
    expect([...r.plan.take.values()].reduce((a, b) => a + b, 0)).toBe(3);
    expect(r.plan.stores).toHaveLength(1);
    expect(r.plan.total).toBe(17);
  });

  it('puts Short Plans before the full Ladder, marked with how many cards they cover', async () => {
    const final = await buildLadder(p, { solve: solveRung, timeLimitS: 5, onUpdate: () => {} });
    expect(final.kmin).toBe(2);
    const [first, ...rest] = final.rungs;
    expect(first).toMatchObject({ k: 1, short: { covered: 3, wanted: 4 }, status: 'optimal', cheapestOverall: false });
    expect(rest[0].k).toBe(2);
    expect(rest[0].short).toBeUndefined();
  });

  it('offers Short Plans only up to 3 Stores', async () => {
    const k = new LadderKnowledge();
    k.kmin = 6;
    k.wanted = 10;
    for (let n = 1; n <= 5; n++) k.offerShort(n, fakePlan(n, 100 - n));
    expect(k.state(false).rungs.filter(r => r.short).map(r => r.k)).toEqual([1, 2, 3]);
  });
});

describe('preferred Stores and runner-up Plans', () => {
  // A is a preferred (free) Store. Without it two Stores are needed; with it, C alone (or B, dearer) is enough.
  const p: Problem = {
    lines: [{ key: 'a', need: 1 }, { key: 'b', need: 1 }, { key: 'c', need: 1 }],
    stores: [{ id: 'A', postage: 0, freeOver: null, free: true }, { id: 'B', postage: 5, freeOver: null }, { id: 'C', postage: 5, freeOver: null }, { id: 'D', postage: 5, freeOver: null }],
    offers: [
      { id: 'a@A', line: 0, store: 0, price: 1, qty: 1 },
      { id: 'a@B', line: 0, store: 1, price: 1, qty: 1 },
      { id: 'b@B', line: 1, store: 1, price: 2, qty: 1 },
      { id: 'b@C', line: 1, store: 2, price: 2, qty: 1 },
      { id: 'c@C', line: 2, store: 2, price: 3, qty: 1 },
      { id: 'c@D', line: 2, store: 3, price: 3, qty: 1 },
      { id: 'c@B', line: 2, store: 1, price: 4, qty: 1 },
    ],
  };

  it("doesn't count preferred Stores toward the Store limit", async () => {
    expect(await minimumStores(p)).toBe(1);
    const r = await solveRung(p, 1, { timeLimitS: 5 });
    expect(r.kind).toBe('optimal');
    if (r.kind !== 'optimal') return;
    expect(r.plan.paid).toBe(1);
    expect(r.plan.stores.length).toBe(2);
    expect(r.plan.postage).toBe(5);
  });

  it('can be filled by preferred Stores alone', async () => {
    const only: Problem = { lines: [{ key: 'a', need: 1 }], stores: [{ id: 'A', postage: 0, freeOver: null, free: true }], offers: [{ id: 'a@A', line: 0, store: 0, price: 4, qty: 1 }] };
    expect(await minimumStores(only)).toBe(0);
    const final = await buildLadder(only, { solve: solveRung, timeLimitS: 5, onUpdate: () => {} });
    expect(final.rungs).toHaveLength(1);
    expect(final.rungs[0]).toMatchObject({ k: 0 });
    expect(final.rungs[0].plan!.total).toBe(4);
  });

  it('finds a runner-up that uses different Stores', async () => {
    const know = new LadderKnowledge();
    await buildLadder(p, { solve: solveRung, timeLimitS: 5, knowledge: know, onUpdate: () => {} });
    expect(know.state(true).rungs[0].next).toBeUndefined();
    await findRunnerUp(p, know, 1, false, solveRung, 5);
    const final = know.state(true);
    const rung = final.rungs[0];
    expect(rung.k).toBe(1);
    const stores = (plan: Plan) => plan.stores.map(s => s.store).filter(s => !p.stores[s].free).sort();
    expect(rung.next).toBeDefined();
    expect(stores(rung.next!.plan!)).not.toEqual(stores(rung.plan!));
    expect(rung.next!.plan!.paid).toBe(1);
    expect(rung.next!.plan!.total).toBeGreaterThanOrEqual(rung.plan!.total);
  });
});
