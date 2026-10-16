// Shared politeness rules for every Source: spacing between requests, how answers are classified
// into a Source Status, and how often to retry. Decided in "What happens when a Source blocks MagicFinder?".
import { SourceError } from './types';

export interface HttpAnswer {
  status: number;
  /** Response body as text. */
  body: string;
  /** Retry-After header value, if any. */
  retryAfter?: string | null;
  contentType?: string | null;
}

const CHALLENGE = /just a moment|attention required|checking your browser|cf-chl|challenge-platform|sorry, you have been blocked/i;

/** Throws a SourceError for anything that isn't a usable answer. */
export function classify(a: HttpAnswer): void {
  if (a.status === 429) throw new SourceError('slowed', 'Asked to slow down (429)', parseRetryAfter(a.retryAfter));
  if (a.status === 403 || a.status === 401 || ((a.contentType ?? '').includes('html') && CHALLENGE.test(a.body))) {
    throw new SourceError('blocked', `Refused (${a.status}${CHALLENGE.test(a.body) ? ', bot check page' : ''})`);
  }
  if (a.status >= 500 || a.status === 0) throw new SourceError('down', `Server error (${a.status})`);
  if (a.status >= 400) throw new SourceError('changed', `Unexpected status ${a.status}`);
}

export function parseRetryAfter(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const secs = Number(v);
  if (Number.isFinite(secs)) return secs * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export interface RetryOptions {
  /** Waits; injectable so tests don't sleep. */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const MAX_WAIT = 60_000;

/**
 * Runs one Source request with the agreed retry rules:
 * Blocked: no retry. Slowed down: wait as asked, up to 3 attempts, then Blocked for this run.
 * Down: 2 retries a few seconds apart. Changed: no retry.
 */
export async function withRetries<T>(attempt: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const sleep = opts.sleep ?? realSleep;
  let slowed = 0;
  let down = 0;
  for (;;) {
    opts.signal?.throwIfAborted();
    try {
      return await attempt();
    } catch (e) {
      const err = e instanceof SourceError ? e : new SourceError('down', (e as Error).message);
      if (err.status === 'slowed') {
        if (++slowed >= 3) throw new SourceError('blocked', 'Still asked to slow down after 3 attempts');
        await sleep(Math.min(err.retryAfterMs ?? 5000 * slowed, MAX_WAIT));
        continue;
      }
      if (err.status === 'down') {
        if (++down > 2) throw err;
        await sleep(3000 * down);
        continue;
      }
      throw err;
    }
  }
}

/**
 * Maps a page of raw Listings, skipping the odd malformed one. Only when every row is unreadable is the Source
 * treated as Changed (one Store's bad data shouldn't stop the whole Source).
 */
export function mapRows<T>(rows: unknown[], map: (r: any) => T | null): T[] {
  const out: T[] = [];
  let failed = 0;
  let firstError: SourceError | null = null;
  for (const r of rows) {
    try {
      const m = map(r);
      if (m) out.push(m);
    } catch (e) {
      if (!(e instanceof SourceError)) throw e;
      failed++;
      firstError ??= e;
    }
  }
  if (rows.length && failed === rows.length) throw firstError!;
  return out;
}

/** Keeps at least `gapMs` between the starts of successive calls. */
export class Throttle {
  private next = 0;
  constructor(private readonly gapMs: number, private readonly sleep = realSleep) {}
  async wait(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.next);
    this.next = at + this.gapMs;
    if (at > now) await this.sleep(at - now);
  }
}
