// "Add all to cart" for Shopify Stores: resolve each Listing's variant from the public products/<handle>.js,
// re-check stock and price, then build a cart permalink that lands on the Store's cart page (never checkout).
// See "Can each Store's cart be pre-filled from a Plan?".
import type { Listing } from '../core/types';
import type { CartCheckResponse, CartLineCheck } from '../shared/api';
import { Throttle } from '../sources/policy';
import { USER_AGENT } from './paths';

export interface ShopifyVariant {
  id: number;
  title: string;
  price: number; // cents
  available: boolean;
  sku?: string | null;
}

const RANK_WORDS: [RegExp, number][] = [
  [/\b(near ?mint|nm(-mint)?|mint)\b/i, 1],
  [/\b(lightly played|light play|lp|slightly played|sp)\b/i, 2],
  [/\b(moderately played|moderate play|mp)\b/i, 3],
  [/\b(heavily played|heavy play|hp)\b/i, 4],
  [/\b(damaged?|dmg)\b/i, 5],
];
const RAW_RANK: Record<string, number> = { 'NM / SP': 1, 'SP / LP': 2, MP: 3, HP: 4, D: 5, NM: 1, LP: 2, DMG: 5 };

function variantRank(v: ShopifyVariant): number | null {
  const sku = v.sku?.match(/-(?:NF|FO)-([1-5])$/i);
  if (sku) return Number(sku[1]);
  for (const [re, r] of RANK_WORDS) if (re.test(v.title)) return r;
  return null;
}

function variantFoil(v: ShopifyVariant): boolean {
  if (v.sku && /-FO-\d$/i.test(v.sku)) return true;
  if (v.sku && /-NF-\d$/i.test(v.sku)) return false;
  return /\bfoil\b/i.test(v.title) && !/non-?foil/i.test(v.title);
}

/** Picks the variant matching a Listing's condition and finish, falling back to the one with the same price. */
export function pickVariant(l: Listing, variants: ShopifyVariant[], variantId?: string | null): ShopifyVariant | null {
  if (variantId) return variants.find(v => String(v.id) === variantId) ?? null;
  if (variants.length === 1) return variants[0];
  const cents = Math.round(l.price * 100);
  const rank = RAW_RANK[l.extra?.rawCondition ?? ''] ?? (l.condition ? RAW_RANK[l.condition] : undefined);
  const foil = l.finish !== 'nonfoil';
  const matching = variants.filter(v => (rank === undefined || variantRank(v) === rank) && variantFoil(v) === foil);
  return (
    matching.find(v => v.price === cents && v.available) ??
    // MtgSingles' foil flag is unreliable, so a same-priced available variant is the next best evidence.
    variants.find(v => v.price === cents && v.available) ??
    matching.find(v => v.available) ??
    matching[0] ??
    null
  );
}

export type ProductFetcher = (url: string) => Promise<{ status: number; redirectedTo?: string; body?: any }>;

const fetchProduct: ProductFetcher = async url => {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, redirect: 'follow' });
  const redirectedTo = res.redirected ? res.url : undefined;
  if (!res.ok) return { status: res.status, redirectedTo };
  try {
    return { status: res.status, redirectedTo, body: await res.json() };
  } catch {
    return { status: 0, redirectedTo };
  }
};

/** One pace per Store host for the whole server, so friends checking carts at the same Store share it. */
const storeThrottles = new Map<string, Throttle>();
export function storeThrottle(host: string): Throttle {
  let t = storeThrottles.get(host);
  if (!t) storeThrottles.set(host, (t = new Throttle(1000)));
  return t;
}

export async function checkShopifyCart(
  storeId: string,
  storeName: string,
  items: { listing: Listing; qty: number; name: string }[],
  get: ProductFetcher = fetchProduct,
  /** Defaults to the Store host's shared pace of one request a second. */
  throttle?: Throttle,
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<CartCheckResponse> {
  const lines: CartLineCheck[] = [];
  let host: string | null = null;
  for (const [index, { listing, qty, name }] of items.entries()) {
    onProgress?.(index, items.length, name);
    const base: CartLineCheck = { listingId: listing.id, name, qty, expectedPrice: listing.price, status: 'unconfirmed', url: listing.url };
    let u: URL;
    try {
      u = new URL(listing.url);
    } catch {
      lines.push(base);
      continue;
    }
    const handle = u.pathname.match(/\/products\/([^/?#]+)/)?.[1];
    if (!handle) {
      lines.push(base);
      continue;
    }
    host ??= u.host;
    await (throttle ?? storeThrottle(u.host)).wait();
    const r = await get(`https://${u.host}/products/${handle}.js`);
    if (r.redirectedTo && /\/password/.test(r.redirectedTo)) {
      return { storeId, storeName, cartUrl: null, lines: items.map(i => ({ ...base, listingId: i.listing.id, name: i.name, qty: i.qty, expectedPrice: i.listing.price, url: i.listing.url })), fallbackReason: `${storeName}'s shop is password-protected right now.` };
    }
    if (r.status === 402) {
      return { storeId, storeName, cartUrl: null, lines: [], fallbackReason: `${storeName}'s shop is paused right now.` };
    }
    const variants: ShopifyVariant[] | undefined = r.body?.variants;
    if (!variants?.length) {
      lines.push(base);
      continue;
    }
    const v = pickVariant(listing, variants, u.searchParams.get('variant'));
    if (!v) {
      lines.push(base);
      continue;
    }
    const current = v.price / 100;
    lines.push({
      ...base,
      variantId: String(v.id),
      currentPrice: current,
      status: !v.available ? 'unavailable' : Math.abs(current - listing.price) > 0.005 ? 'price-changed' : 'ok',
    });
  }
  const cartable = lines.filter(l => (l.status === 'ok' || l.status === 'price-changed') && l.variantId);
  const cartUrl = host && cartable.length ? `https://${host}/cart/${cartable.map(l => `${l.variantId}:${l.qty}`).join(',')}?storefront=true` : null;
  return { storeId, storeName, cartUrl, lines };
}
