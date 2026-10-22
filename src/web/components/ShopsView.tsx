// Browse by Store: every Store that has some of the Want List, and for each, every card it has in stock with all its
// Printings and finishes, set against CardKingdom's price and the average across Stores.
import { useMemo, useState } from 'react';
import type { Lock, LadderView, OfferView, ShopView } from '../../shared/api';
import { costAtStore } from '../planCards';
import { ShopDetailVariant, StorePickerB, usePlanVariant } from './PlanViews.prototype';
import { AustraliaTag, Button, CardImage, cx, money, SourceBadge, Tag } from './ui';

const panel = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800';

/** A card to plan from a Store, with the Printing the buyer chose there (none: any). */
export interface StorePick {
  buyKey: string;
  oracleId: string;
  lineIds: string[];
  lock: Lock | null;
}

export interface Stocked {
  buyKey: string;
  oracleId: string;
  name: string;
  qty: number;
  image: string | null;
  lineIds: string[];
  offers: OfferView[];
  /** Copies this Store has in total. */
  have: number;
  /** Cheapest way to buy all the copies wanted here, or null when the Store has too few. */
  cost: number | null;
  /** Mean over Stores of each Store's cheapest price, per copy. */
  average: number | null;
  /** CardKingdom's price per copy, NZD with GST when that is on. */
  ck: number | null;
}

export interface ShopRow {
  shop: ShopView;
  stocked: Stocked[];
  full: number;
  cards: number;
}

