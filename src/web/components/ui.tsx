// Small UI building blocks in the shadcn/ui style (Tailwind classes, no runtime styling library).
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { SourceId } from '../../shared/api';

export const money = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'accent' | 'outline' | 'ghost' | 'link';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500',
  accent: 'bg-amber-400 text-slate-900 hover:bg-amber-300 font-semibold',
  outline: 'border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800',
  ghost: 'hover:bg-slate-100 dark:hover:bg-slate-800',
  link: 'text-indigo-600 dark:text-indigo-400 underline underline-offset-2 hover:no-underline px-0 py-0',
};

export function Button({ variant = 'outline', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...p}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-md text-sm px-3 py-1.5 transition disabled:opacity-40 disabled:pointer-events-none', VARIANTS[variant], className)}
    />
  );
}

export function Switch({ checked, onChange, label, title, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; title?: string; ariaLabel?: string }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none" title={title}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
        onClick={() => onChange(!checked)}
        className={cx('w-9 h-5 rounded-full p-0.5 transition shrink-0', checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600')}
      >
        <span className={cx('block w-4 h-4 bg-white rounded-full shadow transition', checked && 'translate-x-4')} />
      </button>
      {label}
    </label>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 h-full p-5 shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-semibold">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-semibold text-lg">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
        </div>
        {children}
      </div>
    </div>
  );
}

function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active, onClose]);
}

const SOURCE_STYLE: Record<SourceId, string> = {
  fetch: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200',
  mtgsingles: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/60 dark:text-fuchsia-200',
};
export const SOURCE_NAME: Record<SourceId, string> = { fetch: 'Fetch TCG', mtgsingles: 'MtgSingles' };

export function SourceBadge({ source }: { source: SourceId }) {
  return <span className={cx('text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded', SOURCE_STYLE[source])}>{SOURCE_NAME[source]}</span>;
}

export function Tag({ children, tone = 'plain', title }: { children: ReactNode; tone?: 'plain' | 'warn'; title?: string }) {
  return (
    <span title={title} className={cx('text-[11px] px-1.5 rounded', tone === 'warn' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>
      {children}
    </span>
  );
}

/** A full, unaltered card image (Scryfall rules), with a plain fallback. */
export function CardImage({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return <div className={cx('grid place-items-center text-center text-[10px] p-1 rounded bg-gradient-to-br from-slate-600 to-slate-800 text-white', className)}>{alt}</div>;
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} className={cx('bg-slate-200 dark:bg-slate-800 object-cover', className)} />;
}

export function Notice({ tone, children }: { tone: 'warn' | 'bad' | 'info'; children: ReactNode }) {
  const t = {
    warn: 'bg-amber-50 border-amber-300 text-amber-900 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-200',
    bad: 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/50 dark:border-rose-900 dark:text-rose-200',
    info: 'bg-slate-100 border-slate-200 text-slate-600 dark:bg-slate-800/60 dark:border-slate-700 dark:text-slate-300',
  }[tone];
  return <div className={cx('border rounded-lg px-3 py-2 text-sm', t)}>{children}</div>;
}

export function timeAgo(epochMs: number): string {
  const mins = Math.round((Date.now() - epochMs) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return `${h} h ago`;
}
