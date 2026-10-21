import type { ParseResponse, SearchProgressView, SourceRunStatus } from '../../shared/api';
import { Button, CardImage, cx } from './ui';

export function sourceLine(s: SourceRunStatus): { text: string; warn: boolean } {
  switch (s.status) {
    case 'ok':
      // Hosted mode: other friends' searches are using this Source too. A count only, never what they search for.
      if (s.sharedWith) {
        return { text: `${s.name}: shared with ${s.sharedWith} other search${s.sharedWith === 1 ? '' : 'es'} · about ${s.minutesLeft} min left`, warn: false };
      }
      return { text: `${s.name} ✓`, warn: false };
    case 'off': return { text: `${s.name} off`, warn: false };
    case 'cooling-down': return { text: `${s.name} paused (blocked recently)`, warn: true };
    case 'blocked': return { text: `${s.name} ⚠ stopped answering`, warn: true };
    case 'slowed': return { text: `${s.name} ⚠ asked to slow down`, warn: true };
    case 'down': return { text: `${s.name} ⚠ not working right now`, warn: true };
    case 'changed': return { text: `${s.name} ⚠ needs an update`, warn: true };
  }
}

export function SearchStep({ progress, queuedAhead = null, lines, onCancel }: { progress: SearchProgressView | null; queuedAhead?: number | null; lines: ParseResponse['lines']; onCancel: () => void }) {
  const done = progress?.done ?? 0;
  const total = progress?.total ?? lines.length;
  return (
    <div className="space-y-6 mt-6">
      <div className="max-w-xl mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center space-y-4">
        <div className="text-lg font-semibold">
          {queuedAhead !== null ? `Waiting for ${queuedAhead} search${queuedAhead === 1 ? '' : 'es'} ahead of you…` : 'Searching NZ Stores…'}
        </div>
        <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded">
          <div className="h-2 bg-indigo-500 rounded transition-all" style={{ width: `${total ? (100 * done) / total : 0}%` }} />
        </div>
        <div className="text-sm text-slate-500 tabnum">{done}/{total}{progress?.current ? `: ${progress.current}` : done === total ? ': finding the cheapest Plans…' : ''}</div>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
          {progress?.sources.map(s => {
            const l = sourceLine(s);
            return <span key={s.source} className={cx(l.warn && 'text-amber-600 dark:text-amber-400')} title={s.message}>{l.text}</span>;
          })}
        </div>
        <Button onClick={onCancel}>Cancel search</Button>
      </div>
      <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
        {lines.map((l, i) => (
          <div key={l.id} className={cx('transition duration-500', i < done ? 'opacity-100' : 'opacity-20')}>
            <CardImage src={l.image} alt={l.name} className="w-full aspect-[5/7] rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
