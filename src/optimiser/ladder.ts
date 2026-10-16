// Builds the Trade-off Ladder: a draft from the heuristic straight away, then exact rungs as they finish.
// Rung k is the cheapest Plan using exactly k Stores; rungs run from the fewest covering Stores up to the cheapest
// Plan overall, and a rung that saves nothing over the one below it is hidden.
import { heuristicLadder } from './heuristic';
import { minimumStores, type RungOutcome, type SolveOptions } from './milp';
import { round2, type Plan, type Problem } from './problem';

export type RungStatus = 'refining' | 'optimal' | 'timed-out' | 'no-plan-in-time';

export interface Rung {
  k: number;
  plan: Plan | null;
  status: RungStatus;
  /** For timed-out rungs: how much cheaper a Plan might be. */
  mightSave?: number;
  /** Saving against the rung below, or null for the first rung. */
  saves: number | null;
  cheapestOverall: boolean;
}

export interface LadderState {
  rungs: Rung[];
  /** Fewest Stores that cover every obtainable card; null when no Plan exists at all. */
  kmin: number | null;
  final: boolean;
}

export type RungSolver = (p: Problem, k: number, opts: SolveOptions) => Promise<RungOutcome>;

/** What is known so far: the cheapest Plan seen for each exact Store count, and each "at most k" solve's outcome. */
export class LadderKnowledge {
  readonly byCount = new Map<number, Plan>();
  readonly solved = new Map<number, RungOutcome>();
  kmin: number | null = null;

  offer(plan: Plan) {
    const k = plan.stores.length;
    const cur = this.byCount.get(k);
    if (!cur || plan.total < cur.total - 1e-9) this.byCount.set(k, plan);
  }

  record(k: number, outcome: RungOutcome) {
    this.solved.set(k, outcome);
    if (outcome.kind === 'optimal' || outcome.kind === 'timed-out') this.offer(outcome.plan);
  }

  /** The best Plan known with at most k Stores. */
  bestAtMost(k: number): Plan | null {
    let best: Plan | null = null;
    for (const [c, p] of this.byCount) if (c <= k && (!best || p.total < best.total)) best = p;
    return best;
  }

  state(final: boolean): LadderState {
    const counts = [...this.byCount.keys()];
    if (!counts.length && this.kmin === null) return { rungs: [], kmin: null, final };
    const cheapest = [...this.byCount.values()].reduce<Plan | null>((b, p) => (!b || p.total < b.total ? p : b), null);
    const lo = this.kmin ?? Math.min(...counts);
    const hi = cheapest ? cheapest.stores.length : lo;
    // A solve for "at most K Stores" that returns a Plan with u Stores settles rung u as well as rung K.
    const settles = new Map<number, RungOutcome>();
    for (const o of this.solved.values()) {
      if (o.kind !== 'optimal' && o.kind !== 'timed-out') continue;
      const u = o.plan.stores.length;
      const cur = settles.get(u);
      if (!cur || o.kind === 'optimal' || (cur.kind === 'timed-out' && o.plan.total < cur.plan.total)) settles.set(u, o);
    }
    const rungs: Rung[] = [];
    let last: Rung | null = null;
    for (let k = lo; k <= hi; k++) {
      const plan = this.byCount.get(k) ?? null;
      const own = this.solved.get(k);
      const outcome = own?.kind === 'optimal' && own.plan.stores.length < k ? own : settles.get(k) ?? own;
      // An optimal "at most k" Plan with fewer Stores proves no k-Store Plan is cheaper: skip the rung.
      if (outcome?.kind === 'optimal' && outcome.plan.stores.length < k) continue;
      if (!plan) {
        if (outcome?.kind === 'no-plan-in-time' || (final && k === lo)) {
          rungs.push({ k, plan: null, status: 'no-plan-in-time', saves: null, cheapestOverall: false });
        }
        continue;
      }
      if (last?.plan && plan.total >= last.plan.total - 0.005) continue;
      const status: RungStatus =
        outcome?.kind === 'optimal' ? 'optimal' : outcome?.kind === 'timed-out' ? 'timed-out' : final ? 'timed-out' : 'refining';
      const rung: Rung = {
        k,
        plan,
        status,
        saves: last?.plan ? round2(last.plan.total - plan.total) : null,
        cheapestOverall: false,
      };
      if (outcome?.kind === 'timed-out') rung.mightSave = round2(Math.max(0, plan.total - outcome.bound));
      rungs.push(rung);
      last = rung;
    }
    const top = [...rungs].reverse().find(r => r.plan);
    if (top) top.cheapestOverall = true;
    return { rungs, kmin: this.kmin, final };
  }
}

export interface LadderOptions {
  solve: RungSolver;
  /** Where results are collected; pass one in to keep it for "Try longer". */
  knowledge?: LadderKnowledge;
  /** Seconds per exact rung. */
  timeLimitS?: number;
  /** Exact rungs solved at once. */
  parallel?: number;
  signal?: AbortSignal;
  onUpdate: (s: LadderState) => void;
}

export async function buildLadder(p: Problem, opts: LadderOptions): Promise<LadderState> {
  const know = opts.knowledge ?? new LadderKnowledge();
  const emit = (final = false) => {
    const s = know.state(final);
    opts.onUpdate(s);
    return s;
  };
  if (!p.lines.length) return emit(true);

  for (const plan of heuristicLadder(p).values()) know.offer(plan);
  emit();

  know.kmin = await minimumStores(p);
  if (know.kmin === null) return emit(true);
  emit();
  opts.signal?.throwIfAborted();

  const timeLimitS = opts.timeLimitS ?? 10;
  const allStores = new Set(p.offers.map(o => o.store)).size;
  // Cheapest overall settles first.
  know.record(allStores, await opts.solve(p, allStores, { timeLimitS, start: know.bestAtMost(allStores) ?? undefined }));
  emit();
  const top = know.state(false).rungs.at(-1)?.k ?? know.kmin;

  const todo: number[] = [];
  for (let k = top - 1; k >= know.kmin; k--) todo.push(k);
  const parallel = Math.max(1, opts.parallel ?? 2);
  await Promise.all(
    Array.from({ length: Math.min(parallel, todo.length) }, async () => {
      for (let k = todo.shift(); k !== undefined; k = todo.shift()) {
        opts.signal?.throwIfAborted();
        // A finished rung may already prove this one can't beat a Plan with fewer Stores.
        const outcome = await opts.solve(p, k, { timeLimitS, start: know.bestAtMost(k) ?? undefined });
        know.record(k, outcome);
        emit();
      }
    }),
  );
  return emit(true);
}
