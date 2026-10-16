// Times a full Trade-off Ladder on a synthetic 100-card instance, using the worker pool.
import { syntheticProblemForBench } from '../src/optimiser/synthetic';
import { buildLadder } from '../src/optimiser/ladder';
import { pruneDominated } from '../src/optimiser/problem';
import { SolverPool } from '../src/optimiser/pool';

const [cards = 100, stores = 40, seed = 1] = process.argv.slice(2).map(Number);
const p = pruneDominated(syntheticProblemForBench(cards, stores, seed));
const pool = new SolverPool();
const t0 = Date.now();
let first = 0;
const final = await buildLadder(p, {
  solve: pool.solve, timeLimitS: 10, parallel: pool.size,
  onUpdate: s => {
    if (!first && s.rungs.length) first = Date.now() - t0;
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, s.rungs.map(r => `${r.k}:${r.plan?.total ?? '-'}${r.status[0]}`).join(' '));
  },
});
console.log(`offers ${p.offers.length}, workers ${pool.size}, draft after ${first} ms, final after ${((Date.now() - t0) / 1000).toFixed(1)} s, kmin ${final.kmin}`);
await pool.close();
