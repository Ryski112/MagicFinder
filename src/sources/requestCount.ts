// Each day's requests per Source, so the owner can see the volume in hosted mode's container log. There's no daily
// ceiling. Decided in "How far can sharing stretch the Sources' rate limits in hosted mode?" and "Does the owner need
// controls friends shouldn't have?".

/** The NZ calendar day of an instant, e.g. "2026-10-21". */
export function nzDay(epochMs: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit' }).format(epochMs);
}

export class DailyRequestCount {
  private day: string;
  private counts = new Map<string, number>();
  /** Hears each finished day's line; nothing is logged until main.ts sets it (hosted mode only). */
  onDayEnd: ((line: string) => void) | null = null;

  constructor(private readonly now: () => number = Date.now) {
    this.day = nzDay(now());
  }

  /** One request sent to `source`. */
  count(source: string) {
    this.rollover();
    this.counts.set(source, (this.counts.get(source) ?? 0) + 1);
  }

  /** Reports the previous day once the date has changed. Called on each request and now and then by a timer. */
  rollover() {
    const today = nzDay(this.now());
    if (today === this.day) return;
    this.onDayEnd?.(this.line());
    this.day = today;
    this.counts.clear();
  }

  /** e.g. "Source requests on 2026-10-21: MtgSingles 412, Fetch TCG 230". */
  line(): string {
    const parts = [...this.counts].map(([s, n]) => `${s} ${n}`);
    return `Source requests on ${this.day}: ${parts.length ? parts.join(', ') : 'none'}`;
  }
}

export const requestCount = new DailyRequestCount();
