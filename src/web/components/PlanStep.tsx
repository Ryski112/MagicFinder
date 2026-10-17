import { useEffect, useState } from 'react';
import type { ItemView, LadderView, Lock, PlanChoices, PrintingsResponse, RungView, Settings, StoreView } from '../../shared/api';
import { api } from '../api';
import { CartDialog, type CartTarget } from './CartDialog';
import { sourceLine } from './SearchStep';
import { Button, CardImage, cx, money, Notice, SourceBadge, Switch, Tag, timeAgo } from './ui';

interface Props {
  runId: string;
  ladder: LadderView;
  selectedK: number | null;
  onSelect: (k: number) => void;
  choices: PlanChoices;
  onChoices: (c: PlanChoices) => void;
  settings: Settings;
  onSettings: (p: Partial<Settings>) => void;
  onEdit: () => void;
  onSearchAgain: () => void;
}

const panel = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800';

export function PlanStep(p: Props) {
  const rung = p.ladder.rungs.find(r => r.k === p.selectedK) ?? p.ladder.rungs.find(r => r.cheapestOverall) ?? null;
  const [cart, setCart] = useState<CartTarget | null>(null);
  // Toggling pickup changes a Store's total, which would re-sort it; hold the order it had when the switch was flipped.
  const [heldOrder, setHeldOrder] = useState<{ k: number; ids: string[] } | null>(null);
  const stores = rung ? keepOrder(rung.stores, heldOrder?.k === rung.k ? heldOrder.ids : null) : [];
  const onStoreSettings = (patch: Partial<Settings>) => {
    if (rung && patch.pickupStores) setHeldOrder({ k: rung.k, ids: stores.map(s => s.id) });
    p.onSettings(patch);
  };
  const refining = !p.ladder.final;
  const fetchItems = rung?.stores.filter(s => s.cart === 'fetch').flatMap(s => s.items) ?? [];

  const setLock = (lineIds: string[], lock: Lock | null) =>
    p.onChoices({ ...p.choices, locks: { ...p.choices.locks, ...Object.fromEntries(lineIds.map(id => [id, lock])) } });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="link" onClick={p.onEdit}>← Edit Want List</Button>
        <div className="text-sm text-slate-500">
          {refining ? 'Finding cheaper Plans…' : 'Final'}
          {p.ladder.kmin !== null && ` · Fewest Stores that cover your list: ${p.ladder.kmin}`}
        </div>
      </div>

      <Notices ladder={p.ladder} settings={p.settings} onSettings={p.onSettings} onSearchAgain={p.onSearchAgain} onUnlock={ids => setLock(ids, null)} />

      {p.ladder.rungs.length > 0 && (
        <section>
          <h2 className="font-semibold mb-2">How many Stores do you want to order from?</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {p.ladder.rungs.map(r => (
              <RungCard key={r.k} r={r} selected={rung?.k === r.k} onSelect={() => p.onSelect(r.k)} onTryLonger={() => void api.tryLonger(p.runId, r.k)} />
            ))}
          </div>
        </section>
      )}

      {rung && rung.total !== null && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">
              Your {rung.k}-Store Plan
              {rung.short && <span className="font-normal text-amber-600 dark:text-amber-400"> · leaves out {rung.short.wanted - rung.short.covered} of {rung.short.wanted} cards</span>}
            </h2>
            {rung.pickupHints.length > 0 && (
              <div className="text-xs text-emerald-700 dark:text-emerald-400">
                {rung.pickupHints.map(h => `Pickup available at ${h.name}, saves ${money(h.saves)}`).join(' · ')}
              </div>
            )}
          </div>
          {rung.short && rung.short.leftOut.length > 0 && (
            <CardList
              tone="warn"
              title={`Left out of this Plan (${rung.short.wanted - rung.short.covered})`}
              note={`${rung.k} Store${rung.k > 1 ? 's' : ''} can't supply your whole list. These are the fewest cards to leave out; pick a bigger Plan to include them.`}
              cards={rung.short.leftOut.map(l => ({ key: l.buyKey, name: l.name, qty: l.missing, image: l.image }))}
            />
          )}
          {fetchItems.length > 0 && (
            <div className={cx(panel, 'rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 text-sm')}>
              <SourceBadge source="fetch" />
              <span className="flex-1 text-slate-600 dark:text-slate-300">Fetch TCG uses one cart for every seller, so all {fetchItems.length} Fetch Listings in this Plan check out together.</span>
              <Button variant="accent" onClick={() => setCart({ kind: 'fetch', items: fetchItems, k: rung.k })}>Open {fetchItems.length} Fetch Listings ↗</Button>
            </div>
          )}
          {stores.map(s => (
            <StoreSection key={s.id} store={s} runId={p.runId} settings={p.settings} onSettings={onStoreSettings}
              onCart={() => setCart(s.cart === 'fetch' ? { kind: 'fetch', items: s.items, k: rung.k, seller: s.name } : { kind: 'store', store: s, k: rung.k })}
              onLock={setLock} />
          ))}
          <div className="text-right text-lg font-bold tabnum">
            Landed Cost {money(rung.total)}
            <div className="text-xs font-normal text-slate-500">cards {money(rung.cards)} + postage {money(rung.postage)}</div>
          </div>
        </section>
      )}
      {cart && <CartDialog runId={p.runId} target={cart} onClose={() => setCart(null)} />}
    </div>
  );
}

