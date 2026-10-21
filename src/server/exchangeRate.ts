import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { USER_AGENT } from './paths';

const RATE_URL = (from: string) => `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=NZD`;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const FALLBACK_USD_TO_NZD = 1.7;
export const FALLBACK_AUD_TO_NZD = 1.1;

export class ExchangeRate {
  usdToNzd = FALLBACK_USD_TO_NZD;
  audToNzd = FALLBACK_AUD_TO_NZD;
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
        if (typeof saved.audToNzd === 'number' && saved.audToNzd > 0) this.audToNzd = saved.audToNzd;
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
    const [usd, aud] = await Promise.all([this.fetchRate('USD'), this.fetchRate('AUD')]);
    if (usd === null && aud === null) return;
    if (usd !== null) this.usdToNzd = usd;
    if (aud !== null) this.audToNzd = aud;
    this.fetchedAt = Date.now();
    try {
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify({ usdToNzd: this.usdToNzd, audToNzd: this.audToNzd, fetchedAt: this.fetchedAt }));
      renameSync(tmp, this.path);
    } catch {
      return;
    }
  }

  private async fetchRate(from: string): Promise<number | null> {
    try {
      const res = await this.fetchFn(RATE_URL(from), { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const rate = (await res.json())?.rates?.NZD;
      return typeof rate === 'number' && rate > 0 ? rate : null;
    } catch {
      return null;
    }
  }
}
