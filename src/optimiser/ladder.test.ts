import { describe, expect, it } from 'vitest';
import { buildLadder, LadderKnowledge, type LadderState } from './ladder';
import { solveRung } from './milp';
import { pruneDominated, type Plan, type Problem } from './problem';
import { syntheticProblemForBench } from './synthetic';

const fakePlan = (stores: number, total: number): Plan => ({
  take: new Map(),
  stores: Array.from({ length: stores }, (_, i) => ({ store: i, subtotal: 0, postage: 0 })),
  cards: total,
  postage: 0,
  total,
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
