// Greedy drop + 1-swap heuristic: a draft Trade-off Ladder in well under a second, and a starting Plan for each
// exact solve. It can miss tight rungs and is a few percent above optimal, which the exact solver fixes.
import { evaluateStoreSet, offersByLine, type Plan, type Problem } from './problem';

/** Best Plan found for each Store count. */
export type PlansByCount = Map<number, Plan>;

function storesOf(plan: Plan): Set<number> {
  return new Set(plan.stores.map(s => s.store));
}

export function heuristicLadder(p: Problem, deadlineMs = 800): PlansByCount {
  const started = Date.now();
  const byLine = offersByLine(p);
  const allStores = new Set(p.offers.map(o => o.store));
  const best: PlansByCount = new Map();
  const record = (plan: Plan) => {
    const k = plan.stores.length;
    const cur = best.get(k);
    if (!cur || plan.total < cur.total) best.set(k, plan);
  };
  const evalSet = (s: Set<number>) => {
    const plan = evaluateStoreSet(p, byLine, s);
    // Stores that ended up unused are dropped, so the Plan's own Store set is what counts.
    return plan ? evaluateStoreSet(p, byLine, storesOf(plan)) : null;
  };

  let current = evalSet(allStores);
  if (!current) return best;
  record(current);

  // Local search at a fixed size: drop any Store that doesn't pay for itself, then try 1-swaps.
  const improve = (plan: Plan): Plan => {
    let cur = plan;
    for (let pass = 0; pass < 4 && Date.now() - started < deadlineMs; pass++) {
      const open = storesOf(cur);
      for (const s of open) {
        const trial = new Set(open);
        trial.delete(s);
        const t = trial.size ? evalSet(trial) : null;
        if (t) record(t);
      }
      let swapped: Plan | null = null;
      search: for (const out of open) {
        if (Date.now() - started > deadlineMs) break;
        for (const inn of allStores) {
          if (open.has(inn)) continue;
          const trial = new Set(open);
          trial.delete(out);
          trial.add(inn);
          const t = evalSet(trial);
          if (!t) continue;
          record(t);
          if (t.stores.length === cur.stores.length && t.total < cur.total - 1e-9) {
            swapped = t;
            break search;
          }
        }
      }
      if (!swapped) break;
      cur = swapped;
    }
    record(cur);
    return cur;
  };

  current = improve(current);
  // Greedy drop: remove the Store whose removal costs least, until nothing feasible is left.
  while (current.stores.length > 1 && Date.now() - started < deadlineMs) {
    let next: Plan | null = null;
    for (const s of storesOf(current)) {
      const trial = storesOf(current);
      trial.delete(s);
      const t = evalSet(trial);
      if (t && t.stores.length < current.stores.length && (!next || t.total < next.total)) next = t;
    }
    if (!next) break;
    current = improve(next);
  }
  return best;
}
