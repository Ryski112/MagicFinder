// PROTOTYPE (throwaway, not for main): three looks for the Plan's "By card" view and Browse by Store, so both match
// the "By Store" Plan. Question: how should these two views look so they feel like the rest of the app, with a big card
// on hover and View listing as the yellow button the Store sections use?
// Switch with ?variant=now|A|B|C on the Choose a Plan screen (`npm run prototype:plan-views`), or the bar / ← →.
//   now  the views as they are on main
//   A    Store-style sections: each card (By card) and each Store (Browse) is drawn like a By Store section: header,
//        rows like the Plan's rows with a hover card, a totals column on the right. Printings wrap instead of scrolling.
//   B    Preview column: the card-searcher lesson. The big card sits in a sticky column beside the list, so hovering
//        never covers anything; Stores are picked from rung-style cards along the top.
//   C    Gallery: readable card tiles in a wrapping grid; a card's Printings open as a full-width grid under its row of
//        tiles, like the searcher's Printings.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { OfferView, ShopView } from '../../shared/api';
import type { PlanCard } from '../planCards';
import { costAtStore } from '../planCards';
import type { ShopRow, StorePick, Stocked } from './ShopsView';
import { Delta } from './ShopsView';
import { PrototypeSwitcher } from './PrototypeSwitcher';
import { AustraliaTag, Button, CardImage, CardKingdomChip, cx, money, SourceBadge, Tag, unsure } from './ui';

const panel = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800';
const head = 'flex flex-wrap items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 rounded-t-xl';

// ---- variant state, shared by every component on the page -------------------------------------------------------

const VARIANTS = [
  { key: 'now', name: 'Current' },
  { key: 'A', name: 'Store-style sections' },
  { key: 'B', name: 'Preview column' },
  { key: 'C', name: 'Gallery' },
];
type Key = 'now' | 'A' | 'B' | 'C';
const read = (): Key => {
  const v = new URLSearchParams(window.location.search).get('variant');
  return (VARIANTS.some(x => x.key === v) ? v : 'now') as Key;
};
const subscribe = (f: () => void) => {
  window.addEventListener('plan-variant', f);
  return () => window.removeEventListener('plan-variant', f);
};
export const usePlanVariant = () => useSyncExternalStore(subscribe, read);
const go = (k: string) => {
  const u = new URL(window.location.href);
  u.searchParams.set('variant', k);
  window.history.replaceState(null, '', u);
  window.dispatchEvent(new Event('plan-variant'));
};
export function PlanVariantSwitcher() {
  return <PrototypeSwitcher variants={VARIANTS} current={usePlanVariant()} onChange={go} />;
}

// ---- small shared pieces ----------------------------------------------------------------------------------------

/** Scryfall's readable size sits at the same path as the small one. */
const big = (url: string | null | undefined) => url?.replace('/small/', '/normal/') ?? null;

/** A small card that shows the big one beside it on hover, as the By Store rows do. */
function HoverCard({ src, alt, className = 'w-10' }: { src: string | null; alt: string; className?: string }) {
  return (
    <span className="relative group shrink-0">
      <CardImage src={src} alt={alt} className={cx(className, 'aspect-[5/7] rounded')} />
      {src && (
        <span className="hidden group-hover:block absolute left-full ml-2 top-0 z-30 w-56 shadow-2xl rounded-xl overflow-hidden pointer-events-none">
          <CardImage src={big(src)} alt={alt} className="w-full aspect-[5/7]" />
        </span>
      )}
    </span>
  );
}

/** View listing as the yellow button the Store sections use for their cart. */
function ListingButton({ url, className, full }: { url: string; className?: string; full?: boolean }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
      className={cx('inline-flex items-center justify-center rounded-md bg-amber-400 text-slate-900 hover:bg-amber-300 font-semibold text-xs px-2.5 py-1 whitespace-nowrap shrink-0', full && 'w-full', className)}>
      View listing ↗
    </a>
  );
}

function worstChip(c: PlanCard) {
  const ratio = (i: PlanCard['bought'][number]['item']) => i.price / i.cardKingdomNzd!;
  const items = c.bought.map(b => b.item).filter(i => i.cardKingdomNzd !== null);
  const w = items.filter(i => i.overCardKingdom).sort((a, b) => ratio(b) - ratio(a))[0] ?? items.filter(i => i.underCardKingdom).sort((a, b) => ratio(a) - ratio(b))[0];
  return w ? <CardKingdomChip price={w.price} cardKingdomNzd={w.cardKingdomNzd!} unsure={unsure(w.condition, w.printing?.id ?? null)} /> : null;
}

function CardTags({ c }: { c: PlanCard }) {
  return (
    <>
      {c.notFound && <Tag tone="warn">{c.bought.length ? `${c.missing} not found` : 'Not found'}</Tag>}
      {!c.notFound && c.missing > 0 && <Tag tone="warn">{c.bought.length ? `${c.missing} left out of this Plan` : 'Left out of this Plan'}</Tag>}
    </>
  );
}

