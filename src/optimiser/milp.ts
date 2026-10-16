// Exact Plans with HiGHS (WebAssembly, MIT): one MILP per rung, "at most k Stores". The model follows the optimiser
// research: split quantities, one link row per offer, free-postage thresholds as a lower bound on the subtotal.
import highsLoader from 'highs';
import { planFrom, round2, type Plan, type Problem } from './problem';

type Highs = Awaited<ReturnType<typeof highsLoader>>;
let highsPromise: Promise<Highs> | null = null;
const getHighs = () => (highsPromise ??= highsLoader());

const num = (n: number) => (Math.round(n * 1e6) / 1e6).toString();

/** CPLEX LP text for the Landed Cost model with a Store-count row named "rung". */
export function buildLp(p: Problem): string {
  const obj: string[] = [];
  const rows: string[] = [];
  const bounds: string[] = [];
  const generals: string[] = [];
  const binaries: string[] = [];
  const usedStores = [...new Set(p.offers.map(o => o.store))];

  p.offers.forEach((o, i) => {
    obj.push(`${num(o.price)} x${i}`);
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
    rows.push(` need${line}: ${terms.join(' + ')} = ${l.need}`);
  });
  for (const s of usedStores) {
    const st = p.stores[s];
    binaries.push(`y${s}`);
    if (st.freeOver === null || st.postage === 0) {
      if (st.postage > 0) obj.push(`${num(st.postage)} y${s}`);
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
    ` obj: ${obj.join(' + ') || '0'}`,
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
}

/** Solves one rung: the cheapest Plan using at most k Stores. */
export async function solveRung(p: Problem, k: number, opts: SolveOptions): Promise<RungOutcome> {
  const highs = await getHighs();
  const model = highs.createModel({ format: 'lp', data: buildLp(p) });
  try {
    model.options.set({ output_flag: false, time_limit: opts.timeLimitS, mip_rel_gap: 0.005, presolve: 'on' });
    model.changeRowBounds(model.getRowByName('rung'), -Infinity, k);
    if (opts.start) {
      const n = model.getDimensions().numCols;
      const values = new Array<number>(n).fill(0);
      for (const [i, q] of opts.start.take) values[model.getColByName(`x${i}`)] = q;
      try {
        model.setSolution({ colValue: values });
      } catch {
        // A start that doesn't fit the model is only a hint; solve without it.
      }
    }
    model.run();
    const status = model.getModelStatus();
    const C = highs.constants.modelStatus;
    if (status === C.infeasible) return { kind: 'infeasible' };
    const sol = model.getSolution();
    const hasSolution = model.info.get('primal_solution_status') === 2;
    if (!hasSolution) return status === C.timeLimit ? { kind: 'no-plan-in-time' } : { kind: 'infeasible' };
    const take = new Map<number, number>();
    p.offers.forEach((_, i) => {
      const v = Math.round(sol.colValue[model.getColByName(`x${i}`)]);
      if (v > 0) take.set(i, v);
    });
    const plan = planFrom(p, take);
    if (status === C.optimal) return { kind: 'optimal', plan };
    const bound = Number(model.info.get('mip_dual_bound'));
    return { kind: 'timed-out', plan, bound: Number.isFinite(bound) ? round2(bound) : 0 };
  } finally {
    model.dispose();
  }
}

/** The fewest Stores that can supply every line (cover MILP over Store binaries only), or null if none can. */
export async function minimumStores(p: Problem, timeLimitS = 5): Promise<number | null> {
  const stores = [...new Set(p.offers.map(o => o.store))];
  const rows = p.lines.map((l, line) => {
    const have = new Map<number, number>();
    for (const o of p.offers) if (o.line === line) have.set(o.store, (have.get(o.store) ?? 0) + o.qty);
    const terms = [...have].map(([s, q]) => `${Math.min(q, l.need)} y${s}`);
    return ` c${line}: ${terms.join(' + ') || '0 y0'} >= ${l.need}`;
  });
  const lp = ['Minimize', ` obj: ${stores.map(s => `y${s}`).join(' + ')}`, 'Subject To', ...rows, 'Binary', ` ${stores.map(s => `y${s}`).join(' ')}`, 'End', ''].join('\n');
  const highs = await getHighs();
  const res = highs.solve(lp, { time_limit: timeLimitS, output_flag: false } as any);
  if (res.Status === 'Infeasible') return null;
  if (res.Status !== 'Optimal' && res.Status !== 'Time limit reached') return null;
  return Math.round(res.ObjectiveValue);
}
