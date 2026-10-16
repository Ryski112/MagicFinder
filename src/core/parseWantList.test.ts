import { describe, expect, it } from 'vitest';
import { parseWantList } from './parseWantList';

describe('parseWantList', () => {
  it('reads plain lists', () => {
    const { lines } = parseWantList('4 Lightning Bolt\n1 Sol Ring\n4x  Counterspell');
    expect(lines.map(l => [l.quantity, l.name, l.section])).toEqual([
      [4, 'Lightning Bolt', 'main'],
      [1, 'Sol Ring', 'main'],
      [4, 'Counterspell', 'main'],
    ]);
  });

  it('reads Archidekt text exports with hints, categories and sections', () => {
    const text = `Commander
1x Baba Lysaga, Night Witch (clb) 525 *E* [Commander{top}]

Mainboard
1x Drag to the Roots (dsk) 213 *F* [Disruption]
1x Starscream, Power Hungry // Starscream, Seeker Leader (bot) 5 [Endgame Plans]
2x Snow-Covered Swamp (mh1) 252 [Land]

Maybeboard
1x Aspect of Mongoose (tsp) 191 [Maybeboard{noDeck}{noPrice},Potion Ingredients]`;
    const { lines, unparsed } = parseWantList(text);
    expect(unparsed).toEqual([]);
    expect(lines[0]).toMatchObject({ name: 'Baba Lysaga, Night Witch', set: 'CLB', collectorNumber: '525', finish: 'etched', section: 'commander' });
    expect(lines[1]).toMatchObject({ set: 'DSK', finish: 'foil', section: 'main' });
    expect(lines[2].name).toBe('Starscream, Power Hungry // Starscream, Seeker Leader');
    expect(lines[3]).toMatchObject({ quantity: 2, name: 'Snow-Covered Swamp' });
    expect(lines[4].section).toBe('maybeboard');
  });

  it('marks lines tagged Maybeboard as maybeboard even without a header', () => {
    const { lines } = parseWantList('1x Sol Ring [Ramp,Maybeboard{noDeck}]');
    expect(lines[0].section).toBe('maybeboard');
  });

  it('reads Moxfield exports with single-slash split cards, star collector numbers and SIDEBOARD:', () => {
    const text = `1 Arcane Signet (SLD) 1492★ *F*
2 Ajani, Nacatl Pariah / Ajani, Nacatl Avenger (MH3) 237

SIDEBOARD:
2 Wear / Tear (DMC) 174`;
    const { lines } = parseWantList(text);
    expect(lines[0]).toMatchObject({ set: 'SLD', collectorNumber: '1492★', finish: 'foil' });
    expect(lines[1].name).toBe('Ajani, Nacatl Pariah // Ajani, Nacatl Avenger');
    expect(lines[2]).toMatchObject({ name: 'Wear // Tear', section: 'sideboard' });
  });

  it('treats an empty Arena set "()" as no set and drops the collector number', () => {
    const { lines } = parseWantList('1 Deadly Tempest () 19');
    expect(lines[0]).toEqual({ quantity: 1, name: 'Deadly Tempest', section: 'main', raw: '1 Deadly Tempest () 19' });
  });

  it('reads Arena exports with About/Name/Deck headers', () => {
    const text = `About
Name  Warrior Queen [cEDH]

Commander
1 Najeela, the Blade-Blossom

Deck
1 Ad Nauseam
2 Mountain

Sideboard
2 Wear // Tear`;
    const { lines, unparsed } = parseWantList(text);
    expect(unparsed).toEqual([]);
    expect(lines.map(l => l.section)).toEqual(['commander', 'main', 'main', 'sideboard']);
  });

  it('treats cards after a blank line as sideboard in headerless MTGO lists', () => {
    const { lines } = parseWantList('2 Mountain\n4 Disciple of Freyalise\n\n2 Wear/Tear');
    expect(lines.map(l => l.section)).toEqual(['main', 'main', 'sideboard']);
    expect(lines[2].name).toBe('Wear // Tear');
  });

  it('reports lines it cannot read', () => {
    const { lines, unparsed } = parseWantList('1 Sol Ring\nsome random text here\n');
    expect(lines).toHaveLength(1);
    expect(unparsed).toEqual(['some random text here']);
  });
});
