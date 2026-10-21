import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalogue } from '../catalogue/catalogue';
import type { Finish } from '../core/types';
import type { BuyLine } from '../core/wantList';
import type { CardKingdomView } from '../shared/api';
import type { ExchangeRate } from './exchangeRate';
import { USER_AGENT } from './paths';

const PRICELIST_URL = 'https://api.cardkingdom.com/api/v2/pricelist';
const SITE = 'https://www.cardkingdom.com/';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CkEntry {
  usd: number;
  qty: number;
  url: string;
}

const key = (printingId: string, finish: Finish) => `${printingId}:${finish}`;
const cents = (n: number) => Math.round(n * 100) / 100;

export class CardKingdomPrices {
  private entries = new Map<string, CkEntry>();
  private fetchedAt = 0;
  private refreshing: Promise<void> | null = null;
  private readonly path: string | null;

  constructor(dataDir: string | null, private readonly fetchFn: typeof fetch = fetch) {
    this.path = dataDir ? join(dataDir, 'cardkingdom-prices.json') : null;
    if (this.path && existsSync(this.path)) {
      try {
        const saved = JSON.parse(readFileSync(this.path, 'utf8'));
        this.entries = new Map(saved.entries);
        this.fetchedAt = Number(saved.fetchedAt) || 0;
      } catch {
        this.entries = new Map();
      }
    }
  }

  get ready() {
    return this.entries.size > 0;
  }

  get(printingId: string, finish: Finish): CkEntry | undefined {
    return this.entries.get(key(printingId, finish));
  }

  replace(rows: { printingId: string; finish: Finish; entry: CkEntry }[]) {
    this.entries = new Map(rows.map(r => [key(r.printingId, r.finish), r.entry]));
    this.fetchedAt = Date.now();
  }

  refreshIfStale(): Promise<void> {
    if (Date.now() - this.fetchedAt < MAX_AGE_MS) return Promise.resolve();
    this.refreshing ??= this.refresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async refresh() {
    try {
      const res = await this.fetchFn(PRICELIST_URL, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(180_000) });
      if (!res.ok) return;
      const body = await res.json();
      const next = new Map<string, CkEntry>();
      for (const row of body.data ?? []) {
        const usd = Number(row.price_retail);
        const qty = Number(row.qty_retail);
        if (!row.scryfall_id || !(usd > 0) || !(qty > 0)) continue;
        const k = key(row.scryfall_id, row.is_foil === 'true' || row.is_foil === true ? 'foil' : 'nonfoil');
        const cur = next.get(k);
        if (!cur || usd < cur.usd) next.set(k, { usd, qty, url: SITE + String(row.url ?? '') });
      }
      if (!next.size) return;
      this.entries = next;
      this.fetchedAt = Date.now();
      if (this.path) {
        const tmp = `${this.path}.tmp`;
        writeFileSync(tmp, JSON.stringify({ fetchedAt: this.fetchedAt, entries: [...next] }));
        renameSync(tmp, this.path);
      }
    } catch {
      return;
    }
  }
}

export interface CardKingdomContext {
  prices: CardKingdomPrices;
  usdToNzd: number;
  /** Add 15% NZ GST, so CardKingdom's price compares fairly with NZ prices that include it. */
  gst?: boolean;
}

export class CardKingdom {
  constructor(readonly prices: CardKingdomPrices, private readonly rate: ExchangeRate) {}

  async refresh() {
    await Promise.all([this.prices.refreshIfStale(), this.rate.refreshIfStale()]);
  }

  context(): CardKingdomContext | null {
    return this.prices.ready ? { prices: this.prices, usdToNzd: this.rate.usdToNzd } : null;
  }
}

export const FLAG_MIN_NZD = 5;
export const FLAG_MARGIN = 0.3;
export const GST_RATE = 0.15;

const withGst = (ck: CardKingdomContext, nzd: number) => (ck.gst ? nzd * (1 + GST_RATE) : nzd);

export function cardKingdomUnitNzd(ck: CardKingdomContext, catalogue: Catalogue, oracleId: string, finish: Finish): number | null {
  if (finish === 'etched') return null;
  const usd = Math.min(
    Infinity,
    ...catalogue.printingsOf(oracleId).filter(p => !p.nonTournament).flatMap(p => {
      const entry = ck.prices.get(p.id, finish);
      return entry ? [entry.usd] : [];
    }),
  );
  return Number.isFinite(usd) ? cents(withGst(ck, usd * ck.usdToNzd)) : null;
}

export function overCardKingdom(priceNzd: number, ckNzd: number | null): boolean {
  return ckNzd !== null && priceNzd > FLAG_MIN_NZD && priceNzd > ckNzd * (1 + FLAG_MARGIN);
}

export interface CardKingdomOptions {
  allowFoils: boolean;
  shippingUsd: number;
}

/** What CardKingdom sells of one line (a locked Printing, or any Printing), cheapest first. */
export function cardKingdomOffers(line: BuyLine, catalogue: Catalogue, ck: CardKingdomContext, allowFoils: boolean) {
  const candidates = line.lock
    ? [{ printingId: line.lock.printingId, finish: line.lock.finish }]
    : catalogue.printingsOf(line.oracleId)
        .filter(p => !p.nonTournament)
        .flatMap(p => (['nonfoil', ...(allowFoils ? ['foil'] : [])] as Finish[]).filter(f => p.finishes.includes(f)).map(finish => ({ printingId: p.id, finish })));
  return candidates
    .flatMap(c => {
      const entry = ck.prices.get(c.printingId, c.finish);
      return entry ? [{ ...c, entry }] : [];
    })
    .sort((a, b) => a.entry.usd - b.entry.usd);
}

/** A price in NZD as the buyer pays it: converted from USD, with NZ GST when that is on. */
export function cardKingdomPaidNzd(ck: CardKingdomContext, usd: number): number {
  return cents(withGst(ck, usd * ck.usdToNzd));
}

export function compareAtCardKingdom(buy: BuyLine[], catalogue: Catalogue, ck: CardKingdomContext, opts: CardKingdomOptions): CardKingdomView {
  const items: CardKingdomView['items'] = [];
  const missing: CardKingdomView['missing'] = [];
  for (const line of buy) {
    const offers = cardKingdomOffers(line, catalogue, ck, opts.allowFoils);
    let need = line.quantity;
    for (const o of offers) {
      if (need <= 0) break;
      const qty = Math.min(need, o.entry.qty);
      need -= qty;
      const printing = catalogue.getPrinting(o.printingId);
      items.push({
        buyKey: line.key,
        name: line.name,
        qty,
        priceUsd: o.entry.usd,
        priceNzd: cents(o.entry.usd * ck.usdToNzd),
        finish: o.finish,
        label: printing ? `${printing.setName} #${printing.collectorNumber}` : '',
        url: o.entry.url,
      });
    }
    if (need > 0) missing.push({ buyKey: line.key, name: line.name, missing: need });
  }
  const subtotalUsd = cents(items.reduce((s, i) => s + i.priceUsd * i.qty, 0));
  const shippingUsd = items.length ? opts.shippingUsd : 0;
  const totalUsd = cents(subtotalUsd + shippingUsd);
  const beforeGstNzd = totalUsd * ck.usdToNzd;
  return {
    usdToNzd: ck.usdToNzd,
    items,
    missing,
    subtotalUsd,
    shippingUsd,
    totalUsd,
    gstNzd: cents(withGst(ck, beforeGstNzd) - beforeGstNzd),
    totalNzd: cents(withGst(ck, beforeGstNzd)),
  };
}
