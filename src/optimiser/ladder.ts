// Builds the Trade-off Ladder: a draft from the heuristic straight away, then exact rungs as they finish.
// Rung k is the cheapest Plan using exactly k Stores; rungs run from the fewest covering Stores up to the cheapest
// Plan overall, and a rung that saves nothing over the one below it is hidden. Below that, Short Plans for 1-3
// Stores leave out the fewest cards when the whole list can't fit in that many Stores.
import { heuristicLadder, shortPlanDraft } from './heuristic';
import { minimumStores, type RungOutcome, type SolveOptions } from './milp';
import { copiesIn, copiesWanted, paidStoreIds, round2, coverScore, respectsCap, type Plan, type Problem } from './problem';

/** Short Plans are offered for Store counts up to this. */
export const SHORT_PLAN_MAX_STORES = 3;

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
  /** Set on Short Plans: copies bought out of copies wanted. */
  short?: { covered: number; wanted: number };
  /** The best Plan that uses a different set of Stores: the runner-up for this rung. */
  next?: Rung;
  /** The runner-up was looked for and there is none. */
  noRunnerUp?: boolean;
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
  readonly short = new Map<number, { plan: Plan; outcome?: RungOutcome }>();
  /** Runner-up Plans by rung (see altKey); a null Plan means none exists. */
  readonly alts = new Map<string, { plan: Plan | null; outcome?: RungOutcome }>();
  kmin: number | null = null;
  wanted = 0;
  problem: Problem | null = null;

  static altKey(k: number, short: boolean) {
    return `${short ? 's' : 'f'}${k}`;
  }

  recordAlt(k: number, short: boolean, outcome: RungOutcome) {
    const plan = outcome.kind === 'optimal' || outcome.kind === 'timed-out' ? outcome.plan : null;
    this.alts.set(LadderKnowledge.altKey(k, short), { plan, outcome });
  }

  private withNext(rung: Rung): Rung {
    const alt = this.alts.get(LadderKnowledge.altKey(rung.k, !!rung.short));
    if (alt && !alt.plan) return { ...rung, noRunnerUp: true };
    if (!alt?.plan || !rung.plan) return rung;
    const o = alt.outcome;
    const next: Rung = {
      k: alt.plan.paid,
      plan: alt.plan,
      status: o?.kind === 'optimal' ? 'optimal' : 'timed-out',
      saves: round2(rung.plan.total - alt.plan.total),
      cheapestOverall: false,
      short: rung.short ? { covered: copiesIn(alt.plan), wanted: this.wanted } : undefined,
    };
    if (o?.kind === 'timed-out') next.mightSave = round2(Math.max(0, alt.plan.total - o.bound));
    return { ...rung, next };
  }

  /** Keeps the better Short Plan for k Stores: more of the list covered, then cheaper. */
  offerShort(k: number, plan: Plan | null, outcome?: RungOutcome) {
    const cur = this.short.get(k);
    if (plan && this.problem && !respectsCap(this.problem, plan)) return;
    const score = (x: Plan) => (this.problem ? coverScore(this.problem, x) : copiesIn(x));
    const better = plan && (!cur || score(plan) > score(cur.plan) || (score(plan) === score(cur.plan) && plan.total < cur.plan.total - 1e-9));
    if (better) this.short.set(k, { plan, outcome });
    else if (cur && outcome) cur.outcome = outcome;
  }

  recordShort(k: number, outcome: RungOutcome) {
    if (outcome.kind === 'optimal' || outcome.kind === 'timed-out') this.offerShort(k, outcome.plan, outcome);
    else {
      const cur = this.short.get(k);
      if (cur) cur.outcome = outcome;
    }
  }

  private shortRungs(final: boolean): Rung[] {
    if (this.kmin === null) return [];
    const out: Rung[] = [];
    for (let k = 1; k < Math.min(this.kmin, SHORT_PLAN_MAX_STORES + 1); k++) {
      const s = this.short.get(k);
      if (!s) continue;
      // A Short Plan dearer than the fewest-Stores Plan that covers everything only costs more and covers less.
      // (Cheaper Plans with more Stores don't count: fewer Stores is why a Short Plan exists. At a tie, fewer Stores wins.)
      // Only when the buyer has switched the Short Plan limit on; otherwise every Short Plan is shown.
      const full = this.problem?.shortCap != null ? this.bestAtMost(this.kmin) : null;
      if (full && full.total < s.plan.total - 1e-9) continue;
      const o = s.outcome;
      const status: RungStatus = o?.kind === 'optimal' ? 'optimal' : o?.kind === 'timed-out' || final ? 'timed-out' : 'refining';
      const rung: Rung = { k, plan: s.plan, status, saves: null, cheapestOverall: false, short: { covered: copiesIn(s.plan), wanted: this.wanted } };
      if (o?.kind === 'timed-out') rung.mightSave = round2(Math.max(0, s.plan.total - o.bound));
      out.push(this.withNext(rung));
    }
    return out;
  }

  offer(plan: Plan) {
    const k = plan.paid;
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
    const hi = cheapest ? cheapest.paid : lo;
    // A solve for "at most K Stores" that returns a Plan with u Stores settles rung u as well as rung K.
    const settles = new Map<number, RungOutcome>();
    for (const o of this.solved.values()) {
      if (o.kind !== 'optimal' && o.kind !== 'timed-out') continue;
      const u = o.plan.paid;
      const cur = settles.get(u);
      if (!cur || o.kind === 'optimal' || (cur.kind === 'timed-out' && o.plan.total < cur.plan.total)) settles.set(u, o);
    }
    const rungs: Rung[] = [];
    let last: Rung | null = null;
    for (let k = lo; k <= hi; k++) {
      const plan = this.byCount.get(k) ?? null;
      const own = this.solved.get(k);
      const outcome = own?.kind === 'optimal' && own.plan.paid < k ? own : settles.get(k) ?? own;
      // An optimal "at most k" Plan with fewer Stores proves no k-Store Plan is cheaper: skip the rung.
      if (outcome?.kind === 'optimal' && outcome.plan.paid < k) continue;
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
    return { rungs: [...this.shortRungs(final), ...rungs.map(r => this.withNext(r))], kmin: this.kmin, final };
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
  know.wanted = copiesWanted(p);
  know.problem = p;
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
  const shortCounts: number[] = [];
  for (let k = 1; k < Math.min(know.kmin, SHORT_PLAN_MAX_STORES + 1); k++) {
    shortCounts.push(k);
    know.offerShort(k, shortPlanDraft(p, k));
  }
  emit();
  opts.signal?.throwIfAborted();

  const timeLimitS = opts.timeLimitS ?? 10;
  const allStores = paidStoreIds(p).length;
  // Cheapest overall settles first.
  know.record(allStores, await opts.solve(p, allStores, { timeLimitS, start: know.bestAtMost(allStores) ?? undefined }));
  emit();
  const top = know.state(false).rungs.at(-1)?.k ?? know.kmin;

  const todo: { k: number; short: boolean }[] = [];
  for (let k = top - 1; k >= know.kmin; k--) todo.push({ k, short: false });
  for (const k of shortCounts) todo.push({ k, short: true });
  const parallel = Math.max(1, opts.parallel ?? 2);
  await Promise.all(
    Array.from({ length: Math.min(parallel, todo.length) }, async () => {
      for (let job = todo.shift(); job !== undefined; job = todo.shift()) {
        opts.signal?.throwIfAborted();
        if (job.short) {
          know.recordShort(job.k, await opts.solve(p, job.k, { timeLimitS, partial: true, start: know.short.get(job.k)?.plan }));
        } else {
          know.record(job.k, await opts.solve(p, job.k, { timeLimitS, start: know.bestAtMost(job.k) ?? undefined }));
        }
        emit();
      }
    }),
  );
  return emit(true);
}

/**
 * The runner-up for one shown rung: the best Plan whose Stores differ from every shown rung's. Asked for on demand,
 * since it costs a solve per rung and most buyers never look.
 */
export async function findRunnerUp(p: Problem, know: LadderKnowledge, k: number, short: boolean, solve: RungSolver, timeLimitS = 10): Promise<void> {
  const rungs = know.state(true).rungs.filter(r => r.plan && !!r.short === short);
  const rung = rungs.find(r => r.k === k);
  if (!rung) return;
  const outcome = await solve(p, k, { timeLimitS, partial: short, exclude: rungs.map(r => paidStoreIds(p, r.plan!)) });
  know.recordAlt(k, short, outcome);
}
