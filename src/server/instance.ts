// One MagicFinder at a time: a second launch opens the copy that's already running instead of starting another on
// the next port. Decided in "Which packaging approach, and where do friends download it?".
import { createServer } from 'node:net';

export type PortChoice = { free: number } | { running: number };

function isFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const s = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

async function isMagicFinder(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1500) });
    return ((await res.json()) as { app?: string }).app === 'MagicFinder';
  } catch {
    return false;
  }
}

/** Walks the ports from `start`: a running MagicFinder wins, otherwise the first free port. */
export async function choosePort(start: number, count = 20): Promise<PortChoice> {
  for (let p = start; p < start + count; p++) {
    if (await isFree(p)) return { free: p };
    if (await isMagicFinder(p)) return { running: p };
  }
  throw new Error('No free port found');
}
