// Builds test/fixtures/scryfall-sample.jsonl from a handful of live Scryfall searches.
// Run rarely: `npx tsx scripts/make-scryfall-fixture.ts`. Respects Scryfall's 2 req/s limit.
import { writeFileSync } from 'node:fs';

const queries = [
  '!"Sol Ring" game:paper',
  '!"Counterspell" game:paper',
  '!"Fire // Ice"',
  '!"Bonecrusher Giant"',
  '!"Delver of Secrets"',
  '!"Bind"',
  '!"Bind // Liberate"',
  '!"Lava Axe"',
  '!"Lava, Axe"',
  '!"Island" set:dmu',
  '!"Snow-Covered Island" set:khm',
  '!"Rhystic Study"',
  '!"Command Tower" set:sld',
];
const headers = { 'User-Agent': 'MagicFinder/0.1 (fixture builder)', Accept: 'application/json' };
const out: string[] = [];
for (const q of queries) {
  let url: string | null = `https://api.scryfall.com/cards/search?unique=prints&include_extras=true&q=${encodeURIComponent(q)}`;
  while (url) {
    const res = await fetch(url, { headers });
    const body: any = await res.json();
    if (body.object === 'error') { console.error(q, body.details); break; }
    for (const c of body.data) out.push(JSON.stringify(c));
    url = body.has_more ? body.next_page : null;
    await new Promise(r => setTimeout(r, 600));
  }
}
writeFileSync('test/fixtures/scryfall-sample.jsonl', out.join('\n') + '\n');
console.log(`wrote ${out.length} cards`);
