// Compares each Shopify Store's postage in data/stores.yaml with what its checkout actually offers, and prints the
// Stores that disagree, with the postage entry checkout adds up to.
//
//   npm run probe-postage                                  every Shopify Store
//   npm run probe-postage -- card-merchant-takapuna playx  just these
//   npm run probe-postage -- --write                       also put checkout's figures into stores.yaml
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import { storeCost, type BuyerContext, type PostageOption, type Region, type RegionValue, type StoreRecord } from '../src/core/stores';
import { checkoutRates, suggestPostage } from './checkoutRates';

const STORES = 'data/stores.yaml';
const write = process.argv.includes('--write');
const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
let yaml = readFileSync(STORES, 'utf8');
const stores: StoreRecord[] = parse(yaml);
const CITY: Record<Region, string> = { auckland: 'Auckland', north_island: 'Wellington', south_island: 'Christchurch' };
const buyer = (region: Region, ruralAddress = false): BuyerContext => ({ postageType: 'standard', pickupCity: CITY[region], ruralAddress, pickupStores: new Set(), preferredStores: new Set(), postageOverrides: {}, defaultPostage: { tracked: 7, rural: 5 }, australiaPostage: 20 });
const today = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD

const money = (v: RegionValue) => (typeof v === 'number' ? v.toFixed(2) : `{ ${Object.entries(v).map(([r, n]) => `${r}: ${n.toFixed(2)}`).join(', ')} }`);
const optionYaml = (o: PostageOption) =>
  `    - { name: ${JSON.stringify(o.name)}, tracked: ${o.tracked}, price: ${money(o.price)}${o.rural_surcharge !== undefined ? `, rural_surcharge: ${money(o.rural_surcharge)}` : ''} }`;

/** Replaces a Store's postage block and provenance in the stores.yaml text, keeping everything else as written. */
function rewrite(text: string, s: StoreRecord, option: PostageOption): string {
  const lines = text.split('\n');
  const start = lines.indexOf(`- id: ${s.id}`);
  let end = lines.findIndex((l, i) => i > start && l.trim() === '');
  if (end === -1) end = lines.length;
  const block = lines.slice(start, end);
  const p = block.findIndex(l => l.startsWith('  postage:'));
  if (p !== -1) {
    let q = p + 1;
    while (block[q]?.startsWith('    - ')) q++;
    block.splice(p, q - p);
  }
  const at = block.findIndex(l => l.startsWith('  free_postage:') || l.startsWith('  cart:'));
  block.splice(at, 0, '  postage:', optionYaml(option));
  const policyUrl = s.provenance?.url && !s.provenance.url.endsWith('meta.json') ? s.provenance.url : `${s.site}/policies/shipping-policy`;
  const prov = block.findIndex(l => l.startsWith('  provenance:'));
  block[prov] = `  provenance: { url: ${policyUrl}, checked_on: ${today}, confidence: checkout }`;
  lines.splice(start, end - start, ...block);
  return lines.join('\n');
}

for (const s of stores) {
  if (s.cart !== 'shopify' || !s.site || (only.length && !only.includes(s.id))) continue;
  const rates = await checkoutRates(s.site);
  if (!rates) {
    console.log(`${s.id}: couldn't read checkout rates`);
    continue;
  }
  const option = suggestPostage(rates);
  if (!option) {
    console.log(`${s.id}: checkout offered no delivery option`);
    continue;
  }
  const suggested: StoreRecord = { ...s, postage: [option] };
  const differs = (Object.keys(CITY) as Region[]).some(r => [false, true].some(rural => {
    const ours = storeCost(s, buyer(r, rural));
    return ours.estimated || Math.abs(ours.postage - storeCost(suggested, buyer(r, rural)).postage) > 0.005;
  }));
  console.log(`${s.id}: ${differs ? 'DIFFERS' : 'ok'}`);
  for (const r of Object.keys(CITY) as Region[]) console.log(`  ${r}: ${rates[r].map(x => `${x.name} $${x.price.toFixed(2)}`).join(', ')}`);
  if (!differs) continue;
  console.log(`  stores.yaml has: ${(s.postage ?? []).map(optionYaml).join(' ').trim() || '(default)'}\n  checkout says:  ${optionYaml(option).trim()}`);
  if (write) yaml = rewrite(yaml, s, option);
}

if (write) writeFileSync(STORES, yaml);