function OfferTags({ o }: { o: OfferView }) {
  return (
    <>
      <Tag>{o.condition ?? 'cond. not stated'}</Tag>
      {o.finish !== 'nonfoil' && <Tag>{o.finish === 'foil' ? 'Foil' : 'Etched'}</Tag>}
      {!o.printingId && <Tag tone="warn">Printing not confirmed</Tag>}
      {(o.overCardKingdom || o.underCardKingdom) && o.cardKingdomNzd !== null && <CardKingdomChip price={o.price} cardKingdomNzd={o.cardKingdomNzd} unsure={unsure(o.condition, o.printingId)} />}
    </>
  );
}

// ---- By card ----------------------------------------------------------------------------------------------------

export interface CardsVariantProps {
  cards: PlanCard[];
  offers: Record<string, OfferView[]>;
  pins: Record<string, string>;
  onPin: (buyKey: string, storeId: string | null) => void;
  onRemove: (name: string, lineIds: string[]) => void;
  onRelax: (lineIds: string[]) => void;
  /** The Plan's own Printings & Stores grid for a card. */
  printings: (c: PlanCard, close: () => void) => ReactNode;
}

export function CardsVariant(p: CardsVariantProps & { variant: Key }) {
  if (p.variant === 'A') return <CardsA {...p} />;
  if (p.variant === 'B') return <CardsB {...p} />;
  return <CardsC {...p} />;
}

/** Other Listings of a card as a wrapping grid of tiles, each with Buy here. */
function OtherListings({ c, offers, onPin }: { c: PlanCard; offers: OfferView[]; onPin: CardsVariantProps['onPin'] }) {
  const chosen = new Set(c.bought.map(b => b.item.listingId));
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2 max-h-[28rem] overflow-y-auto p-1">
      {offers.filter(o => !chosen.has(o.listingId)).map(o => {
        const canCover = costAtStore(offers, o.storeId, c.qty) !== null;
        return (
          <div key={o.listingId} className="flex flex-col gap-1 rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-xs">
            <CardImage src={o.storeImage ?? o.image} alt={o.label} className="w-full aspect-[5/7] rounded" />
            <div className="font-semibold leading-tight truncate" title={o.storeName}>{o.storeName}</div>
            <div className="truncate text-slate-500" title={o.label}>{o.label}</div>
            <div className="flex flex-wrap gap-1"><OfferTags o={o} /></div>
            <div className="flex items-baseline justify-between"><span className="tabnum font-semibold text-sm">{money(o.price)}</span><span className="text-slate-500">{o.qty} in stock</span></div>
            <ListingButton url={o.url} full />
            <Button className="w-full text-xs py-1 mt-auto" disabled={!canCover} title={canCover ? undefined : `${o.storeName} doesn't have all ${c.qty}`} onClick={() => onPin(c.buyKey, o.storeId)}>Buy here</Button>
          </div>
        );
      })}
    </div>
  );
}

function CardActions({ c, others, open, setOpen, p }: { c: PlanCard; others: number; open: 'printings' | 'others' | null; setOpen: (v: 'printings' | 'others' | null) => void; p: CardsVariantProps }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {c.lineIds.length > 0 && c.bought.length > 0 && <Button className="text-xs py-1" onClick={() => setOpen(open === 'printings' ? null : 'printings')}>{open === 'printings' ? 'Hide Printings' : 'Printings & Stores'}</Button>}
      {others > 0 && <Button className="text-xs py-1" onClick={() => setOpen(open === 'others' ? null : 'others')}>{open === 'others' ? 'Hide other Listings' : `${others} other Listing${others > 1 ? 's' : ''}`}</Button>}
      {p.pins[c.buyKey] && <Button variant="link" className="text-xs" onClick={() => p.onPin(c.buyKey, null)}>📌 Let MagicFinder choose the Store</Button>}
      {c.waivable && <Button variant="link" className="text-xs" onClick={() => p.onRelax(c.lineIds)}>Don't exclude this card</Button>}
      {c.lineIds.length > 0 && <Button className="text-xs py-1 text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-900" onClick={() => p.onRemove(c.name, c.lineIds)}>Remove from my list</Button>}
    </div>
  );
}

