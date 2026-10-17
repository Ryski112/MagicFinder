import { describe, expect, it } from 'vitest';
import { CardSearchIndex, type CardName } from './cardSearch';

const card = (cardName: string, alias = cardName, kind: CardName['kind'] = 'full', oracleId = cardName): CardName => ({ alias, kind, oracleId, cardName });

const index = new CardSearchIndex([
  card('Lightning Bolt'),
  card('Boltfire'),
  card('Lightning Axe'),
  card('Sol Ring'),
  card('Solemn Simulacrum'),
  card('Rhystic Study'),
  card('Counterspell'),
  card('Mana Drain'),
  card('Bonecrusher Giant // Stomp'),
  card('Bonecrusher Giant // Stomp', 'Bonecrusher Giant', 'face'),
  card('Command Tower'),
  card('Command Tower', 'Cybertron', 'flavor'),
  card('Thoughtcast'),
  card('Fire // Ice'),
]);
const names = (q: string, limit?: number) => index.search(q, limit).map(h => h.name);

describe('CardSearchIndex.search', () => {
  it('needs at least two letters', () => {
    expect(index.search('')).toEqual([]);
    expect(index.search('s')).toEqual([]);
  });

  it('ranks exact, then starts with, then every word starting a word, then contains', () => {
    expect(names('sol ring')[0]).toBe('Sol Ring');
    expect(names('sol').slice(0, 2)).toEqual(['Sol Ring', 'Solemn Simulacrum']);
    expect(names('bolt').slice(0, 2)).toEqual(['Boltfire', 'Lightning Bolt']);
    expect(names('bolt light')).toEqual(['Lightning Bolt']);
    expect(names('spell')).toEqual(['Counterspell']);
  });

  it('ignores case and punctuation', () => {
    expect(names('FIRE ICE')[0]).toBe('Fire // Ice');
    expect(names('fire//ice')[0]).toBe('Fire // Ice');
  });

  it('tolerates a typo, two in longer words, and a half-typed last word', () => {
    expect(names('rhystc study')).toEqual(['Rhystic Study']);
    expect(names('countrspel')).toEqual(['Counterspell']);
    expect(names('rystic stu')).toEqual(['Rhystic Study']);
    expect(names('xyzzy')).toEqual([]);
  });

  it('puts typo matches after real matches', () => {
    // "sol" is one letter off "bol(t)", so Lightning Bolt shows up, but only after the real matches.
    expect(index.search('sol').map(h => h.how)).toEqual(['starts with', 'starts with', 'typo', 'typo']);
    const hits = index.search('mana drin');
    expect(hits.map(h => h.name)).toEqual(['Mana Drain']);
    expect(hits[0].how).toBe('typo');
  });

  it('finds double-faced cards by their front face, once, under the full name', () => {
    const hits = index.search('bonecrusher');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ name: 'Bonecrusher Giant // Stomp', matchedAlias: null });
  });

  it('finds cards by flavour name and says which alias matched', () => {
    expect(index.search('cybertron')[0]).toMatchObject({ name: 'Command Tower', matchedAlias: 'Cybertron' });
    expect(index.search('command tower')[0]).toMatchObject({ name: 'Command Tower', matchedAlias: null });
  });

  it('returns at most `limit` cards', () => {
    expect(names('o', 3)).toEqual([]);
    expect(index.search('t', 3)).toEqual([]);
    expect(names('th', 1)).toHaveLength(1);
  });
});
