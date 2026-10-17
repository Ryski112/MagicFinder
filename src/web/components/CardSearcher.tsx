// The Want List's card searcher: type a name, pick a suggestion, optionally pick a Printing, and the card is added to
// the pasted text. Decided in "How should the Want List card searcher look and behave?" (layout A), with two later
// owner changes: Enter on a suggestion chooses it like a click, and a Printing chosen here is locked, not just noted.
// Keys: ↑/↓ move through suggestions; Enter, Tab or a click chooses the card and shows its Printings (Tab also moves
// to quantity, then to the Printing strip, ←/→); Enter adds from any of them; Escape cancels.
import { useEffect, useRef, useState } from 'react';
import { addToWantList } from '../../core/addToWantList';
import { defaultFinish, wantLineId } from '../../core/wantList';
import type { CardSearchResult, CataloguePrintingView, Lock } from '../../shared/api';
import { api } from '../api';
import { Button, CardImage, cx } from './ui';

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

export function CardSearcher(p: Props) {
  const [q, setQ] = useState('');
  const [qty, setQty] = useState(1);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<CardSearchResult | null>(null);
  const [printings, setPrintings] = useState<CataloguePrintingView[]>([]);
  // '' is "Any printing (cheapest)".
  const [printing, setPrinting] = useState('');
  const [preview, setPreview] = useState('');
  const [msg, setMsg] = useFlash();
  const hits = useSuggestions(chosen ? '' : q);
  const input = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => setActive(0), [hits]);
  useEffect(() => {
    setPrinting('');
    setPreview('');
    setPrintings([]);
    if (!chosen) return;
    let stale = false;
    api.cardPrintings(chosen.oracleId).then(r => !stale && setPrintings(r.printings), () => {});
    return () => {
      stale = true;
    };
  }, [chosen]);

  const reset = () => {
    setQ('');
    setQty(1);
    setChosen(null);
    input.current?.focus();
  };
  const add = (card: CardSearchResult, printingId: string) => {
    const o = printings.find(x => x.id === printingId);
    const r = addToWantList(p.text, { name: card.name, set: o?.setCode, collectorNumber: o?.collectorNumber }, qty);
    p.onText(r.text);
    // The line's id is what the server will give it once it reads "(SET) num" back as this Printing.
    if (o) {
      const lock = { printingId: o.id, finish: defaultFinish(o.finishes) };
      p.onLock(wantLineId(card.oracleId, 'main', lock), lock);
    }
    setMsg(r.message);
    reset();
  };
  const choose = (h: CardSearchResult) => {
    setChosen(h);
    setQ(h.name);
    setOpen(false);
  };
  const browse = (step: number) => {
    const ids = ['', ...printings.map(x => x.id)];
    const next = ids[Math.min(ids.length - 1, Math.max(0, ids.indexOf(printing) + step))];
    setPrinting(next);
    setPreview(next);
    strip.current?.querySelector(`[data-id="${next}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const notReady = `Card search is ready once the card list finishes downloading (${Math.round(p.progress * 100)}%)`;
  const shown = printings.find(x => x.id === printing);
  const previewed = printings.find(x => x.id === preview) ?? shown;

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <input
            ref={input}
            disabled={!p.ready}
            value={q}
            role="combobox"
            aria-label="Add a card by name"
            aria-expanded={open && !chosen && hits.length > 0}
            aria-controls="card-suggestions"
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onChange={e => {
              setQ(e.target.value);
              setChosen(null);
              setOpen(true);
            }}
            onKeyDown={e => {
              if (chosen) {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add(chosen, printing);
                }
                if (e.key === 'Escape') reset();
                return;
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive(Math.min(active + 1, hits.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(Math.max(active - 1, 0));
              } else if (e.key === 'Enter' && hits.length) {
                e.preventDefault();
                choose(hits[active]);
              } else if (e.key === 'Tab' && !e.shiftKey && hits.length) {
                // Let the browser move focus on to quantity; the Printing strip follows.
                choose(hits[active]);
              } else if (e.key === 'Escape') setOpen(false);
            }}
            placeholder={p.ready ? '🔍 Add a card by name…' : notReady}
            title={p.ready ? undefined : notReady}
            className={cx(
              'w-full rounded-lg px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 disabled:opacity-60',
              chosen && 'border-indigo-500 font-medium',
            )}
          />
          {open && !chosen && hits.length > 0 && (
            <ul id="card-suggestions" role="listbox" className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden">
              {hits.map((h, i) => (
                <li key={h.oracleId} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={e => {
                      e.preventDefault();
                      choose(h);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={cx('w-full flex items-center gap-2 px-2 py-1 text-left text-sm', i === active && 'bg-indigo-50 dark:bg-indigo-950')}
                  >
                    <CardImage src={h.image} alt="" className="w-6 h-8 rounded-sm" />
                    <span>
                      {h.name}
                      {h.matchedAlias && <span className="text-xs text-slate-500"> · matched “{h.matchedAlias}”</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <input
          type="number"
          min={1}
          max={99}
          value={qty}
          disabled={!p.ready}
          onChange={e => setQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
          onKeyDown={e => {
            if (e.key === 'Enter' && chosen) add(chosen, printing);
            if (e.key === 'Escape') reset();
          }}
          aria-label="Quantity"
          title="How many"
          className="w-16 rounded-lg px-2 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 tabnum"
        />
        <Button
          variant="primary"
          tabIndex={chosen ? -1 : undefined}
          disabled={!p.ready || (!chosen && !hits.length)}
          onClick={() => (chosen ? add(chosen, printing) : hits[active] && add(hits[active], ''))}
        >
          Add
        </Button>
      </div>

      {chosen && (
        <div className="mt-2 flex gap-3 text-sm">
          <CardImage src={previewed?.imageLarge ?? previewed?.image ?? chosen.image} alt={chosen.name} className="w-36 rounded-lg shrink-0 self-start" />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2 text-xs text-slate-500 mb-1">
              <span className="truncate">
                Printing: <span className="text-slate-800 dark:text-slate-200">{shown ? printingLabel(shown) : 'Any printing (cheapest wins)'}</span>
              </span>
              <Button variant="link" className="text-xs shrink-0" tabIndex={-1} onClick={reset}>cancel (Esc)</Button>
            </div>
            <div
              ref={strip}
              tabIndex={0}
              role="listbox"
              aria-label="Printing"
              onKeyDown={e => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  browse(e.key === 'ArrowRight' ? 1 : -1);
                }
                if (e.key === 'Enter') add(chosen, printing);
                if (e.key === 'Escape') reset();
              }}
              onMouseLeave={() => setPreview(printing)}
              className="flex gap-2 overflow-x-auto pb-2 rounded-lg outline-none focus-visible:ring-2 ring-indigo-500"
            >
              <button
                type="button"
                data-id=""
                tabIndex={-1}
                role="option"
                aria-selected={printing === ''}
                onClick={() => setPrinting('')}
                onMouseEnter={() => setPreview('')}
                className={cx(
                  'shrink-0 w-20 h-28 rounded-md border-2 text-xs text-slate-500 flex items-center justify-center text-center px-1',
                  printing === '' ? 'border-indigo-500' : 'border-slate-300 dark:border-slate-700',
                )}
              >
                Any printing
                <br />
                (cheapest)
              </button>
              {printings.map(o => (
                <button
                  key={o.id}
                  type="button"
                  data-id={o.id}
                  tabIndex={-1}
                  role="option"
                  aria-selected={printing === o.id}
                  onClick={() => setPrinting(o.id)}
                  onMouseEnter={() => setPreview(o.id)}
                  title={printingLabel(o)}
                  className={cx('shrink-0 w-20 text-left rounded-md border-2 overflow-hidden', printing === o.id ? 'border-indigo-500' : 'border-transparent')}
                >
                  <CardImage src={o.image} alt={printingLabel(o)} className="w-full" />
                  <div className="text-[10px] leading-tight px-0.5 truncate">{o.setCode} #{o.collectorNumber}</div>
                  <div className="text-[10px] leading-tight px-0.5 text-slate-500 truncate">{o.treatments[0] ?? o.year}</div>
                </button>
              ))}
            </div>
            {printing && (
              <p className="text-xs text-slate-500">🔒 Added locked to this printing: only it can fill the line. You can allow any printing in the review list.</p>
            )}
          </div>
        </div>
      )}

      <div className="h-5 mt-1 text-xs flex justify-between gap-2" aria-live="polite">
        <span className="text-emerald-600 dark:text-emerald-400">{msg}</span>
        {chosen && <span className="text-slate-400">{printings.length} printings · ← → to browse · Enter adds</span>}
      </div>
    </div>
  );
}
