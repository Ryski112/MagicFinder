import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalogue, Catalogue } from '../catalogue/catalogue';
import { mapFetchListing } from '../sources/fetchTcg';
import type { SourceListing } from '../sources/types';
import { matchListing, nameCandidates } from './matchListing';

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