/** Stores in the held order; any Store not in it (a re-plan can bring new ones) goes after, in the server's order. */
function keepOrder(stores: StoreView[], ids: string[] | null): StoreView[] {
  if (!ids) return stores;
  const pos = new Map(ids.map((id, i) => [id, i]));
  return [...stores].sort((a, b) => (pos.get(a.id) ?? ids.length) - (pos.get(b.id) ?? ids.length));
}

function RungCard({ r, selected, onSelect, onTryLonger }: { r: RungView; selected: boolean; onSelect: () => void; onTryLonger: () => void }) {
  if (r.total === null) {
    return (
      <div className="min-w-[190px] rounded-xl p-3 ring-1 ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900 text-sm">
        <div className="text-slate-500">{r.k} Store{r.k > 1 ? 's' : ''}</div>
        <div className="my-1">Couldn't find a {r.k}-Store Plan in time.</div>
        <Button variant="link" onClick={onTryLonger}>Try longer</Button>
      </div>
    );
  }
  return (
    <button type="button" onClick={onSelect}
      className={cx('min-w-[180px] text-left rounded-xl border-2 p-3 bg-white dark:bg-slate-900 transition', selected ? 'border-indigo-500 shadow-md' : 'border-transparent ring-1 ring-slate-200 dark:ring-slate-800 hover:ring-slate-400')}>
      <div className="text-sm text-slate-500">
        {r.k} Store{r.k > 1 ? 's' : ''}
        {r.cheapestOverall && <span className="ml-1 text-emerald-600 dark:text-emerald-400 font-semibold">· Cheapest overall</span>}
      </div>
      <div className="text-2xl font-bold tabnum">{money(r.total)}</div>
      {r.short
        ? <div className="text-xs text-amber-600 dark:text-amber-400 tabnum h-4">{r.short.covered} of {r.short.wanted} cards</div>
        : <div className="text-xs text-slate-500 tabnum h-4">{r.saves != null ? `saves ${money(r.saves)} vs ${r.k - 1}` : 'all cards · fewest Stores'}</div>}
      <div className="mt-1 h-5">
        {r.status === 'refining' && <span className="text-xs text-amber-700 bg-amber-100 dark:bg-amber-900/50 dark:text-amber-200 px-2 py-0.5 rounded-full animate-pulse">refining…</span>}
        {r.status === 'timed-out' && (
          <span className="text-xs text-orange-800 bg-orange-100 dark:bg-orange-900/50 dark:text-orange-200 px-2 py-0.5 rounded-full">
            {r.mightSave ? `might be up to ${money(r.mightSave)} cheaper` : 'might be a little cheaper'}{' '}
            <span role="button" tabIndex={0} className="underline" onClick={e => { e.stopPropagation(); onTryLonger(); }}>Try longer</span>
          </span>
        )}
      </div>
    </button>
  );
}

