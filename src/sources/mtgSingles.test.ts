import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { httpGet, mapMtgSinglesListing, MtgSinglesSource, parsePrice, storeNameFromKey } from './mtgSingles';
import { SourceError } from './types';

const rows: any[] = JSON.parse(readFileSync('test/fixtures/mtgsingles-counterspell.json', 'utf8'));

describe('mapMtgSinglesListing', () => {
  const mapped = rows.map(r => mapMtgSinglesListing(r)!);

  it('maps every recorded Listing with a clean Store link', () => {
    expect(mapped).toHaveLength(rows.length);
    for (const l of mapped) {
      expect(l.storeKey).toMatch(/^mtgsingles:NZ\//);
      expect(l.url).not.toMatch(/utm_/);
      expect(l.price).toBeGreaterThan(0);
    }
    expect(new Set(mapped.map(l => l.id)).size).toBe(mapped.length);
  });

  it('counts "NM / SP" as NM and other combined grades by their worse half', () => {
    const byRaw = (c: string) => mapped.find(l => l.extra?.rawCondition === c)?.condition;
    expect(byRaw('NM / SP')).toBe('NM');
    expect(byRaw('SP / LP')).toBe('LP');
    expect(byRaw('MP')).toBe('MP');
    expect(byRaw('N/A')).toBeNull();
  });

  it('reads finish, language and Scryfall ids from features and image links', () => {
    expect(mapped.some(l => l.finish === 'foil')).toBe(true);
    expect(mapped.some(l => l.finish === 'etched')).toBe(true);
    expect(mapped.filter(l => !l.english)).toHaveLength(3);
    expect(mapped.filter(l => l.scryfallId).length).toBeGreaterThan(0);
  });

  it('reports a changed Source when fields are missing', () => {
    expect(() => mapMtgSinglesListing({ store: 'NZ/X' })).toThrow(SourceError);
    expect(() => mapMtgSinglesListing({ ...rows[0], price: 'free' })).toThrow(/price/);
  });

  it('skips Australian and out-of-stock Listings', () => {
    expect(mapMtgSinglesListing({ ...rows[0], store: 'AU/Somewhere' })).toBeNull();
    expect(mapMtgSinglesListing({ ...rows[0], availableQty: 0 })).toBeNull();
  });
});

describe('helpers', () => {
  it('parses price strings', () => {
    expect(parsePrice('$1,345.99')).toBe(1345.99);
    expect(parsePrice('$2.30')).toBe(2.3);
    expect(parsePrice('')).toBeNull();
  });
  it('names unknown Stores from their key', () => {
    expect(storeNameFromKey('NZ/CardMerchantHamilton')).toBe('Card Merchant Hamilton');
    expect(storeNameFromKey('NZ/TcgCollectorNZ')).toBe('Tcg Collector NZ');
  });
});

describe('MtgSinglesSource.search', () => {
  const pages = [rows.slice(0, 20), rows.slice(20, 40), rows.slice(40)];

  it('pages until a short page and returns every Listing', async () => {
    let n = 0;
    const src = new MtgSinglesSource({ get: async () => ({ status: 200, body: JSON.stringify(pages[n++]), contentType: 'application/json' }) });
    expect(await src.search('Counterspell')).toHaveLength(rows.length);
    expect(n).toBe(3);
  });

  it('keeps the cheapest pages when a later page has a server error', async () => {
    let n = 0;
    const src = new MtgSinglesSource({ get: async () => (n++ === 0
      ? { status: 200, body: JSON.stringify(pages[0]), contentType: 'application/json' }
      : { status: 504, body: 'Gateway Timeout', contentType: 'text/html' }) });
    expect(await src.search('Counterspell')).toHaveLength(20);
  }, 30_000);

  it('reads an empty "204 No Content" answer as no Listings', async () => {
    const src = new MtgSinglesSource({ get: async () => ({ status: 204, body: '', contentType: null }) });
    expect(await src.search('Black Waltz No 3')).toEqual([]);
  });

  it('skips a malformed Listing instead of giving up on the Source', async () => {
    const page = [...rows.slice(0, 5), { store: 'NZ/Odd', title: 'Broken' }];
    const src = new MtgSinglesSource({ get: async () => ({ status: 200, body: JSON.stringify(page), contentType: 'application/json' }) });
    expect(await src.search('Counterspell')).toHaveLength(5);
  });

  it('is Blocked by a bot check page, without retrying', async () => {
    let n = 0;
    const src = new MtgSinglesSource({ get: async () => { n++; return { status: 403, body: 'Sorry, you have been blocked', contentType: 'text/html' }; } });
    await expect(src.search('Counterspell')).rejects.toMatchObject({ status: 'blocked' });
    expect(n).toBe(1);
  });
});

describe('httpGet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the mtgsingles.co.nz Referer the API needs, under our own User-Agent', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await httpGet('https://api.mtgsingles.co.nz/MtgSingle?query=x')).toMatchObject({ status: 200, body: '[]' });
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers.Referer).toBe('https://www.mtgsingles.co.nz/');
    expect(headers['User-Agent']).toMatch(/^MagicFinder\//);
  });
});
