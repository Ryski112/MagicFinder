import { useState } from 'react';
import type { Lock, ParseResponse, PlanChoices, Settings } from '../../shared/api';
import { CardSearcher } from './CardSearcher';
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
  const [review, setReview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const lines = p.parsed?.lines ?? [];
  const included = lines.filter(l => isLineIncluded(l, p.choices, p.settings));
  const basics = lines.filter(l => l.isBasic);
  const lockOf = (id: string): Lock | null | undefined => p.choices.locks[id];

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
      <CardSearcher text={p.text} onText={p.onText} ready={p.catalogueReady} progress={p.catalogueProgress} />
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
      {review && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {lines.map(l => {
              const on = isLineIncluded(l, p.choices, p.settings);
              const lock = lockOf(l.id);
              return (
                <li key={l.id} className="py-1.5 flex items-center gap-2">
                  <input type="checkbox" checked={on} disabled={l.isBasic && !p.settings.includeBasics}
                    onChange={() => p.onChoices({ ...p.choices, included: { ...p.choices.included, [l.id]: !on } })} />
                  <span className="w-6 text-right tabnum text-slate-500">{l.quantity}</span>
                  <span className={cx(!on && 'line-through text-slate-400')}>{l.name}</span>
                  {l.section !== 'main' && <span className="text-[11px] text-slate-400">{l.section}</span>}
                  {lock && <span title="Locked Printing">🔒</span>}
                  {l.hint && !lock && (
                    <span className="ml-auto text-[11px] text-slate-500">
                      your list said {l.hint.text}{' '}
                      {l.hint.lock && <Button variant="link" className="text-[11px]" onClick={() => p.onChoices({ ...p.choices, locks: { ...p.choices.locks, [l.id]: l.hint!.lock } })}>lock</Button>}
                    </span>
                  )}
                  {lock && <Button variant="link" className="ml-auto text-[11px]" onClick={() => p.onChoices({ ...p.choices, locks: { ...p.choices.locks, [l.id]: null } })}>unlock</Button>}
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
