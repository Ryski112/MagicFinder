// Worker thread entry: solves one rung per message.
import { parentPort } from 'node:worker_threads';
import { solveRung } from './milp';

parentPort!.on('message', async ({ id, problem, k, opts }) => {
  try {
    parentPort!.postMessage({ id, outcome: await solveRung(problem, k, opts) });
  } catch (e) {
    parentPort!.postMessage({ id, error: (e as Error).message });
  }
});
