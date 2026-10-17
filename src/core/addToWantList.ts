// Adds a card to the Want List text, for the card searcher. Decided in "How should the Want List card searcher look
// and behave?": raise the quantity of a plain main-deck line already naming the same card and Printing; otherwise add
// a new line at the end of the main deck. A chosen Printing is written as a note ("(SET) num"), never a lock.
import { nameKey } from '../catalogue/names';
import { parseWantList } from './parseWantList';

export interface CardToAdd {
  name: string;
  set?: string;
  collectorNumber?: string;
}

/** Quantity, name and an optional "(SET) num", nothing else: the only kind of line the searcher bumps. */
const PLAIN = /^(\s*)(\d+)(x?\s+[^[\]^*()]+?(?:\s+\([A-Za-z0-9]+\)\s+\S+)?\s*)$/i;

export function addToWantList(text: string, card: CardToAdd, quantity: number): { text: string; message: string } {
  const rows = text.split('\n');
  const crlf = rows.length > 1 && rows.every((r, i) => i === rows.length - 1 || r.endsWith('\r'));
  const label = `${card.name}${card.set ? ` (${card.set}) ${card.collectorNumber ?? ''}`.trimEnd() : ''}`;
  const main = parseWantList(text).lines.filter(l => l.section === 'main');

  const same = main.find(l =>
    nameKey(l.name) === nameKey(card.name) &&
    (l.set ?? '').toUpperCase() === (card.set ?? '').toUpperCase() &&
    (l.collectorNumber ?? '').toLowerCase() === (card.collectorNumber ?? '').toLowerCase() &&
    PLAIN.test(rows[l.row].replace(/\r$/, '')),
  );
  if (same) {
    const was = same.quantity;
    rows[same.row] = rows[same.row].replace(/^(\s*)\d+/, `$1${was + quantity}`);
    return { text: rows.join('\n'), message: `${card.name}: now ${was + quantity} (was ${was})` };
  }

  const line = `${quantity} ${label}`;
  if (!text.trim()) return { text: line, message: `Added ${line}` };
  // After the last main-deck line; with no main deck yet, before everything (no header there means main).
  const at = main.length ? main[main.length - 1].row + 1 : 0;
  rows.splice(at, 0, crlf ? `${line}\r` : line);
  return { text: rows.join('\n'), message: `Added ${line}` };
}