/** A: one section per card, drawn like a Store section of the By Store Plan. */
function CardsA(p: CardsVariantProps) {
  const [open, setOpen] = useState<{ key: string; what: 'printings' | 'others' } | null>(null);
  return (
    <div className="space-y-3">
      {p.cards.map(c => {
        const all = p.offers[c.buyKey] ?? [];
        const others = all.length - c.bought.length;
        const total = c.bought.reduce((n, b) => n + b.item.price * b.item.qty, 0);
        const what = open?.key === c.buyKey ? open.what : null;
        return (
          <div key={c.buyKey} className={cx(panel, 'rounded-xl')}>
            <div className={head}>
              <span className="tabnum text-slate-500">{c.qty}×</span>
              <span className="font-semibold">{c.name}</span>
              {worstChip(c)}
              <CardTags c={c} />
              <span className="ml-auto tabnum font-semibold">{c.bought.length ? money(total) : '—'}</span>
            </div>
            <div className="grid md:grid-cols-[minmax(0,1fr)_auto]">
              <ul className="divide-y divide-slate-100 dark:divide-slate-800 min-w-0">
                {c.bought.map(({ store, item }) => (
                  <li key={item.listingId} className="px-4 py-2 flex items-center gap-3 text-sm">
                    <HoverCard src={item.printing?.image ?? item.storeImage ?? item.fallbackImage} alt={item.name} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tabnum text-slate-500">{item.qty}×</span>
                        <span className="font-medium">{store.name}</span>
                        {store.city && <span className="text-xs text-slate-500">{store.city}</span>}
                        {store.sources.map(s => <SourceBadge key={s} source={s} />)}
                        {p.pins[c.buyKey] === store.id && <span title="You chose this Store">📌</span>}
                        <Tag>{item.condition ?? 'condition not stated'}</Tag>
                        {item.finish !== 'nonfoil' && <Tag>{item.finish === 'foil' ? 'Foil' : 'Etched'}</Tag>}
                        {!item.printing && <Tag tone="warn">Printing not confirmed</Tag>}
                      </div>
                      <div className="text-xs text-slate-500 truncate">{item.printing?.label ?? item.title}</div>
                    </div>
                    <span className="tabnum">{money(item.price)}</span>
                    <ListingButton url={item.url} />
                  </li>
                ))}
                {!c.bought.length && <li className="px-4 py-3 text-sm text-slate-500 flex items-center gap-3"><HoverCard src={c.image} alt={c.name} />No Store in this Plan has it.</li>}
              </ul>
              <div className="px-4 py-2 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 flex md:flex-col gap-2 md:w-48">
                <CardActions c={c} others={others} open={what} setOpen={w => setOpen(w ? { key: c.buyKey, what: w } : null)} p={p} />
              </div>
            </div>
            {what === 'printings' && <div className="px-4 pb-3">{p.printings(c, () => setOpen(null))}</div>}
            {what === 'others' && <div className="px-3 pb-3 border-t border-slate-100 dark:border-slate-800 pt-2"><OtherListings c={c} offers={all} onPin={p.onPin} /></div>}
          </div>
        );
      })}
    </div>
  );
}

/** B: a compact list with a sticky preview column: the big card and its Listings as yellow cards. */
function CardsB(p: CardsVariantProps) {
  const [sel, setSel] = useState<string | null>(p.cards[0]?.buyKey ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState<'printings' | 'others' | null>(null);
  const shown = p.cards.find(c => c.buyKey === (hover ?? sel)) ?? p.cards[0];
  const selected = p.cards.find(c => c.buyKey === sel) ?? null;
  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-[minmax(0,1fr)_300px] gap-3 items-start">
        <ul className={cx(panel, 'rounded-xl divide-y divide-slate-100 dark:divide-slate-800')} onMouseLeave={() => setHover(null)}>
          {p.cards.map(c => {
            const total = c.bought.reduce((n, b) => n + b.item.price * b.item.qty, 0);
            return (
              <li key={c.buyKey}>
                <button type="button" onMouseEnter={() => setHover(c.buyKey)} onClick={() => { setSel(c.buyKey); setOpen(null); }} aria-pressed={sel === c.buyKey}
                  className={cx('w-full text-left px-4 py-2 flex items-center gap-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60', sel === c.buyKey && 'bg-indigo-50 dark:bg-indigo-950/40 shadow-[inset_3px_0_0] shadow-indigo-500')}>
                  <CardImage src={c.image} alt={c.name} className="w-10 aspect-[5/7] rounded shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabnum text-slate-500">{c.qty}×</span>
                      <span className="font-medium">{c.name}</span>
                      {worstChip(c)}
                      <CardTags c={c} />
                      {p.pins[c.buyKey] && <span title="You chose this Store">📌</span>}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{c.bought.map(b => `${b.item.qty}× ${b.store.name}`).join(' · ') || '—'}</div>
                  </div>
                  <span className="tabnum">{c.bought.length ? money(total) : '—'}</span>
                </button>
              </li>
            );
          })}
        </ul>
        {shown && (
          <aside className={cx(panel, 'rounded-xl p-3 space-y-3 md:sticky md:top-4')}>
            <CardImage src={big(shown.bought[0]?.item.printing?.image ?? shown.image)} alt={shown.name} className="w-full aspect-[5/7] rounded-xl" />
            <div className="font-semibold">{shown.qty}× {shown.name}</div>
            {shown.bought.map(({ store, item }) => (
              <div key={item.listingId} className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-2 text-sm space-y-1">
                <div className="flex items-baseline gap-2"><span className="font-medium flex-1 truncate">{item.qty}× {store.name}</span><span className="tabnum font-semibold">{money(item.price)}</span></div>
                <div className="text-xs text-slate-600 dark:text-slate-300 truncate">{item.printing?.label ?? item.title}</div>
                <div className="flex flex-wrap items-center gap-1">
                  <Tag>{item.condition ?? 'cond. not stated'}</Tag>
                  {item.finish !== 'nonfoil' && <Tag>{item.finish === 'foil' ? 'Foil' : 'Etched'}</Tag>}
                  {!item.printing && <Tag tone="warn">Printing not confirmed</Tag>}
                  <ListingButton url={item.url} className="ml-auto" />
                </div>
              </div>
            ))}
            {!shown.bought.length && <div className="text-sm text-slate-500">No Store in this Plan has it.</div>}
            {selected && shown === selected && <CardActions c={selected} others={(p.offers[selected.buyKey] ?? []).length - selected.bought.length} open={open} setOpen={setOpen} p={p} />}
            {shown !== selected && <div className="text-xs text-slate-500">Click the card to choose its Printings or Store.</div>}
          </aside>
        )}
      </div>
      {selected && open === 'printings' && <div className={cx(panel, 'rounded-xl p-3')}>{p.printings(selected, () => setOpen(null))}</div>}
      {selected && open === 'others' && <div className={cx(panel, 'rounded-xl p-2')}><OtherListings c={selected} offers={p.offers[selected.buyKey] ?? []} onPin={p.onPin} /></div>}
    </div>
  );
}

