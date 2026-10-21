// Dividing an order between CardKingdom and the NZ Stores. CardKingdom joins the problem as one more Store whose
// postage is its shipping (with GST) and whose prices are converted to NZD; it doesn't count toward the Store limit.
import type { Catalogue } from '../catalogue/catalogue';
import type { Finish } from '../core/types';
import type { RungSolver } from '../optimiser/ladder';
import { pruneDominated, round2, type Problem } from '../optimiser/problem';
import type { SplitView, SweepView } from '../shared/api';
import { cardKingdomOffers, cardKingdomPaidNzd, type CardKingdomContext } from './cardKingdom';
import type { Prepared } from './planner';

export const CK_STORE_ID = 'cardkingdom';

export interface SplitOptions {
  allowFoils: boolean;
  shippingUsd: number;
  timeLimitS: number;
}

/**
 * The cheapest way to buy the list from at most `k` NZ Stores (plus preferred ones) and CardKingdom, against buying it
 * all from those NZ Stores (`nzOnly`) or all from CardKingdom.
 */
export async function splitWithCardKingdom(
  prep: Prepared, catalogue: Catalogue, ck: CardKingdomContext, k: number, nzOnly: number, planId: number, opts: SplitOptions, solve: RungSolver,
): Promise<SplitView | { error: string }> {
  const buyByKey = new Map(prep.buy.map(b => [b.key, b]));
  const problem: Problem = { lines: prep.problem.lines, stores: [...prep.problem.stores], offers: [...prep.problem.offers] };
  const ckStore = problem.stores.length;
  const shippingNzd = round2(cardKingdomPaidNzd(ck, opts.shippingUsd));
  problem.stores.push({ id: CK_STORE_ID, postage: shippingNzd, freeOver: null, free: true });

  const ckOffers = new Map<string, { line: number; printingId: string; finish: Finish; usd: number; paid: number; url: string }>();
  let ckOnly: number | null = 0;
  problem.lines.forEach((line, li) => {
    const b = buyByKey.get(line.key)!;
    let need = line.need;
    for (const o of cardKingdomOffers(b, catalogue, ck, opts.allowFoils)) {
      const id = `ck:${o.printingId}:${o.finish}`;
      const paid = cardKingdomPaidNzd(ck, o.entry.usd);
      ckOffers.set(id, { line: li, printingId: o.printingId, finish: o.finish, usd: o.entry.usd, paid, url: o.entry.url });
      problem.offers.push({ id, line: li, store: ckStore, price: paid, qty: o.entry.qty });
      if (need > 0) {
        const q = Math.min(need, o.entry.qty);
        need -= q;
        if (ckOnly !== null) ckOnly += q * paid;
      }
    }
    if (need > 0) ckOnly = null;
  });
  if (ckOnly !== null) ckOnly = round2(ckOnly + shippingNzd);

  const outcome = await solve(pruneDominated(problem), k, { timeLimitS: opts.timeLimitS });
  if (outcome.kind !== 'optimal' && outcome.kind !== 'timed-out') return { error: "Couldn't work out a split in time. Try again." };
  const pruned = pruneDominated(problem);
  const plan = outcome.plan;

  const ckItems: NonNullable<SplitView['ck']>['items'] = [];
  const nzCards = new Map<number, number>();
  for (const [i, qty] of plan.take) {
    const o = pruned.offers[i];
    if (o.store === ckStore) {
      const c = ckOffers.get(o.id)!;
      const b = buyByKey.get(pruned.lines[o.line].key)!;
      const printing = catalogue.getPrinting(c.printingId);
      ckItems.push({
        buyKey: b.key, lineIds: b.lineIds, name: b.name, qty, priceUsd: c.usd, priceNzd: c.paid, finish: c.finish,
        label: printing ? `${printing.setName} #${printing.collectorNumber}` : '', url: c.url,
      });
    } else {
      nzCards.set(o.store, (nzCards.get(o.store) ?? 0) + qty);
    }
  }
  ckItems.sort((a, b) => a.name.localeCompare(b.name));
  const subtotalUsd = round2(ckItems.reduce((s, i) => s + i.priceUsd * i.qty, 0));
  const ckPlanStore = plan.stores.find(s => s.store === ckStore);
  const nzStores = plan.stores.filter(s => s.store !== ckStore).map(s => ({
    id: pruned.stores[s.store].id, name: prep.stores[s.store]?.name ?? pruned.stores[s.store].id, subtotal: s.subtotal, postage: s.postage, cards: nzCards.get(s.store) ?? 0,
  })).sort((a, b) => b.subtotal - a.subtotal);
  const nzTotal = round2(nzStores.reduce((s, x) => s + x.subtotal + x.postage, 0));
  return {
    k, planId, status: outcome.kind, nzOnly, ckOnly, split: plan.total, saves: round2(nzOnly - plan.total),
    ck: ckItems.length && ckPlanStore
      ? { items: ckItems, subtotalUsd, shippingUsd: opts.shippingUsd, shippingNzd, cardsNzd: ckPlanStore.subtotal, totalNzd: round2(ckPlanStore.subtotal + ckPlanStore.postage) }
      : null,
    nz: { stores: nzStores, total: nzTotal },
  };
}

