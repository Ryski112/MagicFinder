// PROTOTYPE (throwaway): three alternative card searchers for the Want List, switchable with `?variant=` on the landing
// page. Question: "What should the card searcher look like so cards are readable, a big card shows on hover, Printings
// wrap and scroll vertically, and adding a card takes fewer than three clicks?"
// Shared by all three: a leading number in the search sets the quantity ("4 bolt" adds 4), clicking a card adds it at any
// Printing straight away, and clicking a Printing adds it locked. Not production code: no tests, minimal error handling.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { addToWantList } from '../../core/addToWantList';
import { defaultFinish, wantLineId } from '../../core/wantList';
import type { CardSearchResult, CataloguePrintingView, Lock } from '../../shared/api';
import { api } from '../api';
import { CardImage, cx } from './ui';

export interface SearcherProps {
  text: string;
  onText: (t: string) => void;
  onLock: (lineId: string, lock: Lock) => void;
  ready: boolean;
  progress: number;
}

// ---- shared plumbing -------------------------------------------------------------------------------------------------

function parseQuery(q: string) {
  const m = q.match(/^\s*(\d{1,2})\s*x?\s+(.*)$/i);
  return m ? { qty: Math.max(1, Number(m[1])), name: m[2] } : { qty: 1, name: q };
}

function useSuggestions(q: string) {
  const [hits, setHits] = useState<CardSearchResult[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let stale = false;
    const t = setTimeout(() => api.searchCards(q).then(r => !stale && setHits(r.results), () => !stale && setHits([])), 120);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q]);
  return hits;
}

function usePrintings(oracleId: string | null) {
  const [list, setList] = useState<CataloguePrintingView[]>([]);
  useEffect(() => {
    setList([]);
    if (!oracleId) return;
    let stale = false;
    api.cardPrintings(oracleId).then(r => !stale && setList(r.printings), () => {});
    return () => {
      stale = true;
    };
  }, [oracleId]);
  return list;
}

function useAdder(p: SearcherProps) {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  const add = (card: CardSearchResult, qty: number, o?: CataloguePrintingView) => {
    const r = addToWantList(p.text, { name: card.name, set: o?.setCode, collectorNumber: o?.collectorNumber }, qty);
    p.onText(r.text);
    if (o) {
      const lock = { printingId: o.id, finish: defaultFinish(o.finishes) };
      p.onLock(wantLineId(card.oracleId, 'main', lock), lock);
    }
    setMsg(o ? `${r.message} 🔒 ${o.setCode} #${o.collectorNumber}` : r.message);
  };
  return { add, msg };
}

const big = (url: string | null | undefined) => url?.replace('/small/', '/normal/') ?? null;
const printingLine = (o: CataloguePrintingView) => [o.setName, o.year, ...o.treatments].join(' · ');

/** A large, readable card floated beside an anchor element while something is hovered. */
function useBigCard(width = 300) {
  const [s, setS] = useState<{ src: string | null; alt: string; left: number; top: number } | null>(null);
  const show = (src: string | null | undefined, alt: string, anchor: HTMLElement | null) => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = width * 1.395;
    const left = r.right + 16 + width < window.innerWidth ? r.right + 16 : Math.max(8, r.left - 16 - width);
    const top = Math.min(Math.max(8, r.top), window.innerHeight - h - 8);
    setS({ src: src ?? null, alt, left, top });
  };
  const node = s && (
    <div className="fixed z-40 pointer-events-none" style={{ left: s.left, top: s.top, width }}>
      <CardImage src={s.src} alt={s.alt} className="w-full aspect-[488/680] rounded-[4.75%/3.5%] shadow-2xl ring-1 ring-black/20" />
    </div>
  );
  return { show, hide: () => setS(null), node };
}

function Toast({ msg }: { msg: string }) {
  return <div className="h-5 mt-1 text-xs text-emerald-600 dark:text-emerald-400" aria-live="polite">{msg}</div>;
}

const inputCls = 'w-full rounded-xl px-4 py-3 text-base bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 outline-none focus:border-indigo-500 focus:ring-4 ring-indigo-500/15 disabled:opacity-60';

function QtyBadge({ qty }: { qty: number }) {
  if (qty === 1) return null;
  return <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-indigo-600 text-white text-xs font-semibold px-2 py-0.5 tabnum">×{qty}</span>;
}

// ---- A: Quick-add list ---------------------------------------------------------------------------------------------
// The familiar dropdown, made readable and one-click. Each row adds on click/Enter; "Printings" (or →) opens that card's
// Printings inline as a wrapping grid that scrolls vertically. The big card sits beside the dropdown.

