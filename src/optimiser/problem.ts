// The optimisation problem behind the Trade-off Ladder, in a compact form that can be sent to worker threads.
// Lines are what must be bought, offers are the usable Listings, stores carry postage and free-postage thresholds.

export interface ProblemLine {
  key: string;
  /** Copies to buy (already capped at what the Stores have in total). */
  need: number;
  /** A Short Plan covers this line whatever it costs, choosing its Stores around it. */
  required?: boolean;
}

export interface ProblemStore {
  id: string;
  /** Postage charged unless the subtotal reaches freeOver (0 for pickup without a fee). */
  postage: number;
  freeOver: number | null;
  /** A preferred Store: always available, never counted toward the Store limit. */
  free?: boolean;
}

export interface Offer {
  /** Listing id. */
  id: string;
  line: number;
  store: number;
  price: number;
  qty: number;
}

export interface Problem {
  lines: ProblemLine[];
  stores: ProblemStore[];
  /** Usable offers, sorted by price within each line. */
  offers: Offer[];
}

export interface PlanStore {
  store: number;
  subtotal: number;
  postage: number;
}

export interface Plan {
  /** Copies bought from each offer, keyed by offer index. */
  take: Map<number, number>;
  stores: PlanStore[];
  cards: number;
  postage: number;
  total: number;
  /** Stores that count toward the Store limit (all but preferred Stores). */
  paid: number;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Keeps, for each (Store, line), only the cheapest offers that together cover the line's need.
 * A Store never sells a dearer copy while a cheaper one is in stock there, so the rest can't be in an optimal Plan.
 */
export function pruneDominated(p: Problem): Problem {
  const groups = new Map<string, Offer[]>();
  for (const o of p.offers) {
    const k = `${o.line}|${o.store}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(o);
  }
  const kept: Offer[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.price - b.price);
    let have = 0;
    const need = p.lines[g[0].line].need;
    for (const o of g) {
      if (have >= need) break;
      kept.push(o);
      have += o.qty;
    }
  }
  kept.sort((a, b) => a.line - b.line || a.price - b.price);
  return { ...p, offers: kept };
}

export function postageCharged(s: ProblemStore, subtotal: number): number {
  return s.freeOver !== null && subtotal >= s.freeOver - 1e-9 ? 0 : s.postage;
}

/** Builds a Plan from chosen quantities. */
export function planFrom(p: Problem, take: Map<number, number>): Plan {
  const sub = new Map<number, number>();
  let cards = 0;
  for (const [i, q] of take) {
    if (q <= 0) continue;
    const o = p.offers[i];
    const v = o.price * q;
    sub.set(o.store, (sub.get(o.store) ?? 0) + v);
    cards += v;
  }
  const stores: PlanStore[] = [...sub].map(([store, subtotal]) => ({
    store,
    subtotal: round2(subtotal),
    postage: postageCharged(p.stores[store], subtotal),
  }));
  const postage = stores.reduce((s, x) => s + x.postage, 0);
  const paid = stores.filter(s => !p.stores[s.store].free).length;
  return { take, stores, cards: round2(cards), postage: round2(postage), total: round2(cards + postage), paid };
}

/** Stores in the problem that count toward the Store limit. */
export function paidStoreIds(p: Problem, plan?: Plan): number[] {
  const all = plan ? plan.stores.map(s => s.store) : [...new Set(p.offers.map(o => o.store))];
  return all.filter(s => !p.stores[s].free);
}

/** Offer indices per line, cheapest first. */
export function offersByLine(p: Problem): number[][] {
  const by: number[][] = p.lines.map(() => []);
  p.offers.forEach((o, i) => by[o.line].push(i));
  for (const list of by) list.sort((a, b) => p.offers[a].price - p.offers[b].price);
  return by;
}

/**
 * Cheapest way to fill every line using only Stores in `open` (ignoring free-postage thresholds when choosing),
 * or null when those Stores can't supply everything.
 */
export function evaluateStoreSet(p: Problem, byLine: number[][], open: ReadonlySet<number>): Plan | null {
  const take = new Map<number, number>();
  for (let line = 0; line < p.lines.length; line++) {
    let need = p.lines[line].need;
    for (const i of byLine[line]) {
      const o = p.offers[i];
      if (!open.has(o.store) && !p.stores[o.store].free) continue;
      const q = Math.min(need, o.qty);
      take.set(i, q);
      need -= q;
      if (!need) break;
    }
    if (need) return null;
  }
  return planFrom(p, take);
}

/** What covering one copy of each line counts for: 1, or enough to outweigh every other copy together when the buyer insisted on it. */
export function coverWeights(p: Problem): number[] {
  const all = p.lines.reduce((n, l) => n + l.need, 0);
  return p.lines.map(l => (l.required ? all + 1 : 1));
}

/** How much of the list a Short Plan covers, counting the cards the buyer insisted on for more. */
export function coverScore(p: Problem, plan: Plan): number {
  const w = coverWeights(p);
  let covered = 0;
  for (const [i, q] of plan.take) covered += q * w[p.offers[i].line];
  return covered;
}

/** Copies a Plan buys. */
export function copiesIn(plan: Plan): number {
  let n = 0;
  for (const q of plan.take.values()) n += q;
  return n;
}

export function copiesWanted(p: Problem): number {
  return p.lines.reduce((n, l) => n + l.need, 0);
}

/** Like evaluateStoreSet, but buys whatever the open Stores have when they can't fill every line. */
export function evaluatePartial(p: Problem, byLine: number[][], open: ReadonlySet<number>): Plan {
  const take = new Map<number, number>();
  for (let line = 0; line < p.lines.length; line++) {
    let need = p.lines[line].need;
    for (const i of byLine[line]) {
      if (!need) break;
      const o = p.offers[i];
      if (!open.has(o.store) && !p.stores[o.store].free) continue;
      const q = Math.min(need, o.qty);
      take.set(i, q);
      need -= q;
    }
  }
  return planFrom(p, take);
}

/** Verifies a Plan buys exactly what each line needs; used by tests and as a guard on solver output. */
export function isComplete(p: Problem, plan: Plan): boolean {
  const got = p.lines.map(() => 0);
  for (const [i, q] of plan.take) {
    if (q < 0 || q > p.offers[i].qty) return false;
    got[p.offers[i].line] += q;
  }
  return got.every((g, line) => g === p.lines[line].need);
}
