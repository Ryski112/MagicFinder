import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalogue, Catalogue } from './catalogue';

const dir = mkdtempSync(join(tmpdir(), 'mf-cat-'));
let cat: Catalogue;

beforeAll(async () => {
  const cards = readFileSync('test/fixtures/scryfall-sample.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const dbPath = join(dir, 'catalogue.sqlite');
  await buildCatalogue(dbPath, cards, '2026-10-16');
  cat = new Catalogue(dbPath);
});
afterAll(() => {
  cat.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('Catalogue.findCard', () => {
  it('finds cards regardless of case and punctuation', () => {
    expect(cat.findCard('sol ring')?.name).toBe('Sol Ring');
    expect(cat.findCard('RHYSTIC STUDY')?.name).toBe('Rhystic Study');
  });

  it('accepts every spelling of split and double-faced cards', () => {
    const fireIce = cat.findCard('Fire // Ice')!.oracleId;
    for (const n of ['Fire / Ice', 'Fire/Ice', 'fire//ice']) expect(cat.findCard(n)?.oracleId).toBe(fireIce);
    expect(cat.findCard('Bonecrusher Giant')?.name).toBe('Bonecrusher Giant // Stomp');
    expect(cat.findCard('Delver of Secrets')?.name).toBe('Delver of Secrets // Insectile Aberration');
  });

  it('keeps colliding names apart instead of guessing', () => {
    expect(cat.findCard('Bind')?.name).toBe('Bind');
    expect(cat.findCard('Bind // Liberate')?.name).toBe('Bind // Liberate');
    expect(cat.findCard('Lava Axe')?.name).toBe('Lava Axe');
    expect(cat.findCard('Lava, Axe')?.name).toBe('Lava, Axe');
  });

  it('returns null for unknown names', () => {
    expect(cat.findCard("Jace's Erasur")).toBeNull();
  });

  it('flags basic lands', () => {
    expect(cat.findCard('Island')?.isBasic).toBe(true);
    expect(cat.findCard('Snow-Covered Island')?.isBasic).toBe(true);
    expect(cat.findCard('Sol Ring')?.isBasic).toBe(false);
  });

  it('maps reversible cards to the face card', () => {
    const tower = cat.findCard('Command Tower')!;
    expect(cat.printingsOf(tower.oracleId).length).toBeGreaterThan(1);
  });
});

describe('Catalogue printings', () => {
  it('keeps English paper printings only', () => {
    const sol = cat.findCard('Sol Ring')!;
    const ps = cat.printingsOf(sol.oracleId);
    expect(ps.length).toBeGreaterThan(100);
    expect(ps.every(p => p.oracleId === sol.oracleId)).toBe(true);
  });

  it('marks gold-bordered printings as non-tournament', () => {
    const counter = cat.findCard('Counterspell')!;
    const gold = cat.printingsOf(counter.oracleId).filter(p => p.nonTournament);
    expect(gold.length).toBeGreaterThan(0);
    expect(gold.some(p => p.nonTournament === 'gold-bordered' || p.nonTournament === 'memorabilia')).toBe(true);
  });

  it('narrows to one Printing with set and collector number, and never guesses without them', () => {
    const sol = cat.findCard('Sol Ring')!;
    const exact = cat.findPrinting(sol.oracleId, { setCode: 'C21', collectorNumber: '263' });
    expect(exact.printing?.setCode).toBe('c21');
    const vague = cat.findPrinting(sol.oracleId, {});
    expect(vague.printing).toBeNull();
    expect(vague.candidates.length).toBeGreaterThan(1);
  });

  it('resolves set names as well as codes', () => {
    expect(cat.setCode('Commander 2021')).toBe('c21');
    expect(cat.setCode('C21')).toBe('c21');
  });

  it('falls back to card-only when the set hint matches nothing', () => {
    const sol = cat.findCard('Sol Ring')!;
    const m = cat.findPrinting(sol.oracleId, { setCode: 'ZZZ' });
    expect(m.printing).toBeNull();
    expect(m.candidates.length).toBeGreaterThan(100);
  });
});
