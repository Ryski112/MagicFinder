// Checks which Australian Stores ship to NZ and what they charge, and rewrites the Australian part of data/stores.yaml.
// Finds Stores by searching MtgSingles AU for a few staples, then tries each Store's checkout (src/server/auStores.ts).
// The weekly "Australian Store check" Action runs it with --write and commits the result. NZ entries are left alone.
//
//   npm run probe-au              report what changed
//   npm run probe-au -- --write   also rewrite the Australian Stores in data/stores.yaml
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { PostageOption, StoreRecord } from '../src/core/stores';
import { checkAuStores, discoverAuStores, probeAuStore } from '../src/server/auStores';
import { ExchangeRate } from '../src/server/exchangeRate';
import { MtgSinglesSource } from '../src/sources/mtgSingles';
import { Throttle } from '../src/sources/policy';

const STORES = 'data/stores.yaml';
const MARKER = '# ---- Australian Stores ----';
const write = process.argv.includes('--write');

const text = readFileSync(STORES, 'utf8');
const cut = text.indexOf(MARKER);
const nzText = (cut === -1 ? text : text.slice(0, cut)).trimEnd();
const known = (parse(text) as StoreRecord[]).filter(s => s.country === 'AU');

const rate = new ExchangeRate(mkdtempSync(join(tmpdir(), 'magicfinder-rate-')));
await rate.refreshIfStale();
const source = new MtgSinglesSource({ country: 'AU', audToNzd: () => rate.audToNzd });
const { stores: seen, error } = await discoverAuStores(source);
if (error) console.warn(`${error}. Checking the ${seen.size} Stores found so far and the ${known.length} already listed.`);
console.log(`Found ${seen.size} Australian Stores on MtgSingles AU (${known.length} already listed); AUD→NZD ${rate.audToNzd}.`);

const hosts = new Map<string, Throttle>();
const result = await checkAuStores(known, seen, {
  audToNzd: rate.audToNzd,
  today: new Date().toLocaleDateString('en-CA'),
  log: line => console.log(line),
  // Same pace as the app's cart checks: one request a second per Store.
  probe: s => probeAuStore(s, {
    wait: async host => {
      let t = hosts.get(host);
      if (!t) hosts.set(host, (t = new Throttle(1000)));
      await t.wait();
    },
  }),
});

console.log(result.changes.length ? `\nChanged:\n${result.changes.map(c => `- ${c}`).join('\n')}` : '\nNo changes.');
if (result.failed.length) console.log(`\nKept the last result for:\n${result.failed.map(c => `- ${c}`).join('\n')}`);

if (write) {
  const header = [
    MARKER,
    '# Written by `npm run probe-au` (weekly, by the "Australian Store check" Action). Edit by hand only to fix the script.',
    '# Ids are the ones MagicFinder gave these Stores before they were listed, so buyers\' exclusions still apply.',
    '# ships_to_nz: true | false | null (checkout couldn\'t tell). postage is checkout\'s cheapest rate to Auckland, in NZD',
    '# at that day\'s rate (the AUD price is in its name); without it the buyer\'s Australian postage guess applies.',
  ];
  writeFileSync(STORES, `${nzText}\n\n${header.join('\n')}\n\n${result.records.map(entry).join('\n\n')}\n`);
  console.log(`\nWrote ${result.records.length} Australian Stores to ${STORES}.`);
}

function entry(s: StoreRecord): string {
  const q = (v: string | null | undefined) => (v == null ? 'null' : JSON.stringify(v));
  const option = (o: PostageOption) => `    - { name: ${q(o.name)}, tracked: ${o.tracked}, price: ${Number(o.price).toFixed(2)}, rural_surcharge: 0 }`;
  return [
    `- id: ${q(s.id)}`,
    `  name: ${q(s.name)}`,
    `  source_keys: { mtgsingles: ${q(s.source_keys.mtgsingles)} }`,
    `  site: ${s.site}`,
    '  location: { city: null, region: null }',
    '  pickup: { available: false, fee: 0 }',
    ...(s.postage?.length ? ['  postage:', ...s.postage.map(option)] : []),
    `  cart: ${s.cart}`,
    '  country: AU',
    `  ships_to_nz: ${s.ships_to_nz ?? null}`,
    `  provenance: { url: ${s.provenance?.url}, checked_on: ${s.provenance?.checked_on}, confidence: ${s.provenance?.confidence} }`,
  ].join('\n');
}
