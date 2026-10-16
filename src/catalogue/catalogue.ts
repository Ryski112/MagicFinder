// Local copy of Scryfall's default_cards, used to identify cards and Printings across Sources.
// Card key = oracle_id. Printing key = (Scryfall id, finish).
import { DatabaseSync } from 'node:sqlite';
import { existsSync, renameSync, rmSync } from 'node:fs';
import type { Finish } from '../core/types';
import { exactKey, nameKey } from './names';

export interface Printing {
  id: string;
  oracleId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  finishes: Finish[];
  /** Buyer-facing treatment labels, e.g. "Showcase", "Borderless". */
  treatments: string[];
  /** Why this Printing is excluded from unlocked lines (e.g. "gold-bordered"), or null. */
  nonTournament: string | null;
  isBasic: boolean;
  imageSmall: string | null;
  imageNormal: string | null;
  releasedAt: string;
}

export interface CardRef {
  oracleId: string;
  name: string;
  isBasic: boolean;
}

export interface PrintingHints {
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  finish?: Finish;
  treatments?: string[];
}

export interface PrintingMatch {
  /** Set when the hints narrow the card to exactly one Printing. */
  printing: Printing | null;
  candidates: Printing[];
}

// Layouts that aren't cards anyone puts on a Want List.
const SKIP_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series', 'planar', 'scheme', 'vanguard', 'front_card', 'augment', 'host']);

const PROMO_LABELS: Record<string, string> = {
  surgefoil: 'Surge foil', galaxyfoil: 'Galaxy foil', doublerainbow: 'Double rainbow foil', rainbowfoil: 'Rainbow foil',
  confettifoil: 'Confetti foil', halofoil: 'Halo foil', texturedfoil: 'Textured foil', stepandcompleat: 'Step-and-compleat foil',
  oilslick: 'Oil slick foil', neonink: 'Neon ink', serialized: 'Serialized', prerelease: 'Prerelease', datestamped: 'Date-stamped',
  buyabox: 'Buy-a-box', storechampionship: 'Store Championship', gilded: 'Gilded foil', fracturefoil: 'Fracture foil',
  manafoil: 'Mana foil', firstplacefoil: 'First place foil', ripplefoil: 'Ripple foil', raisedfoil: 'Raised foil',
};

function treatmentsOf(c: any): string[] {
  const t: string[] = [];
  const fx: string[] = c.frame_effects ?? [];
  if (fx.includes('showcase')) t.push('Showcase');
  if (fx.includes('extendedart')) t.push('Extended art');
  if (c.border_color === 'borderless') t.push('Borderless');
  if (c.full_art && !(c.type_line ?? '').includes('Basic')) t.push('Full art');
  if ((c.frame === '1993' || c.frame === '1997') && c.released_at >= '2003-07-01') t.push('Retro frame');
  for (const p of c.promo_types ?? []) if (PROMO_LABELS[p]) t.push(PROMO_LABELS[p]);
  return t;
}

function nonTournamentOf(c: any): string | null {
  if (c.border_color === 'gold') return 'gold-bordered';
  if (c.oversized) return 'oversized';
  if (c.set_type === 'memorabilia') return 'memorabilia';
  if (c.set_type === 'funny' || c.security_stamp === 'acorn') return 'acorn / Un-set';
  return null;
}

function imagesOf(c: any): { small: string | null; normal: string | null } {
  const uris = c.image_uris ?? c.card_faces?.[0]?.image_uris;
  if (!uris || c.image_status === 'missing' || c.image_status === 'placeholder') return { small: null, normal: null };
  return { small: uris.small ?? null, normal: uris.normal ?? null };
}

