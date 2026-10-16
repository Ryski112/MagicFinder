import type { Problem } from './problem';

/** Deterministic random instance: `cards` lines, `stores` Stores with postage and some free-postage thresholds. */
export function syntheticProblemForBench(cards: number, stores: number, seed = 1): Problem {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const p: Problem = { lines: [], stores: [], offers: [] };
  for (let i = 0; i < stores; i++) {
    p.stores.push({ id: `s${i}`, postage: 5 + Math.round(rand() * 3), freeOver: rand() < 0.4 ? 50 + Math.round(rand() * 50) : null });
  }
  for (let c = 0; c < cards; c++) {
    p.lines.push({ key: `c${c}`, need: c < 3 ? 1 + Math.floor(rand() * 3) : 1 });
    const base = 0.5 + rand() * 20;
    for (let st = 0; st < stores; st++) {
      if (rand() < (st < 2 ? 0.8 : 0.35)) p.offers.push({ id: `o${p.offers.length}`, line: c, store: st, price: Math.round(base * (0.8 + rand() * 0.5) * 100) / 100, qty: 1 + Math.floor(rand() * 3) });
    }
  }
  // Make sure every line can be filled.
  p.lines.forEach((l, c) => p.offers.push({ id: `g${c}`, line: c, store: 0, price: 30, qty: l.need }));
  return p;
}
