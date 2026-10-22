// Getting a Plan's cards into each Store's cart. The buyer always checks out themselves.
import { useEffect, useState } from 'react';
import type { CartCheckResponse, CartKind } from '../../shared/api';
import { api } from '../api';
import { Button, Dialog, money, Notice } from './ui';

/** A Listing to put in a cart: from a Plan's Store, or a card picked in Browse by Store. */
export interface CartItem {
  listingId: string;
  name: string;
  qty: number;
  price: number;
  url: string;
}

/** The Store a cart is for, as a Plan or Browse by Store knows it. */
export interface CartStore {
  id: string;
  name: string;
  cart: CartKind;
  site: string | null;
}

export type CartTarget =
  | { kind: 'fetch'; items: CartItem[]; seller?: string }
  /** `tab` is a tab opened on the click itself, sent to the cart once it's ready (null when pop-ups are blocked). */
  | { kind: 'store'; store: CartStore; items: CartItem[]; tab?: Window | null };

/** The cart button's label for a Store's `cart` kind. */
export function cartLabel(cart: CartKind, listings: number): string {
  return {
    shopify: '🛒 Add all to cart ↗',
    'hobbymaster-deckbuilder': 'Copy list & open Deck Builder',
    'open-listings': 'Open Listings ↗',
    fetch: `Open ${listings} Listing${listings > 1 ? 's' : ''} ↗`,
  }[cart];
}

/** The target for a Store's cart button, opening the Shopify cart's tab during the click. */
export function cartTarget(store: CartStore, items: CartItem[]): CartTarget {
  return store.cart === 'fetch'
    ? { kind: 'fetch', items, seller: store.name }
    : { kind: 'store', store, items, tab: store.cart === 'shopify' ? openCartTab(store.name) : undefined };
}

/**
 * Opens the tab a Shopify cart will load in, during the click, so the browser doesn't block it as a pop-up (a tab
 * opened after the stock check has finished would be). It says what's happening until the cart is ready.
 */
function openCartTab(storeName: string): Window | null {
  const tab = window.open('', '_blank');
  if (!tab) return null;
  tab.opener = null;
  tab.document.title = `Checking ${storeName}…`;
  tab.document.body.innerHTML =
    '<p style="font:16px system-ui,sans-serif;color:#475569;margin:3rem auto;max-width:32rem;text-align:center"></p>';
  tab.document.body.firstElementChild!.textContent = `Checking ${storeName} still has your cards at these prices… Your cart opens here in a moment.`;
  return tab;
}

/** Opens every link in a new tab. Returns how many the browser blocked (it allows one per click unless pop-ups are allowed). */
function openAll(urls: string[]): number {
  let blocked = 0;
  for (const u of urls) {
    const w = window.open(u, '_blank');
    if (w) w.opener = null;
    else blocked++;
  }
  return blocked;
}

function OpenAllButton({ urls }: { urls: string[] }) {
  const [blocked, setBlocked] = useState(0);
  return (
    <div className="mb-3 space-y-2">
      <Button variant="accent" onClick={() => setBlocked(openAll(urls))}>Open all {urls.length}</Button>
      {blocked > 0 && (
        <Notice tone="warn">
          Your browser blocked {blocked} of the {urls.length} tabs; it only allows one per click from a new site. To open them all at once,
          click the blocked pop-up icon at the right of the address bar, choose <b>Always allow pop-ups from {window.location.host}</b>, then
          press Open all again. You only need to do this once. Or open them one by one below.
        </Notice>
      )}
    </div>
  );
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
    const items = target.items;
    return (
      <Dialog open onClose={onClose} title={target.seller ? `Open ${items.length} Listings from ${target.seller}` : `Open ${items.length} Fetch Listings`}>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
          Open each Listing and press "Add to cart" on Fetch TCG. Fetch has one cart for every seller, so items from all Fetch Stores in this Plan check out together, one parcel per seller.
        </p>
        <OpenAllButton urls={items.map(i => i.url)} />
        <ListingLinks items={items} />
      </Dialog>
    );
  }
  const s = target.store;
  const items = target.items;
  if (s.cart === 'shopify') return <ShopifyCart runId={runId} store={s} items={items} tab={target.tab ?? null} onClose={onClose} />;
  if (s.cart === 'hobbymaster-deckbuilder') return <DeckBuilder store={s} items={items} onClose={onClose} />;
  return (
    <Dialog open onClose={onClose} title={`Open Listings at ${s.name}`}>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">{s.name}'s shop can't be filled from a link. Open each Listing and add it to your cart there.</p>
      <OpenAllButton urls={items.map(i => i.url)} />
      <ListingLinks items={items} />
    </Dialog>
  );
}

