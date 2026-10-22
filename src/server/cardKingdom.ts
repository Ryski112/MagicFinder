import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalogue, Printing } from '../catalogue/catalogue';
import { CONDITION_RANK } from '../core/eligibility';
import type { Condition, Finish } from '../core/types';
import type { BuyLine } from '../core/wantList';
import type { CardKingdomView } from '../shared/api';
import type { ExchangeRate } from './exchangeRate';
import { USER_AGENT } from './paths';

const PRICELIST_URL = 'https://api.cardkingdom.com/api/v2/pricelist';
const SITE = 'https://www.cardkingdom.com/';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Bumped when the saved file's shape changes; an older file is ignored and fetched again. */
const CACHE_VERSION = 2;

/** CardKingdom's grades on the app's condition scale: EX is about LP, VG about MP, G about HP. */
const CK_CONDITIONS: [prefix: string, condition: Condition][] = [['nm', 'NM'], ['ex', 'LP'], ['vg', 'MP'], ['g', 'HP']];

/** The copies CardKingdom has of one Printing and finish in one condition. */
export interface CkEntry {
  usd: number;
  qty: number;
  url: string;
  condition: Condition;
}

/** CardKingdom knows only foil and non-foil; it lists etched foils as foil. */
export type CkFinish = 'nonfoil' | 'foil';

const key = (printingId: string, finish: CkFinish) => `${printingId}:${finish}`;
const cents = (n: number) => Math.round(n * 100) / 100;

export class CardKingdomPrices {
  /** Per Printing and finish, one entry per condition in stock, cheapest first. */
  private entries = new Map<string, CkEntry[]>();
  private fetchedAt = 0;
  private refreshing: Promise<void> | null = null;
  private readonly path: string | null;

  constructor(dataDir: string | null, private readonly fetchFn: typeof fetch = fetch) {
    this.path = dataDir ? join(dataDir, 'cardkingdom-prices.json') : null;
    if (this.path && existsSync(this.path)) {
      try {
        const saved = JSON.parse(readFileSync(this.path, 'utf8'));
        if (saved.version === CACHE_VERSION) {
          this.entries = new Map(saved.entries);
          this.fetchedAt = Number(saved.fetchedAt) || 0;
        }
      } catch {
        this.entries = new Map();
      }
    }
  }

  get ready() {
    return this.entries.size > 0;
  }

  /** The conditions CardKingdom has in stock of a Printing and finish, cheapest first. */
  get(printingId: string, finish: CkFinish): readonly CkEntry[] {
    return this.entries.get(key(printingId, finish)) ?? [];
  }

  /** For tests: an entry without a condition is NM. */
  replace(rows: { printingId: string; finish: CkFinish; entry: Omit<CkEntry, 'condition'> & { condition?: Condition } }[]) {
    const next = new Map<string, CkEntry[]>();
    for (const r of rows) add(next, key(r.printingId, r.finish), { condition: 'NM', ...r.entry });
    this.entries = next;
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
      const next = new Map<string, CkEntry[]>();
      for (const row of body.data ?? []) {
        if (!row.scryfall_id) continue;
        const k = key(row.scryfall_id, row.is_foil === 'true' || row.is_foil === true ? 'foil' : 'nonfoil');
        const url = SITE + String(row.url ?? '');
        // price_retail is the NM price but qty_retail counts every condition, so each condition is priced on its own.
        for (const [prefix, condition] of CK_CONDITIONS) {
          const usd = Number(row.condition_values?.[`${prefix}_price`]);
          const qty = Number(row.condition_values?.[`${prefix}_qty`]);
          if (usd > 0 && qty > 0) add(next, k, { usd, qty, url, condition });
        }
      }
      if (!next.size) return;
      this.entries = next;
      this.fetchedAt = Date.now();
      if (this.path) {
        const tmp = `${this.path}.tmp`;
        writeFileSync(tmp, JSON.stringify({ version: CACHE_VERSION, fetchedAt: this.fetchedAt, entries: [...next] }));
        renameSync(tmp, this.path);
      }
    } catch {
      return;
    }
  }
}

