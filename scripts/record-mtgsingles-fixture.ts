// Records raw MtgSingles answers for a card as a test fixture. Rarely needed; makes a few polite requests.
// Usage: npx tsx scripts/record-mtgsingles-fixture.ts "Counterspell"
import { writeFileSync } from 'node:fs';
import { openBrowserPage } from '../src/sources/browser';

const name = process.argv[2] ?? 'Counterspell';
const page = await openBrowserPage('https://mtgsingles.co.nz/');
const rows: unknown[] = [];
for (let p = 1; p <= 5; p++) {
  const url = `https://api.mtgsingles.co.nz/MtgSingle?query=${encodeURIComponent(name)}&tcgType=1&includeMarketplaces=false&sortOrder=2&page=${p}&pageSize=20&Country=1`;
  const a = await page.fetchFromPage(url);
  const batch = JSON.parse(a.body);
  rows.push(...batch);
  if (batch.length < 20) break;
  await new Promise(r => setTimeout(r, 1200));
}
await page.close();
const file = `test/fixtures/mtgsingles-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
writeFileSync(file, JSON.stringify(rows, null, 1) + '\n');
console.log(`${rows.length} Listings -> ${file}`);
