// Shared domain types. Vocabulary follows CONTEXT.md.

export type Finish = 'nonfoil' | 'foil' | 'etched';

export type Section = 'main' | 'commander' | 'companion' | 'sideboard' | 'maybeboard';

/** One line of a pasted or imported Want List, before it is matched to a card. */
export interface ParsedLine {
  quantity: number;
  /** Name as written, with split / double-faced separators normalised to " // ". */
  name: string;
  /** Upper-case set code hint. */
  set?: string;
  /** Collector number hint; only kept when a set is present. */
  collectorNumber?: string;
  /** Finish hint; absent means "not stated". */
  finish?: 'foil' | 'etched';
  section: Section;
  /** The original line, for "Couldn't recognise" messages. */
  raw: string;
  /** Which line of the text it came from (0-based). */
  row: number;
}

export interface ParseResult {
  lines: ParsedLine[];
  /** Non-blank lines that were neither a card line nor a section header. */
  unparsed: string[];
}

export type Condition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';

export type MatchConfidence = 'exact' | 'card-only' | 'unmatched';

export type SourceId = 'fetch' | 'mtgsingles' | 'mtgsingles-au';

/** A specific Printing offered by one Store, found via a Source. */
export interface Listing {
  /** Unique within a run, e.g. "fetch:12345". */
  id: string;
  source: SourceId;
  /** Key into the Store table, e.g. "fetch:<sellerId>" or "mtgsingles:NZ/HobbyMaster". */
  storeKey: string;
  storeName: string;
  /** Scryfall oracle_id of the card; absent when unmatched. */
  oracleId?: string;
  /** Scryfall printing id; absent unless confidence is "exact". */
  printingId?: string;
  finish: Finish;
  confidence: MatchConfidence;
  /** null when the Source doesn't state a condition. */
  condition: Condition | null;
  /** Unit price in NZD. */
  price: number;
  quantity: number;
  url: string;
  title: string;
  /** The Store's picture of the card. */
  imageUrl?: string;
  english: boolean;
  /** False for Listings that can't be bought right now (seller on holiday). */
  buyable: boolean;
  /** Free-form extras a Source wants to keep (e.g. Shopify product handle). */
  extra?: Record<string, string>;
  /** City from the Source, when it reports one. */
  city?: string;
  pickupOffered?: boolean;
}