/** C: readable card tiles; a card's choices open full width under its tile. */
function CardsC(p: CardsVariantProps) {
  const [open, setOpen] = useState<{ key: string; what: 'printings' | 'others' } | null>(null);
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
      {p.cards.flatMap(c => {
        const all = p.offers[c.buyKey] ?? [];
        const what = open?.key === c.buyKey ? open.what : null;
        const tile = (
          <div key={c.buyKey} className={cx(panel, 'rounded-xl p-2 flex flex-col gap-2 text-sm', what && 'ring-2 ring-indigo-500')}>
            <div className="relative group">
              <CardImage src={big(c.bought[0]?.item.printing?.image ?? c.image)} alt={c.name} className="w-full aspect-[5/7] rounded-lg" />
              <span className="absolute top-1.5 left-1.5 rounded-full bg-slate-900/85 text-white text-xs font-semibold px-2 py-0.5 tabnum">{c.qty}×</span>
              <span className="absolute top-1.5 right-1.5">{worstChip(c)}</span>
            </div>
            <div className="font-semibold leading-tight">{c.name}</div>
            <div className="flex flex-wrap gap-1"><CardTags c={c} /></div>
            {c.bought.map(({ store, item }) => (
              <div key={item.listingId} className="rounded-lg bg-slate-50 dark:bg-slate-800/70 p-1.5 space-y-1">
                <div className="flex items-baseline gap-1"><span className="flex-1 truncate font-medium" title={store.name}>{item.qty}× {store.name}</span><span className="tabnum font-semibold">{money(item.price)}</span></div>
                <div className="text-[11px] text-slate-500 truncate" title={item.printing?.label ?? item.title}>{item.condition ?? '?'} · {item.printing?.label ?? item.title}</div>
                <ListingButton url={item.url} full />
              </div>
            ))}
            <div className="mt-auto flex flex-wrap gap-x-3">
              {c.lineIds.length > 0 && c.bought.length > 0 && <Button variant="link" className="text-xs" onClick={() => setOpen(what === 'printings' ? null : { key: c.buyKey, what: 'printings' })}>{what === 'printings' ? 'hide Printings' : 'Printings & Stores'}</Button>}
              {all.length > c.bought.length && <Button variant="link" className="text-xs" onClick={() => setOpen(what === 'others' ? null : { key: c.buyKey, what: 'others' })}>{what === 'others' ? 'hide' : `${all.length - c.bought.length} other Listings`}</Button>}
              {c.lineIds.length > 0 && <Button variant="link" className="text-xs text-rose-600 dark:text-rose-400" onClick={() => p.onRemove(c.name, c.lineIds)}>remove</Button>}
            </div>
          </div>
        );
        if (!what) return [tile];
        return [tile, (
          <div key={`${c.buyKey}-open`} className={cx(panel, 'col-span-full rounded-xl p-3')}>
            <div className="text-sm font-semibold mb-2">{what === 'printings' ? `Printings & Stores for ${c.name}` : `Other Listings of ${c.name}`}</div>
            {what === 'printings' ? p.printings(c, () => setOpen(null)) : <OtherListings c={c} offers={all} onPin={p.onPin} />}
          </div>
        )];
      })}
    </div>
  );
}

// ---- Browse by Store ---------------------------------------------------------------------------------------------

export interface ShopDetailProps {
  skipped: Record<string, true>; onSkip: (buyKeys: string[], skip: boolean) => void;
  chosen: Record<string, string>; onChoose: (buyKey: string, listingId: string | null) => void;
  row: ShopRow; wanted: number; missing: { buyKey: string; name: string; qty: number }[]; showMissing: boolean; onToggleMissing: () => void;
  onBuyAll: (picks: StorePick[], storeId: string) => void; onPrefer: (s: ShopView) => void; onExclude: (s: ShopView) => void; isPreferred: boolean;
}

