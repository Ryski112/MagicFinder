// PROTOTYPE: floating bar that cycles `?variant=` on the current page. Throwaway; never ships (dev builds only).
import { useEffect, useState } from 'react';

export function useVariant(keys: string[]) {
  const read = () => {
    const v = new URLSearchParams(window.location.search).get('variant');
    return v && keys.includes(v) ? v : keys[0];
  };
  const [v, setV] = useState(read);
  const go = (next: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set('variant', next);
    window.history.replaceState(null, '', u);
    setV(next);
  };
  return [v, go] as const;
}

export function PrototypeSwitcher({ variants, current, onChange }: { variants: { key: string; name: string }[]; current: string; onChange: (k: string) => void }) {
  const i = variants.findIndex(x => x.key === current);
  const step = (d: number) => onChange(variants[(i + d + variants.length) % variants.length].key);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable], [role="listbox"]')) return;
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!import.meta.env.DEV) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 rounded-full bg-black text-white text-sm shadow-2xl ring-2 ring-fuchsia-500 px-1 py-1">
      <button type="button" className="px-3 py-1 rounded-full hover:bg-white/15" onClick={() => step(-1)} aria-label="Previous variant">←</button>
      <span className="px-2 font-mono">
        PROTOTYPE {variants[i].key} <span className="text-fuchsia-300">({variants[i].name})</span>
      </span>
      <button type="button" className="px-3 py-1 rounded-full hover:bg-white/15" onClick={() => step(1)} aria-label="Next variant">→</button>
    </div>
  );
}
