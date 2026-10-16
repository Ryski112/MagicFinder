import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalogue, Catalogue } from '../catalogue/catalogue';
import { buyLines, resolveWantList, type ListChoices } from './wantList';
import { isEligible } from './eligibility';
import type { Listing } from './types';

const dir = mkdtempSync(join(tmpdir(), 'mf-want-'));
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

const choices = (over: Partial<ListChoices> = {}): ListChoices => ({ included: {}, locks: {}, includeBasics: false, useListPrintings: false, ...over });

const LIST = `Commander
1x Sol Ring (c21) 263 [Ramp]
Mainboard
2x Counterspell
2 Counterspell (mh2) 267
10 Island
1 Not A Real Card
Maybeboard
1 Rhystic Study`;

describe('resolveWantList', () => {
  it('identifies cards, keeps hints, and reports unknown lines', () => {
    const r = resolveWantList(LIST, cat);
    expect(r.unrecognised).toEqual(['1 Not A Real Card']);
    const sol = r.lines.find(l => l.name === 'Sol Ring')!;
    expect(sol.section).toBe('commander');
    expect(sol.hint?.text).toBe('C21 #263');
    expect(cat.getPrinting(sol.hint!.lock!.printingId)?.setCode).toBe('c21');
    expect(r.lines.find(l => l.name === 'Island')?.isBasic).toBe(true);
    expect(r.lines.find(l => l.name === 'Rhystic Study')?.includedByDefault).toBe(false);
  });
});

describe('buyLines', () => {
  it('skips basics and the maybeboard by default and merges unlocked duplicates', () => {
    const r = resolveWantList(LIST, cat);
    const b = buyLines(r.lines, choices());
    expect(b.map(l => [l.name, l.quantity])).toEqual([['Sol Ring', 1], ['Counterspell', 4]]);
  });

  it('keeps lines apart when they are locked to different Printings', () => {
    const r = resolveWantList(LIST, cat);
    const b = buyLines(r.lines, choices({ useListPrintings: true }));
    expect(b.filter(l => l.name === 'Counterspell').map(l => l.quantity).sort()).toEqual([2, 2]);
    expect(b.find(l => l.name === 'Sol Ring')?.lock).not.toBeNull();
  });

  it('honours the include toggles and basic-land setting', () => {
    const r = resolveWantList(LIST, cat);
    const rhystic = r.lines.find(l => l.name === 'Rhystic Study')!;
    const b = buyLines(r.lines, choices({ includeBasics: true, included: { [rhystic.id]: true } }));
    expect(b.map(l => l.name)).toEqual(expect.arrayContaining(['Island', 'Rhystic Study']));
  });
});

describe('isEligible', () => {
  const r = () => resolveWantList('1 Counterspell', cat);
  const counter = () => buyLines(r().lines, choices())[0];
  const printings = () => cat.printingsOf(counter().oracleId);
  const listing = (over: Partial<Listing>): Listing => ({
    id: 'l', source: 'fetch', storeKey: 'fetch:s', storeName: 's', oracleId: counter().oracleId, finish: 'nonfoil', confidence: 'card-only',
    condition: 'NM', price: 1, quantity: 1, url: '', title: '', english: true, buyable: true, ...over,
  });
  const settings = { minCondition: 'LP' as const, allowFoils: true };

  it('applies condition, language and buyability filters', () => {
    expect(isEligible(listing({}), counter(), cat, settings)).toBe(true);
    expect(isEligible(listing({ condition: 'MP' }), counter(), cat, settings)).toBe(false);
    expect(isEligible(listing({ condition: null }), counter(), cat, settings)).toBe(true);
    expect(isEligible(listing({ english: false }), counter(), cat, settings)).toBe(false);
    expect(isEligible(listing({ buyable: false }), counter(), cat, settings)).toBe(false);
  });

  it('drops foils from unlocked lines when foils are not allowed', () => {
    expect(isEligible(listing({ finish: 'foil' }), counter(), cat, { ...settings, allowFoils: false })).toBe(false);
  });

  it('excludes non-tournament Printings from unlocked lines', () => {
    const gold = printings().find(p => p.nonTournament)!;
    expect(isEligible(listing({ confidence: 'exact', printingId: gold.id }), counter(), cat, settings)).toBe(false);
  });

  it('fills a locked line only with exact matches of that Printing and finish', () => {
    const p = printings().find(x => !x.nonTournament && x.finishes.includes('nonfoil'))!;
    const line = { ...counter(), lock: { printingId: p.id, finish: 'nonfoil' as const } };
    expect(isEligible(listing({ confidence: 'exact', printingId: p.id }), line, cat, settings)).toBe(true);
    expect(isEligible(listing({ confidence: 'exact', printingId: p.id, finish: 'foil' }), line, cat, settings)).toBe(false);
    expect(isEligible(listing({ confidence: 'card-only' }), line, cat, settings)).toBe(false);
  });
});
