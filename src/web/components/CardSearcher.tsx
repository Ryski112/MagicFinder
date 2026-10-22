// The Want List's card searcher: type a name, and any suggestion is added in one click, at any Printing or locked to
// one chosen from its Printings. Decided in "How should the Want List card searcher look and behave?", then reworked
// from a prototype (variant A1 on branch prototype/card-searcher-quick-add): the big card shows in a column inside the
// dropdown so it never covers the results, Printings wrap in a grid that scrolls vertically, and each card has its own
// − n + for copies. Earlier owner decisions still hold: Enter adds like a click, and a Printing chosen here is locked.
// Keys: ↑/↓ move through cards; Enter adds the active card; → opens its Printings and moves into them, where the arrows
// move and Enter adds that Printing; ← or ↑ from the edge goes back to the card; Escape closes the Printings, then the
// list. A quantity typed first ("4 bolt") is how many copies each card adds.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { addToWantList } from '../../core/addToWantList';
import { defaultFinish, wantLineId } from '../../core/wantList';
import type { CardSearchResult, CataloguePrintingView, Lock } from '../../shared/api';
import { api } from '../api';
import { clampQuantity, leadingQuantity, MAX_QUANTITY } from '../cardQuery';
import { CardImage, cx } from './ui';

interface Props {
  text: string;
  onText: (t: string) => void;
  /** Locks a Want List line to a Printing (used when the buyer picks one here). */
  onLock: (lineId: string, lock: Lock) => void;
  ready: boolean;
  /** 0..1 while the card list downloads. */
  progress: number;
}

function useSuggestions(q: string) {
  const [hits, setHits] = useState<CardSearchResult[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      api.searchCards(q).then(r => !stale && setHits(r.results), () => !stale && setHits([]));
    }, 120);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q]);
  return hits;
}

function usePrintings(oracleId: string | null) {
  const [printings, setPrintings] = useState<CataloguePrintingView[]>([]);
  useEffect(() => {
    setPrintings([]);
    if (!oracleId) return;
    let stale = false;
    api.cardPrintings(oracleId).then(r => !stale && setPrintings(r.printings), () => {});
    return () => {
      stale = true;
    };
  }, [oracleId]);
  return printings;
}

function useFlash() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 3500);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg, setMsg] as const;
}

function printingLabel(o: CataloguePrintingView) {
  const finish = o.finishes.length === 1 && o.finishes[0] !== 'nonfoil' ? `${o.finishes[0]} only` : '';
  const extra = [...o.treatments, finish, o.nonTournament ?? ''].filter(Boolean).join(', ');
  return `${o.setCode} #${o.collectorNumber} · ${o.setName} (${o.year})${extra ? ` · ${extra}` : ''}`;
}

/** Scryfall's readable size: search results carry the small image, and the normal one sits at the same path. */
const readable = (url: string | null) => url?.replace('/small/', '/normal/') ?? null;
const cardShape = 'aspect-[488/680] rounded-[4.75%/3.5%]';
const optionId = (i: number) => `card-option-${i}`;
const printingId = (id: string) => `card-printing-${id}`;

function Copies({ n, name, onChange }: { n: number; name: string; onChange: (n: number) => void }) {
  const step = 'w-7 h-7 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-300 disabled:opacity-30';
  return (
    <div className="flex items-center rounded-lg border border-slate-300 dark:border-slate-700 shrink-0" onClick={e => e.stopPropagation()}>
      <button type="button" tabIndex={-1} className={step} disabled={n <= 1} onClick={() => onChange(n - 1)} aria-label={`One fewer ${name}`}>−</button>
      <span className="w-6 text-center text-sm font-semibold tabnum" aria-label={`${n} copies`}>{n}</span>
      <button type="button" tabIndex={-1} className={step} disabled={n >= MAX_QUANTITY} onClick={() => onChange(n + 1)} aria-label={`One more ${name}`}>+</button>
    </div>
  );
}

