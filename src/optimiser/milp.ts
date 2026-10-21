// Exact Plans with HiGHS (WebAssembly, MIT): one MILP per rung, "at most k Stores". The model follows the optimiser
// research: split quantities, one link row per offer, free-postage thresholds as a lower bound on the subtotal.
import highsLoader from 'highs';
import { copyValues, paidStoreIds, planFrom, round2, type Plan, type Problem } from './problem';

type Highs = Awaited<ReturnType<typeof highsLoader>>;
let highsPromise: Promise<Highs> | null = null;
const getHighs = () => (highsPromise ??= highsLoader());

const num = (n: number) => (Math.round(n * 1e6) / 1e6).toString();

/**
 * What a model optimises:
 * - full: buy every line, cheapest Landed Cost;
 * - cover: buy as many copies as possible (Short Plans, step 1);
 * - cost: buy at least `minCovered` copies, cheapest Landed Cost (Short Plans, step 2).
 */
export type ModelMode = { kind: 'full' } | { kind: 'cover' } | { kind: 'cost'; minCovered: number };

/** CPLEX LP text for the Landed Cost model with a Store-count row named "rung". */
export function buildLp(p: Problem, mode: ModelMode = { kind: 'full' }): string {
  const obj: string[] = [];
  const rows: string[] = [];
  const bounds: string[] = [];
  const generals: string[] = [];
  const binaries: string[] = [];
  const usedStores = [...new Set(p.offers.map(o => o.store))];

  const costs = mode.kind !== 'cover';
  p.offers.forEach((o, i) => {
    obj.push(costs ? `${num(o.price)} x${i}` : `- x${i}`);
    const ub = Math.min(o.qty, p.lines[o.line].need);
    if (ub === 1) binaries.push(`x${i}`);
    else {
      bounds.push(`0 <= x${i} <= ${ub}`);
      generals.push(`x${i}`);
    }
    rows.push(` link${i}: x${i} - ${ub} y${o.store} <= 0`);
  });
  p.lines.forEach((l, line) => {
    const terms = p.offers.map((o, i) => (o.line === line ? `x${i}` : null)).filter(Boolean);
    rows.push(` need${line}: ${terms.join(' + ')} ${mode.kind === 'full' ? '=' : '<='} ${l.need}`);
  });
  if (mode.kind === 'cost') rows.push(` covered: ${p.offers.map((_, i) => `x${i}`).join(' + ')} >= ${mode.minCovered}`);
  for (const s of usedStores) {
    const st = p.stores[s];
    binaries.push(`y${s}`);
    if (!costs || st.freeOver === null || st.postage === 0) {
      if (costs && st.postage > 0) obj.push(`${num(st.postage)} y${s}`);
      continue;
    }
    // Tier 0 pays postage; tier 1 is free but needs the subtotal to reach the threshold.
    obj.push(`${num(st.postage)} z${s}_0`);
    binaries.push(`z${s}_0`, `z${s}_1`);
    rows.push(` tier${s}: z${s}_0 + z${s}_1 - y${s} = 0`);
    const sub = p.offers.map((o, i) => (o.store === s ? `${num(o.price)} x${i}` : null)).filter(Boolean);
    rows.push(` free${s}: ${sub.join(' + ')} - ${num(st.freeOver)} z${s}_1 >= 0`);
  }
  rows.push(` rung: ${usedStores.map(s => `y${s}`).join(' + ')} <= ${usedStores.length}`);

  return [
    'Minimize',
    ` obj: ${obj.join(' + ').replace(/\+ -/g, '-') || '0'}`,
    'Subject To',
    ...rows,
    'Bounds',
    ...bounds,
    ...(generals.length ? ['General', ` ${generals.join(' ')}`] : []),
    ...(binaries.length ? ['Binary', ` ${binaries.join(' ')}`] : []),
    'End',
    '',
  ].join('\n');
}

export type RungOutcome =
  | { kind: 'optimal'; plan: Plan }
  | { kind: 'timed-out'; plan: Plan; bound: number }
  | { kind: 'no-plan-in-time' }
  | { kind: 'infeasible' };

export interface SolveOptions {
  timeLimitS: number;
  /** A starting Plan for this rung (from the heuristic). */
  start?: Plan;
  /** Short Plan: leave out the fewest copies when k Stores can't supply everything. */
  partial?: boolean;
}

interface ModelResult {
  status: 'optimal' | 'timed-out' | 'no-solution-in-time' | 'infeasible';
  take: Map<number, number>;
  objective: number;
  bound: number;
}

