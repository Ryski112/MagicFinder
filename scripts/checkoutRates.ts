// Reads the delivery options a Shopify Store's checkout actually offers. A shipping policy page can disagree with
// checkout (Card Merchant Takapuna's says $5 standard post; checkout only offers an $8 courier bag), so this is the
// figure stores.yaml should hold. It puts one in-stock single in a throwaway cart and asks
// /cart/shipping_rates.json for an address in each region.
import type { PostageOption, Region, RegionValue } from '../src/core/stores';
import { USER_AGENT } from '../src/server/paths';

export interface CheckoutRate {
  name: string;
  price: number;
}

const ADDRESSES: Record<Region, { zip: string; province: string; city: string }> = {
  auckland: { zip: '1010', province: 'Auckland', city: 'Auckland' },
  north_island: { zip: '6011', province: 'Wellington', city: 'Wellington' },
  south_island: { zip: '8011', province: 'Canterbury', city: 'Christchurch' },
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** An in-stock variant to put in the cart: a cheap single, so the cart stays under any free-postage threshold. */
async function sampleVariant(site: string): Promise<number | null> {
  const res = await fetch(`${site}/products.json?limit=250`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return null;
  const { products } = (await res.json()) as { products: { product_type: string; tags: string[] | string; variants: { id: number; available: boolean; price: string }[] }[] };
  const available = products.flatMap(p => p.variants.filter(v => v.available).map(v => ({ id: v.id, price: Number(v.price), single: /single|mtg card/i.test(`${p.product_type} ${p.tags}`) })));
  const cheapest = (vs: typeof available) => vs.sort((a, b) => a.price - b.price)[0];
  const single = cheapest(available.filter(v => v.single));
  const pick = single && single.price < 20 ? single : cheapest(available);
  return pick?.id ?? null;
}

/** Checkout delivery options for each region, or null when the Store has nothing in stock or its cart isn't open. */
export async function checkoutRates(site: string): Promise<Record<Region, CheckoutRate[]> | null> {
  try {
    const variant = await sampleVariant(site);
    if (variant === null) return null;
    await sleep(1000);
    const add = await fetch(`${site}/cart/add.js`, {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `id=${variant}&quantity=1`,
    });
    if (!add.ok) return null;
    const cookie = add.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const out = {} as Record<Region, CheckoutRate[]>;
    for (const [region, a] of Object.entries(ADDRESSES) as [Region, (typeof ADDRESSES)[Region]][]) {
      await sleep(1000);
      const q = new URLSearchParams({ 'shipping_address[country]': 'New Zealand', 'shipping_address[zip]': a.zip, 'shipping_address[province]': a.province, 'shipping_address[city]': a.city });
      const res = await fetch(`${site}/cart/shipping_rates.json?${q}`, { headers: { 'User-Agent': USER_AGENT, Cookie: cookie } });
      if (!res.ok) return null;
      const { shipping_rates } = (await res.json()) as { shipping_rates: { name: string; price: string }[] };
      out[region] = shipping_rates.map(r => ({ name: r.name.replace(/\s+/g, ' ').trim(), price: Number(r.price) }));
    }
    return out;
  } catch {
    return null;
  }
}

/** Rates that are only for rural or PO Box addresses, which MagicFinder treats as a surcharge, not an option. */
export const isRuralRate = (r: CheckoutRate) => /\brural|non-urban|po box/i.test(r.name) && !/\b(no|non)[ -]rural/i.test(r.name) && !/\bno\b[^)]*rural/i.test(r.name);
/** Rates a buyer can't pick for delivery (pickup, click & collect). */
export const isPickupRate = (r: CheckoutRate) => /pick ?up|collect|in.store/i.test(r.name);

/** Rates that need a bigger parcel than a few singles. */
const isBulkRate = (r: CheckoutRate) => /non[ -]single|(?<!non )boxed|bundle|large/i.test(r.name);

/**
 * The stores.yaml postage entry these checkout rates add up to: the cheapest delivery option per region, and what a
 * rural address adds on top. Null when checkout offered nothing to deliver to.
 */
export function suggestPostage(rates: Record<Region, CheckoutRate[]>): PostageOption | null {
  const regions = Object.keys(rates) as Region[];
  const urban = (region: Region) => rates[region].filter(r => !isRuralRate(r) && !isPickupRate(r) && !isBulkRate(r)).sort((a, b) => a.price - b.price)[0];
  const rural = (region: Region) => rates[region].filter(r => isRuralRate(r) && !isBulkRate(r)).sort((a, b) => a.price - b.price)[0];
  if (regions.some(r => !urban(r))) return null;
  const collapse = (f: (r: Region) => number | undefined): RegionValue | undefined => {
    const vs = regions.map(f);
    if (vs.some(v => v === undefined)) return undefined;
    return vs.every(v => v === vs[0]) ? (vs[0] as number) : (Object.fromEntries(regions.map((r, i) => [r, vs[i]])) as RegionValue);
  };
  const name = urban('auckland')!.name;
  const surcharge = collapse(r => (rural(r) ? Math.round((rural(r)!.price - urban(r)!.price) * 100) / 100 : undefined));
  return {
    name,
    tracked: /track|courier|signature/i.test(name) ? true : null,
    price: collapse(r => urban(r)!.price)!,
    ...(surcharge !== undefined && { rural_surcharge: surcharge }),
  };
}
