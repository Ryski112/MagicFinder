// Browse by Store: every Store that has some of the Want List, and for each, every card it has in stock with all its
// Printings and finishes, set against CardKingdom's price and the average across Stores.
import { useMemo, useState } from 'react';
import type { Lock, LadderView, OfferView, ShopView } from '../../shared/api';
import { costAtStore, fillAtStore, printingCount } from '../planCards';
import { cartLabel, cartTarget, type CartItem, type CartTarget } from './CartDialog';
import { ActionsToggle, AustraliaTag, Button, CardImage, cx, HoverCard, largeImage, ListingButton, money, PreferButton, PriceAndListing, printingsLabel, Star, SourceBadge, Tag } from './ui';

const panel = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800';

/** A card to plan from a Store, with the Printing the buyer chose there (none: any). */
export interface StorePick {
  buyKey: string;
  oracleId: string;
  lineIds: string[];
  lock: Lock | null;
}

interface Stocked {
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

interface ShopRow {
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

function Delta({ price, ref, label }: { price: number; ref: number | null; label: string }) {
  const v = versus(price, ref);
  if (!v || ref === null) return <span className="text-slate-400">—</span>;
  return (
    <span className={cx('tabnum text-xs', v.pct <= 0 ? 'text-emerald-600 dark:text-emerald-400' : v.pct > 30 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500')}
      title={`${label} ${money(ref)}`}>
      {v.text} <span className="text-slate-400">{label}</span>
    </span>
  );
}

export function ShopsView({ ladder, onBuyAll, onPrefer, onExclude, onRemove, onCart, preferred }: {
  ladder: LadderView;
  /** Take a card off the Want List. */
  onRemove: (name: string, lineIds: string[]) => void;
  /** Put cards from a Store in its cart. */
  onCart: (target: CartTarget) => void;
  /** Plan these cards from this Store. */
  onBuyAll: (picks: StorePick[], storeId: string) => void;
  onPrefer: (shop: ShopView) => void;
  onExclude: (shop: ShopView) => void;
  preferred: Record<string, string>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // On a narrow screen the list folds away to the open Store, so the Store's cards aren't pushed below 100 others.
  const [listOpen, setListOpen] = useState(false);
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
  // The first Store in the list is open until the buyer picks one, so the page is never empty.
  const current = visible.find(r => r.shop.id === selected) ?? visible[0] ?? null;
  const wanted = ladder.cards.length;

  return (
    <section className="grid lg:grid-cols-[300px_minmax(0,1fr)] gap-4 items-start">
      <div className={cx(panel, 'rounded-xl')}>
        <button type="button" onClick={() => setListOpen(!listOpen)} aria-expanded={listOpen}
          className="lg:hidden w-full flex items-center gap-2 px-3 py-2 text-left text-sm">
          <span className="flex-1 min-w-0">
            <span className="block text-xs text-slate-500">Store {current ? `${visible.indexOf(current) + 1} of ${visible.length}` : ''} with your cards</span>
            <span className="block font-semibold truncate">{current?.shop.name ?? 'Pick a Store'}</span>
          </span>
          <span className="text-indigo-600 dark:text-indigo-400 text-xs whitespace-nowrap">{listOpen ? 'Done ▴' : 'Change Store ▾'}</span>
        </button>
        <div className={cx(!listOpen && 'hidden', 'lg:block border-t lg:border-t-0 border-slate-200 dark:border-slate-800')}>
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
              <button type="button" onClick={() => { setSelected(r.shop.id); setListOpen(false); }} aria-pressed={current === r}
                className={cx('w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60', current === r && 'bg-indigo-50 dark:bg-indigo-950/40')}>
                <div className="flex items-center gap-2">
                  {preferred[r.shop.id] && <Star on className="w-3.5 h-3.5" />}
                  <span className="font-medium truncate flex-1">{r.shop.name}</span>
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
      </div>

      <div className="space-y-3 min-w-0">
        
        {current && <ShopDetail key={current.shop.id} row={current} wanted={wanted} showMissing={showMissing} onToggleMissing={() => setShowMissing(!showMissing)}
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
          onBuyAll={onBuyAll} onPrefer={onPrefer} onExclude={onExclude} onRemove={onRemove} onCart={onCart} isPreferred={!!preferred[current.shop.id]} />}
      </div>
    </section>
  );
}

function ShopDetail({ skipped, onSkip, chosen, onChoose, row, wanted, missing, showMissing, onToggleMissing, onBuyAll, onPrefer, onExclude, onRemove, onCart, isPreferred }: {
  skipped: Record<string, true>; onSkip: (buyKeys: string[], skip: boolean) => void;
  chosen: Record<string, string>; onChoose: (buyKey: string, listingId: string | null) => void;
  row: ShopRow; wanted: number; missing: { buyKey: string; name: string; qty: number }[]; showMissing: boolean; onToggleMissing: () => void;
  onBuyAll: (picks: StorePick[], storeId: string) => void; onPrefer: (s: ShopView) => void; onExclude: (s: ShopView) => void;
  onRemove: (name: string, lineIds: string[]) => void; onCart: (target: CartTarget) => void; isPreferred: boolean;
}) {
  const { shop, stocked } = row;
  const [actionsOpen, setActionsOpen] = useState<string | null>(null);
  const [printingsOpen, setPrintingsOpen] = useState<string | null>(null);
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
  // The ticked cards' Listings, as the cart gets them: the chosen Printing, else the cheapest copies here.
  const cartItems = buyable.flatMap((c): CartItem[] => {
    const o = choice(c);
    const fill = o ? [{ offer: o, qty: c.qty }] : fillAtStore(c.offers, shop.id, c.qty) ?? [];
    return fill.map(f => ({ listingId: f.offer.listingId, name: c.name, qty: f.qty, price: f.offer.price, url: f.offer.url }));
  });
  const avgTotal = buyable.length && buyable.every(c => c.average !== null) ? Math.round(buyable.reduce((s, c) => s + (c.average ?? 0) * c.qty, 0) * 100) / 100 : null;
  // Drawn like a Store section of the By Store Plan: the plan button where the cart button sits, totals on the right.
  return (
    // Sized by the panel, not the window: it sits beside the Store list, so a wide window doesn't make it wide.
    <div className={cx(panel, 'rounded-xl @container')}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 rounded-t-xl">
        {shop.storeUrl ? <a href={shop.storeUrl} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{shop.name} ↗</a> : <span className="font-semibold">{shop.name}</span>}
        {shop.city && <span className="text-sm text-slate-500">{shop.city}</span>}
        {shop.country === 'AU' && <AustraliaTag shipsToNz={shop.shipsToNz} estimated={shop.postageEstimated} />}
        {shop.sources.map(s => <SourceBadge key={s} source={s} />)}
        {/* The cart note sits under the whole row, so the buttons stay in line. */}
        <div className="ml-auto flex flex-col items-end gap-0.5">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button variant="link" className="text-xs" onClick={() => onExclude(shop)}>🚫 {shop.country === 'AU' && !shop.shipsToNz ? "Doesn't ship to NZ" : 'Exclude Store'}</Button>
          <PreferButton on={isPreferred} onClick={() => onPrefer(shop)} storeName={shop.name} />
          <Button variant="primary" disabled={!buyable.length}
            title={`Makes ${shop.name} the Store for these ${buyable.length} cards in your Plan`}
            onClick={() => onBuyAll(buyable.map((b): StorePick => {
              const o = choice(b);
              return { buyKey: b.buyKey, oracleId: b.oracleId, lineIds: b.lineIds, lock: o?.printingId ? { printingId: o.printingId, finish: o.finish } : null };
            }), shop.id)}>
            Plan {buyable.length === stocked.length ? 'these' : 'the'} {buyable.length} {buyable.length === 1 ? 'card' : 'cards'} from here
          </Button>
          <Button variant="accent" disabled={!cartItems.length} onClick={() => onCart(cartTarget(shop, cartItems))}
            title={`The ${buyable.length} ticked ${buyable.length === 1 ? 'card' : 'cards'}, at the Printing you chose or the cheapest here`}>
            {cartLabel(shop.cart, cartItems.length)}
          </Button>
        </div>
        {shop.cart === 'shopify' && <span className="text-[11px] text-slate-500">replaces your {shop.name} cart</span>}
        </div>
      </div>
      <div className="grid @3xl:grid-cols-[minmax(0,1fr)_230px]">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 min-w-0">
          {stocked.map(c => {
            // The chosen Printing, else the cheapest.
            const o = choice(c) ?? c.offers[0];
            // A Store's own picture is the best evidence when the title didn't settle the Printing.
            const img = o.printingId ? o.image : o.storeImage ?? o.image;
            const actions = actionsOpen === c.buyKey;
            // Closing the actions also closes the Printings they opened.
            const toggleActions = () => {
              if (actions && printingsOpen === c.buyKey) setPrintingsOpen(null);
              setActionsOpen(actions ? null : c.buyKey);
            };
            return (
              <li key={c.buyKey} className={cx('px-3 sm:px-4 py-2', skipped[c.buyKey] && 'opacity-60')}>
                <div className="flex items-center gap-2 sm:gap-3 text-sm">
                  <input type="checkbox" checked={!skipped[c.buyKey]} onChange={e => onSkip([c.buyKey], !e.target.checked)}
                    aria-label={`Plan ${c.name} from ${shop.name}`} title={`Untick to leave ${c.name} out of "Plan these cards from here"`} />
                  <HoverCard src={img} large={o.printingId ? largeImage(o.image) : img} alt={c.name} />
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={toggleActions}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabnum text-slate-500">{c.qty}×</span>
                      <span className="font-medium">{c.name}</span>
                      <Tag title={o.condition ? undefined : 'The Store did not state a condition'}>{o.condition ?? 'condition not stated'}</Tag>
                      {o.finish !== 'nonfoil' && <Tag>{o.finish === 'foil' ? 'Foil' : 'Etched'}</Tag>}
                      {!o.printingId && <Tag tone="warn" title="The title doesn't say which Printing this is: go by the Store's picture">Printing not confirmed</Tag>}
                      {costOf(c) === null && <Tag tone="warn" title="This Store (or the Printing you chose) has fewer copies than you want">not enough in stock</Tag>}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{o.label}{choice(c) ? ' · your choice' : c.offers.length > 1 ? ' · cheapest here' : ''}</div>
                  </div>
                  <ActionsToggle open={actions} onClick={toggleActions} name={c.name} title="Printings, or remove" />
                  <PriceAndListing price={o.price} url={o.url} note={<Delta price={o.price} ref={c.ck ?? c.average} label={c.ck !== null ? 'CK' : 'avg'} />} />
                </div>
                {actions && (
                  <div className="mt-2 ml-[4.5rem] flex flex-wrap gap-2">
                    <Button className="text-xs py-1" onClick={() => setPrintingsOpen(printingsOpen === c.buyKey ? null : c.buyKey)}>
                      {printingsOpen === c.buyKey ? 'Hide Printings' : printingsLabel(printingCount(c.offers))}
                    </Button>
                    {c.lineIds.length > 0 && <Button className="text-xs py-1 text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-900" onClick={() => onRemove(c.name, c.lineIds)}>Remove from my list</Button>}
                  </div>
                )}
                {printingsOpen === c.buyKey && <PrintingTiles c={c} chosen={chosen[c.buyKey] ?? null} onChoose={id => onChoose(c.buyKey, id)} />}
              </li>
            );
          })}
        </ul>
        <div className="p-4 border-t @3xl:border-t-0 @3xl:border-l border-slate-200 dark:border-slate-800 text-sm tabnum space-y-0.5">
          <div className="flex justify-between"><span>Cards ({buyable.length})</span><span>{money(cardsTotal)}</span></div>
          <div className="flex justify-between">
            <span>Postage{shop.postageEstimated && <span className="text-xs text-amber-600 dark:text-amber-400"> est.</span>}</span>
            <span>{postage === 0 ? 'Free' : money(postage)}</span>
          </div>
          <div className="flex justify-between font-semibold border-t border-slate-200 dark:border-slate-700 pt-1"><span>Store total</span><span>{money(cardsTotal + postage)}</span></div>
          {ckTotal !== null && <div className="flex justify-between text-xs text-slate-500 pt-1"><span>CardKingdom {money(ckTotal)}</span><Delta price={cardsTotal} ref={ckTotal} label="" /></div>}
          {avgTotal !== null && <div className="flex justify-between text-xs text-slate-500"><span>Average {money(avgTotal)}</span><Delta price={cardsTotal} ref={avgTotal} label="" /></div>}
          <div className="text-xs text-slate-500 pt-1">Has {row.full} of {wanted} cards{row.cards > row.full && ` (and too few copies of ${row.cards - row.full} more)`}</div>
          <div className="flex flex-wrap gap-x-3">
            <Button variant="link" className="text-xs" onClick={() => onSkip(stocked.map(s => s.buyKey), false)}>include all</Button>
            {dear.length > 0 && (
              <Button variant="link" className="text-xs" title="Unticks cards priced more than 30% above CardKingdom (or the average)"
                onClick={() => onSkip(dear.map(d => d.buyKey), true)}>
                leave out the {dear.length} dear {dear.length === 1 ? 'one' : 'ones'}
              </Button>
            )}
          </div>
        </div>
      </div>
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

/** A card's Listings at one Store, as a grid that wraps and scrolls down; clicking one chooses that Printing. */
function PrintingTiles({ c, chosen, onChoose }: { c: Stocked; chosen: string | null; onChoose: (listingId: string | null) => void }) {
  return (
    <div className="mt-2 ml-[4.5rem] grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 max-h-[28rem] overflow-y-auto p-1">
      {c.offers.map((o, n) => {
        const on = chosen === o.listingId;
        return (
          <div key={o.listingId}
            className={cx('rounded-lg border p-1.5 text-xs flex flex-col gap-1 transition',
              on ? 'border-indigo-500 ring-2 ring-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                : n === 0 ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20' : 'border-slate-200 dark:border-slate-700')}>
            <button type="button" aria-pressed={on} onClick={() => onChoose(on ? null : o.listingId)} className="block w-full text-left space-y-1"
              title={`${o.label} · ${o.condition ?? 'condition not stated'} · ${o.qty} in stock. ${on ? 'Click to un-choose.' : 'Click to choose this Printing.'}`}>
              <div className="relative">
                <CardImage src={o.storeImage ?? o.image} alt={o.label} className="w-full aspect-[5/7] rounded object-cover" />
                {o.finish !== 'nonfoil' && <span className="absolute top-1 left-1 rounded bg-indigo-600/90 text-white px-1 text-[10px]">{o.finish === 'foil' ? 'Foil' : 'Etched'}</span>}
                {on && <span className="absolute top-1 right-1 rounded-full bg-indigo-600 text-white w-5 h-5 grid place-items-center text-[11px]">✓</span>}
                {n === 0 && c.offers.length > 1 && <span className="absolute bottom-1 left-1 rounded bg-emerald-600/90 text-white px-1 text-[10px]">cheapest</span>}
              </div>
              <div className="flex items-baseline justify-between">
                <span className="tabnum font-semibold text-sm">{money(o.price)}</span>
                <span className={cx('tabnum', o.qty < c.qty ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500')}>{o.qty} in stock</span>
              </div>
              <div className="truncate text-slate-600 dark:text-slate-300" title={o.label}>{o.label}</div>
              {!o.printingId && <div className="text-amber-600 dark:text-amber-400" title="The title doesn't say which Printing this is: go by the Store's picture">Printing not confirmed</div>}
              <div className="text-slate-500">{o.condition ?? 'cond. not stated'}</div>
              <div><Delta price={o.price} ref={o.cardKingdomNzd} label="CK" /></div>
              <div><Delta price={o.price} ref={c.average} label="avg" /></div>
            </button>
            <ListingButton url={o.url} className="mt-auto w-full" />
          </div>
        );
      })}
    </div>
  );
}
