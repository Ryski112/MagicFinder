import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalogue, Catalogue } from '../catalogue/catalogue';
import { mapFetchListing } from '../sources/fetchTcg';
import type { SourceListing } from '../sources/types';
import { imageIds } from '../sources/mtgSingles';
import { findCardForTitle, matchByImage, matchListing, nameCandidates } from './matchListing';

const dir = mkdtempSync(join(tmpdir(), 'mf-match-'));
let cat: Catalogue;
beforeAll(async () => {
  const cards = readFileSync('test/fixtures/scryfall-sample.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
  await buildCatalogue(join(dir, 'c.sqlite'), cards, 'test');
  cat = new Catalogue(join(dir, 'c.sqlite'));
});
afterAll(() => {
  cat.close();
  rmSync(dir, { recursive: true, force: true });
});

const listing = (over: Partial<SourceListing>): SourceListing => ({
  id: 'x:1', source: 'mtgsingles', storeKey: 'mtgsingles:NZ/Test', storeName: 'Test', title: '', finish: 'nonfoil',
  treatments: [], condition: 'NM', english: true, price: 1, quantity: 1, url: 'https://example.test', buyable: true, ...over,
});

describe('nameCandidates', () => {
  it('strips bracketed treatments and conditions, and tries each side of a dash', () => {
    expect(nameCandidates('Lightning Bolt (Showcase) (Foil) (SP)')).toEqual(['Lightning Bolt']);
    expect(nameCandidates('Wild Rose Rebellion - Counterspell (Showcase)')).toEqual(['Wild Rose Rebellion - Counterspell', 'Wild Rose Rebellion', 'Counterspell']);
    expect(nameCandidates('Delver of Secrets // Insectile Aberration [ISD]')[0]).toBe('Delver of Secrets // Insectile Aberration');
    expect(nameCandidates('Counterspell (Borderless) |  Foil (009)')).toEqual(['Counterspell']);
  });

  it('reads Arctic Collect titles: rarity and collector number after the name, sometimes with finish and set between', () => {
    expect(nameCandidates('Brainstorm C 96')).toContain('Brainstorm');
    expect(nameCandidates('Sol Ring Foil Buy-A-Box Promos P 1')).toContain('Sol Ring');
    expect(nameCandidates('Arcane Signet (Borderless) : Eternal-Legal M 95')).toContain('Arcane Signet');
    // Longest first, so a longer real name wins over a shorter one hidden inside it.
    const c = nameCandidates('Bonecrusher Giant Foil Throne of Eldraine R 115');
    expect(c.indexOf('Bonecrusher Giant')).toBeLessThan(c.indexOf('Bonecrusher'));
  });

  it('only shortens titles that end in a rarity and number, so other titles are never guessed at', () => {
    expect(nameCandidates('Sol Ring Foil Promo')).toEqual(['Sol Ring Foil Promo']);
    expect(nameCandidates('Very Cryptic Command')).toEqual(['Very Cryptic Command']);
  });
});

describe('findCardForTitle', () => {
  it('finds the card in Arctic Collect titles', () => {
    expect(findCardForTitle(cat, 'Sol Ring Foil Buy-A-Box Promos P 1')?.name).toBe('Sol Ring');
    expect(findCardForTitle(cat, 'Rhystic Study (Borderless) : Eternal-Legal M 95')?.name).toBe('Rhystic Study');
    expect(findCardForTitle(cat, 'Counterspell C 96')?.name).toBe('Counterspell');
    expect(findCardForTitle(cat, 'Sol Ring Foil Promo')).toBeNull();
  });
});

describe('matchListing', () => {
  it('matches Fetch Listings exactly through their Scryfall id', () => {
    const raw = JSON.parse(readFileSync('test/fixtures/fetch-counterspell.json', 'utf8')).searchResults.content;
    const counter = cat.findCard('Counterspell')!.oracleId;
    const matched = raw.map((r: any) => matchListing(cat, mapFetchListing(r)!));
    const exact = matched.filter((m: any) => m.confidence === 'exact');
    expect(exact.length).toBeGreaterThan(matched.length * 0.8);
    expect(exact.every((m: any) => m.oracleId === counter)).toBe(true);
  });

  it('matches a title to the card, and to the Printing when set and number are given', () => {
    const m = matchListing(cat, listing({ title: 'Sol Ring', setCode: 'C21', collectorNumber: '263' }));
    expect(m).toMatchObject({ confidence: 'exact' });
    expect(cat.getPrinting(m.printingId!)?.setCode).toBe('c21');
  });

  it('stays card-only when the Printing is uncertain', () => {
    const m = matchListing(cat, listing({ title: 'Sol Ring (Foil)' }));
    expect(m.confidence).toBe('card-only');
    expect(m.oracleId).toBe(cat.findCard('Sol Ring')!.oracleId);
    expect(m.printingId).toBeUndefined();
  });

  it('matches Secret Lair renamed titles by the real card name', () => {
    expect(matchListing(cat, listing({ title: 'Wild Rose Rebellion - Counterspell (Showcase)' })).oracleId).toBe(cat.findCard('Counterspell')!.oracleId);
  });

  it('leaves unknown titles unmatched', () => {
    expect(matchListing(cat, listing({ title: 'Totally Not A Card' })).confidence).toBe('unmatched');
  });
});


describe('printings from Store pictures', () => {
  it('reads a Scryfall id, or a platform card id, out of a picture address', () => {
    expect(imageIds('https://cards.scryfall.io/normal/front/c/b/cba33bf7-0919-408c-8eb0-0bb9fe920c81.jpg?1')).toEqual({ scryfallId: 'cba33bf7-0919-408c-8eb0-0bb9fe920c81' });
    const uuid = '71b54704-2a9f-5111-a1d4-d8843dfa90b1';
    expect(imageIds(`https://cdn.shopify.com/s/files/1/0558/files/${uuid}_370x480.png`)).toEqual({ scryfallId: uuid, imageKey: uuid });
    expect(imageIds('https://cdn.shopify.com/s/files/1/0400/files/532935_370x480.jpg')).toEqual({ imageKey: '532935' });
    expect(imageIds('https://cdn.shopify.com/s/files/1/1629/products/07fec4a2db5aca3da38dcd1404ef596c_370x480.png')).toEqual({});
    expect(imageIds(undefined)).toEqual({});
  });

  it('takes a title with no treatment as the plain printing when the set has variants', () => {
    const plain = matchListing(cat, listing({ title: 'Bonecrusher Giant', setName: 'Throne of Eldraine' }));
    expect(plain).toMatchObject({ confidence: 'exact' });
    expect(cat.getPrinting(plain.printingId!)).toMatchObject({ setCode: 'eld', collectorNumber: '115' });
    const showcase = matchListing(cat, listing({ title: 'Bonecrusher Giant (Showcase)', setName: 'Throne of Eldraine', treatments: ['Showcase'] }));
    expect(cat.getPrinting(showcase.printingId!)).toMatchObject({ collectorNumber: '291' });
  });

  it('settles a Listing by the picture it shares with an identified one, if the Printing fits its title', () => {
    const a = listing({ id: 'a', title: 'Sol Ring', setCode: 'msc', collectorNumber: '212', imageKey: '236019' });
    const b = listing({ id: 'b', title: 'Sol Ring', setCode: 'msc', imageKey: '236019' });
    const c = listing({ id: 'c', title: 'Sol Ring', setCode: 'msc', imageKey: '999999' });
    const pairs = [a, b, c].map(source => ({ source, listing: matchListing(cat, source) }));
    expect(pairs.map(p => p.listing.confidence)).toEqual(['exact', 'card-only', 'card-only']);
    matchByImage(cat, pairs);
    expect(pairs.map(p => p.listing.confidence)).toEqual(['exact', 'exact', 'card-only']);
    expect(pairs[1].listing.printingId).toBe(pairs[0].listing.printingId);
  });

  it("doesn't trust a picture seen on two different Printings", () => {
    const a = listing({ id: 'a', title: 'Sol Ring', setCode: 'msc', collectorNumber: '212', imageKey: 'k' });
    const a2 = listing({ id: 'a2', title: 'Sol Ring', setCode: 'msc', collectorNumber: '213', imageKey: 'k' });
    const b = listing({ id: 'b', title: 'Sol Ring', setCode: 'msc', imageKey: 'k' });
    const pairs = [a, a2, b].map(source => ({ source, listing: matchListing(cat, source) }));
    matchByImage(cat, pairs);
    expect(pairs[2].listing.confidence).toBe('card-only');
  });
});
