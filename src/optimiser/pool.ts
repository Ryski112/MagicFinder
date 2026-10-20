// Runs exact rung solves in worker threads so the server stays responsive and rungs solve in parallel.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RungOutcome, SolveOptions } from './milp';
import type { Problem } from './problem';

interface Job {
  id: number;
  resolve: (o: RungOutcome) => void;
  reject: (e: Error) => void;
}

// The packaged build bundles the worker as worker.mjs next to the bundled server; from source it is worker.ts.
const BUNDLED_WORKER = new URL('./worker.mjs', import.meta.url);
const WORKER = existsSync(fileURLToPath(BUNDLED_WORKER)) ? BUNDLED_WORKER : new URL('./worker.ts', import.meta.url);

/**
 * Jobs waiting for a worker, taken in turns between owners (runs): the next free worker goes to the owner that has
 * waited longest since it last got one. With a single owner (the desktop's one run) this is first come first served.
 * Decided in "How do friends' searches run side by side in hosted mode?".
 */
export class TurnQueue<T> {
  private items: { owner: string; item: T }[] = [];
  /** When each owner with waiting jobs last got a worker (or first queued), as a counter. */
  private lastServed = new Map<string, number>();
  private tick = 0;

  get length() {
    return this.items.length;
  }

  push(owner: string, item: T) {
    if (!this.lastServed.has(owner)) this.lastServed.set(owner, ++this.tick);
    this.items.push({ owner, item });
  }

  shift(): T | undefined {
    if (!this.items.length) return undefined;
    let best = 0;
    for (let i = 1; i < this.items.length; i++) {
      if (this.lastServed.get(this.items[i].owner)! < this.lastServed.get(this.items[best].owner)!) best = i;
    }
    const [{ owner, item }] = this.items.splice(best, 1);
    if (this.items.some(x => x.owner === owner)) this.lastServed.set(owner, ++this.tick);
    else this.lastServed.delete(owner);
    return item;
  }
}

export class SolverPool {
  private idle: Worker[] = [];
  private busy = new Map<Worker, Job>();
  private queue = new TurnQueue<{ msg: unknown; job: Job }>();
  private nextId = 1;
  readonly size: number;

  constructor(size = Math.max(1, Math.min(4, availableParallelism() - 1))) {
    this.size = size;
  }

  private spawn(): Worker {
    const w = new Worker(WORKER);
    w.on('message', (m: { id: number; outcome?: RungOutcome; error?: string }) => {
      const job = this.busy.get(w);
      this.busy.delete(w);
      if (job) m.error ? job.reject(new Error(m.error)) : job.resolve(m.outcome!);
      this.release(w);
    });
    w.on('error', e => {
      const job = this.busy.get(w);
      this.busy.delete(w);
      job?.reject(e);
      this.idle = this.idle.filter(x => x !== w);
    });
    return w;
  }

  private release(w: Worker) {
    const next = this.queue.shift();
    if (next) {
      this.busy.set(w, next.job);
      w.postMessage(next.msg);
    } else this.idle.push(w);
  }

  /** `owner` (a run id) only matters when several runs share the pool: their jobs then take turns. */
  solve = (problem: Problem, k: number, opts: SolveOptions, owner = ''): Promise<RungOutcome> =>
    new Promise<RungOutcome>((resolve, reject) => {
      const job: Job = { id: this.nextId++, resolve, reject };
      const msg = { id: job.id, problem, k, opts };
      let w = this.idle.pop();
      if (!w && this.busy.size < this.size) w = this.spawn();
      if (w) {
        this.busy.set(w, job);
        w.postMessage(msg);
      } else this.queue.push(owner, { msg, job });
    });

  async close() {
    await Promise.all([...this.idle, ...this.busy.keys()].map(w => w.terminate()));
    this.idle = [];
    this.busy.clear();
  }
}