/** The same sums ShopDetail does, for the variants. */
function shopMath(p: ShopDetailProps) {
  const { shop, stocked } = p.row;
  const choice = (c: Stocked) => c.offers.find(o => o.listingId === p.chosen[c.buyKey]) ?? null;
  const costOf = (c: Stocked) => {
    const o = choice(c);
    return o ? (o.qty >= c.qty ? Math.round(o.price * c.qty * 100) / 100 : null) : c.cost;
  };
  const buyable = stocked.filter(s => costOf(s) !== null && !p.skipped[s.buyKey]);
  const dear = stocked.filter(c => {
    const o = choice(c) ?? c.offers[0];
    const ref = c.ck ?? c.average;
    return costOf(c) !== null && ref !== null && o.price > ref * 1.3 && o.price > 1;
  });
  const cardsTotal = Math.round(buyable.reduce((s, c) => s + (costOf(c) ?? 0), 0) * 100) / 100;
  const postage = shop.freeOver !== null && cardsTotal >= shop.freeOver ? 0 : shop.postage;
  const ckTotal = buyable.every(c => c.ck !== null) && buyable.length ? Math.round(buyable.reduce((s, c) => s + (c.ck ?? 0) * c.qty, 0) * 100) / 100 : null;
  const avgTotal = buyable.length && buyable.every(c => c.average !== null) ? Math.round(buyable.reduce((s, c) => s + (c.average ?? 0) * c.qty, 0) * 100) / 100 : null;
  const buy = () => p.onBuyAll(buyable.map((b): StorePick => {
    const o = choice(b);
    return { buyKey: b.buyKey, oracleId: b.oracleId, lineIds: b.lineIds, lock: o?.printingId ? { printingId: o.printingId, finish: o.finish } : null };
  }), shop.id);
  const planLabel = `Plan ${buyable.length} ${buyable.length === 1 ? 'card' : 'cards'} from here`;
  return { choice, costOf, buyable, dear, cardsTotal, postage, ckTotal, avgTotal, buy, planLabel };
}

export function ShopDetailVariant(p: ShopDetailProps & { variant: Key }) {
  if (p.variant === 'A') return <ShopA {...p} />;
  if (p.variant === 'B') return <ShopB {...p} />;
  return <ShopC {...p} />;
}

function ShopHeader({ p, children }: { p: ShopDetailProps; children?: ReactNode }) {
  const shop = p.row.shop;
  return (
    <div className={head}>
      {shop.storeUrl ? <a href={shop.storeUrl} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{shop.name} ↗</a> : <span className="font-semibold">{shop.name}</span>}
      {shop.city && <span className="text-sm text-slate-500">{shop.city}</span>}
      {shop.country === 'AU' && <AustraliaTag shipsToNz={shop.shipsToNz} estimated={shop.postageEstimated} />}
      {shop.sources.map(s => <SourceBadge key={s} source={s} />)}
      <div className="ml-auto flex items-center gap-3">
        <Button variant="link" className="text-xs" onClick={() => p.onExclude(shop)}>🚫 {shop.country === 'AU' && !shop.shipsToNz ? "Doesn't ship to NZ" : 'Exclude Store'}</Button>
        <Button variant="link" className="text-xs" onClick={() => p.onPrefer(shop)}>{p.isPreferred ? '★ Preferred' : '☆ Prefer'}</Button>
        {children}
      </div>
    </div>
  );
}

/** Totals laid out like the By Store Plan's side column. */
function ShopTotals({ p, m }: { p: ShopDetailProps; m: ReturnType<typeof shopMath> }) {
  return (
    <div className="text-sm tabnum space-y-0.5">
      <div className="flex justify-between"><span>Cards ({m.buyable.length})</span><span>{money(m.cardsTotal)}</span></div>
      <div className="flex justify-between"><span>Postage{p.row.shop.postageEstimated && <span className="text-xs text-amber-600 dark:text-amber-400"> est.</span>}</span><span>{m.postage === 0 ? 'Free' : money(m.postage)}</span></div>
      <div className="flex justify-between font-semibold border-t border-slate-200 dark:border-slate-700 pt-1"><span>Store total</span><span>{money(m.cardsTotal + m.postage)}</span></div>
      {m.ckTotal !== null && <div className="flex justify-between text-xs text-slate-500 pt-1"><span>CardKingdom {money(m.ckTotal)}</span><Delta price={m.cardsTotal} ref={m.ckTotal} label="" /></div>}
      {m.avgTotal !== null && <div className="flex justify-between text-xs text-slate-500"><span>Average {money(m.avgTotal)}</span><Delta price={m.cardsTotal} ref={m.avgTotal} label="" /></div>}
      <div className="text-xs text-slate-500 pt-1">Has {p.row.full} of {p.wanted} cards</div>
      {m.dear.length > 0 && <Button variant="link" className="text-xs" onClick={() => p.onSkip(m.dear.map(d => d.buyKey), true)}>leave out the {m.dear.length} dear {m.dear.length === 1 ? 'one' : 'ones'}</Button>}
    </div>
  );
}

