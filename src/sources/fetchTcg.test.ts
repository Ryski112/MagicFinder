import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FetchTcgSource, mapFetchListing } from './fetchTcg';
import { SourceError } from './types';
import type { HttpAnswer } from './policy';

const fixture = readFileSync('test/fixtures/fetch-counterspell.json', 'utf8');
const answer = (a: Partial<HttpAnswer>): HttpAnswer => ({ status: 200, body: fixture, contentType: 'application/json', ...a });

describe('mapFetchListing', () => {
  const raw = JSON.parse(fixture).searchResults.content;

  it('maps every recorded Listing', () => {
    const mapped = raw.map(mapFetchListing).filter(Boolean);
    expect(mapped.length).toBe(raw.length);
    for (const l of mapped) {
      expect(l.storeKey).toMatch(/^fetch:seller-\d+$/);
      expect(l.url).toMatch(/^https:\/\/www\.fetchtcg\.com\/marketplace\/listings\/\d+$/);
      expect(l.price).toBeGreaterThan(0);
      expect(l.scryfallId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('reads condition, finish, language, buyability and treatments', () => {
    const mapped = raw.map(mapFetchListing);
    expect(new Set(mapped.map((l: any) => l.condition))).toEqual(new Set(['NM', 'LP', 'MP', 'HP']));
    expect(mapped.some((l: any) => l.finish === 'foil')).toBe(true);
    expect(mapped.find((l: any) => l.title.includes('Japanese'))?.english).toBe(false);
    expect(mapped.find((l: any) => l.title === 'Counterspell')?.english).toBe(true);
    const individual = raw.find((l: any) => l.buyNowEnabled === false);
    expect(mapFetchListing(individual)?.buyable).toBe(true);
    expect(mapFetchListing({ ...individual, sellerOnHoliday: true })?.buyable).toBe(false);
    expect(mapped.find((l: any) => l.title.startsWith('Counterspell (Retro)'))?.treatments).toContain('Retro frame');
  });

  it('reports a changed Source when fields are missing', () => {
    expect(() => mapFetchListing({ id: 1 })).toThrow(SourceError);
    expect(() => mapFetchListing({ ...raw[0], listedPrice: undefined, listedPriceInRequestedCurrency: undefined })).toThrow(/price/);
  });

  it('skips non-NZ and inactive Listings', () => {
    expect(mapFetchListing({ ...raw[0], listedCountry: 'AU' })).toBeNull();
    expect(mapFetchListing({ ...raw[0], status: 'SOLD' })).toBeNull();
  });
});

describe('FetchTcgSource.search', () => {
  it('returns Listings from a normal answer', async () => {
    const src = new FetchTcgSource(async () => answer({}));
    expect((await src.search('Counterspell')).length).toBe(66);
  });

  it('stops immediately on a block, without retrying', async () => {
    let calls = 0;
    const src = new FetchTcgSource(async () => {
      calls++;
      return answer({ status: 403, body: '<html>Sorry, you have been blocked</html>', contentType: 'text/html' });
    });
    await expect(src.search('Counterspell')).rejects.toMatchObject({ status: 'blocked' });
    expect(calls).toBe(1);
  });

  it('treats a Cloudflare challenge page as blocked even with status 200', async () => {
    const src = new FetchTcgSource(async () => answer({ body: '<html><title>Just a moment...</title></html>', contentType: 'text/html' }));
    await expect(src.search('Counterspell')).rejects.toMatchObject({ status: 'blocked' });
  });

  it('reports a changed Source when the answer has the wrong shape', async () => {
    const src = new FetchTcgSource(async () => answer({ body: '{"results": []}' }));
    await expect(src.search('Counterspell')).rejects.toMatchObject({ status: 'changed' });
  });
});
