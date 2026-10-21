// Which Listings may fill a line. Decided in "Which Listings count as a match for a Want List line?".
import type { Catalogue } from '../catalogue/catalogue';
import type { Condition, Listing } from './types';
import type { BuyLine } from './wantList';

export const CONDITION_RANK: Record<Condition, number> = { NM: 0, LP: 1, MP: 2, HP: 3, DMG: 4 };

export interface EligibilitySettings {
  minCondition: Condition;
  allowFoils: boolean;
  /** Printings the buyer never wants (by Scryfall id); a line locked to one still gets it. */
  blockedPrintings?: Readonly<Record<string, unknown>>;
}

/** Why a Listing of the right card can't fill a line, so Not Found can say what was left out. */
export type Exclusion = 'non-english' | 'not-buyable' | 'unmatched' | 'sold-out' | 'condition' | 'other-printing' | 'foil' | 'non-tournament' | 'blocked-printing';

/** The reasons that come from the buyer's own settings, which they can waive for one card. */
export const WAIVABLE: ReadonlySet<Exclusion> = new Set<Exclusion>(['condition', 'foil', 'non-tournament', 'blocked-printing']);

function listingExclusion(l: Listing, s: EligibilitySettings, relaxed = false): Exclusion | null {
  if (!l.english) return 'non-english';
  if (!l.buyable) return 'not-buyable';
  if (l.confidence === 'unmatched') return 'unmatched';
  if (l.quantity <= 0) return 'sold-out';
  if (!relaxed && l.condition !== null && CONDITION_RANK[l.condition] > CONDITION_RANK[s.minCondition]) return 'condition';
  return null;
}

/** Filters that apply to every line, whether locked or not. */
export function passesListingFilters(l: Listing, s: EligibilitySettings): boolean {
  return listingExclusion(l, s) === null;
}

/** Why a Listing of this line's card can't fill it, or null if it can. */
export function exclusion(l: Listing, line: BuyLine, catalogue: Catalogue, s: EligibilitySettings): Exclusion | null {
  const general = listingExclusion(l, s, line.relaxed);
  if (general) return general;
  if (line.lock) return l.confidence === 'exact' && l.printingId === line.lock.printingId && l.finish === line.lock.finish ? null : 'other-printing';
  if (line.relaxed) return null;
  if (!s.allowFoils && l.finish !== 'nonfoil') return 'foil';
  if (l.printingId && s.blockedPrintings?.[l.printingId]) return 'blocked-printing';
  if (l.printingId && catalogue.getPrinting(l.printingId)?.nonTournament) return 'non-tournament';
  return null;
}

export function isEligible(l: Listing, line: BuyLine, catalogue: Catalogue, s: EligibilitySettings): boolean {
  return l.oracleId === line.oracleId && exclusion(l, line, catalogue, s) === null;
}
