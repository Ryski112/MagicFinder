// Replaces seller identities and exact locations in a recorded Fetch TCG response with stable fakes,
// so fixtures can be committed. Usage: npx tsx scripts/scrub-fetch-fixture.ts <file.json>
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const body = JSON.parse(readFileSync(file, 'utf8'));
const ids = new Map<string, number>();
for (const l of body.searchResults.content) {
  if (!ids.has(l.listedByUserId)) ids.set(l.listedByUserId, ids.size + 1);
  const n = ids.get(l.listedByUserId)!;
  l.listedByUserId = `seller-${n}`;
  l.sellerProfileName = `Seller${n}`;
  if (l.sellerBusinessName) l.sellerBusinessName = `Test Store ${n}`;
  l.sellerProfileImageUrl = null;
  l.details = '';
  if (l.regionAddress) {
    l.regionAddress.suburb = null;
    l.regionAddress.latitude = null;
    l.regionAddress.longitude = null;
  }
}
writeFileSync(file, JSON.stringify(body, null, 1) + '\n');
console.log(`scrubbed ${ids.size} sellers`);