function DeckBuilder({ store, items, onClose }: { store: CartStore; items: CartItem[]; onClose: () => void }) {
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

function ShopifyCart({ runId, store, items, tab, onClose }: { runId: string; store: CartStore; items: CartItem[]; tab: Window | null; onClose: () => void }) {
  const [check, setCheck] = useState<CartCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  // Whether the tab opened on the click was sent to the cart (it may have been closed in the meantime).
  const [sent, setSent] = useState(false);
  useEffect(() => {
    api.cart(runId, store.id, items.map(i => ({ listingId: i.listingId, qty: i.qty, name: i.name })), (done, total, name) => setProgress({ done, total, name })).then(
      r => {
        setCheck(r);
        if (tab && !tab.closed && r.cartUrl) {
          tab.location.href = r.cartUrl;
          setSent(true);
          // The cart tab shows what's in the cart and its prices; only stay open when cards were left out of it.
          if (!r.lines.some(l => l.status === 'unavailable' || l.status === 'unconfirmed')) onClose();
        } else if (tab && !tab.closed) tab.close();
      },
      e => {
        setError((e as Error).message);
        if (tab && !tab.closed) tab.close();
      },
    );
  }, [runId, store.id, items, tab]);
  const bad = check?.lines.filter(l => l.status === 'unavailable' || l.status === 'unconfirmed') ?? [];
  const changed = check?.lines.filter(l => l.status === 'price-changed') ?? [];
  const good = check?.lines.filter(l => l.status === 'ok' || l.status === 'price-changed') ?? [];
  // With a cart tab open, that tab says what's happening, so this dialog only appears if the check needs the buyer.
  if (tab && !tab.closed && !check && !error) return null;
  return (
    <Dialog open onClose={onClose} title={`Add all to cart at ${store.name}`}>
      {error && <Notice tone="bad">{error}</Notice>}
      {!check && !error && <CheckProgress storeName={store.name} progress={progress} total={items.length} />}
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
          {check.cartUrl && sent && (
            <p>
              Your cart at {store.name} is open in a new tab, ready to review and check out.{' '}
              <a href={check.cartUrl} target="_blank" rel="noreferrer" className="text-indigo-600 dark:text-indigo-400 underline">Open it again ↗</a>
            </p>
          )}
          {check.cartUrl && !sent && (
            <>
              <Notice tone="warn">This replaces anything already in your {store.name} cart.</Notice>
              <a href={check.cartUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-md bg-amber-400 hover:bg-amber-300 text-slate-900 font-semibold px-4 py-2">Open my cart at {store.name} ↗</a>
              <p className="text-xs text-slate-500">You'll land on {store.name}'s cart page to review and check out yourself.</p>
            </>
          )}
          {bad.length > 0 && (
            <div>
              <div className="font-medium mb-1">{check.cartUrl ? 'Left out of the cart' : 'Open these Listings'}:</div>
              <ListingLinks items={bad.map(l => ({ name: l.name, qty: l.qty, price: l.expectedPrice, url: l.url, note: l.status === 'unavailable' ? 'sold out' : `couldn't confirm: ${l.reason ?? 'unknown reason'}` }))} />
            </div>
          )}
          {check.fallbackReason && <ListingLinks items={items} />}
        </div>
      )}
    </Dialog>
  );
}

function CheckProgress({ storeName, progress, total }: { storeName: string; progress: { done: number; total: number; name: string } | null; total: number }) {
  const n = progress?.total ?? total;
  const done = progress?.done ?? 0;
  return (
    <div className="space-y-3 py-2" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm">
        <span className="inline-block w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" aria-hidden />
        <span>Checking {storeName} still has these cards at these prices…</span>
      </div>
      <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded overflow-hidden">
        <div className="h-2 bg-indigo-500 rounded transition-all duration-700" style={{ width: `${n ? Math.max(4, (100 * (done + 0.5)) / n) : 4}%` }} />
      </div>
      <div className="text-xs text-slate-500 tabnum">
        {progress ? `${Math.min(done + 1, n)} of ${n}: ${progress.name}` : `0 of ${n}`} · about {Math.max(1, n - done)} s left
      </div>
    </div>
  );
}