export function VariantA(p: SearcherProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { qty, name } = parseQuery(q);
  const hits = useSuggestions(name);
  const printings = usePrintings(expanded);
  const { add, msg } = useAdder(p);
  const card = useBigCard();
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setActive(0);
    setExpanded(null);
  }, [hits]);
  useEffect(() => {
    const h = hits[active];
    if (open && h && !expanded) card.show(big(h.image), h.name, panel.current);
  }, [active, hits, open]);
  useEffect(() => {
    if (!open || !hits.length) card.hide();
  }, [open, hits.length]);

  const done = (h: CardSearchResult, o?: CataloguePrintingView) => {
    add(h, qty, o);
    setQ('');
    setExpanded(null);
    input.current?.focus();
  };

  return (
    <div>
      <div className="relative">
        <input
          ref={input}
          disabled={!p.ready}
          value={q}
          onChange={e => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            const h = hits[active];
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive(Math.min(active + 1, hits.length - 1));
              setExpanded(null);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(Math.max(active - 1, 0));
              setExpanded(null);
            } else if (e.key === 'ArrowRight' && h && input.current?.selectionStart === q.length) {
              e.preventDefault();
              setExpanded(h.oracleId);
            } else if (e.key === 'ArrowLeft' && expanded) {
              e.preventDefault();
              setExpanded(null);
            } else if (e.key === 'Enter' && h) {
              e.preventDefault();
              done(h);
            } else if (e.key === 'Escape') setOpen(false);
          }}
          placeholder={p.ready ? 'Add a card: “Sol Ring”, or “4 bolt” for four' : `Card search is ready once the card list downloads (${Math.round(p.progress * 100)}%)`}
          className={inputCls}
        />
        <QtyBadge qty={qty} />
        {open && hits.length > 0 && (
          <div ref={panel} className="absolute z-30 left-0 right-0 mt-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden" onMouseDown={e => e.preventDefault()} onMouseLeave={() => card.hide()}>
            <ul className="max-h-[28rem] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {hits.map((h, i) => (
                <li key={h.oracleId}>
                  <div
                    className={cx('group flex items-center gap-3 px-3 py-2 cursor-pointer', i === active && 'bg-indigo-50 dark:bg-indigo-950/60')}
                    onMouseEnter={() => {
                      setActive(i);
                      card.show(big(h.image), h.name, panel.current);
                    }}
                    onClick={() => done(h)}
                  >
                    <CardImage src={h.image} alt="" className="w-10 h-14 rounded shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{h.name}</div>
                      <div className="text-xs text-slate-500">{h.matchedAlias ? `matched “${h.matchedAlias}” · ` : ''}click or Enter adds {qty} · any printing</div>
                    </div>
                    <button
                      type="button"
                      className={cx('text-xs rounded-md px-2 py-1 border shrink-0', expanded === h.oracleId ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300' : 'border-slate-300 dark:border-slate-700 text-slate-500 opacity-0 group-hover:opacity-100', i === active && 'opacity-100')}
                      onClick={e => {
                        e.stopPropagation();
                        setExpanded(expanded === h.oracleId ? null : h.oracleId);
                      }}
                    >
                      Printings {expanded === h.oracleId ? '▴' : '→'}
                    </button>
                  </div>
                  {expanded === h.oracleId && (
                    <div className="px-3 pb-3 bg-slate-50 dark:bg-slate-950/40">
                      <p className="text-xs text-slate-500 py-2">Click a printing to add it locked: only that printing can fill the line.</p>
                      <div className="grid grid-cols-5 gap-2 max-h-64 overflow-y-auto pr-1">
                        {printings.map(o => (
                          <button
                            key={o.id}
                            type="button"
                            className="text-left rounded-md hover:ring-2 ring-indigo-500"
                            onMouseEnter={() => card.show(o.imageLarge ?? big(o.image), printingLine(o), panel.current)}
                            onClick={() => done(h, o)}
                          >
                            <CardImage src={o.image} alt={printingLine(o)} className="w-full aspect-[488/680] rounded-md" />
                            <div className="text-[11px] font-medium mt-0.5 truncate">{o.setCode} #{o.collectorNumber}</div>
                            <div className="text-[11px] text-slate-500 truncate">{o.treatments[0] ?? o.year}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100 dark:border-slate-800">↑↓ choose · Enter adds · → printings · Esc closes</div>
          </div>
        )}
      </div>
      <Toast msg={msg} />
      {card.node}
    </div>
  );
}

// ---- B: Gallery ----------------------------------------------------------------------------------------------------
// Image-first, like Scryfall. Results are a grid of readable cards inline on the page (not an overlay). Click a card to add
// it; its "Choose printing" bar swaps the grid for that card's Printings. Quantity is a segmented control as well as "4 x".

export function VariantB(p: SearcherProps) {
  const [q, setQ] = useState('');
  const [qtyPick, setQtyPick] = useState(1);
  const [focus, setFocus] = useState<CardSearchResult | null>(null);
  const parsed = parseQuery(q);
  const qty = parsed.qty !== 1 ? parsed.qty : qtyPick;
  const hits = useSuggestions(parsed.name);
  const printings = usePrintings(focus?.oracleId ?? null);
  const { add, msg } = useAdder(p);
  const card = useBigCard(320);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => setFocus(null), [hits]);
  const done = (h: CardSearchResult, o?: CataloguePrintingView) => {
    add(h, qty, o);
    setQ('');
    setQtyPick(1);
    setFocus(null);
    card.hide();
    input.current?.focus();
  };

  const tile = (key: string, img: string | null, label: ReactNode, sub: ReactNode, onClick: () => void, onHover: (el: HTMLElement) => void, extra?: ReactNode) => (
    <div key={key} className="group relative" onMouseEnter={e => onHover(panel.current ?? e.currentTarget)} onMouseLeave={() => card.hide()}>
      <button type="button" className="block w-full text-left rounded-lg transition hover:-translate-y-0.5 hover:ring-2 ring-indigo-500" onClick={onClick}>
        <CardImage src={img} alt="" className="w-full aspect-[488/680] rounded-lg" />
        <span className="absolute top-1.5 left-1.5 rounded-full bg-black/70 text-white text-[11px] px-2 py-0.5 opacity-0 group-hover:opacity-100">+ Add {qty}</span>
      </button>
      {extra}
      <div className="mt-1 text-sm font-medium leading-tight truncate">{label}</div>
      <div className="text-xs text-slate-500 truncate">{sub}</div>
    </div>
  );

  return (
    <div>
      <div className="flex gap-2 items-stretch">
        <div className="relative flex-1">
          <input
            ref={input}
            disabled={!p.ready}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && hits[0]) done(focus ?? hits[0]);
              if (e.key === 'Escape') (focus ? setFocus(null) : setQ(''));
            }}
            placeholder={p.ready ? 'Search cards to add…' : `Card search is ready once the card list downloads (${Math.round(p.progress * 100)}%)`}
            className={inputCls}
          />
        </div>
        <div className="flex rounded-xl border border-slate-300 dark:border-slate-700 overflow-hidden text-sm" role="radiogroup" aria-label="Quantity">
          {[1, 2, 3, 4].map(n => (
            <button key={n} type="button" role="radio" aria-checked={qty === n} onClick={() => setQtyPick(n)}
              className={cx('w-10 tabnum', qty === n ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}>
              {n}
            </button>
          ))}
        </div>
      </div>

      {hits.length > 0 && (
        <div ref={panel} className="mt-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
          {focus ? (
            <>
              <div className="flex items-baseline justify-between mb-2">
                <button type="button" className="text-sm text-indigo-600 dark:text-indigo-400" onClick={() => setFocus(null)}>← All results</button>
                <span className="text-xs text-slate-500">{focus.name}: {printings.length} printings · a chosen printing is added locked</span>
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-3 max-h-[30rem] overflow-y-auto pr-1">
                {tile('any', focus.image, 'Any printing', 'cheapest wins', () => done(focus), el => card.show(big(focus.image), focus.name, el))}
                {printings.map(o =>
                  tile(o.id, o.image, `${o.setCode} #${o.collectorNumber}`, o.treatments[0] ?? `${o.setName} · ${o.year}`, () => done(focus, o), el => card.show(o.imageLarge ?? big(o.image), printingLine(o), el)),
                )}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 gap-3 max-h-[30rem] overflow-y-auto pr-1">
              {hits.map((h, i) =>
                tile(
                  h.oracleId,
                  big(h.image),
                  h.name,
                  h.matchedAlias ? `matched “${h.matchedAlias}”` : i === 0 ? 'Enter adds this' : 'any printing',
                  () => done(h),
                  el => card.show(big(h.image), h.name, el),
                  <button type="button" onClick={() => setFocus(h)}
                    className="absolute bottom-[calc(2.5rem+6px)] inset-x-1.5 rounded-md bg-black/75 text-white text-[11px] py-1 opacity-0 group-hover:opacity-100">
                    Choose printing…
                  </button>,
                ),
              )}
            </div>
          )}
        </div>
      )}
      <Toast msg={msg} />
      {card.node}
    </div>
  );
}

// ---- C: Palette ----------------------------------------------------------------------------------------------------
// A focused "add cards" mode for building a list in one sitting. "/" or the bar opens a palette: results on the left, the
// active card large and readable on the right with its Printings below it (wrapping, vertical scroll). Adding keeps the
// palette open and lists what was added, so ten cards is ten Enters.

export function VariantC(p: SearcherProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState<CataloguePrintingView | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const { qty, name } = parseQuery(q);
  const hits = useSuggestions(name);
  const cur = hits[active] ?? null;
  const printings = usePrintings(cur?.oracleId ?? null);
  const { add, msg } = useAdder(p);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setActive(0), [hits]);
  useEffect(() => setHover(null), [cur?.oracleId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !open && !(e.target as HTMLElement).closest('input, textarea')) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus());
  }, [open]);

  const done = (h: CardSearchResult, o?: CataloguePrintingView) => {
    add(h, qty, o);
    setAdded(a => [`${qty} ${h.name}${o ? ` (${o.setCode}) ${o.collectorNumber} 🔒` : ''}`, ...a]);
    setQ('');
    input.current?.focus();
  };

  return (
    <div>
      <button
        type="button"
        disabled={!p.ready}
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:border-indigo-400 disabled:opacity-60"
      >
        <span className="text-slate-400">🔍</span>
        <span className="flex-1 text-slate-500">{p.ready ? 'Add cards by name…' : `Card search is ready once the card list downloads (${Math.round(p.progress * 100)}%)`}</span>
        <kbd className="text-xs rounded border border-slate-300 dark:border-slate-600 px-1.5 text-slate-500">/</kbd>
      </button>
      <Toast msg={msg} />

      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[8vh] px-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-4xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="relative border-b border-slate-200 dark:border-slate-800">
              <input
                ref={input}
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive(Math.min(active + 1, hits.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive(Math.max(active - 1, 0));
                  } else if (e.key === 'Enter' && cur) {
                    e.preventDefault();
                    done(cur);
                  } else if (e.key === 'Escape') setOpen(false);
                }}
                placeholder="Card name, or “4 bolt” for four"
                className="w-full px-5 py-4 text-lg bg-transparent outline-none"
              />
              <QtyBadge qty={qty} />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] h-[60vh]">
              <ul className="overflow-y-auto border-r border-slate-200 dark:border-slate-800 py-1">
                {!hits.length && <li className="px-5 py-3 text-sm text-slate-400">{name.trim().length < 2 ? 'Type at least two letters.' : 'No cards match.'}</li>}
                {hits.map((h, i) => (
                  <li key={h.oracleId}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => done(h)}
                      className={cx('w-full text-left px-5 py-2.5 flex items-center justify-between gap-2', i === active ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800')}
                    >
                      <span className="truncate">
                        <span className="font-medium">{h.name}</span>
                        {h.matchedAlias && <span className={cx('text-xs', i === active ? 'text-indigo-200' : 'text-slate-500')}> · “{h.matchedAlias}”</span>}
                      </span>
                      {i === active && <span className="text-xs text-indigo-200 shrink-0">↵ add {qty}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="overflow-y-auto p-4">
                {cur && (
                  <>
                    <div className="flex gap-4">
                      <CardImage src={hover ? (hover.imageLarge ?? big(hover.image)) : big(cur.image)} alt={cur.name} className="w-56 aspect-[488/680] rounded-[4.75%/3.5%] shadow-lg shrink-0" />
                      <div className="min-w-0 text-sm">
                        <div className="text-lg font-semibold leading-tight">{cur.name}</div>
                        <div className="text-slate-500 mt-1">{hover ? printingLine(hover) : `${printings.length} printings`}</div>
                        <p className="text-xs text-slate-500 mt-3">Enter or click the name adds {qty} at any printing (cheapest wins). Click a printing below to add it locked.</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-5 gap-2 mt-4" onMouseLeave={() => setHover(null)}>
                      {printings.map(o => (
                        <button key={o.id} type="button" onMouseEnter={() => setHover(o)} onClick={() => done(cur, o)} className="text-left rounded-md hover:ring-2 ring-indigo-500" title={printingLine(o)}>
                          <CardImage src={o.image} alt={printingLine(o)} className="w-full aspect-[488/680] rounded-md" />
                          <div className="text-[11px] font-medium mt-0.5 truncate">{o.setCode} #{o.collectorNumber}</div>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-2 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500">
              <span className="shrink-0">Added {added.length}</span>
              <div className="flex-1 min-w-0 truncate text-emerald-600 dark:text-emerald-400">{added.join(' · ')}</div>
              <button type="button" className="shrink-0 rounded-md bg-indigo-600 text-white px-3 py-1" onClick={() => setOpen(false)}>Done (Esc)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