/** The Printings a Store has of one card, as a wrapping grid (it scrolls down, never sideways). */
function PrintingTiles({ c, p, onHover }: { c: Stocked; p: ShopDetailProps; onHover?: (o: OfferView | null) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 max-h-[26rem] overflow-y-auto p-1">
      {c.offers.map((o, n) => {
        const on = p.chosen[c.buyKey] === o.listingId;
        return (
          <div key={o.listingId} onMouseEnter={() => onHover?.(o)} onMouseLeave={() => onHover?.(null)}
            className={cx('rounded-lg border p-1.5 text-xs flex flex-col gap-1', on ? 'border-indigo-500 ring-2 ring-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : n === 0 ? 'border-emerald-400 dark:border-emerald-600' : 'border-slate-200 dark:border-slate-700')}>
            <button type="button" aria-pressed={on} onClick={() => p.onChoose(c.buyKey, on ? null : o.listingId)} className="text-left space-y-1" title={on ? 'Click to un-choose' : 'Choose this Printing'}>
              <div className="relative">
                <CardImage src={o.storeImage ?? o.image} alt={o.label} className="w-full aspect-[5/7] rounded" />
                {on && <span className="absolute top-1 right-1 rounded-full bg-indigo-600 text-white w-5 h-5 grid place-items-center text-[11px]">✓</span>}
                {n === 0 && c.offers.length > 1 && <span className="absolute bottom-1 left-1 rounded bg-emerald-600/90 text-white px-1 text-[10px]">cheapest</span>}
              </div>
              <div className="flex items-baseline justify-between"><span className="tabnum font-semibold text-sm">{money(o.price)}</span><span className={cx('tabnum', o.qty < c.qty ? 'text-amber-600' : 'text-slate-500')}>{o.qty} in stock</span></div>
              <div className="truncate text-slate-500" title={o.label}>{o.label}</div>
              <div className="flex flex-wrap gap-1"><OfferTags o={o} /></div>
            </button>
            <ListingButton url={o.url} full className="mt-auto" />
          </div>
        );
      })}
    </div>
  );
}

function Missing({ p }: { p: ShopDetailProps }) {
  if (!p.missing.length) return null;
  return (
    <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 text-sm">
      <Button variant="link" className="text-xs" onClick={p.onToggleMissing}>{p.showMissing ? 'hide' : 'show'} {p.missing.length} card{p.missing.length > 1 ? 's' : ''} this Store doesn't have</Button>
      {p.showMissing && <div className="mt-1 text-slate-500 text-xs">{p.missing.map(m => `${m.qty}× ${m.name}`).join(', ')}</div>}
    </div>
  );
}

/** A: the Store drawn like a By Store Plan section: rows with a hover card, totals on the right, Printings on demand. */
function ShopA(p: ShopDetailProps) {
  const m = shopMath(p);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className={cx(panel, 'rounded-xl')}>
      <ShopHeader p={p}><Button variant="accent" disabled={!m.buyable.length} onClick={m.buy}>{m.planLabel}</Button></ShopHeader>
      <div className="grid xl:grid-cols-[minmax(0,1fr)_230px]">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 min-w-0">
          {p.row.stocked.map(c => {
            const o = m.choice(c) ?? c.offers[0];
            const short = m.costOf(c) === null;
            return (
              <li key={c.buyKey} className={cx('px-4 py-2', p.skipped[c.buyKey] && 'opacity-60')}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <input type="checkbox" checked={!p.skipped[c.buyKey]} onChange={e => p.onSkip([c.buyKey], !e.target.checked)} aria-label={`Plan ${c.name} from here`} title="Plan this card from here" />
                  <HoverCard src={o.image ?? o.storeImage} alt={c.name} />
                  <div className="flex-1 min-w-[12rem]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tabnum text-slate-500">{c.qty}×</span>
                      <span className="font-medium">{c.name}</span>
                      <Tag>{o.condition ?? 'cond. not stated'}</Tag>
                      {o.finish !== 'nonfoil' && <Tag>{o.finish === 'foil' ? 'Foil' : 'Etched'}</Tag>}
                      {!o.printingId && <Tag tone="warn">Printing not confirmed</Tag>}
                      {short && <Tag tone="warn">not enough in stock</Tag>}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{o.label}{m.choice(c) ? ' · your choice' : c.offers.length > 1 ? ' · cheapest' : ''}</div>
                  </div>
                  <div className="text-right">
                    <div className="tabnum">{money(o.price)}</div>
                    <div className="text-[11px]"><Delta price={o.price} ref={c.ck ?? c.average} label={c.ck !== null ? 'CK' : 'avg'} /></div>
                  </div>
                  <ListingButton url={o.url} />
                  {c.offers.length > 1 && (
                    <Button className="text-xs py-1" onClick={() => setOpen(open === c.buyKey ? null : c.buyKey)} aria-expanded={open === c.buyKey}>
                      {open === c.buyKey ? 'Hide' : `${c.offers.length} Printings`}
                    </Button>
                  )}
                </div>
                {open === c.buyKey && <div className="mt-2 ml-[4.5rem]"><PrintingTiles c={c} p={p} /></div>}
              </li>
            );
          })}
        </ul>
        <div className="p-4 border-t xl:border-t-0 xl:border-l border-slate-200 dark:border-slate-800"><ShopTotals p={p} m={m} /></div>
      </div>
      <Missing p={p} />
    </div>
  );
}

/** B: compact rows with Printings as chips; a sticky column shows the hovered Printing big, then the totals. */
function ShopB(p: ShopDetailProps) {
  const m = shopMath(p);
  const [hover, setHover] = useState<{ c: Stocked; o: OfferView } | null>(null);
  const first = p.row.stocked[0];
  const shown = hover ?? (first ? { c: first, o: m.choice(first) ?? first.offers[0] } : null);
  return (
    <div className={cx(panel, 'rounded-xl')}>
      <ShopHeader p={p} />
      <div className="grid md:grid-cols-[minmax(0,1fr)_260px]">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 min-w-0">
          {p.row.stocked.map(c => (
            <li key={c.buyKey} className={cx('px-4 py-2 text-sm', p.skipped[c.buyKey] && 'opacity-60')}>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={!p.skipped[c.buyKey]} onChange={e => p.onSkip([c.buyKey], !e.target.checked)} aria-label={`Plan ${c.name} from here`} />
                <span className="tabnum text-slate-500">{c.qty}×</span>
                <span className="font-medium flex-1">{c.name}</span>
                {m.costOf(c) === null && <Tag tone="warn">not enough</Tag>}
                <span className="tabnum font-semibold">{money(m.costOf(c))}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
                {c.offers.map((o, n) => {
                  const on = p.chosen[c.buyKey] === o.listingId || (!p.chosen[c.buyKey] && n === 0);
                  return (
                    <button key={o.listingId} type="button" onMouseEnter={() => setHover({ c, o })} onFocus={() => setHover({ c, o })}
                      onClick={() => p.onChoose(c.buyKey, p.chosen[c.buyKey] === o.listingId ? null : o.listingId)}
                      className={cx('rounded-full border px-2 py-0.5 text-xs flex items-center gap-1.5', on ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-300 dark:border-slate-600 hover:border-indigo-400')}>
                      <span className="tabnum font-semibold">{money(o.price)}</span>
                      <span className={cx('max-w-40 truncate', on ? 'text-indigo-100' : 'text-slate-500')}>{o.label.split(' · ')[0]}</span>
                      {o.finish !== 'nonfoil' && <span>✦</span>}
                      {o.condition !== 'NM' && <span className={on ? '' : 'text-amber-600'}>{o.condition ?? '?'}</span>}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
        <aside className="p-3 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800 space-y-3">
          <div className="md:sticky md:top-4 space-y-3">
            {shown && (
              <div className="space-y-2">
                <CardImage src={big(shown.o.image) ?? shown.o.storeImage} alt={shown.o.label} className="w-full aspect-[5/7] rounded-xl" />
                {shown.o.storeImage && <div className="flex items-center gap-2 text-[11px] text-slate-500"><CardImage src={shown.o.storeImage} alt="Store's picture" className="w-8 aspect-[5/7] rounded" />the Store's own picture</div>}
                <div className="text-sm font-semibold">{shown.c.name}</div>
                <div className="text-xs text-slate-500">{shown.o.label}</div>
                <div className="flex flex-wrap gap-1"><OfferTags o={shown.o} /></div>
                <div className="flex items-center gap-2"><span className="tabnum font-semibold">{money(shown.o.price)}</span><span className="text-xs text-slate-500">{shown.o.qty} in stock</span><ListingButton url={shown.o.url} className="ml-auto" /></div>
              </div>
            )}
            <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
              <ShopTotals p={p} m={m} />
              <Button variant="accent" className="w-full" disabled={!m.buyable.length} onClick={m.buy}>{m.planLabel}</Button>
            </div>
          </div>
        </aside>
      </div>
      <Missing p={p} />
    </div>
  );
}

/** C: one readable tile per card (its chosen or cheapest Printing); Printings open full width below. */
function ShopC(p: ShopDetailProps) {
  const m = shopMath(p);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className={cx(panel, 'rounded-xl')}>
      <ShopHeader p={p} />
      <div className="px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm border-b border-slate-100 dark:border-slate-800 tabnum">
        <span>Has <b>{p.row.full} of {p.wanted}</b></span>
        <span>Cards <b>{money(m.cardsTotal)}</b> + postage {m.postage === 0 ? 'free' : money(m.postage)}</span>
        <span className="font-semibold">= {money(m.cardsTotal + m.postage)}</span>
        {m.ckTotal !== null && <Delta price={m.cardsTotal} ref={m.ckTotal} label="vs CK" />}
        {m.dear.length > 0 && <Button variant="link" className="text-xs" onClick={() => p.onSkip(m.dear.map(d => d.buyKey), true)}>leave out {m.dear.length} dear</Button>}
        <Button variant="accent" className="ml-auto" disabled={!m.buyable.length} onClick={m.buy}>{m.planLabel}</Button>
      </div>
      <div className="p-3 grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
        {p.row.stocked.flatMap(c => {
          const o = m.choice(c) ?? c.offers[0];
          const skipped = !!p.skipped[c.buyKey];
          const tile = (
            <div key={c.buyKey} className={cx('rounded-xl border p-2 flex flex-col gap-1.5 text-sm', open === c.buyKey ? 'border-indigo-500 ring-2 ring-indigo-500' : 'border-slate-200 dark:border-slate-700', skipped && 'opacity-50')}>
              <div className="relative">
                <CardImage src={big(o.image) ?? o.storeImage} alt={c.name} className="w-full aspect-[5/7] rounded-lg" />
                <label className="absolute top-1.5 left-1.5 rounded-full bg-slate-900/85 text-white text-xs px-2 py-0.5 flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={!skipped} onChange={e => p.onSkip([c.buyKey], !e.target.checked)} aria-label={`Plan ${c.name} from here`} />
                  <span className="tabnum font-semibold">{c.qty}×</span>
                </label>
                {m.costOf(c) === null && <span className="absolute bottom-1.5 left-1.5 rounded bg-amber-500 text-slate-900 text-[11px] px-1.5 font-semibold">only {o.qty} in stock</span>}
              </div>
              <div className="font-semibold leading-tight">{c.name}</div>
              <div className="text-[11px] text-slate-500 truncate" title={o.label}>{o.label}</div>
              <div className="flex flex-wrap gap-1"><OfferTags o={o} /></div>
              <div className="flex items-baseline justify-between"><span className="tabnum font-semibold">{money(o.price)}</span><Delta price={o.price} ref={c.ck ?? c.average} label={c.ck !== null ? 'CK' : 'avg'} /></div>
              <ListingButton url={o.url} full />
              {c.offers.length > 1 && <Button className="text-xs py-1 w-full" onClick={() => setOpen(open === c.buyKey ? null : c.buyKey)}>{open === c.buyKey ? 'Hide Printings' : `All ${c.offers.length} Printings`}</Button>}
            </div>
          );
          return open === c.buyKey ? [tile, <div key={`${c.buyKey}-p`} className="col-span-full rounded-xl bg-slate-50 dark:bg-slate-800/50 p-2"><PrintingTiles c={c} p={p} /></div>] : [tile];
        })}
        {p.missing.map(x => (
          <div key={x.buyKey} className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-2 grid place-items-center text-center text-xs text-slate-500 min-h-40">
            <div><div className="tabnum">{x.qty}×</div><div className="font-medium">{x.name}</div><div>not stocked here</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** B's Store picker: rung-style cards along the top instead of a side list. */
export function StorePickerB({ rows, selected, onSelect, filter, onFilter, country, onCountry, wanted, preferred }: {
  rows: ShopRow[]; selected: string | null; onSelect: (id: string) => void; filter: string; onFilter: (s: string) => void;
  country: 'all' | 'NZ' | 'AU'; onCountry: (c: 'all' | 'NZ' | 'AU') => void; wanted: number; preferred: Record<string, string>;
}) {
  const [all, setAll] = useState(false);
  useEffect(() => { if (!selected && rows[0]) onSelect(rows[0].shop.id); }, [selected, rows, onSelect]);
  const shown = all || filter ? rows : rows.slice(0, 8);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold mr-2">Stores with your cards ({rows.length})</h3>
        <input value={filter} onChange={e => onFilter(e.target.value)} placeholder="Find a Store" aria-label="Find a Store"
          className="border rounded-md px-2 py-1 text-sm bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 w-44" />
        {(['all', 'NZ', 'AU'] as const).map(c => (
          <button key={c} type="button" aria-pressed={country === c} onClick={() => onCountry(c)}
            className={cx('px-2 py-0.5 rounded-full border text-xs', country === c ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 dark:border-slate-600')}>{c === 'all' ? 'All' : c}</button>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {shown.map(r => (
          <button key={r.shop.id} type="button" onClick={() => onSelect(r.shop.id)} aria-pressed={selected === r.shop.id}
            className={cx('text-left rounded-xl border px-3 py-2 transition', selected === r.shop.id ? 'border-indigo-500 ring-2 ring-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-indigo-400')}>
            <div className="text-xs text-slate-500 truncate">{preferred[r.shop.id] ? '★ ' : ''}{r.shop.city ?? '—'}{r.shop.country === 'AU' ? ' · AU' : ''}</div>
            <div className="font-semibold truncate">{r.shop.name}</div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${(r.full / wanted) * 100}%` }} /></div>
            <div className="text-xs text-slate-500 tabnum mt-0.5">{r.full} of {wanted} cards{r.cards > r.full ? ` (+${r.cards - r.full} short)` : ''}</div>
          </button>
        ))}
      </div>
      {!all && !filter && rows.length > 8 && <Button variant="link" className="text-xs" onClick={() => setAll(true)}>show all {rows.length} Stores</Button>}
    </div>
  );
}