const SCHEMA = `
CREATE TABLE printings (
  id TEXT PRIMARY KEY, oracle_id TEXT NOT NULL, name TEXT NOT NULL, set_code TEXT NOT NULL, set_name TEXT NOT NULL,
  collector_number TEXT NOT NULL, finishes TEXT NOT NULL, treatments TEXT NOT NULL, non_tournament TEXT,
  is_basic INTEGER NOT NULL, image_small TEXT, image_normal TEXT, released_at TEXT NOT NULL
);
CREATE INDEX printings_oracle ON printings(oracle_id);
CREATE INDEX printings_set ON printings(set_code, collector_number);
CREATE TABLE names (key TEXT NOT NULL, exact TEXT NOT NULL, kind TEXT NOT NULL, oracle_id TEXT NOT NULL, card_name TEXT NOT NULL);
CREATE INDEX names_key ON names(key);
CREATE TABLE sets (key TEXT PRIMARY KEY, set_code TEXT NOT NULL);
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

/**
 * Builds a catalogue database from Scryfall card objects. Writes to a temporary file and swaps it in,
 * so a running app never sees a half-built catalogue.
 */
export async function buildCatalogue(dbPath: string, cards: AsyncIterable<any> | Iterable<any>, sourceUpdatedAt: string): Promise<number> {
  const tmp = `${dbPath}.building`;
  rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  db.exec(SCHEMA);
  const insP = db.prepare('INSERT OR IGNORE INTO printings VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const insN = db.prepare('INSERT INTO names VALUES (?,?,?,?,?)');
  const insS = db.prepare('INSERT OR IGNORE INTO sets VALUES (?,?)');
  const seenNames = new Set<string>();
  let count = 0;
  db.exec('BEGIN');
  for await (const c of cards) {
    if (c.lang !== 'en' || c.digital || !(c.games ?? []).includes('paper') || SKIP_LAYOUTS.has(c.layout)) continue;
    // Reversible cards keep their oracle_id and real name on each face.
    const reversible = !c.oracle_id && c.card_faces?.[0]?.oracle_id;
    const oracleId: string = reversible ? c.card_faces[0].oracle_id : c.oracle_id;
    const name: string = reversible ? c.card_faces[0].name : c.name;
    if (!oracleId) continue;
    const typeLine: string = c.type_line ?? c.card_faces?.[0]?.type_line ?? '';
    const isBasic = /\bBasic\b.*\bLand\b/.test(typeLine);
    const img = imagesOf(c);
    insP.run(c.id, oracleId, name, c.set, c.set_name, c.collector_number, (c.finishes ?? ['nonfoil']).join(','),
      treatmentsOf(c).join('|'), nonTournamentOf(c), isBasic ? 1 : 0, img.small, img.normal, c.released_at ?? '');
    insS.run(c.set, c.set);
    insS.run(nameKey(c.set_name), c.set);
    count++;

    const aliases: [string, string][] = [[name, 'full']];
    if (!reversible && c.card_faces?.length && name.includes(' // ')) aliases.push([c.card_faces[0].name, 'face']);
    if (c.flavor_name) aliases.push([c.flavor_name, 'flavor']);
    for (const [alias, kind] of aliases) {
      const seen = `${oracleId}|${kind}|${alias}`;
      if (seenNames.has(seen)) continue;
      seenNames.add(seen);
      insN.run(nameKey(alias), exactKey(alias), kind, oracleId, name);
    }
  }
  db.prepare('INSERT INTO meta VALUES (?,?)').run('source_updated_at', sourceUpdatedAt);
  db.prepare('INSERT INTO meta VALUES (?,?)').run('built_at', new Date().toISOString());
  db.exec('COMMIT');
  db.close();
  if (existsSync(dbPath)) rmSync(dbPath);
  renameSync(tmp, dbPath);
  return count;
}

interface NameRow { exact: string; kind: string; oracle_id: string; card_name: string }

export class Catalogue {
  private db: DatabaseSync;
  private printingCache = new Map<string, Printing[]>();

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath, { readOnly: true });
  }

  close() {
    this.db.close();
  }

  meta(key: string): string | null {
    const row = this.db.prepare('SELECT v FROM meta WHERE k = ?').get(key) as { v: string } | undefined;
    return row?.v ?? null;
  }

  /** Finds a card by name. Never guesses: returns null when the name is unknown or ambiguous. */
  findCard(name: string): CardRef | null {
    const rows = this.db.prepare('SELECT exact, kind, oracle_id, card_name FROM names WHERE key = ?').all(nameKey(name)) as unknown as NameRow[];
    const pick = (rs: NameRow[]) => {
      const ids = new Set(rs.map(r => r.oracle_id));
      return ids.size === 1 ? rs[0] : null;
    };
    let row = pick(rows);
    if (!row && rows.length) {
      // Colliding key (e.g. "Bind" vs "Bind // Liberate", "Lava Axe" vs "Lava, Axe"): require punctuation to match,
      // preferring full card names over face and flavour aliases.
      const exact = exactKey(name);
      const same = rows.filter(r => r.exact === exact);
      row = pick(same.filter(r => r.kind === 'full')) ?? pick(same);
    }
    if (!row) return null;
    return { oracleId: row.oracle_id, name: row.card_name, isBasic: this.printingsOf(row.oracle_id).some(p => p.isBasic) };
  }

  printingsOf(oracleId: string): Printing[] {
    let ps = this.printingCache.get(oracleId);
    if (!ps) {
      ps = (this.db.prepare('SELECT * FROM printings WHERE oracle_id = ? ORDER BY released_at DESC').all(oracleId) as any[]).map(toPrinting);
      this.printingCache.set(oracleId, ps);
    }
    return ps;
  }

  getPrinting(id: string): Printing | null {
    const row = this.db.prepare('SELECT * FROM printings WHERE id = ?').get(id);
    return row ? toPrinting(row) : null;
  }

  /** Resolves a set name or code to a set code, or null. */
  setCode(nameOrCode: string): string | null {
    const lower = nameOrCode.toLowerCase();
    const row = (this.db.prepare('SELECT set_code FROM sets WHERE key = ?').get(lower) ??
      this.db.prepare('SELECT set_code FROM sets WHERE key = ?').get(nameKey(nameOrCode))) as { set_code: string } | undefined;
    return row?.set_code ?? null;
  }

  /** Narrows a card to a Printing using hints. Never guesses: printing is null unless exactly one candidate is left. */
  findPrinting(oracleId: string, hints: PrintingHints): PrintingMatch {
    const all = this.printingsOf(oracleId);
    let c = all;
    const narrow = (keep: (p: Printing) => boolean) => {
      const next = c.filter(keep);
      if (next.length) c = next;
      return next.length > 0;
    };
    const code = hints.setCode ? hints.setCode.toLowerCase() : hints.setName ? this.setCode(hints.setName) : null;
    if ((hints.setCode || hints.setName) && !(code && narrow(p => p.setCode === code))) return { printing: null, candidates: all };
    if (hints.collectorNumber && !narrow(p => p.collectorNumber.toLowerCase() === hints.collectorNumber!.toLowerCase())) {
      return { printing: null, candidates: c };
    }
    for (const t of hints.treatments ?? []) narrow(p => p.treatments.includes(t));
    if (hints.finish) narrow(p => p.finishes.includes(hints.finish!));
    return { printing: c.length === 1 ? c[0] : null, candidates: c };
  }
}

function toPrinting(r: any): Printing {
  return {
    id: r.id,
    oracleId: r.oracle_id,
    name: r.name,
    setCode: r.set_code,
    setName: r.set_name,
    collectorNumber: r.collector_number,
    finishes: r.finishes.split(',') as Finish[],
    treatments: r.treatments ? r.treatments.split('|') : [],
    nonTournament: r.non_tournament,
    isBasic: !!r.is_basic,
    imageSmall: r.image_small,
    imageNormal: r.image_normal,
    releasedAt: r.released_at,
  };
}
