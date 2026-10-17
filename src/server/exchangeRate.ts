import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { USER_AGENT } from './paths';

const RATE_URL = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=NZD';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const FALLBACK_USD_TO_NZD = 1.7;

export class ExchangeRate {
  usdToNzd = FALLBACK_USD_TO_NZD;
  private fetchedAt = 0;
  private readonly path: string;
  private refreshing: Promise<void> | null = null;

  constructor(dataDir: string, private readonly fetchFn: typeof fetch = fetch) {
    this.path = join(dataDir, 'exchange-rate.json');
    if (existsSync(this.path)) {
      try {
        const saved = JSON.parse(readFileSync(this.path, 'utf8'));
        if (typeof saved.usdToNzd === 'number' && saved.usdToNzd > 0) {
          this.usdToNzd = saved.usdToNzd;
          this.fetchedAt = Number(saved.fetchedAt) || 0;
        }
      } catch {
        this.fetchedAt = 0;
      }
    }
  }

  refreshIfStale(): Promise<void> {
    if (Date.now() - this.fetchedAt < MAX_AGE_MS) return Promise.resolve();
    this.refreshing ??= this.refresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async refresh() {
    try {
      const res = await this.fetchFn(RATE_URL, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return;
      const rate = (await res.json())?.rates?.NZD;
      if (typeof rate !== 'number' || !(rate > 0)) return;
      this.usdToNzd = rate;
      this.fetchedAt = Date.now();
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify({ usdToNzd: rate, fetchedAt: this.fetchedAt }));
      renameSync(tmp, this.path);
    } catch {
      return;
    }
  }
}
