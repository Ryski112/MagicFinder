import { describe, expect, it } from 'vitest';
import { addToWantList } from './addToWantList';
import { parseWantList } from './parseWantList';

const sol = { name: 'Sol Ring' };

describe('addToWantList', () => {
  it('starts an empty list', () => {
    expect(addToWantList('', sol, 1)).toEqual({ text: '1 Sol Ring', message: 'Added 1 Sol Ring' });
    expect(addToWantList('  \n', sol, 2).text).toBe('2 Sol Ring');
  });

  it('raises the quantity of a plain line naming the same card, keeping its style', () => {
    expect(addToWantList('4 Lightning Bolt\n1x Sol Ring\n1 Island', sol, 2)).toEqual({
      text: '4 Lightning Bolt\n3x Sol Ring\n1 Island',
      message: 'Sol Ring: now 3 (was 1)',
    });
    expect(addToWantList('1 sol ring', sol, 1).text).toBe('2 sol ring');
  });

  it('only bumps a line with the same Printing', () => {
    const withPrinting = { name: 'Sol Ring', set: 'C21', collectorNumber: '263' };
    expect(addToWantList('1 Sol Ring (C21) 263', withPrinting, 1).text).toBe('2 Sol Ring (C21) 263');
    expect(addToWantList('1 Sol Ring (c21) 263', withPrinting, 1).text).toBe('2 Sol Ring (c21) 263');
    expect(addToWantList('1 Sol Ring', withPrinting, 1).text).toBe('1 Sol Ring\n1 Sol Ring (C21) 263');
    expect(addToWantList('1 Sol Ring (C21) 263', sol, 1).text).toBe('1 Sol Ring (C21) 263\n1 Sol Ring');
  });

  it("doesn't bump lines carrying a finish, categories or other notes", () => {
    expect(addToWantList('1 Sol Ring *F*', sol, 1).text).toBe('1 Sol Ring *F*\n1 Sol Ring');
    expect(addToWantList('1x Sol Ring [Ramp]', sol, 1).text).toBe('1x Sol Ring [Ramp]\n1 Sol Ring');
  });

  it('writes a chosen Printing as a note', () => {
    expect(addToWantList('', { name: 'Sol Ring', set: 'C21', collectorNumber: '263' }, 1).text).toBe('1 Sol Ring (C21) 263');
  });

  it('adds new lines at the end of the main deck, before other sections', () => {
    const text = 'Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Arcane Signet\n1 Command Tower\n\nSideboard\n1 Negate\n\nMaybeboard\n1 Sol Ring';
    const r = addToWantList(text, { name: 'Counterspell' }, 1);
    expect(r.text).toBe('Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Arcane Signet\n1 Command Tower\n1 Counterspell\n\nSideboard\n1 Negate\n\nMaybeboard\n1 Sol Ring');
    expect(parseWantList(r.text).lines.find(l => l.name === 'Counterspell')?.section).toBe('main');
  });

  it('adds to the main deck rather than bumping a sideboard or maybeboard copy', () => {
    const r = addToWantList('1 Arcane Signet\nMaybeboard\n1 Sol Ring', sol, 1);
    expect(r.text).toBe('1 Arcane Signet\n1 Sol Ring\nMaybeboard\n1 Sol Ring');
  });

  it('keeps headerless MTGO lists in the main deck, before the blank-line sideboard', () => {
    const r = addToWantList('4 Lightning Bolt\n4 Counterspell\n\n2 Negate', sol, 1);
    expect(r.text).toBe('4 Lightning Bolt\n4 Counterspell\n1 Sol Ring\n\n2 Negate');
  });

  it('puts the card before the first header when the list has no main deck yet', () => {
    const r = addToWantList('Commander\n1 Atraxa, Praetors\' Voice', sol, 1);
    expect(r.text).toBe('1 Sol Ring\nCommander\n1 Atraxa, Praetors\' Voice');
    expect(parseWantList(r.text).lines.map(l => l.section)).toEqual(['main', 'commander']);
  });

  it('keeps Windows line endings', () => {
    expect(addToWantList('1 Arcane Signet\r\n1 Island\r\n', sol, 1).text).toBe('1 Arcane Signet\r\n1 Island\r\n1 Sol Ring\r\n');
  });
});
