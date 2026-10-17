// PROTOTYPE (card searcher, issue #18): three throwaway layouts for adding a card to the Want List by name.
// Switch with ?variant=A|B|C (or the floating bar / ← →). Not production code: no tests, minimal error handling.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ParseResponse } from '../../shared/api';
import { Button, CardImage, cx } from './ui';

interface Hit { oracleId: string; name: string; matchedAlias: string | null; kind: string; how: string; image: string | null }
type Match = 'prefix' | 'words' | 'fuzzy';
type AddMode = 'bump' | 'append';

export interface SearcherProps {
  text: string;
  onText: (t: string) => void;
  parsed: ParseResponse | null;
  catalogueReady: boolean;
  catalogueProgress: number;
  importRow: ReactNode;
  textarea: ReactNode;
  below: ReactNode;
}

const VARIANTS = [
  ['A', 'Search bar above the box'],
  ['B', 'Search tab with card images'],
  ['C', 'Type it like a list line'],
] as const;

const param = (k: string, d: string) => new URLSearchParams(location.search).get(k) ?? d;
function setParam(k: string, v: string) {
  const u = new URL(location.href);
  u.searchParams.set(k, v);
  history.replaceState(null, '', u);
  window.dispatchEvent(new Event('prototype-params'));
}
function useParams() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force(n => n + 1);
    window.addEventListener('prototype-params', f);
    return () => window.removeEventListener('prototype-params', f);
  }, []);
  return {
    variant: param('variant', 'A'),
    match: param('match', 'words') as Match,
    add: param('add', 'bump') as AddMode,
    loading: param('catalogue', 'ready') === 'loading',
    limit: Number(param('limit', '8')),
  };
}

