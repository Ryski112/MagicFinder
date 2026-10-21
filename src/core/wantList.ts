// From parsed lines to the Want List the optimiser works on: cards identified, sections and basics handled,
// locks applied, duplicate lines merged. Decided in "Which Listings count as a match for a Want List line?".
import type { Catalogue } from '../catalogue/catalogue';
import type { Finish, ParsedLine, Section } from './types';
import { parseWantList } from './parseWantList';

/** A Printing pinned by the buyer: an exact Scryfall printing in one finish. */
export interface Lock {
  printingId: string;
  finish: Finish;
}

export const lockKey = (l: Lock) => `${l.printingId}:${l.finish}`;

/** The finish a Printing named without one means: non-foil when it comes that way, else its only finish. */
export const defaultFinish = (finishes: Finish[]): Finish => (finishes.includes('nonfoil') ? 'nonfoil' : finishes[0] ?? 'nonfoil');

/** A Want List line's id: card, section and the list's Printing, plus "#n" for repeats. Locks are keyed by it. */
export const wantLineId = (oracleId: string, section: Section, listPrinting: Lock | null, repeat = 0) => {
  const base = `${oracleId}:${section}:${listPrinting ? lockKey(listPrinting) : ''}`;
  return repeat ? `${base}#${repeat}` : base;
};

export function parseLockKey(k: string): Lock | null {
  const i = k.lastIndexOf(':');
  if (i <= 0) return null;
  const finish = k.slice(i + 1);
  if (finish !== 'nonfoil' && finish !== 'foil' && finish !== 'etched') return null;
  return { printingId: k.slice(0, i), finish };
}

/** A recognised line of the buyer's list, as shown on the Want List screen. */
export interface WantLine {
  /** Stable id for this line within the list (used for include/exclude and locks). */
  id: string;
  oracleId: string;
  name: string;
  quantity: number;
  section: Section;
  isBasic: boolean;
  /** What the imported list said about the Printing, e.g. "C21 #263 foil". */
  hint?: { text: string; lock: Lock | null };
  /** Included unless the buyer unticks it; maybeboard starts unticked. */
  includedByDefault: boolean;
}

export interface ResolvedWantList {
  lines: WantLine[];
  unrecognised: string[];
}

function hintText(p: ParsedLine): string | undefined {
  if (!p.set) return p.finish ? p.finish : undefined;
  return [p.set, p.collectorNumber ? `#${p.collectorNumber}` : '', p.finish ?? ''].filter(Boolean).join(' ');
}

export function resolveWantList(text: string, catalogue: Catalogue): ResolvedWantList {
  const parsed = parseWantList(text);
  const lines: WantLine[] = [];
  const unrecognised = [...parsed.unparsed];
  const seen = new Map<string, number>();
  for (const p of parsed.lines) {
    const card = catalogue.findCard(p.name) ?? (p.name.includes(' // ') ? catalogue.findCard(p.name.split(' // ')[0]) : null);
    if (!card) {
      unrecognised.push(p.raw);
      continue;
    }
    let hint: WantLine['hint'];
    const text = hintText(p);
    if (text) {
      const m = p.set ? catalogue.findPrinting(card.oracleId, { setCode: p.set, collectorNumber: p.collectorNumber, finish: p.finish }) : null;
      const printing = m?.printing ?? null;
      const finish: Finish = p.finish ?? defaultFinish(printing?.finishes ?? []);
      hint = { text, lock: printing && printing.finishes.includes(finish) ? { printingId: printing.id, finish } : null };
    }
    const base = wantLineId(card.oracleId, p.section, hint?.lock ?? null);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    lines.push({
      id: wantLineId(card.oracleId, p.section, hint?.lock ?? null, n),
      oracleId: card.oracleId,
      name: card.name,
      quantity: p.quantity,
      section: p.section,
      isBasic: card.isBasic,
      hint,
      includedByDefault: p.section !== 'maybeboard',
    });
  }
  return { lines, unrecognised };
}

/** Choices the buyer makes about the list. */
export interface ListChoices {
  /** Line ids the buyer has explicitly ticked (true) or unticked (false); otherwise includedByDefault applies. */
  included: Readonly<Record<string, boolean>>;
  /** Locks set by the buyer, by line id; null means explicitly unlocked. */
  locks: Readonly<Record<string, Lock | null>>;
  /** Line ids the buyer has told us not to exclude Listings for on condition, finish or Printing grounds. */
  relaxed?: Readonly<Record<string, boolean>>;
  /** Line ids a Short Plan must cover, choosing its Stores around them. */
  required?: Readonly<Record<string, boolean>>;
  /** Stores (by id) the buyer doesn't want a line's card from, by line id. */
  avoid?: Readonly<Record<string, readonly string[]>>;
  includeBasics: boolean;
  useListPrintings: boolean;
}

/** A line the optimiser fills: merged across duplicate Want List lines. */
export interface BuyLine {
  key: string;
  oracleId: string;
  name: string;
  quantity: number;
  lock: Lock | null;
  /** The buyer's condition, foil and Printing filters don't apply to this line. */
  relaxed?: boolean;
  /** A Short Plan must cover this line. */
  required?: boolean;
  /** Stores the buyer doesn't want this card from. */
  avoid?: string[];
  /** Want List line ids merged into this one. */
  lineIds: string[];
}

export function lockFor(line: WantLine, choices: ListChoices): Lock | null {
  if (line.id in choices.locks) return choices.locks[line.id];
  return choices.useListPrintings ? line.hint?.lock ?? null : null;
}

export function isIncluded(line: WantLine, choices: ListChoices): boolean {
  if (line.isBasic && !choices.includeBasics) return false;
  return choices.included[line.id] ?? line.includedByDefault;
}

/** Merges duplicate lines by card when neither is locked, or both are locked to the same Printing. */
export function buyLines(lines: WantLine[], choices: ListChoices): BuyLine[] {
  const out = new Map<string, BuyLine>();
  for (const l of lines) {
    if (!isIncluded(l, choices)) continue;
    const lock = lockFor(l, choices);
    const key = `${l.oracleId}|${lock ? lockKey(lock) : ''}`;
    const relaxed = !!choices.relaxed?.[l.id];
    const required = !!choices.required?.[l.id];
    const avoid = choices.avoid?.[l.id] ?? [];
    const cur = out.get(key);
    if (cur) {
      cur.quantity += l.quantity;
      cur.lineIds.push(l.id);
      cur.relaxed = cur.relaxed || relaxed;
      cur.required = cur.required || required;
      cur.avoid = [...new Set([...(cur.avoid ?? []), ...avoid])];
    } else out.set(key, { key, oracleId: l.oracleId, name: l.name, quantity: l.quantity, lock, relaxed, required, avoid: [...avoid], lineIds: [l.id] });
  }
  return [...out.values()];
}
