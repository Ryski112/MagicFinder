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

export function Switch({ checked, onChange, label, title, ariaLabel, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; title?: string; ariaLabel?: string; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm select-none', disabled ? 'opacity-70 cursor-default' : 'cursor-pointer')} title={title}>
      <button
        type="button"
        role="switch"
        disabled={disabled}
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
  'mtgsingles-au': 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
};
export const SOURCE_NAME: Record<SourceId, string> = { fetch: 'Fetch TCG', mtgsingles: 'MtgSingles', 'mtgsingles-au': 'MtgSingles AU' };

export function SourceBadge({ source }: { source: SourceId }) {
  return <span className={cx('text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded', SOURCE_STYLE[source])}>{SOURCE_NAME[source]}</span>;
}

/** Whether an Australian Store posts to NZ, as the weekly checkout check found. */
export function AustraliaTag({ shipsToNz, estimated }: { shipsToNz: boolean | null; estimated: boolean }) {
  if (shipsToNz === true) {
    return <Tag title={`An Australian Store whose checkout offers postage to NZ.${estimated ? ' Postage here is a guess.' : ''}`}>Australia · ships to NZ</Tag>;
  }
  if (shipsToNz === false) return <Tag tone="warn" title="Its checkout offers no postage to NZ. Shown because you turned off leaving these Stores out.">Australia · doesn't ship to NZ</Tag>;
  return <Tag tone="warn" title="An Australian Store nobody could check yet. Check its site ships to NZ before ordering; postage here is a guess.">Australia · may not ship to NZ</Tag>;
}

export function Tag({ children, tone = 'plain', title }: { children: ReactNode; tone?: 'plain' | 'warn'; title?: string }) {
  return (
    <span title={title} className={cx('text-[11px] px-1.5 rounded', tone === 'warn' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300')}>
      {children}
    </span>
  );
}

/** True when a Listing's price may not be like-for-like: below NM, or the Printing isn't confirmed. */
export const unsure = (condition: string | null, printingId: string | null) => condition !== 'NM' || printingId === null;

/** "+X%" over CardKingdom (orange, red from +60%), or "−X%" under it (green, darker from −50%). `unsure` warns that a bargain may not be like-for-like. */
export function CardKingdomChip({ price, cardKingdomNzd, unsure = false }: { price: number; cardKingdomNzd: number; unsure?: boolean }) {
  const pct = Math.round((price / cardKingdomNzd - 1) * 100);
  const bargain = pct < 0;
  const severe = bargain ? pct <= -50 : pct >= 60;
  return (
    <span
      title={`${money(price)} here vs ${money(cardKingdomNzd)} at CardKingdom, before shipping${bargain ? ` — a bargain${unsure ? '. Check the condition and Printing' : ''}` : ''}`}
      className={cx(
        'text-[11px] font-bold px-1.5 rounded-full tabnum cursor-help whitespace-nowrap shrink-0',
        bargain ? (severe ? 'bg-emerald-700 text-white' : 'bg-emerald-500 text-white') : severe ? 'bg-rose-600 text-white' : 'bg-orange-500 text-white',
      )}
    >
      {bargain ? `−${-pct}` : `+${pct}`}%
    </span>
  );
}

/** A small card that shows the large one beside it while hovered. */
export function HoverCard({ src, large, alt, className = 'w-10' }: { src: string | null | undefined; large?: string | null; alt: string; className?: string }) {
  const big = large ?? src;
  return (
    <span className="relative group shrink-0">
      <CardImage src={src} alt={alt} className={cx(className, 'aspect-[5/7] rounded')} />
      {big && (
        <span className="hidden group-hover:block absolute left-full ml-2 top-0 z-30 w-56 shadow-2xl rounded-xl overflow-hidden pointer-events-none">
          <CardImage src={big} alt={alt} className="w-full aspect-[5/7]" />
        </span>
      )}
    </span>
  );
}

/** Scryfall's large image sits at the same path as the small one. */
export const largeImage = (url: string | null | undefined) => url?.replace('/small/', '/normal/') ?? null;

const listingButton = 'inline-flex items-center justify-center rounded-md font-semibold text-xs px-2.5 py-1 whitespace-nowrap shrink-0';

/** A Listing's page at its Store, as the yellow button the Store sections use. */
export function ListingButton({ url, className }: { url: string; className?: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
      className={cx(listingButton, 'bg-amber-400 text-slate-900 hover:bg-amber-300', className)}>
      View listing ↗
    </a>
  );
}

/** Takes up a View listing button's room, so a header's figures line up over the lines' prices (on a narrow screen the button sits under the price, so it takes none). */
export function ListingButtonSpace() {
  return <span aria-hidden className={cx(listingButton, 'invisible hidden sm:inline-flex')}>View listing ↗</span>;
}

/** The end of a line: its price, then View listing. On a narrow screen the button goes under the price, so the line keeps room for its name. */
export function PriceAndListing({ price, note, url }: { price: number; note?: ReactNode; url: string }) {
  return (
    <span className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3 shrink-0">
      <PriceCell price={price} note={note} />
      <ListingButton url={url} />
    </span>
  );
}

/** The round chevron that opens a row's actions. */
export function ActionsToggle({ open, onClick, name, title }: { open: boolean; onClick: () => void; name: string; title: string }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} actions for ${name}`} title={open ? 'Hide actions' : title}
      className={cx('shrink-0 w-7 h-7 grid place-items-center rounded-full border transition-colors',
        open
          ? 'border-indigo-500 bg-indigo-600 text-white'
          : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400')}>
      {/* Drawn centred on its own 16×16 box, so it sits in the middle of the circle and turns about that middle. */}
      <svg viewBox="0 0 16 16" aria-hidden="true" className={cx('w-3.5 h-3.5 transition-transform', open && 'rotate-90')}
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 4l4 4-4 4" />
      </svg>
    </button>
  );
}

/** A row's price, at a fixed width so the row's › buttons line up down the list. */
export function PriceCell({ price, note }: { price: number; note?: ReactNode }) {
  return (
    <span className="w-24 shrink-0 text-right">
      <span className="block tabnum">{money(price)}</span>
      {note && <span className="block text-[11px] text-slate-500 tabnum">{note}</span>}
    </span>
  );
}

/** A five-point star, gold and filled when on, an outline when off. */
export function Star({ on, className = 'w-4 h-4' }: { on: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cx(className, 'shrink-0 transition-colors', on ? 'fill-amber-400 text-amber-400' : 'fill-none text-slate-400')}
      stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z" />
    </svg>
  );
}

/** Marks a Store as preferred, like a favourites button: a star that turns gold. */
export function PreferButton({ on, onClick, storeName }: { on: boolean; onClick: () => void; storeName: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      title={on ? `${storeName} is a preferred Store: no postage, and it doesn't count toward your Store limit. Click to stop.` : `Make ${storeName} a preferred Store: somewhere you collect from for free, so it doesn't count toward your Store limit.`}
      className={cx('group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
        on ? 'border-amber-400/70 bg-amber-400/10 text-amber-600 dark:text-amber-300' : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-amber-400 hover:text-amber-600 dark:hover:text-amber-300')}>
      <Star on={on} className={cx('w-3.5 h-3.5', !on && 'group-hover:text-amber-400')} />
      {on ? 'Preferred' : 'Prefer'}
    </button>
  );
}

/** "3 Printings", or "Printings" when the count isn't known. */
export const printingsLabel = (n: number) => (n > 0 ? `${n} Printing${n === 1 ? '' : 's'}` : 'Printings');

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