/** The problem without some lines (Store numbering unchanged). */
function withoutLines(p: Problem, drop: ReadonlySet<number>): Problem {
  const to = new Map<number, number>();
  const lines = p.lines.filter((_, i) => !drop.has(i));
  p.lines.forEach((_, i) => {
    if (!drop.has(i)) to.set(i, to.size);
  });
  return { lines, stores: p.stores, offers: p.offers.filter(o => to.has(o.line)).map(o => ({ ...o, line: to.get(o.line)! })) };
}

/**
 * Moves the Plan's dearest cards to CardKingdom one at a time, most expensive first, and totals each step: CardKingdom
 * for the moved cards (one shipping charge) plus the best NZ Plan for the rest with at most `k` Stores.
 */
export async function sweepCardKingdom(
  prep: Prepared, catalogue: Catalogue, ck: CardKingdomContext, k: number, planCostByKey: ReadonlyMap<string, number>, planId: number, opts: SplitOptions, solve: RungSolver,
): Promise<SweepView | { error: string }> {
  const buyByKey = new Map(prep.buy.map(b => [b.key, b]));
  const shippingNzd = round2(cardKingdomPaidNzd(ck, opts.shippingUsd));
  // Cards CardKingdom can supply in full, dearest first (by what the NZ Plan pays for them).
  const order = prep.problem.lines.flatMap((line, li) => {
    const b = buyByKey.get(line.key)!;
    let need = line.need;
    let cost = 0;
    let usd = 0;
    for (const o of cardKingdomOffers(b, catalogue, ck, opts.allowFoils)) {
      const q = Math.min(need, o.entry.qty);
      need -= q;
      cost += q * cardKingdomPaidNzd(ck, o.entry.usd);
      usd += q * o.entry.usd;
      if (!need) break;
    }
    return need > 0 ? [] : [{ line: li, buyKey: b.key, lineIds: b.lineIds, name: b.name, qty: line.need, ckNzd: round2(cost), ckUsd: round2(usd), planNzd: round2(planCostByKey.get(b.key) ?? 0) }];
  }).sort((a, b) => b.planNzd - a.planNzd);

  const m = order.length;
  const steps = new Set<number>([0, m]);
  for (let n = 1; n <= Math.min(m, 20); n++) steps.add(n);
  for (let n = 20; n < m; n += Math.max(1, Math.ceil((m - 20) / 10))) steps.add(n);
  const counts = [...steps].sort((a, b) => a - b);

  const points = await Promise.all(counts.map(async n => {
    const moved = order.slice(0, n);
    const ckCards = round2(moved.reduce((s, o) => s + o.ckNzd, 0));
    const ckTotal = n ? round2(ckCards + shippingNzd) : 0;
    const rest = withoutLines(prep.problem, new Set(moved.map(o => o.line)));
    let nzTotal = 0;
    let status: 'optimal' | 'timed-out' = 'optimal';
    if (rest.lines.length) {
      const out = await solve(pruneDominated(rest), k, { timeLimitS: Math.min(opts.timeLimitS, 4) });
      if (out.kind !== 'optimal' && out.kind !== 'timed-out') return null;
      nzTotal = out.plan.total;
      status = out.kind;
    }
    return { n, ckTotal, nzTotal, total: round2(ckTotal + nzTotal), status };
  }));
  const done = points.filter((p): p is NonNullable<typeof p> => p !== null);
  if (!done.length) return { error: "Couldn't work out the comparison in time. Try again." };
  const best = done.reduce((b, p, i) => (p.total < done[b].total - 1e-9 ? i : b), 0);
  return {
    k, planId, shippingUsd: opts.shippingUsd,
    order: order.map(o => ({ buyKey: o.buyKey, lineIds: o.lineIds, name: o.name, qty: o.qty, nzd: o.planNzd, ckNzd: o.ckNzd, ckUsd: o.ckUsd })),
    points: done, best,
  };
}