/** "+12%" / "−5%" against a reference price. */
function versus(price: number, ref: number | null) {
  if (ref === null || ref <= 0) return null;
  const pct = Math.round((price / ref - 1) * 100);
  return { pct, text: pct === 0 ? 'same' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%` };
}

export function Delta({ price, ref, label }: { price: number; ref: number | null; label: string }) {
  const v = versus(price, ref);
  if (!v || ref === null) return <span className="text-slate-400">—</span>;
  return (
    <span className={cx('tabnum text-xs', v.pct <= 0 ? 'text-emerald-600 dark:text-emerald-400' : v.pct > 30 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500')}
      title={`${label} ${money(ref)}`}>
      {v.text} <span className="text-slate-400">{label}</span>
    </span>
  );
}

export function ShopsView({ ladder, onBuyAll, onPrefer, onExclude, preferred }: {
  ladder: LadderView;
  /** Plan these cards from this Store. */
  onBuyAll: (picks: StorePick[], storeId: string) => void;
  onPrefer: (shop: ShopView) => void;
  onExclude: (shop: ShopView) => void;
  preferred: Record<string, string>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [country, setCountry] = useState<'all' | 'NZ' | 'AU'>('all');
  const [showMissing, setShowMissing] = useState(false);
  // The Printing chosen for a card at a Store: "storeId|buyKey" to Listing id.
  const [chosen, setChosen] = useState<Record<string, string>>({});
  // Cards left out of "Plan these cards from here" at a Store: "storeId|buyKey".
  const [skipped, setSkipped] = useState<Record<string, true>>({});

  const rows = useMemo<ShopRow[]>(() => {
    const averages = new Map<string, number>();
    const byStore = new Map<string, Map<string, OfferView[]>>();
    for (const c of ladder.cards) {
      const cheapest = new Map<string, number>();
      for (const o of ladder.offers[c.buyKey] ?? []) {
        cheapest.set(o.storeId, Math.min(cheapest.get(o.storeId) ?? Infinity, o.price));
        let m = byStore.get(o.storeId);
        if (!m) byStore.set(o.storeId, (m = new Map()));
        m.set(c.buyKey, [...(m.get(c.buyKey) ?? []), o]);
      }
      if (cheapest.size) averages.set(c.buyKey, [...cheapest.values()].reduce((s, v) => s + v, 0) / cheapest.size);
    }
    return ladder.shops.map(shop => {
      const stocked = ladder.cards.flatMap((c): Stocked[] => {
        const offers = (byStore.get(shop.id)?.get(c.buyKey) ?? []).sort((a, b) => a.price - b.price);
        if (!offers.length) return [];
        const ck = offers.find(o => o.cardKingdomNzd !== null)?.cardKingdomNzd ?? null;
        return [{
          buyKey: c.buyKey, oracleId: c.oracleId, name: c.name, qty: c.qty, image: c.image, lineIds: c.lineIds, offers, have: offers.reduce((s, o) => s + o.qty, 0),
          cost: costAtStore(offers, shop.id, c.qty), average: averages.get(c.buyKey) ?? null, ck,
        }];
      });
      return { shop, stocked, full: stocked.filter(s => s.cost !== null).length, cards: stocked.length };
    }).sort((a, b) => b.full - a.full || b.cards - a.cards || a.shop.name.localeCompare(b.shop.name));
  }, [ladder]);

  const visible = rows.filter(r => (country === 'all' || r.shop.country === country) && r.shop.name.toLowerCase().includes(filter.toLowerCase()));
  const current = rows.find(r => r.shop.id === selected) ?? null;
  const wanted = ladder.cards.length;
  const variant = usePlanVariant();
  const Detail = variant === 'now' ? ShopDetail : ShopDetailVariant;

  const picker = variant === 'B';
  return (
    <section className={picker ? 'space-y-4' : 'grid md:grid-cols-[300px_minmax(0,1fr)] gap-4 items-start'}>
      {picker && <StorePickerB rows={visible} selected={selected} onSelect={setSelected} filter={filter} onFilter={setFilter} country={country} onCountry={setCountry} wanted={wanted} preferred={preferred} />}
      {!picker && (
      <div className={cx(panel, 'rounded-xl')}>
        <div className="p-3 space-y-2 border-b border-slate-200 dark:border-slate-800">
          <div className="font-semibold">Stores with your cards ({visible.length})</div>
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find a Store" aria-label="Find a Store"
            className="block w-full border rounded-md px-2 py-1 text-sm bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600" />
          <div className="flex gap-1 text-xs" role="group" aria-label="Country">
            {(['all', 'NZ', 'AU'] as const).map(c => (
              <button key={c} type="button" aria-pressed={country === c} onClick={() => setCountry(c)}
                className={cx('px-2 py-0.5 rounded-full border', country === c ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 dark:border-slate-600')}>
                {c === 'all' ? 'All' : c}
              </button>
            ))}
          </div>
        </div>
        <ul className="max-h-[70vh] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {visible.map(r => (
            <li key={r.shop.id}>
              <button type="button" onClick={() => setSelected(r.shop.id)} aria-pressed={selected === r.shop.id}
                className={cx('w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60', selected === r.shop.id && 'bg-indigo-50 dark:bg-indigo-950/40')}>
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate flex-1">{preferred[r.shop.id] ? '★ ' : ''}{r.shop.name}</span>
                  {r.shop.country === 'AU' && <Tag tone={r.shop.shipsToNz ? 'plain' : 'warn'} title={r.shop.shipsToNz ? 'Ships to NZ' : r.shop.shipsToNz === false ? "Doesn't ship to NZ" : 'May not ship to NZ'}>AU</Tag>}
                </div>
                <div className="text-xs text-slate-500 tabnum">
                  {r.full} of {wanted} cards{r.cards > r.full ? ` (+${r.cards - r.full} short)` : ''}{r.shop.city ? ` · ${r.shop.city}` : ''}
                </div>
              </button>
            </li>
          ))}
          {!visible.length && <li className="px-3 py-4 text-sm text-slate-500">No Store matches.</li>}
        </ul>
      </div>
      )}

      <div className="space-y-3 min-w-0">
        {!current && <div className={cx(panel, 'rounded-xl p-6 text-slate-500')}>Pick a Store to see every card of your list it has in stock, with each Printing and finish.</div>}
        {current && <Detail variant={variant} row={current} wanted={wanted} showMissing={showMissing} onToggleMissing={() => setShowMissing(!showMissing)}
          missing={ladder.cards.filter(c => !current.stocked.some(s => s.buyKey === c.buyKey))}
          chosen={Object.fromEntries(Object.entries(chosen).filter(([k]) => k.startsWith(`${current.shop.id}|`)).map(([k, v]) => [k.slice(current.shop.id.length + 1), v]))}
          onChoose={(buyKey, listingId) => setChosen(m => {
            const { [`${current.shop.id}|${buyKey}`]: _gone, ...rest } = m;
            return listingId ? { ...rest, [`${current.shop.id}|${buyKey}`]: listingId } : rest;
          })}
          skipped={Object.fromEntries(Object.keys(skipped).filter(k => k.startsWith(`${current.shop.id}|`)).map(k => [k.slice(current.shop.id.length + 1), true]))}
          onSkip={(buyKeys, skip) => setSkipped(m => {
            const next = { ...m };
            for (const k of buyKeys) {
              if (skip) next[`${current.shop.id}|${k}`] = true;
              else delete next[`${current.shop.id}|${k}`];
            }
            return next;
          })}
          onBuyAll={onBuyAll} onPrefer={onPrefer} onExclude={onExclude} isPreferred={!!preferred[current.shop.id]} />}
      </div>
    </section>
  );
}

function ShopDetail({ skipped, onSkip, chosen, onChoose, row, wanted, missing, showMissing, onToggleMissing, onBuyAll, onPrefer, onExclude, isPreferred }: {
  skipped: Record<string, true>; onSkip: (buyKeys: string[], skip: boolean) => void;
  chosen: Record<string, string>; onChoose: (buyKey: string, listingId: string | null) => void;
  row: ShopRow; wanted: number; missing: { buyKey: string; name: string; qty: number }[]; showMissing: boolean; onToggleMissing: () => void;
  onBuyAll: (picks: StorePick[], storeId: string) => void; onPrefer: (s: ShopView) => void; onExclude: (s: ShopView) => void; isPreferred: boolean;
}) {
  const { shop, stocked } = row;
  const choice = (c: Stocked) => c.offers.find(o => o.listingId === chosen[c.buyKey]) ?? null;
  // A chosen Printing is the only one bought, so it must have all the copies wanted.
  const costOf = (c: Stocked) => {
    const o = choice(c);
    return o ? (o.qty >= c.qty ? Math.round(o.price * c.qty * 100) / 100 : null) : c.cost;
  };
  const buyable = stocked.filter(s => costOf(s) !== null && !skipped[s.buyKey]);
  // Dear here: more than 30% above CardKingdom's price, or above the average when CardKingdom is off.
  const dear = stocked.filter(c => {
    const o = choice(c) ?? c.offers[0];
    const ref = c.ck ?? c.average;
    return costOf(c) !== null && ref !== null && o.price > ref * 1.3 && o.price > 1;
  });
  const cardsTotal = Math.round(buyable.reduce((s, c) => s + (costOf(c) ?? 0), 0) * 100) / 100;
  const postage = shop.freeOver !== null && cardsTotal >= shop.freeOver ? 0 : shop.postage;
  const ckTotal = buyable.every(c => c.ck !== null) && buyable.length ? Math.round(buyable.reduce((s, c) => s + (c.ck ?? 0) * c.qty, 0) * 100) / 100 : null;
  const avgTotal = buyable.length && buyable.every(c => c.average !== null) ? Math.round(buyable.reduce((s, c) => s + (c.average ?? 0) * c.qty, 0) * 100) / 100 : null;
  return (
    <div className={cx(panel, 'rounded-xl')}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 rounded-t-xl">
        {shop.storeUrl ? <a href={shop.storeUrl} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{shop.name} ↗</a> : <span className="font-semibold">{shop.name}</span>}
        {shop.city && <span className="text-sm text-slate-500">{shop.city}</span>}
        {shop.country === 'AU' && <AustraliaTag shipsToNz={shop.shipsToNz} estimated={shop.postageEstimated} />}
        {shop.sources.map(s => <SourceBadge key={s} source={s} />)}
        <div className="ml-auto flex items-center gap-3">
          <Button variant="link" className="text-xs" onClick={() => onPrefer(shop)}>{isPreferred ? '★ Preferred' : '☆ Prefer'}</Button>
          <Button variant="link" className="text-xs" onClick={() => onExclude(shop)}>🚫 {shop.country === 'AU' && !shop.shipsToNz ? "Doesn't ship to NZ" : 'Exclude Store'}</Button>
        </div>
      </div>
      <div className="px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm border-b border-slate-100 dark:border-slate-800">
        <div>Has <span className="font-semibold">{row.full} of {wanted}</span> cards{row.cards > row.full && <span className="text-slate-500"> (and fewer copies than you want of {row.cards - row.full} more)</span>}</div>
        <div className="tabnum">Cheapest copies <span className="font-semibold">{money(cardsTotal)}</span> + postage {postage === 0 ? 'free' : money(postage)}{shop.postageEstimated && <span className="text-amber-600 dark:text-amber-400"> (est.)</span>}</div>
        {ckTotal !== null && <div className="tabnum text-slate-500">CardKingdom for these: {money(ckTotal)} <Delta price={cardsTotal} ref={ckTotal} label="vs CK" /></div>}
        {avgTotal !== null && <div className="tabnum text-slate-500">Average price: {money(avgTotal)} <Delta price={cardsTotal} ref={avgTotal} label="vs avg" /></div>}
        <Button variant="accent" className="ml-auto" disabled={!buyable.length}
          title={`Makes ${shop.name} the Store for these ${buyable.length} cards in your Plan`}
          onClick={() => onBuyAll(buyable.map((b): StorePick => {
            const o = choice(b);
            return { buyKey: b.buyKey, oracleId: b.oracleId, lineIds: b.lineIds, lock: o?.printingId ? { printingId: o.printingId, finish: o.finish } : null };
          }), shop.id)}>
          Plan {buyable.length === stocked.length ? 'these' : 'the'} {buyable.length} {buyable.length === 1 ? 'card' : 'cards'} from here
        </Button>
      </div>
      {stocked.length > 0 && (
        <div className="px-4 py-2 flex flex-wrap items-center gap-3 text-xs text-slate-500 border-b border-slate-100 dark:border-slate-800">
          <span>Untick a card to leave it out of "Plan these cards from here".</span>
          <Button variant="link" className="text-xs" onClick={() => onSkip(stocked.map(s => s.buyKey), false)}>include all</Button>
          {dear.length > 0 && (
            <Button variant="link" className="text-xs" title="Unticks cards priced more than 30% above CardKingdom (or the average)"
              onClick={() => onSkip(dear.map(d => d.buyKey), true)}>
              leave out the {dear.length} dear {dear.length === 1 ? 'one' : 'ones'}
            </Button>
          )}
        </div>
      )}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {stocked.map(c => (
          <li key={c.buyKey} className={cx('px-4 py-3', skipped[c.buyKey] && 'opacity-60')}>
            <div className="grid sm:grid-cols-[170px_minmax(0,1fr)] gap-x-4 gap-y-2">
            <div className="text-sm">
              <label className="flex items-center gap-1.5 text-xs text-slate-500 mb-1 cursor-pointer">
                <input type="checkbox" checked={!skipped[c.buyKey]} onChange={e => onSkip([c.buyKey], !e.target.checked)} aria-label={`Plan ${c.name} from ${shop.name}`} />
                plan from here
              </label>
              <div className="flex gap-2 sm:block">
                <span className="tabnum text-slate-500">{c.qty}× </span>
                <span className="font-medium">{c.name}</span>
              </div>
              <div className="text-xs text-slate-500 tabnum space-y-0.5 mt-1">
                {c.average !== null && <div>average {money(c.average)}</div>}
                {c.ck !== null && <div>CardKingdom {money(c.ck)}</div>}
                <div>{c.offers.length} Printing{c.offers.length > 1 ? 's' : ''}{c.offers.length > 1 && ' · click one to choose it'}</div>
              </div>
              {costOf(c) === null && <Tag tone="warn" title="This Store (or the Printing you chose) has fewer copies than you want">not enough in stock</Tag>}
            </div>
            {/* One row per card: the Printings sit side by side and scroll sideways when there are many. */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {c.offers.map((o, n) => {
                const on = chosen[c.buyKey] === o.listingId;
                return (
                  <div key={o.listingId}
                    className={cx('shrink-0 w-[118px] rounded-lg border p-1.5 text-xs transition',
                      on ? 'border-indigo-500 ring-2 ring-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                        : n === 0 ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-700')}>
                    <button type="button" aria-pressed={on} onClick={() => onChoose(c.buyKey, on ? null : o.listingId)}
                      title={`${o.label} · ${o.condition ?? 'condition not stated'} · ${o.qty} in stock. ${on ? 'Click to un-choose.' : 'Click to choose this Printing.'}`}
                      className="block w-full text-left">
                      <div className="relative">
                        <CardImage src={o.storeImage ?? o.image} alt={o.label} className="w-full aspect-[5/7] rounded object-cover" />
                        {o.finish !== 'nonfoil' && <span className="absolute top-1 left-1 rounded bg-indigo-600/90 text-white px-1 text-[10px]">{o.finish === 'foil' ? 'Foil' : 'Etched'}</span>}
                        {on && <span className="absolute top-1 right-1 rounded-full bg-indigo-600 text-white w-5 h-5 grid place-items-center text-[11px]">✓</span>}
                        {n === 0 && c.offers.length > 1 && <span className="absolute bottom-1 left-1 rounded bg-emerald-600/90 text-white px-1 text-[10px]">cheapest</span>}
                      </div>
                      <div className="mt-1 flex items-baseline justify-between">
                        <span className="tabnum font-semibold text-sm">{money(o.price)}</span>
                        <span className={cx('tabnum', o.qty < c.qty ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500')}>{o.qty}×</span>
                      </div>
                      <div className="truncate text-slate-600 dark:text-slate-300">{o.label}</div>
                      {!o.printingId && <div className="text-amber-600 dark:text-amber-400" title="The title doesn't say which Printing this is: go by the Store's picture">Printing not confirmed</div>}
                      <div className="text-slate-500">{o.condition ?? 'cond. not stated'}</div>
                      <div className="mt-0.5 space-y-0.5">
                        <div><Delta price={o.price} ref={o.cardKingdomNzd} label="CK" /></div>
                        <div><Delta price={o.price} ref={c.average} label="avg" /></div>
                      </div>
                    </button>
                    <a href={o.url} target="_blank" rel="noreferrer" className="mt-1 block text-indigo-600 dark:text-indigo-400 hover:underline">View listing ↗</a>
                  </div>
                );
              })}
            </div>
            </div>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 text-sm">
          <Button variant="link" className="text-xs" onClick={onToggleMissing} aria-expanded={showMissing}>
            {showMissing ? 'hide' : 'show'} {missing.length} card{missing.length > 1 ? 's' : ''} this Store doesn't have
          </Button>
          {showMissing && <div className="mt-1 text-slate-500 text-xs">{missing.map(m => `${m.qty}× ${m.name}`).join(', ')}</div>}
        </div>
      )}
    </div>
  );
}
