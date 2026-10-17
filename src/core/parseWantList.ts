import type { ParsedLine, ParseResult, Section } from './types';

// One forgiving grammar covering Archidekt text, Moxfield, Arena, MTGO and plain lists:
//   qty[x] name [(SET) [collector#]] [*F*|*E*] [[categories]] [^label^]
const LINE =
  /^(\d+)\s*x?\s+(.+?)(?:\s+\(([A-Za-z0-9]*)\)(?:\s+(\S+?))?)?(?:\s+\*([FE])\*)?(?:\s+\[([^\]]*)\])?(?:\s+\^[^^]*\^)?$/i;

const HEADERS: Record<string, Section | 'ignore'> = {
  commander: 'commander',
  commanders: 'commander',
  companion: 'companion',
  sideboard: 'sideboard',
  maybeboard: 'maybeboard',
  considering: 'maybeboard',
  deck: 'main',
  main: 'main',
  mainboard: 'main',
  about: 'ignore',
};

/** Normalise the separators used for split and double-faced cards to " // ". */
export function normaliseCardName(name: string): string {
  return name
    .replace(/\s*\/\/?\s*/g, ' // ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseWantList(text: string): ParseResult {
  const lines: ParsedLine[] = [];
  const unparsed: string[] = [];
  let section: Section = 'main';
  let sawHeader = false;
  let sawCard = false;
  let afterBlank = false;

  const rows = text.split(/\r?\n/);
  for (let row = 0; row < rows.length; row++) {
    const raw = rows[row].trim();
    if (!raw) {
      if (sawCard) afterBlank = true;
      continue;
    }
    if (raw.startsWith('//') || raw.startsWith('#')) continue;

    const m = raw.match(LINE);
    if (!m) {
      const header = raw.replace(/:$/, '').trim().toLowerCase();
      if (header in HEADERS) {
        const s = HEADERS[header];
        if (s !== 'ignore') {
          section = s;
          sawHeader = true;
        }
      } else if (/^name\s/i.test(raw)) {
        // Arena "Name <deck name>" line
      } else if (sawCard || !/^[A-Za-z][\w '&-]*:?$/.test(raw)) {
        unparsed.push(raw);
      } else {
        // An unknown header before any card (e.g. an Archidekt custom category): stay in main.
        section = 'main';
        sawHeader = true;
      }
      continue;
    }

    const [, qty, name, set, collector, finish, categories] = m;
    let lineSection = section;
    // MTGO convention: with no explicit headers, cards after the first blank line are the sideboard.
    if (!sawHeader && afterBlank) lineSection = 'sideboard';
    if (categories && /maybeboard|\{noDeck\}/i.test(categories)) lineSection = 'maybeboard';

    const line: ParsedLine = {
      quantity: Number(qty),
      name: normaliseCardName(name),
      section: lineSection,
      raw,
      row,
    };
    if (set) {
      line.set = set.toUpperCase();
      if (collector) line.collectorNumber = collector;
    }
    if (finish) line.finish = finish.toUpperCase() === 'E' ? 'etched' : 'foil';
    if (line.quantity > 0) {
      lines.push(line);
      sawCard = true;
    }
  }
  return { lines, unparsed };
}