function useCardSearch(q: string, match: Match, limit: number) {
  const [hits, setHits] = useState<Hit[]>([]);
  const [meta, setMeta] = useState('');
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      setMeta('');
      return;
    }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/prototype/card-search?${new URLSearchParams({ q, match, limit: String(limit) })}`).then(r => r.json());
      setHits(r.results ?? []);
      setMeta(r.total != null ? `${r.total} matches · ${r.ms} ms` : '');
    }, 120);
    return () => clearTimeout(t);
  }, [q, match, limit]);
  return { hits, meta };
}

// --- Editing the pasted text -------------------------------------------------------------------

const HEADER = /^\s*(commanders?|companion|sideboard|maybeboard|considering|deck|main|mainboard|about)\s*:?\s*$/i;
const PLAIN = /^(\s*)(\d+)(x?)(\s+)(.+?)\s*$/i;
const sameName = (a: string, b: string) => a.toLowerCase().replace(/\s*\/\/?\s*/g, ' // ').trim() === b.toLowerCase();

/** Adds `delta` copies of a card. "bump" raises the quantity of a plain line already naming it; otherwise a new line goes at the end of the main deck. */
export function addToText(text: string, name: string, delta: number, mode: AddMode): { text: string; message: string } {
  const lines = text.split('\n');
  if (mode === 'bump' || delta < 0) {
    for (let i = 0; i < lines.length; i++) {
      const m = PLAIN.exec(lines[i]);
      if (!m || !sameName(m[5], name)) continue;
      const qty = Number(m[2]) + delta;
      if (qty <= 0) {
        lines.splice(i, 1);
        return { text: lines.join('\n'), message: `Removed ${name}` };
      }
      lines[i] = `${m[1]}${qty}${m[3]}${m[4]}${m[5]}`;
      return { text: lines.join('\n'), message: `${name}: now ${qty} (was ${qty - delta})` };
    }
  }
  if (delta <= 0) return { text, message: '' };
  // Find the end of the main deck: before Sideboard/Maybeboard/etc., or (no headers) before the MTGO blank-line sideboard.
  const hasHeaders = lines.some(l => HEADER.test(l));
  let section = 'main';
  let insertAt = -1;
  let sawCard = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = HEADER.exec(l);
    if (h) {
      section = /^(deck|main|mainboard)$/i.test(h[1]) ? 'main' : h[1].toLowerCase();
      continue;
    }
    if (!l.trim()) {
      if (!hasHeaders && sawCard) break;
      continue;
    }
    sawCard = true;
    if (section === 'main') insertAt = i + 1;
  }
  const newLine = `${delta} ${name}`;
  if (insertAt < 0) {
    const t = text.trimEnd();
    return { text: t ? `${t}\n${newLine}` : newLine, message: `Added ${newLine}` };
  }
  lines.splice(insertAt, 0, newLine);
  return { text: lines.join('\n'), message: `Added ${newLine}` };
}

// --- Shared bits ---------------------------------------------------------------------------------

function notReadyText(progress: number) {
  return `Card search is ready once the card list finishes downloading (${Math.round(progress * 100)}%)`;
}

function Suggestions({ hits, active, onPick, onHover, showHow }: { hits: Hit[]; active: number; onPick: (h: Hit) => void; onHover: (i: number) => void; showHow: boolean }) {
  if (!hits.length) return null;
  return (
    <ul className="absolute z-20 left-0 right-0 mt-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg overflow-hidden">
      {hits.map((h, i) => (
        <li key={h.oracleId}>
          <button type="button" onMouseDown={e => { e.preventDefault(); onPick(h); }} onMouseEnter={() => onHover(i)}
            className={cx('w-full flex items-center gap-2 px-2 py-1 text-left text-sm', i === active && 'bg-indigo-50 dark:bg-indigo-950')}>
            <CardImage src={h.image} alt="" className="w-6 h-8 rounded-sm object-cover" />
            <span className="flex-1">
              {h.name}
              {h.matchedAlias && <span className="text-xs text-slate-500"> · matched “{h.matchedAlias}”</span>}
            </span>
            {showHow && <span className="text-[10px] text-slate-400">{h.how}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
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

/** Arrow keys move through suggestions; Enter picks the highlighted one (or the first); Escape closes. */
function comboKeys(e: React.KeyboardEvent, hits: Hit[], active: number, setActive: (n: number) => void, pick: (h: Hit) => void, close: () => void) {
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(active + 1, hits.length - 1)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(active - 1, 0)); }
  else if (e.key === 'Enter' && hits.length) { e.preventDefault(); pick(hits[Math.max(active, 0)]); }
  else if (e.key === 'Escape') close();
}

// --- Variant A: a search bar with a quantity box, between the import row and the text box -------

function VariantA(p: SearcherProps & { ready: boolean }) {
  const { match, add, limit } = useParams();
  const [q, setQ] = useState('');
  const [qty, setQty] = useState(1);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useFlash();
  const { hits, meta } = useCardSearch(q, match, limit);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setActive(0), [hits]);
  const pick = (h: Hit) => {
    const r = addToText(p.text, h.name, qty, add);
    p.onText(r.text);
    setMsg(r.message);
    setQ('');
    setQty(1);
    input.current?.focus();
  };
  return (
    <>
      {p.importRow}
      <div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input ref={input} disabled={!p.ready} value={q} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
              onChange={e => { setQ(e.target.value); setOpen(true); }}
              onKeyDown={e => comboKeys(e, hits, active, setActive, pick, () => setOpen(false))}
              placeholder={p.ready ? '🔍 Add a card by name…' : notReadyText(p.catalogueProgress)}
              className="w-full rounded-lg px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 disabled:opacity-60" />
            {open && <Suggestions hits={hits} active={active} onPick={pick} onHover={setActive} showHow />}
          </div>
          <input type="number" min={1} max={99} value={qty} disabled={!p.ready} onChange={e => setQty(Math.max(1, Number(e.target.value) || 1))}
            aria-label="Quantity" title="How many"
            className="w-16 rounded-lg px-2 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 tabnum" />
          <Button variant="primary" disabled={!hits.length} onClick={() => hits[active] && pick(hits[active])}>Add</Button>
        </div>
        <div className="h-5 mt-1 text-xs flex justify-between">
          <span className="text-emerald-600 dark:text-emerald-400">{msg}</span>
          <span className="text-slate-400">{meta}</span>
        </div>
      </div>
      {p.textarea}
      {p.below}
    </>
  );
}

// --- Variant B: tabs; searching shows card images and builds a visible list alongside ----------

function VariantB(p: SearcherProps & { ready: boolean }) {
  const { match, add } = useParams();
  const [tab, setTab] = useState<'search' | 'paste'>(p.text.trim() ? 'paste' : 'search');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useFlash();
  const { hits, meta } = useCardSearch(q, match, 12);
  const change = (name: string, delta: number) => {
    const r = addToText(p.text, name, delta, delta < 0 ? 'bump' : add);
    p.onText(r.text);
    setMsg(r.message);
  };
  const lines = p.parsed?.lines ?? [];
  const tabBtn = (t: typeof tab, label: string) => (
    <button type="button" onClick={() => setTab(t)}
      className={cx('px-4 py-2 text-sm font-medium border-b-2 -mb-px', tab === t ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500')}>
      {label}
    </button>
  );
  return (
    <>
      <div className="flex border-b border-slate-200 dark:border-slate-800">
        {tabBtn('search', '🔍 Search for cards')}
        {tabBtn('paste', '📋 Paste or import a list')}
      </div>
      {tab === 'paste' ? (
        <>{p.importRow}{p.textarea}</>
      ) : (
        <div className="grid md:grid-cols-[minmax(0,1fr)_220px] gap-4">
          <div className="space-y-2 min-w-0">
            <input autoFocus disabled={!p.ready} value={q} onChange={e => setQ(e.target.value)}
              placeholder={p.ready ? 'Card name, e.g. “sol ring”' : notReadyText(p.catalogueProgress)}
              className="w-full rounded-lg px-4 py-3 text-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 disabled:opacity-60" />
            <div className="h-4 text-xs flex justify-between"><span className="text-emerald-600 dark:text-emerald-400">{msg}</span><span className="text-slate-400">{meta}</span></div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {hits.map(h => (
                <div key={h.oracleId} className="group relative">
                  <button type="button" onClick={() => change(h.name, 1)} title={`Add 1 ${h.name}`} className="block w-full">
                    <CardImage src={h.image} alt={h.name} className="w-full rounded-md" />
                  </button>
                  <div className="absolute inset-x-1 bottom-1 hidden group-hover:flex gap-1 justify-center">
                    {[1, 4].map(n => <button key={n} type="button" onClick={() => change(h.name, n)} className="rounded bg-slate-900/80 text-white text-xs px-2 py-0.5">+{n}</button>)}
                  </div>
                  <div className="text-[11px] truncate mt-0.5">{h.name}</div>
                </div>
              ))}
            </div>
            {!q && <p className="text-sm text-slate-500">Click a card to add one; hover for +4. Your list builds up on the right.</p>}
          </div>
          <aside className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 text-sm self-start">
            <div className="font-semibold px-1 mb-1">Your list ({lines.reduce((n, l) => n + l.quantity, 0)})</div>
            {!lines.length && <div className="px-1 text-slate-500">Nothing yet.</div>}
            <ul className="max-h-80 overflow-auto">
              {lines.map(l => (
                <li key={l.id} className="flex items-center gap-1 px-1 py-0.5">
                  <button type="button" className="w-5 text-slate-500" onClick={() => change(l.name, -1)}>−</button>
                  <span className="w-5 text-right tabnum">{l.quantity}</span>
                  <button type="button" className="w-5 text-slate-500" onClick={() => change(l.name, 1)}>+</button>
                  <span className="truncate">{l.name}</span>
                </li>
              ))}
            </ul>
            <Button variant="link" className="text-xs mt-1" onClick={() => setTab('paste')}>see it as text</Button>
          </aside>
        </div>
      )}
      {p.below}
    </>
  );
}

// --- Variant C: one line under the text box; you type "4 bolt" and Enter adds it -----------------

function VariantC(p: SearcherProps & { ready: boolean }) {
  const { match, add, limit } = useParams();
  const [raw, setRaw] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useFlash();
  const m = /^\s*(\d+)\s*x?\s+(.*)$/i.exec(raw);
  const qty = m ? Math.max(1, Number(m[1])) : 1;
  const q = m ? m[2] : raw;
  const { hits, meta } = useCardSearch(q, match, limit);
  useEffect(() => setActive(0), [hits]);
  const pick = (h: Hit) => {
    const r = addToText(p.text, h.name, qty, add);
    p.onText(r.text);
    setMsg(r.message);
    setRaw('');
  };
  return (
    <>
      {p.importRow}
      <div className="rounded-lg border border-slate-300 dark:border-slate-700 overflow-visible">
        <div className="[&>textarea]:border-0 [&>textarea]:rounded-b-none">{p.textarea}</div>
        <div className="relative border-t border-dashed border-slate-300 dark:border-slate-700 flex items-center font-mono text-xs">
          <span className="pl-3 text-slate-400">+</span>
          <input disabled={!p.ready} value={raw} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
            onChange={e => { setRaw(e.target.value); setOpen(true); }}
            onKeyDown={e => comboKeys(e, hits, active, setActive, pick, () => setOpen(false))}
            placeholder={p.ready ? 'add a card: type “4 bolt” and press Enter' : notReadyText(p.catalogueProgress)}
            className="flex-1 px-2 py-2 bg-transparent outline-none disabled:opacity-60" />
          {q.trim().length >= 2 && <span className="pr-3 text-slate-400">{qty}×</span>}
          {open && <div className="absolute left-0 right-0 top-full font-sans"><Suggestions hits={hits} active={active} onPick={pick} onHover={setActive} showHow={false} /></div>}
        </div>
      </div>
      <div className="h-4 -mt-2 text-xs flex justify-between"><span className="text-emerald-600 dark:text-emerald-400">{msg}</span><span className="text-slate-400">{meta}</span></div>
      {p.below}
    </>
  );
}

// --- Switcher -------------------------------------------------------------------------------------

export function CardSearcherPrototype(p: SearcherProps) {
  const { variant, match, add, loading } = useParams();
  const ready = p.catalogueReady && !loading;
  const progress = loading ? 0.42 : p.catalogueProgress;
  const i = Math.max(0, VARIANTS.findIndex(v => v[0] === variant));
  const cycle = (d: number) => setParam('variant', VARIANTS[(i + d + VARIANTS.length) % VARIANTS.length][0]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowLeft') cycle(-1);
      if (e.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  const props = { ...p, ready, catalogueProgress: progress };
  const sel = 'bg-slate-800 rounded px-1 py-0.5';
  return (
    <>
      {VARIANTS[i][0] === 'A' && <VariantA {...props} />}
      {VARIANTS[i][0] === 'B' && <VariantB {...props} />}
      {VARIANTS[i][0] === 'C' && <VariantC {...props} />}
      {/* Shown in every build: this whole file lives only on the prototype branch. */}
      {(
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-wrap justify-center items-center gap-x-3 gap-y-1 w-max max-w-[calc(100vw-2rem)] rounded-2xl bg-slate-950 text-white text-xs px-4 py-2 shadow-2xl ring-2 ring-fuchsia-500">
          <span className="text-fuchsia-400 font-bold">PROTOTYPE</span>
          <button type="button" onClick={() => cycle(-1)}>◀</button>
          <span className="text-center">{VARIANTS[i][0]} ({VARIANTS[i][1]})</span>
          <button type="button" onClick={() => cycle(1)}>▶</button>
          <label>match <select className={sel} value={match} onChange={e => setParam('match', e.target.value)}>
            <option value="prefix">starts with</option><option value="words">any word</option><option value="fuzzy">typo-tolerant</option>
          </select></label>
          <label>add <select className={sel} value={add} onChange={e => setParam('add', e.target.value)}>
            <option value="bump">bump existing</option><option value="append">always new line</option>
          </select></label>
          <label><input type="checkbox" checked={loading} onChange={e => setParam('catalogue', e.target.checked ? 'loading' : 'ready')} /> catalogue downloading</label>
        </div>
      )}
    </>
  );
}
