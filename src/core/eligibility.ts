// Which Listings may fill a line. Decided in "Which Listings count as a match for a Want List line?".
import type { Catalogue } from '../catalogue/catalogue';
import type { Condition, Listing } from './types';
import type { BuyLine } from './wantList';

export const CONDITION_RANK: Record<Condition, number> = { NM: 0, LP: 1, MP: 2, HP: 3, DMG: 4 };

export interface EligibilitySettings {
  minCondition: Condition;
  allowFoils: boolean;
}

/** Filters that apply to every line, whether locked or not. */
export function passesListingFilters(l: Listing, s: EligibilitySettings): boolean {
  if (!l.english || !l.buyable || l.confidence === 'unmatched' || l.quantity <= 0) return false;
  if (l.condition !== null && CONDITION_RANK[l.condition] > CONDITION_RANK[s.minCondition]) return false;
  return true;
}

export function isEligible(l: Listing, line: BuyLine, catalogue: Catalogue, s: EligibilitySettings): boolean {
  if (l.oracleId !== line.oracleId || !passesListingFilters(l, s)) return false;
  if (line.lock) return l.confidence === 'exact' && l.printingId === line.lock.printingId && l.finish === line.lock.finish;
  if (!s.allowFoils && l.finish !== 'nonfoil') return false;
  if (l.printingId) {
    const p = catalogue.getPrinting(l.printingId);
    if (p?.nonTournament) return false;
  }
  return true;
}
