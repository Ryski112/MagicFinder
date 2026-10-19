// Monthly Store-table check: fetches each Store's shipping policy page, Shopify /meta.json and the postage its Shopify
// checkout offers, and reports the Stores whose text or checkout postage changed since last time, so a person can update
// data/stores.yaml. It never edits stores.yaml itself.
//
//   npm run check-stores              report changes
//   npm run check-stores -- --write   also save the new fingerprints to data/store-check.json
//   npm run check-stores -- --issue   also open a GitHub issue listing the changes (needs the gh CLI)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';
import type { StoreRecord } from '../src/core/stores';
import { USER_AGENT } from '../src/server/paths';
import { checkoutRates, suggestPostage } from './checkoutRates';

const HASHES = 'data/store-check.json';
const write = process.argv.includes('--write');
const issue = process.argv.includes('--issue');

const stores: StoreRecord[] = parse(readFileSync('data/stores.yaml', 'utf8'));
const old: Record<string, { policy: string | null; meta: string | null; checkout?: string | null; checked: string }> = existsSync(HASHES) ? JSON.parse(readFileSync(HASHES, 'utf8')) : {};
const next: typeof old = {};
const changes: string[] = [];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function get(url: string): Promise<{ status: number; body: string; url: string } | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
    return { status: res.status, body: await res.text(), url: res.url };
  } catch {
    return null;
  }
}

for (const s of stores) {
  if (!s.site) continue;
  const policyUrl = s.provenance?.url && !s.provenance.url.endsWith('meta.json') ? s.provenance.url : `${s.site}/policies/shipping-policy`;
  const policy = await get(policyUrl);
  await sleep(1000);
  const meta = s.cart === 'shopify' ? await get(`${s.site}/meta.json`) : null;
  await sleep(1000);

  const policyHash = policy && policy.status === 200 ? hash(text(policy.body)) : null;
  let metaHash: string | null = null;
  let city: string | null = null;
  if (meta?.status === 200) {
    try {
      const m = JSON.parse(meta.body);
      city = m.city ?? null;
      metaHash = hash(JSON.stringify([m.city, m.province, m.country, m.myshopify_domain]));
    } catch {
      // Not JSON: e.g. a password page.
    }
  }
  const rates = s.cart === 'shopify' ? await checkoutRates(s.site) : null;
  const postage = rates && suggestPostage(rates);
  const checkoutHash = postage ? hash(JSON.stringify([postage.price, postage.rural_surcharge ?? null])) : null;
  next[s.id] = { policy: policyHash, meta: metaHash, checkout: checkoutHash, checked: new Date().toISOString().slice(0, 10) };

  const notes: string[] = [];
  if (policy?.url.includes('/password') || meta?.url.includes('/password')) notes.push('shop is password-protected');
  if (policy?.status === 402 || meta?.status === 402) notes.push('shop is paused');
  if (!policy) notes.push("site didn't answer");
  const before = old[s.id];
  if (before) {
    if (before.policy !== policyHash) notes.push(`shipping policy changed (${policyUrl})`);
    if (before.meta !== metaHash) notes.push(`location changed${city ? ` (now ${city})` : ''}`);
    if (before.checkout !== undefined && before.checkout !== checkoutHash) notes.push('checkout postage changed (run `npm run probe-postage -- ' + s.id + '`)');
  }
  if (notes.length) changes.push(`- **${s.name}** (\`${s.id}\`): ${notes.join('; ')}`);
  console.log(`${s.name}: ${notes.length ? notes.join('; ') : 'no change'}`);
}

if (write) writeFileSync(HASHES, JSON.stringify(next, null, 2) + '\n');

if (changes.length) {
  const body = [
    'The monthly Store-table check found changes. Review each Store\'s page and update `data/stores.yaml` (postage, free-postage threshold, pickup, location, provenance).',
    '',
    ...changes,
  ].join('\n');
  console.log(`\n${body}`);
  if (issue) execFileSync('gh', ['issue', 'create', '--title', `Store table check ${new Date().toISOString().slice(0, 7)}`, '--body', body], { stdio: 'inherit' });
} else {
  console.log('\nNo Store changes.');
}
