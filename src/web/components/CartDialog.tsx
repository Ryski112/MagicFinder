// Getting a Plan's cards into each Store's cart. The buyer always checks out themselves.
import { useEffect, useState } from 'react';
import type { CartCheckResponse, ItemView, StoreView } from '../../shared/api';
import { api } from '../api';
import { Button, Dialog, money, Notice } from './ui';

export type CartTarget = { kind: 'fetch'; items: ItemView[]; k: number } | { kind: 'store'; store: StoreView; k: number };

function openAll(urls: string[]) {
  // Browsers may only allow the first tab from one click; the list below covers the rest.
  for (const u of urls) window.open(u, '_blank', 'noopener');
}

function ListingLinks({ items }: { items: { name: string; qty: number; price: number; url: string; note?: string }[] }) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
      {items.map((i, n) => (
        <li key={n} className="py-1.5 flex items-center gap-2">
          <span className="tabnum text-slate-500 w-7">{i.qty}×</span>
          <span className="flex-1">{i.name}{i.note && <span className="text-xs text-amber-600 dark:text-amber-400"> · {i.note}</span>}</span>
          <span className="tabnum">{money(i.price)}</span>
          <a className="text-indigo-600 dark:text-indigo-400 underline" href={i.url} target="_blank" rel="noreferrer">open ↗</a>
        </li>
      ))}
    </ul>
  );
}

export function CartDialog({ runId, target, onClose }: { runId: string; target: CartTarget; onClose: () => void }) {
  if (target.kind === 'fetch') {
    const items = target.items.map(i => ({ name: i.name, qty: i.qty, price: i.price, url: i.url }));
    return (
      <Dialog open onClose={onClose} title={`Open ${items.length} Fetch Listings`}>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
          Fetch TCG has one cart for every seller. Open each Listing and press "Add to cart"; items from all Fetch Stores in this Plan check out together, one parcel per seller.
        </p>
        <Button variant="accent" className="mb-3" onClick={() => openAll(items.map(i => i.url))}>Open all</Button>
        <ListingLinks items={items} />
      </Dialog>
    );
  }
  const s = target.store;
  if (s.cart === 'shopify') return <ShopifyCart runId={runId} store={s} k={target.k} onClose={onClose} />;
  const items = s.items.map(i => ({ name: i.name, qty: i.qty, price: i.price, url: i.url }));
  if (s.cart === 'hobbymaster-deckbuilder') return <DeckBuilder store={s} items={items} onClose={onClose} />;
  return (
    <Dialog open onClose={onClose} title={`Open Listings at ${s.name}`}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">{s.name}'s shop can't be filled from a link. Open each Listing and add it to your cart there.</p>
      <Button variant="accent" className="mb-3" onClick={() => openAll(items.map(i => i.url))}>Open all</Button>
      <ListingLinks items={items} />
    </Dialog>
  );
}

function DeckBuilder({ store, items, onClose }: { store: StoreView; items: { name: string; qty: number; price: number; url: string }[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = items.map(i => `${i.qty} ${i.name}`).join('\n');
  return (
    <Dialog open onClose={onClose} title={`Copy list for ${store.name}`}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
        {store.name}'s Deck Builder takes a pasted list and shows its stock. Copy the list, open the Deck Builder, paste, then add the cards.
      </p>
      <pre className="text-xs bg-slate-100 dark:bg-slate-800 rounded p-2 mb-3 max-h-40 overflow-auto">{text}</pre>
      <div className="flex flex-wrap gap-2 mb-3">
        <Button variant="accent" onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.open(`${store.site ?? 'https://hobbymaster.co.nz'}/deck-builder`, '_blank', 'noopener');
        }}>{copied ? 'Copied, Deck Builder opened' : 'Copy list & open Deck Builder ↗'}</Button>
      </div>
      <details className="text-sm"><summary className="cursor-pointer text-slate-500">Or open each Listing</summary><ListingLinks items={items} /></details>
    </Dialog>
  );
}

function ShopifyCart({ runId, store, k, onClose }: { runId: string; store: StoreView; k: number; onClose: () => void }) {
  const [check, setCheck] = useState<CartCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.cart(runId, store.id, k).then(setCheck, e => setError((e as Error).message));
  }, [runId, store.id, k]);
  const bad = check?.lines.filter(l => l.status === 'unavailable' || l.status === 'unconfirmed') ?? [];
  const changed = check?.lines.filter(l => l.status === 'price-changed') ?? [];
  const good = check?.lines.filter(l => l.status === 'ok' || l.status === 'price-changed') ?? [];
  return (
    <Dialog open onClose={onClose} title={`Add all to cart at ${store.name}`}>
      {error && <Notice tone="bad">{error}</Notice>}
      {!check && !error && <p className="text-sm text-slate-500">Checking {store.name} still has these cards at these prices…</p>}
      {check && (
        <div className="space-y-3 text-sm">
          {check.fallbackReason && <Notice tone="warn">{check.fallbackReason} Open the Listings instead.</Notice>}
          {!check.fallbackReason && (
            <p>
              {good.length} of {check.lines.length} cards still available
              {changed.length > 0 && `, ${changed.length} price${changed.length > 1 ? 's' : ''} changed`}.
            </p>
          )}
          {changed.length > 0 && (
            <ul className="text-amber-700 dark:text-amber-300">
              {changed.map(l => <li key={l.listingId}>{l.name}: now {money(l.currentPrice)} (was {money(l.expectedPrice)})</li>)}
            </ul>
          )}
          {check.cartUrl && (
            <>
              <Notice tone="warn">This replaces anything already in your {store.name} cart.</Notice>
              <a href={check.cartUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-md bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold px-4 py-2">Open my cart at {store.name} ↗</a>
              <p className="text-xs text-slate-500">You'll land on {store.name}'s cart page to review and check out yourself.</p>
            </>
          )}
          {bad.length > 0 && (
            <div>
              <div className="font-medium mb-1">{check.cartUrl ? 'Left out of the cart' : 'Open these Listings'}:</div>
              <ListingLinks items={bad.map(l => ({ name: l.name, qty: l.qty, price: l.expectedPrice, url: l.url, note: l.status === 'unavailable' ? 'sold out' : "couldn't confirm" }))} />
            </div>
          )}
          {check.fallbackReason && <ListingLinks items={store.items.map(i => ({ name: i.name, qty: i.qty, price: i.price, url: i.url }))} />}
        </div>
      )}
    </Dialog>
  );
}
