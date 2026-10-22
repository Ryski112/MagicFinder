import { useState } from 'react';
import type { Lock, ParseResponse, PlanChoices, Settings } from '../../shared/api';
import { CardSearcher } from './CardSearcher';
import { VariantA, VariantA1, VariantA2, VariantA3 } from './CardSearcher.prototype';
import { PrototypeSwitcher, useVariant } from './PrototypeSwitcher';
import { Button, cx } from './ui';

interface Props {
  text: string;
  onText: (t: string) => void;
  deckName: string | null;
  onImport: (url: string) => Promise<void>;
  parsed: ParseResponse | null;
  choices: PlanChoices;
  onChoices: (c: PlanChoices) => void;
  settings: Settings;
  onSettings: (p: Partial<Settings>) => void;
  onFind: () => void;
  busy: boolean;
  catalogueMessage: string | null;
  catalogueReady: boolean;
  /** 0..1 while the card list downloads. */
  catalogueProgress: number;
}

export function isLineIncluded(l: ParseResponse['lines'][number], choices: PlanChoices, s: Settings) {
  if (l.isBasic && !s.includeBasics) return false;
  return choices.included[l.id] ?? l.includedByDefault;
}

export function WantListStep(p: Props) {
  const [url, setUrl] = useState('');
  const [review, setReview] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // PROTOTYPE: card searcher variants, `?variant=` (see CardSearcher.prototype.tsx). Round 2 refines A; B and C lost.
  const [variant, setVariant] = useVariant(['A1', 'A2', 'A3', 'A', 'now']);
  const Searcher = { now: CardSearcher, A: VariantA, A1: VariantA1, A2: VariantA2, A3: VariantA3 }[variant] ?? CardSearcher;
  const lines = p.parsed?.lines ?? [];
  const included = lines.filter(l => isLineIncluded(l, p.choices, p.settings));
  const basics = lines.filter(l => l.isBasic);
  // What will actually apply: the buyer's own choice, else the list's Printing when "Use the Printings from my list" is on.
  const lockOf = (l: ParseResponse['lines'][number]): Lock | null =>
    l.id in p.choices.locks ? p.choices.locks[l.id] : p.settings.useListPrintings ? l.hint?.lock ?? null : null;
  const setLock = (id: string, lock: Lock | null) => p.onChoices({ ...p.choices, locks: { ...p.choices.locks, [id]: lock } });
  const sameLock = (a: Lock | null | undefined, b: Lock | null | undefined) => !!a && !!b && a.printingId === b.printingId && a.finish === b.finish;

  const doImport = async () => {
    setImporting(true);
    setImportError(null);
    try {
      await p.onImport(url);
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const summary = [
    `${included.reduce((n, l) => n + l.quantity, 0)} cards recognised`,
    p.parsed?.unrecognised.length ? `${p.parsed.unrecognised.length} not` : '',
    basics.length && !p.settings.includeBasics ? 'basics skipped' : '',
  ].filter(Boolean).join(', ');

  return (
    <div className="max-w-2xl mx-auto space-y-4 pt-6">
      <h1 className="text-4xl font-black tracking-tight">Cheapest way to buy your list in NZ.</h1>
      <p className="text-slate-500 dark:text-slate-400">Paste a list or an Archidekt link, or add cards by name. MagicFinder searches Fetch TCG and MtgSingles and shows what each extra Store saves you.</p>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg px-4 py-3 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
          placeholder="https://archidekt.com/decks/…"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && url && doImport()}
        />
        <Button variant="primary" className="px-4" disabled={!url || importing} onClick={doImport}>{importing ? 'Importing…' : 'Import'}</Button>
      </div>
      {importError && <p className="text-sm text-rose-600 dark:text-rose-400">{importError}</p>}
      <Searcher key={variant} text={p.text} onText={p.onText} onLock={setLock} ready={p.catalogueReady} progress={p.catalogueProgress} />
      <PrototypeSwitcher
        variants={[
          { key: 'A1', name: 'Preview column + stepper' },
          { key: 'A2', name: 'Spotlight + one-click counts' },
          { key: 'A3', name: 'Big rows + live tally' },
          { key: 'A', name: 'Round 1 quick-add list' },
          { key: 'now', name: 'Current' },
        ]}
        current={variant}
        onChange={setVariant}
      />
      <textarea
        className="w-full h-56 rounded-lg p-3 font-mono text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700"
        placeholder={'4 Lightning Bolt\n1 Sol Ring (C21) 263\n1x Rhystic Study *F*'}
        value={p.text}
        onChange={e => p.onText(e.target.value)}
      />
      {p.catalogueMessage && <p className="text-sm text-amber-600 dark:text-amber-400">{p.catalogueMessage}</p>}
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="accent" className="px-6 py-3 text-lg rounded-lg" disabled={!included.length || p.busy} onClick={p.onFind}>Find my cards</Button>
        <span className="text-sm text-slate-500 dark:text-slate-400">{p.deckName ? `“${p.deckName}”: ` : ''}{lines.length ? summary : ''}</span>
        {lines.length > 0 && <Button variant="link" className="ml-auto" onClick={() => setReview(!review)}>{review ? 'hide list ▴' : 'review list ▾'}</Button>}
      </div>
      {review && lines.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          {lines.some(l => l.hint || lockOf(l)) && (
            <p className="mb-2 text-xs text-slate-500">
              MagicFinder buys the cheapest printing of each card. Where your list names a printing, you can lock the line to buy only that printing: it may cost more or be out of stock.
            </p>
          )}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {lines.map(l => {
              const on = isLineIncluded(l, p.choices, p.settings);
              const lock = lockOf(l);
              return (
                <li key={l.id} className="py-1.5 flex items-center gap-2">
                  <input type="checkbox" checked={on} disabled={l.isBasic && !p.settings.includeBasics}
                    onChange={() => p.onChoices({ ...p.choices, included: { ...p.choices.included, [l.id]: !on } })} />
                  <span className="w-6 text-right tabnum text-slate-500">{l.quantity}</span>
                  <span className={cx(!on && 'line-through text-slate-400')}>{l.name}</span>
                  {l.section !== 'main' && <span className="text-[11px] text-slate-400">{l.section}</span>}
                  {lock ? (
                    <span className="ml-auto flex items-center gap-2 text-[11px]">
                      <span className="rounded px-1.5 bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
                        title="Locked: only this exact printing (and finish) can fill this line, even if another printing is cheaper.">
                        🔒 only {sameLock(lock, l.hint?.lock) ? l.hint!.text : 'one printing'}
                      </span>
                      <Button variant="link" className="text-[11px]" title="Let any printing fill this line, cheapest first." onClick={() => setLock(l.id, null)}>
                        allow any printing
                      </Button>
                    </span>
                  ) : l.hint ? (
                    <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
                      <span title={l.hint.lock ? 'Your list names this printing. For now any printing can fill the line, cheapest first.' : "Your list names a printing MagicFinder couldn't pin down, so any printing can fill the line."}>
                        list says {l.hint.text}{l.hint.lock ? '' : ' (no exact match)'} · any printing
                      </span>
                      {l.hint.lock && (
                        <Button variant="link" className="text-[11px]" title={`Lock: only ${l.hint.text} can fill this line, even if another printing is cheaper.`} onClick={() => setLock(l.id, l.hint!.lock)}>
                          🔒 only buy {l.hint.text}
                        </Button>
                      )}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!!p.parsed?.unrecognised.length && <div className="mt-2 text-sm text-rose-600 dark:text-rose-400">Couldn't recognise: {p.parsed.unrecognised.join(' · ')}</div>}
          {basics.length > 0 && (
            <div className="mt-2 text-sm text-slate-500 flex items-center gap-2">
              {p.settings.includeBasics ? 'Basic lands included.' : `Skipped basic lands: ${basics.map(b => `${b.quantity} ${b.name}`).join(', ')}.`}
              <Button variant="link" onClick={() => p.onSettings({ includeBasics: !p.settings.includeBasics })}>{p.settings.includeBasics ? 'skip them' : 'include them'}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