/** Adds an entry, keeping the cheaper where two rows share a condition, cheapest first. */
function add(map: Map<string, CkEntry[]>, k: string, entry: CkEntry) {
  const list = map.get(k) ?? [];
  const same = list.findIndex(e => e.condition === entry.condition);
  if (same >= 0 && list[same].usd <= entry.usd) return;
  if (same >= 0) list.splice(same, 1);
  list.push(entry);
  list.sort((a, b) => a.usd - b.usd);
  map.set(k, list);
}

export interface CardKingdomContext {
  prices: CardKingdomPrices;
  usdToNzd: number;
  /** The worst condition the buyer takes, as for NZ Listings; NM when unset. */
  minCondition?: Condition;
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
/** A bargain is at least 25% under CardKingdom, on a card CardKingdom sells for at least NZ$5. */
export const BARGAIN_MIN_NZD = 5;
export const BARGAIN_MARGIN = 0.25;
export const GST_RATE = 0.15;

const withGst = (ck: CardKingdomContext, nzd: number) => (ck.gst ? nzd * (1 + GST_RATE) : nzd);

/**
 * CardKingdom's price per copy of a line, NZD with GST when that is on: its locked Printing, or else the cheapest Printing
 * and finish CardKingdom has. Every Listing of the line is compared against this one price, whatever its own Printing.
 */
export function cardKingdomUnitNzd(ck: CardKingdomContext, catalogue: Catalogue, line: CardKingdomLine, allowFoils: boolean): number | null {
  const cheapest = cardKingdomOffers(line, catalogue, ck, allowFoils)[0];
  return cheapest ? cardKingdomPaidNzd(ck, cheapest.entry.usd) : null;
}

export function overCardKingdom(priceNzd: number, ckNzd: number | null): boolean {
  return ckNzd !== null && priceNzd > FLAG_MIN_NZD && priceNzd > ckNzd * (1 + FLAG_MARGIN);
}

export function underCardKingdom(priceNzd: number, ckNzd: number | null): boolean {
  return ckNzd !== null && ckNzd >= BARGAIN_MIN_NZD && priceNzd <= ckNzd * (1 - BARGAIN_MARGIN);
}

export interface CardKingdomOptions {
  allowFoils: boolean;
  shippingUsd: number;
}

export type CardKingdomLine = Pick<BuyLine, 'oracleId' | 'lock'>;

/**
 * The finish a CardKingdom copy of a Printing has, or null when it doesn't fit the Printing. CardKingdom only knows foil
 * and non-foil, so its foil of an etched-only Printing is the etched foil; and when Scryfall knows a Printing in just one
 * finish, CardKingdom's word is taken for the copy it actually sells.
 */
function cardKingdomFinish(printing: Printing, ckFinish: CkFinish): Finish | null {
  const finish: Finish = ckFinish === 'foil' && !printing.finishes.includes('foil') && printing.finishes.includes('etched') ? 'etched' : ckFinish;
  return printing.finishes.includes(finish) || printing.finishes.length === 1 ? finish : null;
}

/** What CardKingdom sells of one line (a locked Printing, or any Printing) in a condition the buyer takes, cheapest first. */
export function cardKingdomOffers(line: CardKingdomLine, catalogue: Catalogue, ck: CardKingdomContext, allowFoils: boolean) {
  const lock = line.lock;
  const printings = lock
    ? [catalogue.getPrinting(lock.printingId)].filter((p): p is Printing => !!p)
    : catalogue.printingsOf(line.oracleId).filter(p => !p.nonTournament);
  const ckFinishes: CkFinish[] = lock || allowFoils ? ['nonfoil', 'foil'] : ['nonfoil'];
  const worst = CONDITION_RANK[ck.minCondition ?? 'NM'];
  return printings
    .flatMap(p => ckFinishes.flatMap(ckFinish => {
      const finish = cardKingdomFinish(p, ckFinish);
      if (!finish || (lock && finish !== lock.finish)) return [];
      return ck.prices.get(p.id, ckFinish)
        .filter(entry => CONDITION_RANK[entry.condition] <= worst)
        .map(entry => ({ printingId: p.id, finish, entry }));
    }))
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
        condition: o.entry.condition,
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
