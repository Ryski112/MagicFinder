import { useEffect, useState, type ReactNode } from 'react';
import type { UnconfirmedListingView, CardKingdomView, Exclusion, Finish, ItemView, LadderView, LeftOutView, Lock, NotFoundView, OfferView, PlanChoices, PrintingsResponse, PrintingView, RungView, Settings, SplitView, StoreView, SweepView } from '../../shared/api';
import { api } from '../api';
import { ShopsView, type StorePick } from './ShopsView';
import { CartDialog, openCartTab, type CartTarget } from './CartDialog';
import { cardsElsewhere, costAtStore, isWaivable, planCards, type Elsewhere } from '../planCards';
import { sourceLine } from './SearchStep';
import { AustraliaTag, Button, CardImage, CardKingdomChip, cx, money, Notice, SourceBadge, Switch, Tag, timeAgo, unsure } from './ui';

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
  /** A change was just made and the re-planned result hasn't arrived yet. */
  updating?: boolean;
}

const panel = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800';

export function PlanStep(p: Props) {
  const base = p.ladder.rungs.find(r => r.k === p.selectedK) ?? p.ladder.rungs.find(r => r.cheapestOverall) ?? null;
  // The runner-up is the next best Plan with a different set of Stores; picking another rung goes back to the best one.
  const [mode, setMode] = useState<'plans' | 'shops'>('plans');
  const [showRunnerUp, setShowRunnerUp] = useState(false);
  useEffect(() => setShowRunnerUp(false), [base?.k]);
  const rung = showRunnerUp && base?.next ? base.next : base;
  /** Names the Plan to the cart check: negative for a runner-up. */
  const cartK = base ? (rung?.runnerUp ? -base.k : base.k) : 0;
  const [finding, setFinding] = useState<number | null>(null);
  useEffect(() => setFinding(null), [base?.k, base?.next, base?.noRunnerUp, p.ladder.planId]);
  const anyPreferred = Object.keys(p.settings.preferredStores).length > 0;
  const hasPreferred = anyPreferred && p.settings.preferredOn;
  const [cart, setCart] = useState<CartTarget | null>(null);
  const [view, setView] = useState<'stores' | 'cards'>('stores');
  // How cards are ordered within a Store (or in the card list): by name, or dearest first. Remembered in this browser.
  const [sortBy, setSortByState] = useState<'name' | 'price'>(() => {
    try { return localStorage.getItem('planSort') === 'price' ? 'price' : 'name'; } catch { return 'name'; }
  });
  const setSortBy = (v: 'name' | 'price') => {
    setSortByState(v);
    try { localStorage.setItem('planSort', v); } catch { /* the choice just isn't remembered */ }
  };
  // Toggling pickup changes a Store's total, which would re-sort it; hold the order it had when the switch was flipped.
  const [heldOrder, setHeldOrder] = useState<{ k: number; ids: string[] } | null>(null);
  const stores = rung ? keepOrder(rung.stores, heldOrder?.k === rung.k ? heldOrder.ids : null) : [];
  const cards = planCards(stores);
  const onStoreSettings = (patch: Partial<Settings>) => {
    if (rung && patch.pickupStores) setHeldOrder({ k: rung.k, ids: stores.map(s => s.id) });
    p.onSettings(patch);
  };
  const refining = !p.ladder.final;
  const fetchItems = rung?.stores.filter(s => s.cart === 'fetch').flatMap(s => s.items) ?? [];

  const setPin = (buyKey: string, storeId: string | null) => {
    if (rung) setHeldOrder({ k: rung.k, ids: stores.map(s => s.id) });
    const pins = { ...p.choices.pins };
    if (storeId) pins[buyKey] = storeId;
    else delete pins[buyKey];
    p.onChoices({ ...p.choices, pins });
  };

  // Cards taken off the list from this screen, so they can be put back. They stay unticked on the Want List.
  const [removed, setRemoved] = useState<{ name: string; lineIds: string[] }[]>([]);
  const setIncluded = (lineIds: string[], on: boolean) =>
    p.onChoices({ ...p.choices, included: { ...p.choices.included, ...Object.fromEntries(lineIds.map(id => [id, on])) } });
  const removeCard = (name: string, lineIds: string[]) => {
    if (!lineIds.length) return;
    setRemoved(r => [...r.filter(x => x.name !== name), { name, lineIds }]);
    setIncluded(lineIds, false);
  };
  const removeCards = (cards: { name: string; lineIds: string[] }[]) => {
    const ids = cards.flatMap(c => c.lineIds);
    if (!ids.length) return;
    setRemoved(r => [...r.filter(x => !cards.some(c => c.name === x.name)), ...cards.filter(c => c.lineIds.length)]);
    setIncluded(ids, false);
  };
  /** Several cards at once: one `onChoices` call each would overwrite the last. */
  const setPins = (buyKeys: string[], storeId: string) => {
    if (rung) setHeldOrder({ k: rung.k, ids: stores.map(s => s.id) });
    p.onChoices({ ...p.choices, pins: { ...p.choices.pins, ...Object.fromEntries(buyKeys.map(k => [k, storeId])) } });
  };
  const putBack = (card: { name: string; lineIds: string[] }) => {
    setRemoved(r => r.filter(x => x !== card));
    setIncluded(card.lineIds, true);
  };

  /** Stops the condition, foil and Printing filters from leaving this card's Listings out. */
  const relax = (lineIds: string[], require = false) => {
    const set = (ids: string[]) => Object.fromEntries(ids.map(id => [id, true]));
    p.onChoices({ ...p.choices, relaxed: { ...p.choices.relaxed, ...set(lineIds) }, ...(require ? { required: { ...p.choices.required, ...set(lineIds) } } : {}) });
  };
  const setLock = (lineIds: string[], lock: Lock | null) =>
    p.onChoices({ ...p.choices, locks: { ...p.choices.locks, ...Object.fromEntries(lineIds.map(id => [id, lock])) } });
  // Locking changes a line's key (card + Printing), so the Store pin has to be filed under the new key.
  const buyFrom = (item: { buyKey: string; oracleId: string; lineIds: string[] }, lock: Lock, storeId: string) => {
    if (rung) setHeldOrder({ k: rung.k, ids: stores.map(s => s.id) });
    const pins = { ...p.choices.pins };
    delete pins[item.buyKey];
    pins[`${item.oracleId}|${lock.printingId}:${lock.finish}`] = storeId;
    p.onChoices({ ...p.choices, locks: { ...p.choices.locks, ...Object.fromEntries(item.lineIds.map(id => [id, lock])) }, pins });
  };
  /** Don't buy this card from this Store: the Plan is made again without it. */
  const avoidStore = (item: { lineIds: string[] }, storeId: string) => {
    if (rung) setHeldOrder({ k: rung.k, ids: stores.map(s => s.id) });
    const avoid = { ...p.choices.avoid };
    for (const id of item.lineIds) avoid[id] = [...new Set([...(avoid[id] ?? []), storeId])];
    p.onChoices({ ...p.choices, avoid });
  };
  /** Take a Listing whose Printing isn't known: any Printing is allowed, and the line is pinned to its Store. */
  const pinStore = (item: { buyKey: string; oracleId: string; lineIds: string[] }, storeId: string) => {
    if (rung) setHeldOrder({ k: rung.k, ids: stores.map(s => s.id) });
    const pins = { ...p.choices.pins };
    delete pins[item.buyKey];
    pins[`${item.oracleId}|`] = storeId;
    p.onChoices({ ...p.choices, locks: { ...p.choices.locks, ...Object.fromEntries(item.lineIds.map(id => [id, null])) }, pins });
  };
  const blockListing = (u: UnconfirmedListingView, blocked: boolean, cardName: string) => {
    const next = { ...p.settings.blockedListings };
    if (blocked) next[u.listingId] = `${cardName} · ${u.storeName} · ${u.title}`;
    else delete next[u.listingId];
    p.onSettings({ blockedListings: next });
  };
  const blockPrinting = (printing: PrintingView, blocked: boolean, cardName: string) => {
    const next = { ...p.settings.blockedPrintings };
    if (blocked) next[printing.id] = `${cardName} · ${printing.setName} #${printing.collectorNumber}`;
    else delete next[printing.id];
    p.onSettings({ blockedPrintings: next });
  };
  // Preferred Stores count as part of the order: they cost nothing to add, so their Listings are marked like the Plan's own.
  const planStoreIds = new Set([...stores.map(s => s.id), ...(p.settings.preferredOn ? Object.keys(p.settings.preferredStores) : [])]);
  // A Plan from before the server sent line ids takes them from the wanted cards.
  const leftOut = (rung?.short?.leftOut ?? []).map(l => l.lineIds ? l : { ...l, lineIds: p.ladder.cards.find(c => c.buyKey === l.buyKey)?.lineIds ?? [] });
  const qtyOf = new Map(planCards(stores, leftOut, p.ladder.notFound).map(c => [c.buyKey, c.qty]));
  // For a Store that can't be used (an Australian one that doesn't ship to NZ, say): the Plan is made again without it.
  const excludeStore = (s: StoreView) => {
    setHeldOrder(null);
    p.onSettings({ excludedStores: { ...p.settings.excludedStores, [s.id]: s.name } });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="link" onClick={p.onEdit}>← Edit Want List</Button>
        <div className="text-sm text-slate-500">
          {p.updating ? 'Updating your Plan…' : refining ? 'Finding cheaper Plans…' : 'Final'}
          {p.ladder.kmin !== null && ` · Fewest Stores that cover your list: ${p.ladder.kmin}`}
        </div>
      </div>

      <div className={cx('space-y-6', p.updating && 'opacity-50 pointer-events-none transition-opacity')} aria-busy={p.updating}>
      <OverridesBar
        cards={p.ladder.cards}
        shops={p.ladder.shops}
        onUnavoid={(ids, storeId) => p.onChoices({ ...p.choices, avoid: Object.fromEntries(Object.entries(p.choices.avoid ?? {}).map(([id, list]) => [id, ids.includes(id) ? list.filter(x => x !== storeId) : list])) })}
        choices={p.choices}
        settings={p.settings}
        onUndoRelax={ids => p.onChoices({ ...p.choices, relaxed: { ...p.choices.relaxed, ...Object.fromEntries(ids.map(id => [id, false])) }, required: { ...p.choices.required, ...Object.fromEntries(ids.map(id => [id, false])) } })}
        onUnlock={ids => setLock(ids, null)}
        onUnpin={keys => p.onChoices({ ...p.choices, pins: Object.fromEntries(Object.entries(p.choices.pins ?? {}).filter(([k]) => !keys.includes(k))) })}
        onSettings={p.onSettings}
      />

      <Notices extra={[
          ...(removed.length > 0 ? [{ key: 'removed', label: `${removed.length} removed from your list`, node: (
            <div className="text-sm text-slate-600 dark:text-slate-300">
              Removed from your list:{' '}
              {removed.map((r, n) => (
                <span key={r.name}>
                  {n > 0 && ', '}
                  {r.name} (<Button variant="link" className="text-sm" onClick={() => putBack(r)}>put back</Button>)
                </span>
              ))}
            </div>
          ) }] : []),
          ...(fetchItems.length > 0 ? [{ key: 'fetch', label: 'Fetch TCG checks out together', node: (
            <div className={cx(panel, 'rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 text-sm')}>
              <SourceBadge source="fetch" />
              <span className="flex-1 text-slate-600 dark:text-slate-300">Fetch TCG uses one cart for every seller, so all {fetchItems.length} Fetch Listings in this Plan check out together.</span>
              <Button variant="accent" onClick={() => setCart({ kind: 'fetch', items: fetchItems, k: cartK })}>Open {fetchItems.length} Fetch Listings ↗</Button>
            </div>
          ) }] : []),
        ]} ladder={p.ladder} settings={p.settings} onSettings={p.onSettings} onSearchAgain={p.onSearchAgain} onUnlock={ids => setLock(ids, null)} onRelax={relax} />

      <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden text-sm" role="group" aria-label="View">
        {([['plans', 'Plans'], ['shops', 'Browse by Store']] as const).map(([m, label]) => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
            className={cx('px-3 py-1', mode === m ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>{label}</button>
        ))}
      </div>

      {mode === 'shops' && (
        <ShopsView ladder={p.ladder} preferred={p.settings.preferredOn ? p.settings.preferredStores : {}}
          onBuyAll={(picks: StorePick[], storeId) => {
            // A chosen Printing is locked, which changes the line's key, so its pin is filed under the new key.
            const pins = { ...p.choices.pins };
            const locks = { ...p.choices.locks };
            for (const pick of picks) {
              delete pins[pick.buyKey];
              if (pick.lock) for (const id of pick.lineIds) locks[id] = pick.lock;
              pins[pick.lock ? `${pick.oracleId}|${pick.lock.printingId}:${pick.lock.finish}` : pick.buyKey] = storeId;
            }
            if (rung) setHeldOrder({ k: rung.k, ids: stores.map(s => s.id) });
            p.onChoices({ ...p.choices, locks, pins });
            setMode('plans');
          }}
          onPrefer={s => {
            const { [s.id]: _gone, ...rest } = p.settings.preferredStores;
            p.onSettings({ preferredStores: p.settings.preferredStores[s.id] ? rest : { ...p.settings.preferredStores, [s.id]: s.name } });
          }}
          onExclude={s => p.onSettings({ excludedStores: { ...p.settings.excludedStores, [s.id]: s.name } })} />
      )}

      <div className={cx('space-y-6', mode === 'shops' && 'hidden')}>
      {p.ladder.rungs.length > 0 && (
        <section>
          <h2 className="font-semibold mb-2">How many Stores do you want to order from?</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {p.ladder.rungs.map(r => (
              <RungCard key={r.k} r={r} preferred={hasPreferred} selected={rung?.k === r.k} onSelect={() => p.onSelect(r.k)} onTryLonger={() => void api.tryLonger(p.runId, r.k)} />
            ))}
          </div>
        </section>
      )}

      <CardKingdomPanel
        ck={p.ladder.cardKingdom}
        planTotal={rung?.total ?? null}
        leftOut={rung?.short?.cardKingdom ? { ck: rung.short.cardKingdom, count: rung.short.wanted - rung.short.covered, planTotal: rung.total } : null}
        split={p.ladder.cardKingdom && base && !base.short && base.total !== null
          ? <SplitPanel runId={p.runId} planId={p.ladder.planId} k={base.k} onTakeOut={removeCards} />
          : undefined}
      />

      {rung && rung.total !== null && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">
              Your {storeCountLabel(rung.k, hasPreferred)} Plan
              {rung.runnerUp && <span className="font-normal text-indigo-600 dark:text-indigo-400"> · runner-up</span>}
              {rung.short && <span className="font-normal text-amber-600 dark:text-amber-400"> · leaves out {rung.short.wanted - rung.short.covered} of {rung.short.wanted} cards</span>}
              {rung.short && rung.short.premium > 0 && (
                <span className="block text-xs font-normal text-slate-500" title="Compared with each card's cheapest price at any Store, before postage.">
                  These Stores charge {money(rung.short.premium)} more than the cheapest price anywhere for the cards they cover.
                </span>
              )}
            </h2>
            <div className="tabnum text-lg font-bold" title={`cards ${money(rung.cards)} + postage ${money(rung.postage)}`}>
              {money(rung.total)}
              <span className="ml-2 text-xs font-normal text-slate-500">Landed Cost · cards {money(rung.cards)} + postage {money(rung.postage)}</span>
            </div>
            {rung.pickupHints.length > 0 && (
              <div className="text-xs text-emerald-700 dark:text-emerald-400">
                {rung.pickupHints.map(h => `Pickup available at ${h.name}, saves ${money(h.saves)}`).join(' · ')}
              </div>
            )}
          </div>
          {/* The two toggles share one left-aligned line, so they wrap together instead of splitting to opposite ends. */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden text-sm" role="group" aria-label="Group by">
              {(['stores', 'cards'] as const).map(v => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
                  className={cx('px-3 py-1 whitespace-nowrap', view === v ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>
                  By {v === 'stores' ? 'Store' : 'card'}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 overflow-hidden text-sm" role="group" aria-label="Sort cards by">
              {(['name', 'price'] as const).map(v => (
                <button key={v} type="button" aria-pressed={sortBy === v} onClick={() => setSortBy(v)} title={v === 'price' ? 'Sort by price, dearest first' : 'Sort by name, A to Z'}
                  className={cx('px-3 py-1 whitespace-nowrap', sortBy === v ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>
                  {v === 'price' ? 'Price' : 'Name'}
                </button>
              ))}
            </div>
          </div>
          {base && !base.next && !rung.runnerUp && (
            <div className="text-sm flex flex-wrap items-center gap-2">
              {base.noRunnerUp
                ? <span className="text-slate-500">There is no other {storeCountLabel(base.k, hasPreferred)} Plan with different Stores.</span>
                : (
                  <>
                    <Button variant="link" className="text-sm" disabled={finding === base.k} title="The next best Plan with different Stores, to compare what you leave out."
                      onClick={() => { setFinding(base.k); void api.runnerUp(p.runId, base.k); }}>
                      {finding === base.k ? 'Looking…' : 'Find the runner-up Plan'}
                    </Button>
                  </>
                )}
            </div>
          )}
          {base?.next && (
            <div className="text-sm flex flex-wrap items-center gap-2">
              <Button className="text-xs py-1" onClick={() => setShowRunnerUp(!showRunnerUp)} aria-pressed={showRunnerUp}>
                {showRunnerUp ? '← Back to the best Plan' : 'See the runner-up Plan'}
              </Button>
              <span className="text-slate-500">
                {showRunnerUp
                  ? `The best ${storeCountLabel(base.k, hasPreferred)} Plan is ${money(base.total ?? 0)}${base.short ? ` and covers ${base.short.covered} of ${base.short.wanted} cards` : ''}.`
                  : `Different Stores: ${money(base.next.total ?? 0)} (${runnerUpDiff(base)})`}
              </span>
            </div>
          )}
          {rung.short && leftOut.length > 0 && (
            <CardList
              tone="warn"
              bulk={leftOut.some(l => l.waivable !== false && l.lineIds.length) ? { label: "Don't exclude any of these", onClick: () => relax(leftOut.filter(l => l.waivable !== false).flatMap(l => l.lineIds), true) } : undefined}
              title={`Left out of this Plan (${rung.short.wanted - rung.short.covered})`}
              note={`${rung.k} Store${rung.k > 1 ? 's' : ''} can't supply your whole list. These are the fewest cards to leave out; pick a bigger Plan to include them.`}
              cards={leftOut.map(l => ({
                key: l.buyKey, name: l.name, qty: l.missing, image: l.image, note: l.note,
                actions: l.waivable !== false && l.lineIds.length ? [{ label: "Don't exclude this card", onClick: () => relax(l.lineIds, true) }] : [],
              }))}
            />
          )}
          {view === 'cards' && <CardsView sortBy={sortBy} runId={p.runId} planStoreIds={planStoreIds} onBuyFrom={buyFrom} onPinStore={pinStore} onBlock={blockPrinting} onBlockListing={blockListing} onLock={setLock} stores={stores} leftOut={leftOut} notFound={p.ladder.notFound} offers={p.ladder.offers} pins={p.choices.pins ?? {}} onPin={setPin} onRemove={removeCard} onRelax={relax} />}
          {view === 'stores' && stores.map(s => (
            <StoreSection key={s.id} sortBy={sortBy} store={s} runId={p.runId} settings={p.settings} onSettings={onStoreSettings}
              elsewhere={cardsElsewhere(s.id, cards, p.ladder.offers)} pins={p.choices.pins ?? {}} onPin={setPin} onPinAll={setPins}
              onCart={() =>
                setCart(
                  s.cart === 'fetch'
                    ? { kind: 'fetch', items: s.items, k: cartK, seller: s.name }
                    : { kind: 'store', store: s, k: cartK, tab: s.cart === 'shopify' ? openCartTab(s.name) : undefined },
                )
              }
              onLock={setLock} onRemove={removeCard} planStoreIds={planStoreIds} qtyOf={qtyOf} onBuyFrom={buyFrom} onPinStore={pinStore} onBlock={blockPrinting} onBlockListing={blockListing} onAvoid={avoidStore} onExclude={() => excludeStore(s)} />
          ))}
        </section>
      )}
      </div>
      </div>
      {cart && <CartDialog runId={p.runId} target={cart} onClose={() => setCart(c => (c === cart ? null : c))} />}
    </div>
  );
}

function CardsView({ sortBy, runId, planStoreIds, onBuyFrom, onPinStore, onBlock, onBlockListing, onLock, stores, leftOut, notFound, offers, pins, onPin, onRemove, onRelax }: { sortBy: 'name' | 'price'; runId: string; planStoreIds: Set<string>; onBuyFrom: (item: ItemView, lock: Lock, storeId: string) => void; onPinStore: (item: ItemView, storeId: string) => void; onBlock: PrintingActions['onBlock']; onBlockListing: PrintingActions['onBlockListing']; onLock: (lineIds: string[], lock: Lock | null) => void; stores: StoreView[]; leftOut: LeftOutView[]; notFound: NotFoundView[]; offers: Record<string, OfferView[]>; pins: Record<string, string>; onPin: (buyKey: string, storeId: string | null) => void; onRemove: (name: string, lineIds: string[]) => void; onRelax: (lineIds: string[]) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [printingsOpen, setPrintingsOpen] = useState<string | null>(null);
  const cost = (c: { bought: { item: ItemView }[] }) => c.bought.reduce((n, b) => n + b.item.price * b.item.qty, 0);
  const cards = planCards(stores, leftOut, notFound);
  // Dearest first; cards with nothing bought (left out, Not Found) go last, still by name.
  if (sortBy === 'price') cards.sort((a, b) => cost(b) - cost(a) || a.name.localeCompare(b.name));
  return (
    <ul className={cx(panel, 'rounded-xl divide-y divide-slate-100 dark:divide-slate-800')}>
      {cards.map(c => {
        const all = offers[c.buyKey] ?? [];
        const chosen = new Set(c.bought.map(b => b.item.listingId));
        // One chip per card: the dearest Listing over CardKingdom, else the best bargain under it.
        const ratio = (i: ItemView) => i.price / i.cardKingdomNzd!;
        const items = c.bought.map(b => b.item).filter(i => i.cardKingdomNzd !== null);
        const worst = items.filter(i => i.overCardKingdom).sort((a, b) => ratio(b) - ratio(a))[0]
          ?? items.filter(i => i.underCardKingdom).sort((a, b) => ratio(a) - ratio(b))[0];
        return (
          <li key={c.buyKey} className="px-4 py-2 text-sm">
            <div className="flex items-start gap-3">
              <CardImage src={c.image} alt={c.name} className="w-10 aspect-[5/7] rounded shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabnum text-slate-500">{c.qty}×</span>
                  <span className="font-medium">{c.name}</span>
                  {worst && <CardKingdomChip price={worst.price} cardKingdomNzd={worst.cardKingdomNzd!} unsure={unsure(worst.condition, worst.printing?.id ?? null)} />}
                  {c.notFound && <Tag tone="warn">{c.bought.length ? `${c.missing} not found` : 'Not found'}</Tag>}
                  {!c.notFound && c.missing > 0 && <Tag tone="warn">{c.bought.length ? `${c.missing} left out of this Plan` : 'Left out of this Plan'}</Tag>}
                  {c.lineIds.length > 0 && <RemoveButton className="ml-auto" name={c.name} onClick={() => onRemove(c.name, c.lineIds)} />}
                </div>
                {c.waivable && <Button variant="link" className="text-xs mt-1" onClick={() => onRelax(c.lineIds)}>Don't exclude this card</Button>}
                <ul className="mt-1 space-y-0.5">
                  {c.bought.map(({ store, item }) => (
                    <li key={item.listingId} className="flex flex-wrap items-center gap-2">
                      <span>{item.qty}× from <span className="font-medium">{store.name}</span></span>
                      <span className="text-xs text-slate-500 truncate">{item.printing?.label ?? item.title}</span>
                      <span className="tabnum ml-auto">{money(item.price)}</span>
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap">View listing ↗</a>
                    </li>
                  ))}
                </ul>
                {pins[c.buyKey] && (
                  <div className="text-xs mt-1 text-indigo-600 dark:text-indigo-400">
                    📌 You chose this Store. <Button variant="link" className="text-xs" onClick={() => onPin(c.buyKey, null)}>Let MagicFinder choose</Button>
                  </div>
                )}
                {c.lineIds.length > 0 && c.bought.length > 0 && (
                  <Button variant="link" className="text-xs mt-1 mr-3" onClick={() => setPrintingsOpen(printingsOpen === c.buyKey ? null : c.buyKey)}>
                    {printingsOpen === c.buyKey ? 'hide Printings' : 'Printings & Stores'}
                  </Button>
                )}
                {all.length > chosen.size && (
                  <Button variant="link" className="text-xs mt-1" onClick={() => setOpen(open === c.buyKey ? null : c.buyKey)}>
                    {open === c.buyKey ? 'hide other Stores' : `${all.length - chosen.size} other Listing${all.length - chosen.size > 1 ? 's' : ''}`}
                  </Button>
                )}
              </div>
            </div>
            {printingsOpen === c.buyKey && c.bought.length > 0 && (
              <PrintingGrid runId={runId} lineId={c.lineIds[0]} planStoreIds={planStoreIds} need={c.qty} current={c.bought.map(b => ({ storeId: b.store.id, printingId: b.item.printing?.id ?? null, finish: b.item.finish }))} onBlock={onBlock} onBlockListing={onBlockListing}
                onLock={lock => { onLock(c.lineIds, lock); setPrintingsOpen(null); }}
                onBuyFrom={(lock, storeId) => { onBuyFrom(c.bought[0].item, lock, storeId); setPrintingsOpen(null); }}
                onPinStore={storeId => { onPinStore(c.bought[0].item, storeId); setPrintingsOpen(null); }} />
            )}
            {open === c.buyKey && (
              <div className="mt-3 grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {all.filter(o => !chosen.has(o.listingId)).map(o => {
                  const canCover = costAtStore(all, o.storeId, c.qty) !== null;
                  return (
                    <div key={o.listingId} className="flex flex-col min-w-0 rounded-xl p-2 bg-slate-50 dark:bg-slate-800 text-xs">
                      <CardImage src={o.image} alt={c.name} className="w-full aspect-[5/7] rounded-lg" />
                      <div className="mt-1 font-semibold text-sm leading-tight break-words" title={o.storeName}>{o.storeName}</div>
                      <div className="h-8 overflow-hidden text-[11px] text-slate-600 dark:text-slate-300">{o.label}</div>
                      <div className="flex flex-wrap items-center gap-1 my-1">
                        {o.condition && <Tag>{o.condition}</Tag>}
                        {o.finish !== 'nonfoil' && <Tag>{o.finish === 'foil' ? 'Foil' : 'Etched'}</Tag>}
                        {(o.overCardKingdom || o.underCardKingdom) && o.cardKingdomNzd !== null && <CardKingdomChip price={o.price} cardKingdomNzd={o.cardKingdomNzd} unsure={unsure(o.condition, o.printingId)} />}
                      </div>
                      <div className="text-sm font-semibold tabnum">{money(o.price)}</div>
                      <div className="text-[11px] text-slate-500">{o.qty} in stock</div>
                      <a href={o.url} target="_blank" rel="noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">View listing ↗</a>
                      <Button className="w-full mt-auto text-xs py-1" disabled={!canCover} title={canCover ? undefined : `${o.storeName} doesn't have all ${c.qty}`}
                        onClick={() => onPin(c.buyKey, o.storeId)}>Buy here</Button>
                    </div>
                  );
                })}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const usd = (n: number) => `US$${n.toFixed(2)}`;

/** Moves the dearest cards to CardKingdom one at a time and totals every step, so the cut-off can be picked by eye. */
function SweepTable({ runId, planId, k, onTakeOut }: { runId: string; planId: number; k: number; onTakeOut: (cards: { name: string; lineIds: string[] }[]) => void }) {
  const [state, setState] = useState<{ planId: number; k: number; busy?: boolean; result?: SweepView; error?: string } | null>(null);
  const mine = state && state.planId === planId && state.k === k ? state : null;
  const run = async () => {
    setState({ planId, k, busy: true });
    try {
      setState({ planId, k, result: await api.sweep(runId, k) });
    } catch (e) {
      setState({ planId, k, error: (e as Error).message });
    }
  };
  const r = mine?.result;
  const base = r?.points[0]?.n === 0 ? r.points[0].total : null;
  const worst = r ? Math.max(...r.points.map(x => x.total)) : 0;
  const best = r ? r.points[r.best] : null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={mine?.busy} onClick={run}>{mine?.busy ? 'Comparing…' : r ? 'Compare again' : 'Compare by price, dearest first'}</Button>
        <span className="text-xs text-slate-500">Moves your dearest cards to CardKingdom one at a time and totals each step, with the rest from the NZ Stores.</span>
      </div>
      {mine?.error && <Notice tone="warn">{mine.error}</Notice>}
      {r && best && base !== null && (
        <div className="space-y-2 text-sm">
          <div>
            {best.n === 0
              ? <>Moving cards to CardKingdom never beats the NZ Stores alone ({money(base)}).</>
              : <>Cheapest: move the dearest <span className="font-semibold">{best.n} card{best.n > 1 ? 's' : ''}</span> to CardKingdom for <span className="font-semibold tabnum">{money(best.total)}</span>, <span className="tabnum text-emerald-600 dark:text-emerald-400">{money(base - best.total)} less</span> than the NZ Stores alone ({money(base)}).</>}
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs tabnum">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900 text-slate-500">
                <tr><th className="text-left p-1.5">Dearest cards at CardKingdom</th><th className="text-right p-1.5">CardKingdom</th><th className="text-right p-1.5">NZ Stores</th><th className="text-right p-1.5">Total</th><th className="p-1.5 w-40" aria-label="Compared with the others" /><th /></tr>
              </thead>
              <tbody>
                {r.points.map((x, i) => (
                  <tr key={x.n} className={cx('border-t border-slate-100 dark:border-slate-800', i === r.best && 'bg-emerald-50 dark:bg-emerald-950/30 font-semibold')}>
                    <td className="p-1.5 truncate max-w-[16rem]" title={r.order.slice(0, x.n).map(o => o.name).join(', ')}>
                      {x.n === 0 ? 'None: all NZ' : <>{x.n} · up to <span className="font-normal">{r.order[x.n - 1].name}</span></>}
                    </td>
                    <td className="p-1.5 text-right">{x.n ? money(x.ckTotal) : '—'}</td>
                    <td className="p-1.5 text-right">{money(x.nzTotal)}{x.status === 'timed-out' && <span title="Ran out of time; might be a little lower"> ~</span>}</td>
                    <td className="p-1.5 text-right">{money(x.total)}</td>
                    <td className="p-1.5">
                      <div className="h-2 rounded bg-slate-100 dark:bg-slate-800">
                        <div className={cx('h-2 rounded', i === r.best ? 'bg-emerald-500' : 'bg-indigo-400')} style={{ width: `${Math.max(4, (x.total / worst) * 100)}%` }} />
                      </div>
                    </td>
                    <td className="p-1.5 text-right">
                      {x.n > 0 && <Button variant="link" className="text-xs" onClick={() => onTakeOut(r.order.slice(0, x.n).map(o => ({ name: o.name, lineIds: o.lineIds })))}>take out</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-slate-500">CardKingdom totals include US${r.shippingUsd.toFixed(2)} shipping once, and GST. "Take out" unticks those cards so the Plan is the NZ part; the CardKingdom panel lists them.</div>
        </div>
      )}
    </div>
  );
}

/** Works out which cards are better bought at CardKingdom (one shipping charge plus GST) and which from the NZ Stores. */
function SplitPanel({ runId, planId, k, onTakeOut }: { runId: string; planId: number; k: number; onTakeOut: (cards: { name: string; lineIds: string[] }[]) => void }) {
  const [state, setState] = useState<{ planId: number; k: number; busy?: boolean; result?: SplitView; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const mine = state && state.planId === planId && state.k === k ? state : null;
  const run = async () => {
    setState({ planId, k, busy: true });
    try {
      setState({ planId, k, result: await api.split(runId, k) });
    } catch (e) {
      setState({ planId, k, error: (e as Error).message });
    }
  };
  const r = mine?.result;
  const useful = !!r?.ck && r.saves >= 0.5;
  const copy = async () => {
    if (!r?.ck) return;
    try {
      await navigator.clipboard.writeText(r.ck.items.map(i => `${i.qty} ${i.name}`).join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="border-t border-slate-200 dark:border-slate-800 px-4 py-3 space-y-2">
      <div className="font-semibold">Split between CardKingdom and the NZ Stores</div>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={mine?.busy} onClick={run}>{mine?.busy ? 'Working it out…' : r ? 'Work it out again' : 'Work out the best split'}</Button>
        <span className="text-xs text-slate-500">Shipping is paid once at CardKingdom, so a few dear cards can be worth adding to one order.</span>
      </div>
      {mine?.error && <Notice tone="warn">{mine.error}</Notice>}
      <SweepTable runId={runId} planId={planId} k={k} onTakeOut={onTakeOut} />
      {r && (
        <div className="space-y-2 text-sm">
          {useful ? (
            <div>
              Buy <span className="font-semibold">{r.ck!.items.reduce((s, i) => s + i.qty, 0)} cards at CardKingdom</span> and the rest from the NZ Stores:{' '}
              <span className="font-semibold tabnum">{money(r.split)}</span>, which is <span className="font-semibold tabnum text-emerald-600 dark:text-emerald-400">{money(r.saves)} less</span> than the NZ Stores alone ({money(r.nzOnly)})
              {r.ckOnly !== null && <> and {money(r.ckOnly - r.split)} less than everything from CardKingdom ({money(r.ckOnly)})</>}.
            </div>
          ) : (
            <div>No card is cheap enough at CardKingdom to make up for its shipping: stay with the NZ Plan at <span className="font-semibold tabnum">{money(r.nzOnly)}</span>
              {r.ckOnly !== null && <> (everything from CardKingdom would be {money(r.ckOnly)})</>}.</div>
          )}
          {r.status === 'timed-out' && <div className="text-xs text-amber-700 dark:text-amber-400">This ran out of time, so a slightly better split may exist.</div>}
          {useful && r.ck && (
            <div className="grid md:grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="font-medium mb-1">At CardKingdom · {money(r.ck.totalNzd)}</div>
                <ul className="space-y-0.5">
                  {r.ck.items.map(i => (
                    <li key={`${i.buyKey}:${i.label}:${i.finish}`} className="flex gap-2 tabnum">
                      <span className="text-slate-500">{i.qty}×</span>
                      <a href={i.url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 truncate hover:underline" title={i.label}>{i.name}{i.finish !== 'nonfoil' && ' (foil)'}</a>
                      <span>{money(i.priceNzd * i.qty)}</span>
                    </li>
                  ))}
                </ul>
                <div className="text-xs text-slate-500 mt-1 tabnum">
                  cards {usd(r.ck.subtotalUsd)} + shipping {usd(r.ck.shippingUsd)}, converted, with GST where it applies
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                <div className="font-medium mb-1">From the NZ Stores · {money(r.nz.total)}</div>
                <ul className="space-y-0.5">
                  {r.nz.stores.map(s => (
                    <li key={s.id} className="flex gap-2 tabnum">
                      <span className="flex-1 min-w-0 truncate">{s.name}</span>
                      <span className="text-slate-500">{s.cards} card{s.cards > 1 ? 's' : ''}</span>
                      <span>{money(s.subtotal + s.postage)}</span>
                    </li>
                  ))}
                  {!r.nz.stores.length && <li className="text-slate-500">Nothing: everything is cheaper at CardKingdom.</li>}
                </ul>
              </div>
            </div>
          )}
          {useful && r.ck && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={copy}>{copied ? 'Copied' : 'Copy the CardKingdom list'}</Button>
              <Button variant="accent" onClick={() => onTakeOut(r.ck!.items.map(i => ({ name: i.name, lineIds: i.lineIds })))}
                title="Takes these cards off the Plan (they stay on your Want List, ticked off) so the Plan is the NZ part only. You can put them back.">
                Take them out of the Plan
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** CardKingdom against the whole list and, for a Short Plan, against just the cards it leaves out: one row, details behind a toggle. */
function CardKingdomPanel({ ck, planTotal, leftOut, split }: { split?: ReactNode; ck: CardKingdomView | null; planTotal: number | null; leftOut?: { ck: CardKingdomView; count: number; planTotal: number | null } | null }) {
  const [open, setOpen] = useState(false);
  const [cardsOpen, setCardsOpen] = useState<Record<string, boolean>>({});
  const parts = [
    ck?.items.length ? { key: 'all', ck, label: 'Whole list', planTotal, alongside: null as number | null } : null,
    leftOut?.ck.items.length ? { key: 'left', ck: leftOut.ck, label: `${leftOut.count} left-out cards`, planTotal: null, alongside: leftOut.planTotal } : null,
  ].filter((x): x is NonNullable<typeof x> => !!x);
  if (!parts.length) return null;
  const notSold = parts.reduce((n, x) => n + x.ck.missing.reduce((m, c) => m + c.missing, 0), 0);
  return (
    <section className={cx(panel, 'rounded-xl')}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3">
        <div className="font-semibold">Compare: CardKingdom (USA)</div>
        {parts.map(x => {
          // A CardKingdom total that leaves cards out isn't comparable with the Plan's, so no "less/more" then.
          const diff = x.planTotal === null || x.ck.missing.length ? null : Math.round((x.ck.totalNzd - x.planTotal) * 100) / 100;
          const whole = x.alongside !== null && !x.ck.missing.length ? Math.round((x.alongside + x.ck.totalNzd) * 100) / 100 : null;
          return (
            <div key={x.key} className="flex items-baseline gap-2">
              {parts.length > 1 && <span className="text-xs text-slate-500">{x.label}</span>}
              <span className="text-xl font-bold tabnum">{money(x.ck.totalNzd)}</span>
              {diff !== null && diff !== 0 && (
                <span className={cx('text-sm tabnum', diff < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500')}>
                  {money(Math.abs(diff))} {diff < 0 ? 'less' : 'more'} than the Plan
                </span>
              )}
              {whole !== null && <span className="text-sm text-slate-500 tabnum">Plan + this = <span className="font-semibold text-slate-900 dark:text-slate-100">{money(whole)}</span></span>}
            </div>
          );
        })}
        {notSold > 0 && <Tag tone="warn">{notSold} not sold there</Tag>}
        <Button variant="link" className="ml-auto text-sm" onClick={() => setOpen(!open)}>{open ? 'hide' : split ? 'details & split' : 'details'}</Button>
      </div>
      {open && parts.map(x => (
        <div key={x.key} className="border-t border-slate-200 dark:border-slate-800">
          <div className="px-4 pt-2 pb-1 text-xs text-slate-500 tabnum space-y-1">
            <div>
              {parts.length > 1 && <span className="font-semibold">{x.label}: </span>}
              cards {usd(x.ck.subtotalUsd)} + shipping {usd(x.ck.shippingUsd)} = {usd(x.ck.totalUsd)} at {x.ck.usdToNzd.toFixed(4)} NZD/USD
              {x.ck.gstNzd > 0 && <>, + {money(x.ck.gstNzd)} GST</>}
              <Button variant="link" className="ml-3 text-xs" onClick={() => setCardsOpen({ ...cardsOpen, [x.key]: !cardsOpen[x.key] })}>
                {cardsOpen[x.key] ? 'hide cards' : `show ${x.ck.items.length} card${x.ck.items.length > 1 ? 's' : ''}`}
              </Button>
            </div>
            {x.ck.missing.length > 0 && (
              <div className="text-amber-700 dark:text-amber-400">
                Not available at CardKingdom: {x.ck.missing.map(m => `${m.missing}× ${m.name}`).join(', ')}. Its total leaves these out, so it isn't compared with the Plan.
              </div>
            )}
          </div>
          {cardsOpen[x.key] && <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {x.ck.items.map(i => (
              <li key={`${i.buyKey}:${i.label}:${i.finish}`} className="px-4 py-2 flex items-center gap-3 text-sm">
                <span className="tabnum text-slate-500">{i.qty}×</span>
                <span className="font-medium">{i.name}</span>
                {i.finish !== 'nonfoil' && <Tag>Foil</Tag>}
                <span className="text-xs text-slate-500 truncate flex-1">{i.label}</span>
                <span className="tabnum text-slate-500">{usd(i.priceUsd)}</span>
                <span className="tabnum">{money(i.priceNzd)}</span>
                <a href={i.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap">View ↗</a>
              </li>
            ))}
          </ul>}
        </div>
      ))}
      {split && <div className={open ? '' : 'hidden'}>{split}</div>}
    </section>
  );
}

/** Stores in the held order; any Store not in it (a re-plan can bring new ones) goes after, in the server's order. */
function keepOrder(stores: StoreView[], ids: string[] | null): StoreView[] {
  if (!ids) return stores;
  const pos = new Map(ids.map((id, i) => [id, i]));
  return [...stores].sort((a, b) => (pos.get(a.id) ?? ids.length) - (pos.get(b.id) ?? ids.length));
}

const storeCountLabel = (k: number, preferred: boolean) =>
  k === 0 ? 'preferred-Stores-only' : `${k}-Store${preferred ? ' + preferred' : ''}`;

/** How a runner-up differs from the best Plan: price, and for a Short Plan the cards it covers. */
function runnerUpDiff(r: RungView): string {
  const next = r.next!;
  const diff = (next.total ?? 0) - (r.total ?? 0);
  const price = diff === 0 ? 'same price' : `${diff > 0 ? '+' : '−'}${money(Math.abs(diff))}`;
  if (!r.short || !next.short) return price;
  const cards = next.short.covered - r.short.covered;
  return `${price}, ${cards === 0 ? 'same number of cards' : `${Math.abs(cards)} ${cards > 0 ? 'more' : 'fewer'} card${Math.abs(cards) > 1 ? 's' : ''}`}`;
}

function RungCard({ r, preferred, selected, onSelect, onTryLonger }: { r: RungView; preferred: boolean; selected: boolean; onSelect: () => void; onTryLonger: () => void }) {
  if (r.total === null) {
    return (
      <div className="min-w-[190px] rounded-xl p-3 ring-1 ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900 text-sm">
        <div className="text-slate-500">{r.k} Store{r.k > 1 ? 's' : ''}{preferred && ' + preferred'}</div>
        <div className="my-1">Couldn't find a {r.k}-Store Plan in time.</div>
        <Button variant="link" onClick={onTryLonger}>Try longer</Button>
      </div>
    );
  }
  return (
    <button type="button" onClick={onSelect}
      className={cx('min-w-[180px] text-left rounded-xl border-2 p-3 bg-white dark:bg-slate-900 transition', selected ? 'border-indigo-500 shadow-md' : 'border-transparent ring-1 ring-slate-200 dark:ring-slate-800 hover:ring-slate-400')}>
      <div className="text-sm text-slate-500">
        {r.k === 0 ? 'Preferred Stores only' : <>{r.k} Store{r.k > 1 ? 's' : ''}{preferred && ' + preferred'}</>}
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

function Notices({ ladder, settings, onSettings, onSearchAgain, onUnlock, onRelax, extra = [] }: { extra?: { key: string; label: string; node: ReactNode }[]; ladder: LadderView; settings: Settings; onSettings: (p: Partial<Settings>) => void; onSearchAgain: () => void; onUnlock: (ids: string[]) => void; onRelax: (ids: string[]) => void }) {
  const [copied, setCopied] = useState(false);
  const troubled = ladder.sources.filter(s => s.status !== 'ok' && s.status !== 'off');
  const skipped = ladder.sources.filter(s => s.status === 'ok' && s.notSearched.length > 0);
  const allFailed = ladder.sources.filter(s => s.status !== 'off').every(s => s.status !== 'ok') && ladder.rungs.length === 0;
  const notFoundCount = ladder.notFound.reduce((n, x) => n + x.missing, 0);
  const summary = [
    troubled.length + skipped.length > 0 && `${troubled.length + skipped.length} Source problem${troubled.length + skipped.length > 1 ? 's' : ''}`,
    notFoundCount > 0 && `${notFoundCount} Not Found`,
    ladder.unrecognised.length > 0 && `${ladder.unrecognised.length} not recognised`,
    ladder.skippedBasics.length > 0 && 'basic lands skipped',
    ladder.unidentified.length > 0 && `${ladder.unidentified.length} unmatched Listing${ladder.unidentified.length > 1 ? 's' : ''}`,
    settings.useListPrintings && "using your list's Printings",
    ...extra.map(e => e.label),
  ].filter((x): x is string => !!x);
  return (
    <div className="space-y-2">
      {allFailed && <Notice tone="bad">No Source could be searched, so there's no Plan this time. Check your internet connection and try again.</Notice>}
      <HeadsUp summary={summary} urgent={troubled.length > 0 || notFoundCount > 0 || ladder.unrecognised.length > 0}>
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
              excludedNote(n, settings),
            ].filter(Boolean).join(' · '),
            actions: [
              ...(n.locked ? [{ label: 'locked to one printing: allow any printing', onClick: () => onUnlock(n.lineIds) }] : []),
              ...(isWaivable(n) ? [{ label: "Don't exclude this card", onClick: () => onRelax(n.lineIds) }] : []),
            ],
          }))}
        />
      )}
      {ladder.unrecognised.length > 0 && <Notice tone="bad">Couldn't recognise: {ladder.unrecognised.join(' · ')}</Notice>}
      {ladder.skippedBasics.length > 0 && (
        <Notice tone="info">
          Skipped basic lands: {ladder.skippedBasics.join(', ')}. <Button variant="link" onClick={() => onSettings({ includeBasics: true })}>include them</Button>
        </Notice>
      )}
      {ladder.unidentified.length > 0 && <Unidentified listings={ladder.unidentified} />}
      {settings.useListPrintings && <Notice tone="info">Using the Printings from your list. <Button variant="link" onClick={() => onSettings({ useListPrintings: false })}>Stop</Button></Notice>}
      {extra.map(e => <div key={e.key}>{e.node}</div>)}
      </HeadsUp>
    </div>
  );
}

/** Everything the buyer has overridden for this Plan, in one place, each with a way to undo it. */
function OverridesBar({ cards, shops, choices, settings, onUnavoid, onUndoRelax, onUnlock, onUnpin, onSettings }: {
  cards: LadderView['cards']; shops: LadderView['shops']; choices: PlanChoices; settings: Settings;
  onUnavoid: (lineIds: string[], storeId: string) => void; onUndoRelax: (lineIds: string[]) => void; onUnlock: (lineIds: string[]) => void; onUnpin: (keys: string[]) => void; onSettings: (p: Partial<Settings>) => void;
}) {
  const [open, setOpen] = useState(true);
  const chips: { key: string; kind: string; text: string; undo: () => void; undoLabel: string }[] = [];
  for (const c of cards) {
    for (const storeId of new Set(c.lineIds.flatMap(id => choices.avoid?.[id] ?? []))) {
      chips.push({ key: `avoid:${c.buyKey}:${storeId}`, kind: 'Not from', text: `${shops.find(x => x.id === storeId)?.name ?? storeId}: ${c.name}`, undo: () => onUnavoid(c.lineIds, storeId), undoLabel: 'Allow again' });
    }
    if (c.lineIds.some(id => choices.relaxed?.[id])) chips.push({ key: `relax:${c.buyKey}`, kind: "Don't exclude", text: c.name, undo: () => onUndoRelax(c.lineIds), undoLabel: 'Exclude again' });
    if (c.lineIds.some(id => choices.locks[id])) chips.push({ key: `lock:${c.buyKey}`, kind: 'Locked to one Printing', text: c.name, undo: () => onUnlock(c.lineIds), undoLabel: 'Allow any Printing' });
  }
  // "Move all here" can pin dozens of cards, so a long list collapses into one chip.
  const pinned = cards.filter(c => choices.pins?.[c.buyKey]);
  if (pinned.length > 4) chips.push({ key: 'pins', kind: 'Pinned to Stores', text: `${pinned.length} cards`, undo: () => onUnpin(pinned.map(c => c.buyKey)), undoLabel: 'Unpin all' });
  else for (const c of pinned) chips.push({ key: `pin:${c.buyKey}`, kind: 'Pinned to a Store', text: c.name, undo: () => onUnpin([c.buyKey]), undoLabel: 'Unpin' });
  for (const [id, label] of Object.entries(settings.blockedPrintings)) {
    chips.push({ key: `block:${id}`, kind: "Don't use this Printing", text: label, undoLabel: 'Allow again', undo: () => { const { [id]: _gone, ...rest } = settings.blockedPrintings; onSettings({ blockedPrintings: rest }); } });
  }
  for (const [id, label] of Object.entries(settings.blockedListings)) {
    chips.push({ key: `listing:${id}`, kind: "Don't use this Listing", text: label, undoLabel: 'Allow again', undo: () => { const { [id]: _gone, ...rest } = settings.blockedListings; onSettings({ blockedListings: rest }); } });
  }
  if (!chips.length) return null;
  return (
    <section className={cx(panel, 'rounded-xl px-4 py-3')} aria-label="Your overrides">
      <button type="button" className="w-full flex items-center justify-between gap-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="font-semibold text-sm">Your overrides ({chips.length})</span>
        <span className="text-xs text-slate-500 whitespace-nowrap">{open ? 'hide ▴' : 'show ▾'}</span>
      </button>
      {open && <ul className="flex flex-wrap gap-2 mt-2">
        {chips.map(c => (
          <li key={c.key} className="inline-flex items-center gap-2 rounded-full border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 pl-3 pr-1 py-0.5 text-xs">
            <span><span className="text-slate-500">{c.kind}:</span> <span className="font-medium">{c.text}</span></span>
            <Button variant="link" className="text-xs px-1" onClick={c.undo}>{c.undoLabel}</Button>
          </li>
        ))}
      </ul>}
    </section>
  );
}

/** Every notice behind one line, so the Plan isn't pushed down the page; opens to the details. */
function HeadsUp({ summary, urgent, children }: { summary: string[]; urgent: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!summary.length) return null;
  return (
    <div className={cx('border rounded-lg text-sm', urgent
      ? 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-200'
      : 'bg-slate-100 border-slate-200 text-slate-600 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-300')}>
      <button type="button" className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span><span className="font-medium">Heads up ({summary.length})</span> · {summary.join(' · ')}</span>
        <span className="text-xs opacity-80 whitespace-nowrap">{open ? 'hide ▴' : 'show ▾'}</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

/** Store Listings no card could be matched to, so the buyer can see whether any are real cards worth a look. */
function Unidentified({ listings }: { listings: LadderView['unidentified'] }) {
  const n = listings.length;
  return (
    <Notice tone="info">
      <details>
        <summary className="cursor-pointer">
          {n} Listing{n > 1 ? 's' : ''} couldn't be matched to a card and {n > 1 ? 'were' : 'was'} left out of every Plan. <span className="underline">Show {n > 1 ? 'them' : 'it'}</span>
        </summary>
        <p className="mt-2 text-xs">
          These are Store Listings whose titles MagicFinder couldn't tie to one card, often Un-cards, misprints or unusually named products. Your list's
          section labels (Commander, Sideboard…) are never counted here. If one is a card you want, open it and buy it directly.
        </p>
        <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">
          {listings.map((l, i) => (
            <li key={i} className="py-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <SourceBadge source={l.source} />
              <span className="flex-1 min-w-0">{l.title}</span>
              <span className="text-xs text-slate-500">{l.storeName}{l.searchedFor && ` · found searching for ${l.searchedFor}`}</span>
              <span className="tabnum">{money(l.price)}</span>
              <a className="text-indigo-600 dark:text-indigo-400 underline" href={l.url} target="_blank" rel="noreferrer">open ↗</a>
            </li>
          ))}
        </ul>
      </details>
    </Notice>
  );
}

function StoreSection({ sortBy, store: s, runId, settings, onSettings, onCart, onLock, onRemove, elsewhere, pins, onPin, onPinAll, planStoreIds, qtyOf, onBuyFrom, onPinStore, onBlock, onBlockListing, onAvoid, onExclude }: {
  sortBy: 'name' | 'price'; onAvoid: (item: ItemView, storeId: string) => void;
  onExclude: () => void; onPinAll: (buyKeys: string[], storeId: string) => void; qtyOf: Map<string, number>;
  planStoreIds: Set<string>; onBuyFrom: (item: ItemView, lock: Lock, storeId: string) => void; onPinStore: (item: ItemView, storeId: string) => void; onBlock: PrintingActions['onBlock']; onBlockListing: PrintingActions['onBlockListing'];
  store: StoreView; runId: string; elsewhere: Elsewhere[]; pins: Record<string, string>; onPin: (buyKey: string, storeId: string | null) => void; settings: Settings; onSettings: (p: Partial<Settings>) => void; onCart: () => void; onLock: (lineIds: string[], lock: Lock | null) => void; onRemove: (name: string, lineIds: string[]) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [elsewhereOpen, setElsewhereOpen] = useState(false);
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
        {s.country === 'AU' && <AustraliaTag shipsToNz={s.shipsToNz} estimated={s.postageEstimated} />}
        {s.sources.map(src => <SourceBadge key={src} source={src} />)}
        {s.staleSince && <Tag tone="warn" title="Its Source couldn't be searched just now">prices from {timeAgo(s.staleSince)}</Tag>}
        <div className="ml-auto flex items-center gap-3">
          <Button variant="link" className="text-xs" onClick={onExclude}
            title={`Leave ${s.name} out of every Plan from now on, e.g. because it doesn't ship to you. You can add it back in Settings.`}>
            🚫 {s.country === 'AU' && !s.shipsToNz ? "Doesn't ship to NZ" : 'Exclude Store'}
          </Button>
          <Button variant="link" className="text-xs" onClick={() => {
            const { [s.id]: _gone, ...rest } = settings.preferredStores;
            onSettings({ preferredStores: s.preferred ? rest : { ...settings.preferredStores, [s.id]: s.name } });
          }}
            title={s.preferred ? `${s.name} is a preferred Store: no postage, and it doesn't count toward your Store limit. Click to stop.` : `Make ${s.name} a preferred Store: somewhere you collect from for free, so it doesn't count toward your Store limit.`}>
            {s.preferred ? '★ Preferred' : '☆ Prefer'}
          </Button>
          {s.pickupEligible && !s.preferred && (
            <Switch checked={s.pickupOn} onChange={setPickup} ariaLabel={`I'll pick up from ${s.name}`} label={<>I'll pick up{!s.pickupConfirmed && <span className="text-xs text-slate-500"> (not confirmed)</span>}</>}
              title={s.pickupConfirmed ? (s.pickupFee ? `Pickup fee ${money(s.pickupFee)}` : 'Free pickup') : "This Store hasn't said whether it offers pickup; check before you rely on it"} />
          )}
          {cartLabel && (
            <span className="flex flex-col items-end">
              <Button variant="accent" onClick={onCart}>{cartLabel}{s.cart !== 'hobbymaster-deckbuilder' && ' ↗'}</Button>
              {s.cart === 'shopify' && <span className="text-[11px] text-slate-500 mt-0.5">replaces your {s.name} cart</span>}
            </span>
          )}
        </div>
      </div>
      <div className="grid md:grid-cols-[minmax(0,1fr)_230px]">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800 min-w-0">
          {(sortBy === 'price' ? [...s.items].sort((a, b) => b.price * b.qty - a.price * a.qty || a.name.localeCompare(b.name)) : s.items).map(i => (
            <li key={i.listingId} className="px-4 py-2">
              <ItemRow item={i} open={open === i.listingId} onToggle={() => setOpen(open === i.listingId ? null : i.listingId)} pinned={pins[i.buyKey] === s.id} onUnpin={() => onPin(i.buyKey, null)} onAvoid={() => onAvoid(i, s.id)} onRemove={() => onRemove(i.name, i.lineIds)} />
              {open === i.listingId && (
                <PrintingGrid runId={runId} lineId={i.lineIds[0]} planStoreIds={planStoreIds} need={qtyOf.get(i.buyKey) ?? i.qty} current={s.items.filter(x => x.buyKey === i.buyKey).map(x => ({ storeId: s.id, printingId: x.printing?.id ?? null, finish: x.finish }))} onBlock={onBlock} onBlockListing={onBlockListing}
                  onLock={lock => { onLock(i.lineIds, lock); setOpen(null); }} onBuyFrom={(lock, storeId) => { onBuyFrom(i, lock, storeId); setOpen(null); }} onPinStore={storeId => { onPinStore(i, storeId); setOpen(null); }} />
              )}
            </li>
          ))}
          {elsewhere.length > 0 && (
            <li className="px-4 py-2">
              <Button variant="link" className="text-xs" onClick={() => setElsewhereOpen(!elsewhereOpen)} aria-expanded={elsewhereOpen}>
                {elsewhereOpen ? 'hide' : 'show'} {elsewhere.length} other card{elsewhere.length > 1 ? 's' : ''} from your order this Store has
              </Button>
              {elsewhereOpen && (
                <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                  <li className="flex flex-wrap items-center gap-2 py-1">
                    <span className="text-slate-500 flex-1">Together: {money(elsewhere.reduce((t, e) => t + e.cost, 0))} here, against {money(elsewhere.reduce((t, e) => t + e.current, 0))} now (before postage).</span>
                    <Button className="text-xs py-0.5" onClick={() => onPinAll(elsewhere.map(e => e.card.buyKey), s.id)}>Move all {elsewhere.length} here</Button>
                  </li>
                  {elsewhere.map(e => (
                    <li key={e.card.buyKey} className="flex flex-wrap items-center gap-2 py-1">
                      <span className="tabnum text-slate-500">{e.card.qty}×</span>
                      <span className="font-medium">{e.card.name}</span>
                      <span className="text-xs text-slate-500">now from {e.card.bought.map(b => b.store.name).join(', ')}</span>
                      <span className="tabnum ml-auto">{money(e.cost)}</span>
                      <span className={cx('tabnum text-xs w-16 text-right', e.cost < e.current ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500')}>
                        {e.cost === e.current ? 'same' : `${e.cost < e.current ? '−' : '+'}${money(Math.abs(e.cost - e.current))}`}
                      </span>
                      <Button className="text-xs py-0.5" onClick={() => onPin(e.card.buyKey, s.id)}>Buy here instead</Button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )}
        </ul>
        <div className="p-4 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800">
          <StoreTotals store={s} settings={settings} onSettings={onSettings} />
        </div>
      </div>
    </div>
  );
}

function ItemRow({ item: i, open, onToggle, pinned, onUnpin, onAvoid, onRemove }: { item: ItemView; open: boolean; onToggle: () => void; pinned: boolean; onUnpin: () => void; onAvoid: () => void; onRemove: () => void }) {
  // A Store's own picture is the best evidence when the title didn't settle the Printing.
  const img = i.printing?.image ?? i.storeImage ?? i.fallbackImage;
  // The row's actions stay out of the way until the buyer opens them, so narrow windows don't cut them off.
  const [actions, setActions] = useState(false);
  const toggleActions = () => setActions(x => !x);
  return (
    <div>
      <div className="flex items-center gap-3 text-sm">
        <span className="relative group shrink-0">
          <CardImage src={img} alt={i.name} className="w-10 aspect-[5/7] rounded" />
          {(i.printing?.imageLarge ?? img) && (
            <span className="hidden group-hover:block absolute left-12 top-0 z-30 w-56 shadow-2xl rounded-xl overflow-hidden pointer-events-none">
              <CardImage src={i.printing?.imageLarge ?? img} alt={i.name} className="w-full aspect-[5/7]" />
            </span>
          )}
        </span>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={toggleActions}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabnum text-slate-500">{i.qty}×</span>
            <span className="font-medium">{i.name}</span>
            {i.locked && <span title="Locked Printing">🔒</span>}
            {pinned && <button type="button" className="text-xs" title="You chose this Store for this card. Click to let MagicFinder choose again" onClick={e => { e.stopPropagation(); onUnpin(); }}>📌 ✕</button>}
            <Tag title={i.condition ? undefined : 'The Store did not state a condition'}>{i.condition ?? 'condition not stated'}</Tag>
            {i.finish !== 'nonfoil' && <Tag>{i.finish === 'foil' ? 'Foil' : 'Etched'}</Tag>}
            {!i.printing && <Tag tone="warn" title="Matched the card but not the exact Printing">Printing not confirmed</Tag>}
            {(i.overCardKingdom || i.underCardKingdom) && i.cardKingdomNzd !== null && <CardKingdomChip price={i.price} cardKingdomNzd={i.cardKingdomNzd} unsure={unsure(i.condition, i.printing?.id ?? null)} />}
          </div>
          <div className="text-xs text-slate-500 truncate">{i.printing?.label ?? i.title}</div>
        </div>
        <div className="flex flex-col items-end sm:flex-row sm:items-center sm:gap-3 shrink-0">
          <span className="tabnum">{money(i.price)}{i.extra?.priceAud && <span className="text-xs text-slate-500" title="Listed in Australian dollars; converted to NZD"> (A${Number(i.extra.priceAud).toFixed(2)})</span>}</span>
          <a href={i.url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap">View listing ↗</a>
        </div>
        <button type="button" onClick={toggleActions} aria-expanded={actions} aria-label={`${actions ? 'Hide' : 'Show'} actions for ${i.name}`} title={actions ? 'Hide actions' : 'Other Printings, buy elsewhere, or remove'}
          className={cx('shrink-0 w-7 h-7 grid place-items-center rounded-full border transition-colors',
            actions
              ? 'border-indigo-500 bg-indigo-600 text-white'
              : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400')}>
          {/* Drawn centred on its own 16×16 box, so it sits in the middle of the circle and turns about that middle. */}
          <svg viewBox="0 0 16 16" aria-hidden="true" className={cx('w-3.5 h-3.5 transition-transform', actions && 'rotate-90')}
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 4l4 4-4 4" />
          </svg>
        </button>
      </div>
      {actions && (
        <div className="mt-2 ml-[3.25rem] flex flex-wrap gap-2">
          <Button className="text-xs py-1" onClick={onToggle}>{open ? 'Hide other Printings' : 'Other Printings'}</Button>
          <Button className="text-xs py-1" title="Buy this card from another Store; the Plan is made again without this one" onClick={onAvoid}>Not from this Store</Button>
          <Button className="text-xs py-1 text-rose-600 dark:text-rose-400 border-rose-300 dark:border-rose-900" onClick={onRemove}>Remove from my list</Button>
        </div>
      )}
    </div>
  );
}

/** Takes a card off the Want List and re-plans without it. */
function RemoveButton({ name, onClick, className }: { name: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} title={`Remove ${name} from your list`} aria-label={`Remove ${name} from your list`}
      className={cx('shrink-0 w-6 h-6 grid place-items-center rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50', className)}>✕</button>
  );
}

interface PrintingActions {
  /** Store ids already in the selected Plan, so their Listings can be marked. */
  planStoreIds: Set<string>;
  /** Copies the line needs, to warn when a Store has fewer. */
  need: number;
  /** The Listings the Plan already buys for this line, which aren't offered again as alternatives. */
  current: { storeId: string; printingId: string | null; finish: Finish }[];
  onLock: (lock: Lock | null) => void;
  /** Lock the Printing and pin the line to a Store in one go. */
  onBuyFrom: (lock: Lock, storeId: string) => void;
  /** Pin the line to a Store without choosing a Printing (for a Listing whose Printing isn't known). */
  onPinStore: (storeId: string) => void;
  onBlock: (printing: PrintingView, blocked: boolean, cardName: string) => void;
  /** Never use one Listing whose Printing isn't known (or use it again). */
  onBlockListing: (listing: UnconfirmedListingView, blocked: boolean, cardName: string) => void;
}

function PrintingGrid({ runId, lineId, planStoreIds, need, current, onLock, onBuyFrom, onPinStore, onBlock, onBlockListing }: { runId: string; lineId: string } & PrintingActions) {
  const [data, setData] = useState<PrintingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blockedHere, setBlockedHere] = useState<Record<string, boolean>>({});
  useEffect(() => {
    api.printings(runId, lineId).then(setData, e => setError((e as Error).message));
  }, [runId, lineId]);
  if (error) return <p className="mt-2 text-sm text-rose-600">{error}</p>;
  if (!data) return <p className="mt-2 text-sm text-slate-500">Loading Printings…</p>;
  const unconfirmed = data.unconfirmed ?? [];
  if (!data.options.length && !unconfirmed.length) return <p className="mt-2 text-sm text-slate-500">No Store has this card in stock{need > 1 ? '' : ' right now'}.</p>;
  return (
    <div className="mt-3">
      {!data.options.length && <p className="mb-2 text-sm text-slate-500">None of the Listings say which Printing they are, so none can be chosen. Go by the Store's picture:</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {data.options.map(o => {
          const lock: Lock = { printingId: o.printing.id, finish: o.printing.finish };
          const blocked = blockedHere[o.printing.id] ?? o.blocked;
          const isCurrent = (x: { storeId: string }) => current.some(c => c.storeId === x.storeId && c.printingId === o.printing.id && c.finish === o.printing.finish);
          const bought = o.offers.some(isCurrent);
          const offers = o.offers.filter(x => !isCurrent(x));
          // A lock covers every copy of the line, so a Printing with fewer copies than you need would leave some Not Found.
          const stock = o.offers.reduce((n, x) => n + x.qty, 0);
          const short = stock < need;
          const shortWhy = `Only ${stock} of this Printing in stock across all Stores; you need ${need}. Locking to it would leave ${need - stock} Not Found.`;
          const inPlan = offers.filter(x => planStoreIds.has(x.storeId));
          return (
            <div key={`${o.printing.id}:${o.printing.finish}`} className={cx('rounded-xl p-2 flex flex-col', o.locked ? 'ring-2 ring-indigo-500 bg-indigo-50 dark:bg-indigo-950' : 'bg-slate-50 dark:bg-slate-800', blocked && 'opacity-60')}>
              <CardImage src={o.printing.image} alt={data.name} className="w-full aspect-[5/7] rounded-lg" />
              <div className="text-[11px] mt-1 min-h-8 text-slate-600 dark:text-slate-300">{o.printing.label}</div>
              {o.printing.nonTournament && <div className="text-[10px] text-slate-500">{o.printing.nonTournament}, used only if locked</div>}
              <div className="text-sm font-semibold tabnum">
                {o.cheapest == null ? <span className="text-slate-400">none in stock</span> : <>from {money(o.cheapest)}</>}
              </div>
              {short && !bought && <div className="text-[11px] text-amber-600 dark:text-amber-400">Only {stock} in stock, need {need}</div>}
              {bought && <div className="text-[11px] text-emerald-600 dark:text-emerald-400">● What you're buying now</div>}
              {offers.length > 0 && (
                <ul className="mt-1 space-y-1 text-[11px]">
                  {[...offers].sort((a, b) => Number(planStoreIds.has(b.storeId)) - Number(planStoreIds.has(a.storeId)) || a.price - b.price).map(x => (
                    <li key={`${x.storeId}:${x.url}`} className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate" title={x.storeName}>
                        {planStoreIds.has(x.storeId) && <span title="This Store is in your Plan or is one of your preferred Stores" className="text-emerald-600 dark:text-emerald-400">● </span>}
                        {x.storeName}
                        {x.qty < need && <span className="text-amber-600 dark:text-amber-400" title={`Only ${x.qty} in stock; you need ${need}`}> ({x.qty} left)</span>}
                      </span>
                      <span className="tabnum">{money(x.price)}</span>
                      <Button className="text-[11px] py-0 px-1.5" disabled={blocked || short || x.qty < need} title={short ? shortWhy : x.qty < need ? `${x.storeName} has ${x.qty}; you need ${need}` : `Buy this Printing from ${x.storeName}`} onClick={() => onBuyFrom(lock, x.storeId)}>Buy</Button>
                    </li>
                  ))}
                </ul>
              )}
              {inPlan.length === 0 && offers.length > 0 && <div className="mt-1 text-[11px] text-slate-500">None of these Stores are in your Plan yet.</div>}
              <div className="mt-auto pt-1 space-y-1">
                {o.locked
                  ? <Button variant="primary" className="w-full text-xs py-1" title="Let any printing fill this line, cheapest first." onClick={() => onLock(null)}>🔒 Only this · allow any</Button>
                  : <Button className="w-full text-xs py-1" disabled={o.cheapest == null || blocked || short} title={short ? shortWhy : 'Lock: buy only this printing, even if another is cheaper.'} onClick={() => onLock(lock)}>🔒 Only buy this one</Button>}
                {!o.locked && (
                  <Button variant="link" className="w-full text-[11px]" title={blocked ? 'Allow this Printing to be picked again.' : 'Never pick this Printing for any card unless you lock it. Saved in Settings.'}
                    onClick={() => { setBlockedHere(b => ({ ...b, [o.printing.id]: !blocked })); onBlock(o.printing, !blocked, data.name); }}>
                    {blocked ? 'Allow this Printing again' : '🚫 Never buy this Printing'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {unconfirmed.length > 0 && (
        <div className={data.options.length ? 'mt-4' : ''}>
          {data.options.length > 0 && <p className="mb-2 text-xs text-slate-500">Also in stock, but the Printing isn't stated (go by the Store's picture, then buy from that Store):</p>}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {unconfirmed.map(u => (
              <div key={`${u.storeId}:${u.url}`} title={`${u.title} · ${u.storeName}`}
                className={cx('shrink-0 w-[118px] rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 text-xs flex flex-col', u.blocked && 'opacity-60')}>
                <a href={u.url} target="_blank" rel="noreferrer" className="hover:opacity-80">
                  <CardImage src={u.image} alt={u.title} className="w-full aspect-[5/7] rounded object-cover" />
                </a>
                <div className="mt-1 flex items-baseline justify-between"><span className="tabnum font-semibold text-sm">{money(u.price)}</span><span className="text-slate-500 tabnum">{u.qty}×</span></div>
                <div className="truncate text-slate-600 dark:text-slate-300">{u.storeName}</div>
                <div className="text-slate-500">{u.finish !== 'nonfoil' ? 'Foil · ' : ''}{u.condition ?? 'cond. not stated'}</div>
                <Button className="mt-1 w-full text-[11px] py-0.5" disabled={u.blocked || u.qty < need} title={u.qty < need ? `${u.storeName} has ${u.qty}; you need ${need}` : `Buy this card from ${u.storeName}, whichever Printing they send`} onClick={() => onPinStore(u.storeId)}>Buy here</Button>
                <Button variant="link" className="w-full text-[11px]" title={u.blocked ? 'Allow this Listing to be picked again.' : "Never pick this Listing, for example when its picture shows a Printing you don't want. Saved in your overrides."}
                  onClick={() => onBlockListing(u, !u.blocked, data.name)}>{u.blocked ? 'Use this Listing again' : '🚫 Never use this Listing'}</Button>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.hint && <p className="text-xs text-slate-500 mt-2">Your list said {data.hint.text}.</p>}
    </div>
  );
}

function StoreTotals({ store: s, settings, onSettings }: { store: StoreView; settings: Settings; onSettings: (p: Partial<Settings>) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(s.postageKind === 'pickup' ? s.postage : s.postage || settings.defaultPostage.tracked));
  const override = settings.postageOverrides[s.id];
  const postageLabel = s.preferred ? 'Collect' : s.postageKind === 'pickup' ? 'Pickup' : `Postage (${settings.postageType})`;
  return (
    <div className="text-sm tabnum space-y-0.5">
      <div className="flex justify-between"><span>Cards</span><span>{money(s.subtotal)}</span></div>
      <div className="flex justify-between items-center gap-2">
        <span className="whitespace-nowrap">
          {postageLabel}
          {s.postageEstimated && <Button variant="link" className="ml-1 text-xs text-amber-600 dark:text-amber-400" title="This Store doesn't publish postage; click to enter what it charges you" onClick={() => setEditing(true)}>est.</Button>}
          {override !== undefined && <Button variant="link" className="ml-1 text-xs" title="Your price for this Store" onClick={() => setEditing(true)}>yours</Button>}
          {override === undefined && !s.postageEstimated && s.postageKind !== 'free' && <Button variant="link" className="ml-1 text-xs" title="Enter what this Store really charges you" onClick={() => setEditing(true)}>edit</Button>}
        </span>
        <span>{s.postageKind === 'free' ? 'Free' : money(s.postage)}</span>
      </div>
      {editing && (
        <form className="flex gap-1 items-center" onSubmit={e => { e.preventDefault(); onSettings({ postageOverrides: { ...settings.postageOverrides, [s.id]: Number(value) } }); setEditing(false); }}>
          <span>$</span>
          <input autoFocus type="number" min={0} step={0.1} value={value} onChange={e => setValue(e.target.value)} className="w-20 border rounded px-1 py-0.5 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600" />
          <Button variant="primary" className="text-xs py-0.5" type="submit">Save</Button>
          <Button variant="ghost" className="text-xs py-0.5" onClick={() => setEditing(false)}>Cancel</Button>
          {override !== undefined && (
            <Button variant="link" className="text-xs" title="Go back to the Store's usual price" onClick={() => {
              const { [s.id]: _gone, ...rest } = settings.postageOverrides;
              onSettings({ postageOverrides: rest });
              setEditing(false);
            }}>Reset</Button>
          )}
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
  actions?: { label: string; onClick: () => void }[];
}

const CONDITION_NAME: Record<Settings['minCondition'], string> = { NM: 'Near Mint', LP: 'Lightly Played', MP: 'Moderately Played', HP: 'Heavily Played', DMG: 'Damaged' };

/** Says which Listings of a Not Found card were found but left out, e.g. "found but left out: 4 below Near Mint". */
function excludedNote(n: NotFoundView, settings: Settings): string {
  const reasons: Record<Exclusion, string> = {
    condition: `below ${CONDITION_NAME[settings.minCondition]}`,
    'not-buyable': 'not for sale right now',
    'sold-out': 'sold out',
    'non-english': 'not in English',
    unmatched: "couldn't be matched to a Printing",
    'other-printing': 'other Printings (this one is locked)',
    foil: 'foil (foils are off)',
    'non-tournament': 'not tournament legal',
    'blocked-printing': 'on your never-buy Printings list',
    'blocked-listing': 'on your never-buy Listings list',
    'avoided-store': 'at a Store you ruled out for this card',
  };
  const parts = (Object.entries(n.excluded) as [Exclusion, number][]).sort((a, b) => b[1] - a[1]).map(([why, count]) => `${count} ${reasons[why]}`);
  return parts.length ? `found but left out: ${parts.join(', ')}` : '';
}

/** A collapsible list of cards with their images, for Not Found and for cards a Short Plan leaves out. */
function CardList({ title, note, cards, tone, bulk }: { title: string; note?: string; cards: CardListItem[]; tone: 'bad' | 'warn'; bulk?: { label: string; onClick: () => void } }) {
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
          {(note || bulk) && (
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              {note && <p className="text-xs opacity-80">{note}</p>}
              {bulk && <Button className="text-xs py-1" onClick={bulk.onClick}>{bulk.label}</Button>}
            </div>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-3">
            {cards.map(c => (
              <div key={c.key} className="text-xs flex flex-col">
                <div className="relative">
                  <CardImage src={c.image} alt={c.name} className="w-full aspect-[5/7] rounded-lg" />
                  {c.qty > 1 && <span className="absolute top-1 left-1 bg-black/75 text-white font-bold rounded px-1.5">×{c.qty}</span>}
                </div>
                <div className="mt-1 font-medium leading-tight">{c.name}</div>
                {c.note && <div className="opacity-80">{c.note}</div>}
                {c.actions?.map(a => <Button key={a.label} className="w-full mt-2 text-xs py-1 leading-tight" onClick={a.onClick}>{a.label}</Button>)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