async function runModel(p: Problem, mode: ModelMode, k: number, timeLimitS: number, start?: Plan): Promise<ModelResult> {
  const highs = await getHighs();
  const model = highs.createModel({ format: 'lp', data: buildLp(p, mode) });
  try {
    model.options.set({ output_flag: false, time_limit: timeLimitS, mip_rel_gap: mode.kind === 'cover' ? 0 : 0.005, presolve: 'on' });
    model.changeRowBounds(model.getRowByName('rung'), -Infinity, k);
    if (start) {
      const n = model.getDimensions().numCols;
      const values = new Array<number>(n).fill(0);
      for (const [i, q] of start.take) values[model.getColByName(`x${i}`)] = q;
      try {
        model.setSolution({ colValue: values });
      } catch {
        // A start that doesn't fit the model is only a hint; solve without it.
      }
    }
    model.run();
    const status = model.getModelStatus();
    const C = highs.constants.modelStatus;
    const empty = { take: new Map<number, number>(), objective: 0, bound: 0 };
    if (status === C.infeasible) return { status: 'infeasible', ...empty };
    if (model.info.get('primal_solution_status') !== 2) return { status: status === C.timeLimit ? 'no-solution-in-time' : 'infeasible', ...empty };
    const sol = model.getSolution();
    const take = new Map<number, number>();
    p.offers.forEach((_, i) => {
      const v = Math.round(sol.colValue[model.getColByName(`x${i}`)]);
      if (v > 0) take.set(i, v);
    });
    const bound = Number(model.info.get('mip_dual_bound'));
    return { status: status === C.optimal ? 'optimal' : 'timed-out', take, objective: model.getObjectiveValue(), bound: Number.isFinite(bound) ? bound : 0 };
  } finally {
    model.dispose();
  }
}

/** Solves one rung: the cheapest Plan using at most k Stores (or, for a Short Plan, covering the most it can). */
export async function solveRung(p: Problem, k: number, opts: SolveOptions): Promise<RungOutcome> {
  if (opts.partial) return solveShort(p, k, opts);
  const r = await runModel(p, { kind: 'full' }, k, opts.timeLimitS, opts.start);
  if (r.status === 'infeasible') return { kind: 'infeasible' };
  if (r.status === 'no-solution-in-time') return { kind: 'no-plan-in-time' };
  const plan = planFrom(p, r.take);
  return r.status === 'optimal' ? { kind: 'optimal', plan } : { kind: 'timed-out', plan, bound: round2(r.bound) };
}

/** Short Plan: first the most copies k Stores can supply, then the cheapest way to buy that many. */
async function solveShort(p: Problem, k: number, opts: SolveOptions): Promise<RungOutcome> {
  const half = opts.timeLimitS / 2;
  const cover = await runModel(p, { kind: 'cover' }, k, half, opts.start);
  if (cover.status === 'infeasible' || cover.status === 'no-solution-in-time') return { kind: 'no-plan-in-time' };
  const most = Math.round(-cover.objective);
  if (most <= 0) return { kind: 'infeasible' };
  const cost = await runModel(p, { kind: 'cost', minCovered: most }, k, half, planFrom(p, cover.take));
  const take = cost.status === 'optimal' || cost.status === 'timed-out' ? cost.take : cover.take;
  const plan = planFrom(p, take);
  if (cover.status === 'optimal' && cost.status === 'optimal') return { kind: 'optimal', plan };
  return { kind: 'timed-out', plan, bound: cost.status === 'timed-out' ? round2(cost.bound) : plan.total };
}

/** The fewest Stores (not counting preferred ones) that can supply every line, or null if none can. */
export async function minimumStores(p: Problem, timeLimitS = 5): Promise<number | null> {
  const stores = paidStoreIds(p);
  const rows: string[] = [];
  for (let line = 0; line < p.lines.length; line++) {
    const need = p.lines[line].need;
    const have = new Map<number, number>();
    for (const o of p.offers) if (o.line === line) have.set(o.store, (have.get(o.store) ?? 0) + o.qty);
    let free = 0;
    const terms: string[] = [];
    for (const [s, q] of have) {
      if (p.stores[s].free) free += q;
      else terms.push(`${Math.min(q, need)} y${s}`);
    }
    if (free >= need) continue;
    if (!terms.length) return null;
    rows.push(` c${line}: ${terms.join(' + ')} >= ${need - Math.min(free, need)}`);
  }
  if (!rows.length) return 0;
  const lp = ['Minimize', ` obj: ${stores.map(s => `y${s}`).join(' + ')}`, 'Subject To', ...rows, 'Binary', ` ${stores.map(s => `y${s}`).join(' ')}`, 'End', ''].join('\n');
  const highs = await getHighs();
  const res = highs.solve(lp, { time_limit: timeLimitS, output_flag: false } as any);
  if (res.Status === 'Infeasible') return null;
  if (res.Status !== 'Optimal' && res.Status !== 'Time limit reached') return null;
  return Math.round(res.ObjectiveValue);
}