export function CardSearcher(p: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // The card whose Printings are open, and the Printing the cursor is on (-1 while it is on the card itself).
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1);
  // Copies set with a card's − n +, by oracle id; a card without one adds the typed quantity.
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [msg, setMsg] = useFlash();
  const typed = leadingQuantity(q);
  const hits = useSuggestions(typed ? typed.rest : q);
  const printings = usePrintings(expanded);
  const input = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  const cur = hits[active];
  const inPrintings = cursor >= 0 && !!cur && expanded === cur.oracleId;
  const atPrinting = inPrintings ? printings[cursor] : undefined;
  const copiesOf = (h: CardSearchResult) => copies[h.oracleId] ?? typed?.quantity ?? 1;

  useEffect(() => {
    setActive(0);
    setExpanded(null);
    setCursor(-1);
  }, [hits]);
  useEffect(() => {
    const id = atPrinting ? printingId(atPrinting.id) : optionId(active);
    document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
  }, [active, atPrinting]);

  const add = (card: CardSearchResult, o?: CataloguePrintingView) => {
    const r = addToWantList(p.text, { name: card.name, set: o?.setCode, collectorNumber: o?.collectorNumber }, copiesOf(card));
    p.onText(r.text);
    // The line's id is what the server will give it once it reads "(SET) num" back as this Printing.
    if (o) {
      const lock = { printingId: o.id, finish: defaultFinish(o.finishes) };
      p.onLock(wantLineId(card.oracleId, 'main', lock), lock);
    }
    setMsg(o ? `${r.message} · 🔒 locked to this printing` : r.message);
    setQ('');
    setCopies({});
    setExpanded(null);
    setCursor(-1);
    input.current?.focus();
  };
  const toCard = (i: number) => {
    setActive(Math.max(0, Math.min(hits.length - 1, i)));
    setExpanded(null);
    setCursor(-1);
  };
  const columns = () => (grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(' ').length : 1);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (expanded) {
        setExpanded(null);
        setCursor(-1);
      } else setOpen(false);
      return;
    }
    if (!cur) return;
    const n = columns();
    const last = printings.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (inPrintings) {
        if (Math.floor(cursor / n) < Math.floor(last / n)) setCursor(Math.min(cursor + n, last));
        else toCard(active + 1);
      } else if (expanded === cur.oracleId && printings.length) setCursor(0);
      else toCard(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (inPrintings) setCursor(cursor - n >= 0 ? cursor - n : -1);
      else toCard(active - 1);
    } else if (e.key === 'ArrowRight' && (inPrintings || input.current?.selectionStart === q.length)) {
      e.preventDefault();
      if (inPrintings) setCursor(Math.min(cursor + 1, last));
      else {
        setExpanded(cur.oracleId);
        setCursor(0);
      }
    } else if (e.key === 'ArrowLeft' && (inPrintings || expanded)) {
      e.preventDefault();
      if (inPrintings) setCursor(cursor - 1);
      else setExpanded(null);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!inPrintings) add(cur);
      else if (atPrinting) add(cur, atPrinting);
    }
  };

  const notReady = `Card search is ready once the card list finishes downloading (${Math.round(p.progress * 100)}%)`;
  const showing = open && hits.length > 0;

  return (
    <div>
      <div className="relative">
        <input
          ref={input}
          disabled={!p.ready}
          value={q}
          role="combobox"
          aria-label="Add a card by name"
          aria-expanded={showing}
          aria-controls="card-suggestions"
          aria-activedescendant={showing ? (atPrinting ? printingId(atPrinting.id) : optionId(active)) : undefined}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={e => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKey}
          placeholder={p.ready ? '🔍 Add a card by name, or “4 bolt” for four…' : notReady}
          title={p.ready ? undefined : notReady}
          className="w-full rounded-xl px-4 py-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 outline-none focus:border-indigo-500 focus:ring-4 ring-indigo-500/15 disabled:opacity-60"
        />
        {showing && cur && (
          // Clicks inside keep focus in the box, so the list stays open and the keys keep working.
          <div className="absolute z-30 left-0 right-0 mt-2 flex rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden" onMouseDown={e => e.preventDefault()}>
            <div className="flex-1 min-w-0 flex flex-col">
              <ul id="card-suggestions" role="listbox" aria-label="Cards" className="max-h-[min(28rem,65vh)] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {hits.map((h, i) => (
                  <li key={h.oracleId} role="presentation">
                    <div
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === active && !inPrintings}
                      className={cx('group flex items-center gap-3 px-3 py-2 cursor-pointer', i === active && 'bg-indigo-50 dark:bg-indigo-950/60')}
                      onMouseEnter={() => {
                        setActive(i);
                        setCursor(-1);
                      }}
                      onClick={() => add(h)}
                    >
                      <CardImage src={h.image} alt="" className="w-10 h-14 rounded shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{h.name}</div>
                        <div className="text-xs text-slate-500 truncate">{h.matchedAlias ? `matched “${h.matchedAlias}” · ` : ''}any printing (cheapest wins)</div>
                      </div>
                      <Copies n={copiesOf(h)} name={h.name} onChange={n => setCopies({ ...copies, [h.oracleId]: clampQuantity(n) })} />
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-expanded={expanded === h.oracleId}
                        aria-label={`Printings of ${h.name}`}
                        className={cx(
                          'text-xs rounded-md px-2 py-1 border shrink-0',
                          expanded === h.oracleId ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300' : 'border-slate-300 dark:border-slate-700 text-slate-500',
                        )}
                        onClick={e => {
                          e.stopPropagation();
                          setActive(i);
                          setCursor(-1);
                          setExpanded(expanded === h.oracleId ? null : h.oracleId);
                        }}
                      >
                        <span className="hidden sm:inline">Printings </span>{expanded === h.oracleId ? '▴' : '→'}
                      </button>
                    </div>
                    {expanded === h.oracleId && (
                      <div className="px-3 pb-3 bg-slate-50 dark:bg-slate-950/40" role="group" aria-label={`Printings of ${h.name}`}>
                        <p className="text-xs text-slate-500 py-2">Click a printing to add {copiesOf(h)} locked: only that printing can fill the line. You can allow any printing in the review list.</p>
                        <div ref={grid} className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2 max-h-64 overflow-y-auto pr-1">
                          {printings.map((o, j) => (
                            <button
                              key={o.id}
                              id={printingId(o.id)}
                              type="button"
                              tabIndex={-1}
                              role="option"
                              aria-selected={inPrintings && j === cursor}
                              title={printingLabel(o)}
                              onMouseEnter={() => {
                                setActive(i);
                                setCursor(j);
                              }}
                              onClick={() => add(h, o)}
                              className={cx('text-left rounded-md ring-indigo-500 hover:ring-2', inPrintings && j === cursor && 'ring-2')}
                            >
                              <CardImage src={o.image} alt={printingLabel(o)} className="w-full aspect-[488/680] rounded-md" />
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
            {/* The big card, beside the results rather than over them; phones go without it. */}
            <aside className="hidden md:block w-60 shrink-0 border-l border-slate-200 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-950/40" aria-hidden>
              <CardImage src={atPrinting ? (atPrinting.imageLarge ?? readable(atPrinting.image)) : readable(cur.image)} alt={cur.name} className={cx('w-full shadow-lg', cardShape)} />
              <div className="mt-2 text-sm font-medium leading-tight">{cur.name}</div>
              <div className="text-xs text-slate-500">{atPrinting ? `${printingLabel(atPrinting)} · adds locked` : 'Any printing (cheapest wins)'}</div>
            </aside>
          </div>
        )}
      </div>
      <div className="h-5 mt-1 text-xs text-emerald-600 dark:text-emerald-400" aria-live="polite">{msg}</div>
    </div>
  );
}