function Notices({ ladder, settings, onSettings, onSearchAgain, onUnlock }: { ladder: LadderView; settings: Settings; onSettings: (p: Partial<Settings>) => void; onSearchAgain: () => void; onUnlock: (ids: string[]) => void }) {
  const [copied, setCopied] = useState(false);
  const troubled = ladder.sources.filter(s => s.status !== 'ok' && s.status !== 'off');
  const skipped = ladder.sources.filter(s => s.status === 'ok' && s.notSearched.length > 0);
  const allFailed = ladder.sources.filter(s => s.status !== 'off').every(s => s.status !== 'ok') && ladder.rungs.length === 0;
  return (
    <div className="space-y-2">
      {skipped.map(s => (
        <Notice key={s.source} tone="info">
          {s.name} had a server error on {s.notSearched.length} card{s.notSearched.length > 1 ? 's' : ''}, so {s.notSearched.length > 1 ? 'they were' : 'it was'} only
          searched on the other Source: {ladder.partialCards.join(', ')}. <Button variant="link" onClick={onSearchAgain}>Search again</Button>
        </Notice>
      ))}
      {troubled.map(s => (
        <Notice key={s.source} tone="warn">
          <div>{s.message ?? sourceLine(s).text}</div>
          {s.notSearched.length > 0 && ladder.partialCards.length > 0 && (
            <div className="mt-1">These cards were searched on one Source only, so the Plans may not be the cheapest: {ladder.partialCards.join(', ')}.</div>
          )}
          {s.staleSince && <div className="mt-1">Using its prices from {timeAgo(s.staleSince)}; they may have changed.</div>}
          <div className="mt-1 flex flex-wrap gap-3">
            {(s.status === 'blocked' || s.status === 'cooling-down') && (
              <Button variant="link" onClick={async () => { await api.tryAgain(s.source); onSearchAgain(); }}>Try again now</Button>
            )}
            {s.status === 'down' && <Button variant="link" onClick={onSearchAgain}>Search again</Button>}
            {s.details && (
              <Button variant="link" onClick={async () => { await navigator.clipboard.writeText(s.details!); setCopied(true); }}>{copied ? 'Copied' : 'Copy details'}</Button>
            )}
            {s.details && <a className="text-indigo-600 dark:text-indigo-400 underline text-sm" href="https://github.com/Ryski112/MagicFinder/issues/new" target="_blank" rel="noreferrer">Report it</a>}
          </div>
        </Notice>
      ))}
      {allFailed && <Notice tone="bad">No Source could be searched, so there's no Plan this time. Check your internet connection and try again.</Notice>}
      {ladder.notFound.length > 0 && (
        <CardList
          tone="bad"
          title={`Not Found (${ladder.notFound.reduce((n, x) => n + x.missing, 0)}), left out of every Plan`}
          cards={ladder.notFound.map(n => ({
            key: n.buyKey,
            name: n.name,
            qty: n.missing,
            image: n.image,
            note: [
              n.missing < n.wanted ? `only ${n.wanted - n.missing} of ${n.wanted} available` : '',
              n.notSearchedOn.length ? `${n.notSearchedOn.join(' and ')} not searched` : '',
            ].filter(Boolean).join(' · '),
            action: n.locked ? { label: 'locked Printing: unlock', onClick: () => onUnlock(n.lineIds) } : undefined,
          }))}
        />
      )}
      {ladder.unrecognised.length > 0 && <Notice tone="bad">Couldn't recognise: {ladder.unrecognised.join(' · ')}</Notice>}
      {ladder.skippedBasics.length > 0 && (
        <Notice tone="info">
          Skipped basic lands: {ladder.skippedBasics.join(', ')}. <Button variant="link" onClick={() => onSettings({ includeBasics: true })}>include them</Button>
        </Notice>
      )}
      {ladder.unidentified > 0 && <Notice tone="info">{ladder.unidentified} Listing{ladder.unidentified > 1 ? 's' : ''} couldn't be identified and {ladder.unidentified > 1 ? 'were' : 'was'} ignored.</Notice>}
      {settings.useListPrintings && <Notice tone="info">Using the Printings from your list. <Button variant="link" onClick={() => onSettings({ useListPrintings: false })}>Stop</Button></Notice>}
    </div>
  );
}

function StoreSection({ store: s, runId, settings, onSettings, onCart, onLock }: {
  store: StoreView; runId: string; settings: Settings; onSettings: (p: Partial<Settings>) => void; onCart: () => void; onLock: (lineIds: string[], lock: Lock | null) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const setPickup = (on: boolean) => {
    const next = new Set(settings.pickupStores);
    if (on) next.add(s.id); else next.delete(s.id);
    onSettings({ pickupStores: [...next] });
  };
  const cartLabel = {
    shopify: '🛒 Add all to cart',
    'hobbymaster-deckbuilder': 'Copy list & open Deck Builder',
    'open-listings': 'Open Listings',
    fetch: `Open ${s.items.length} Listing${s.items.length > 1 ? 's' : ''}`,
  }[s.cart];
  return (
    <div className={cx(panel, 'rounded-xl')}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 rounded-t-xl">
        {s.storeUrl ? <a href={s.storeUrl} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{s.name} ↗</a> : <span className="font-semibold">{s.name}</span>}
        {s.city && <span className="text-sm text-slate-500">{s.city}</span>}
        {s.sources.map(src => <SourceBadge key={src} source={src} />)}
        {s.staleSince && <Tag tone="warn" title="Its Source couldn't be searched just now">prices from {timeAgo(s.staleSince)}</Tag>}
        <div className="ml-auto flex items-center gap-3">
          {s.pickupEligible && (
            <Switch checked={s.pickupOn} onChange={setPickup} ariaLabel={`I'll pick up from ${s.name}`} label={<>I'll pick up{!s.pickupConfirmed && <span className="text-xs text-slate-500"> (not confirmed)</span>}</>}
              title={s.pickupConfirmed ? (s.pickupFee ? `Pickup fee ${money(s.pickupFee)}` : 'Free pickup') : "This Store hasn't said whether it offers pickup; check before you rely on it"} />
          )}
          {cartLabel && <Button variant="accent" onClick={onCart}>{cartLabel}{s.cart !== 'hobbymaster-deckbuilder' && ' ↗'}</Button>}
        </div>
      </div>
      <div className="grid md:grid-cols-[minmax(0,1fr)_230px]">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 min-w-0">
          {s.items.map(i => (
            <li key={i.listingId} className="px-4 py-2">
              <ItemRow item={i} open={open === i.listingId} onToggle={() => setOpen(open === i.listingId ? null : i.listingId)} />
              {open === i.listingId && (
                <PrintingGrid runId={runId} lineId={i.lineIds[0]} onLock={lock => { onLock(i.lineIds, lock); setOpen(null); }} />
              )}
            </li>
          ))}
        </ul>
        <div className="p-4 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800">
          <StoreTotals store={s} settings={settings} onSettings={onSettings} />
        </div>
      </div>
    </div>
  );
}

function ItemRow({ item: i, open, onToggle }: { item: ItemView; open: boolean; onToggle: () => void }) {
  const img = i.printing?.image ?? i.fallbackImage;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="relative group shrink-0">
        <CardImage src={img} alt={i.name} className="w-10 aspect-[5/7] rounded" />
        {(i.printing?.imageLarge ?? img) && (
          <span className="hidden group-hover:block absolute left-12 top-0 z-30 w-56 shadow-2xl rounded-xl overflow-hidden pointer-events-none">
            <CardImage src={i.printing?.imageLarge ?? img} alt={i.name} className="w-full aspect-[5/7]" />
          </span>
        )}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabnum text-slate-500">{i.qty}×</span>
          <span className="font-medium">{i.name}</span>
          {i.locked && <span title="Locked Printing">🔒</span>}
          <Tag title={i.condition ? undefined : 'The Store did not state a condition'}>{i.condition ?? 'condition not stated'}</Tag>
          {i.finish !== 'nonfoil' && <Tag>{i.finish === 'foil' ? 'Foil' : 'Etched'}</Tag>}
          {!i.printing && <Tag tone="warn" title="Matched the card but not the exact Printing">Printing not confirmed</Tag>}
        </div>
        <div className="text-xs text-slate-500 truncate">
          {i.printing?.label ?? i.title} · <Button variant="link" className="text-xs" onClick={onToggle}>{open ? 'hide Printings' : 'other Printings'}</Button>
        </div>
      </div>
      <div className="flex flex-col items-end sm:flex-row sm:items-center sm:gap-3 shrink-0">
        <span className="tabnum">{money(i.price)}</span>
        <a href={i.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap">View listing ↗</a>
      </div>
    </div>
  );
}

function PrintingGrid({ runId, lineId, onLock }: { runId: string; lineId: string; onLock: (lock: Lock | null) => void }) {
  const [data, setData] = useState<PrintingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.printings(runId, lineId).then(setData, e => setError((e as Error).message));
  }, [runId, lineId]);
  if (error) return <p className="mt-2 text-sm text-rose-600">{error}</p>;
  if (!data) return <p className="mt-2 text-sm text-slate-500">Loading Printings…</p>;
  if (!data.options.length) return <p className="mt-2 text-sm text-slate-500">No other confirmed Printings are in stock.</p>;
  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        {data.options.map(o => (
          <div key={`${o.printing.id}:${o.printing.finish}`} className={cx('rounded-xl p-2', o.locked ? 'ring-2 ring-indigo-500 bg-indigo-50 dark:bg-indigo-950' : 'bg-slate-50 dark:bg-slate-800')}>
            <CardImage src={o.printing.image} alt={data.name} className="w-full aspect-[5/7] rounded-lg" />
            <div className="text-[11px] mt-1 h-8 overflow-hidden text-slate-600 dark:text-slate-300">{o.printing.label}</div>
            {o.printing.nonTournament && <div className="text-[10px] text-slate-500">{o.printing.nonTournament}, used only if locked</div>}
            <div className="text-sm font-semibold tabnum">
              {o.cheapest == null ? <span className="text-slate-400">none in stock</span> : <>from {money(o.cheapest)}<div className="text-[11px] font-normal text-slate-500">at {o.stores} Store{o.stores > 1 ? 's' : ''}</div></>}
            </div>
            {o.locked
              ? <Button variant="primary" className="w-full mt-1 text-xs py-1" onClick={() => onLock(null)}>🔒 Locked, unlock</Button>
              : <Button className="w-full mt-1 text-xs py-1" disabled={o.cheapest == null} onClick={() => onLock({ printingId: o.printing.id, finish: o.printing.finish })}>Lock this one</Button>}
          </div>
        ))}
      </div>
      {data.hint && <p className="text-xs text-slate-500 mt-2">Your list said {data.hint.text}.</p>}
    </div>
  );
}

function StoreTotals({ store: s, settings, onSettings }: { store: StoreView; settings: Settings; onSettings: (p: Partial<Settings>) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(s.postage || settings.defaultPostage.tracked));
  const override = settings.postageOverrides[s.id];
  const postageLabel = s.postageKind === 'pickup' ? 'Pickup' : `Postage (${settings.postageType})`;
  return (
    <div className="text-sm tabnum space-y-0.5">
      <div className="flex justify-between"><span>Cards</span><span>{money(s.subtotal)}</span></div>
      <div className="flex justify-between items-center gap-2">
        <span className="whitespace-nowrap">
          {postageLabel}
          {s.postageEstimated && <Button variant="link" className="ml-1 text-xs text-amber-600 dark:text-amber-400" title="This Store doesn't publish postage; click to enter what it charges you" onClick={() => setEditing(true)}>est.</Button>}
          {override !== undefined && s.postageKind !== 'pickup' && <Button variant="link" className="ml-1 text-xs" title="Your price for this Store" onClick={() => setEditing(true)}>yours</Button>}
        </span>
        <span>{s.postageKind === 'free' ? 'Free' : money(s.postage)}</span>
      </div>
      {editing && (
        <form className="flex gap-1 items-center" onSubmit={e => { e.preventDefault(); onSettings({ postageOverrides: { ...settings.postageOverrides, [s.id]: Number(value) } }); setEditing(false); }}>
          <span>$</span>
          <input autoFocus type="number" min={0} step={0.1} value={value} onChange={e => setValue(e.target.value)} className="w-20 border rounded px-1 py-0.5 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600" />
          <Button variant="primary" className="text-xs py-0.5" type="submit">Save</Button>
          <Button variant="ghost" className="text-xs py-0.5" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      )}
      {s.postageKind === 'postage' && s.freeOver !== null && s.subtotal < s.freeOver && (
        <div className="text-[11px] text-slate-500">Free postage over {money(s.freeOver)} ({money(s.freeOver - s.subtotal)} away)</div>
      )}
      <div className="flex justify-between font-semibold border-t border-slate-200 dark:border-slate-700 pt-1"><span>Store total</span><span>{money(s.total)}</span></div>
    </div>
  );
}

interface CardListItem {
  key: string;
  name: string;
  qty: number;
  image: string | null;
  note?: string;
  action?: { label: string; onClick: () => void };
}

/** A collapsible list of cards with their images, for Not Found and for cards a Short Plan leaves out. */
function CardList({ title, note, cards, tone }: { title: string; note?: string; cards: CardListItem[]; tone: 'bad' | 'warn' }) {
  const [open, setOpen] = useState(false);
  const toneClass = tone === 'bad'
    ? 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/50 dark:border-rose-900 dark:text-rose-200'
    : 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-200';
  return (
    <div className={cx('border rounded-lg text-sm', toneClass)}>
      <button type="button" className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left font-medium" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span className="text-xs font-normal opacity-80 whitespace-nowrap">{open ? 'hide ▴' : `show ${cards.length} card${cards.length > 1 ? 's' : ''} ▾`}</span>
      </button>
      {!open && <div className="px-3 pb-2 -mt-1 text-xs opacity-80 truncate">{cards.map(c => c.name).join(', ')}</div>}
      {open && (
        <div className="px-3 pb-3">
          {note && <p className="text-xs opacity-80 mb-2">{note}</p>}
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-3">
            {cards.map(c => (
              <div key={c.key} className="text-xs">
                <div className="relative">
                  <CardImage src={c.image} alt={c.name} className="w-full aspect-[5/7] rounded-lg" />
                  {c.qty > 1 && <span className="absolute top-1 left-1 bg-black/75 text-white font-bold rounded px-1.5">×{c.qty}</span>}
                </div>
                <div className="mt-1 font-medium leading-tight">{c.name}</div>
                {c.note && <div className="opacity-80">{c.note}</div>}
                {c.action && <Button variant="link" className="text-xs" onClick={c.action.onClick}>{c.action.label}</Button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
