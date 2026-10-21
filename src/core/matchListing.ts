// Turns a Source's Listing into a Listing matched to the catalogue: card first, then Printing. Never guesses.
import type { Catalogue, CardRef } from '../catalogue/catalogue';
import type { SourceListing } from '../sources/types';
import type { Listing } from './types';

// Title noise to strip before looking a name up: bracketed groups, condition and finish words.
const BRACKETS = /\s*[([][^)\]]*[)\]]/g;
/** Things that turn up in name searches but aren't cards anyone buys as singles. */
export const NOT_A_CARD = /\b(art card|art series|double-sided token|token|art sleeves?|sleeves|theme card|checklist card|emblem|playmat|deck box)\b/i;
const TRAILING_WORDS = /\s+[-–]\s+(?:foil|non-?foil|etched|nm|lp|mp|hp|near mint|lightly played)\b.*$/i;

/** Candidate card names to try for a Listing title, best first. */
export function nameCandidates(title: string): string[] {
  // Some Stores add "| Foil (255)" after the name.
  const base = title.split(/\s+\|\s+/)[0].replace(BRACKETS, '').replace(TRAILING_WORDS, '').replace(/\s+/g, ' ').trim();
  const out = [base];
  // Secret Lair style "Wild Rose Rebellion - Counterspell": try each side of a dash.
  for (const part of base.split(/\s+[-–]\s+/)) if (part !== base) out.push(part.trim());
  // Front face of "Front // Back".
  if (base.includes('//')) out.push(base.split('//')[0].trim());
  // Arctic Collect: a rarity letter and collector number after the name ("Brainstorm C 96"), sometimes with the finish
  // and set name in between ("Sol Ring Foil Buy-A-Box Promos P 1"). Only for titles ending that way: drop the tail,
  // then try shorter and shorter leading words, longest first so the full name wins over a shorter one inside it.
  const tail = base.match(/^(.+?)\s+[CURMSLPT]\s+\d+[a-z★]?$/);
  if (tail) {
    const rest = tail[1].split(/\s+:\s+/)[0];
    const words = rest.split(' ');
    for (let n = words.length; n >= 1; n--) out.push(words.slice(0, n).join(' '));
  }
  return [...new Set(out.filter(Boolean))];
}

export function findCardForTitle(catalogue: Catalogue, title: string): CardRef | null {
  for (const n of nameCandidates(title)) {
    const c = catalogue.findCard(n);
    if (c) return c;
  }
  return null;
}

export function matchListing(catalogue: Catalogue, s: SourceListing): Listing {
  const base: Listing = {
    id: s.id,
    source: s.source,
    storeKey: s.storeKey,
    storeName: s.storeName,
    finish: s.finish,
    confidence: 'unmatched',
    condition: s.condition,
    price: s.price,
    quantity: s.quantity,
    url: s.url,
    title: s.title,
    imageUrl: s.imageUrl,
    english: s.english,
    buyable: s.buyable,
    extra: s.extra,
    city: s.city,
    pickupOffered: s.pickupOffered,
  };

  const card = findCardForTitle(catalogue, s.title);

  // 1. A structured id goes straight to the Printing, unless the title names a different card.
  if (s.scryfallId) {
    const p = catalogue.getPrinting(s.scryfallId);
    if (p && (!card || card.oracleId === p.oracleId)) {
      const finish = p.finishes.includes(s.finish) ? s.finish : p.finishes.length === 1 ? p.finishes[0] : s.finish;
      return { ...base, oracleId: p.oracleId, printingId: p.id, finish, confidence: 'exact' };
    }
  }

  // 2. Otherwise the card from the title, then the Printing from the hints.
  if (!card) return base;
  const m = catalogue.findPrinting(card.oracleId, {
    setCode: s.setCode,
    setName: s.setCode ? undefined : s.setName,
    collectorNumber: s.collectorNumber,
    finish: s.finish,
    treatments: s.treatments,
  });
  if (m.printing) return { ...base, oracleId: card.oracleId, printingId: m.printing.id, confidence: 'exact' };
  // A title that names no treatment ("Showcase", "Borderless", a collector number) is the plain printing: Stores label the
  // variants, and leave the ordinary one bare. Only when that leaves exactly one.
  if (m.candidates.length > 1 && !s.collectorNumber && !s.treatments.length && !/\(\s*(?:[A-Z0-9]{2,5}-)?\d{1,4}[a-z★]?\s*\)/.test(s.title)) {
    const plain = m.candidates.filter(p => !p.treatments.length && !p.nonTournament && p.finishes.includes(s.finish));
    if (plain.length === 1) return { ...base, oracleId: card.oracleId, printingId: plain[0].id, confidence: 'exact' };
  }
  return { ...base, oracleId: card.oracleId, confidence: 'card-only' };
}

/**
 * Printings the title couldn't settle, settled by the picture: Stores on the same platform use the same card image id
 * for the same Printing, so a Listing that shares it with a Listing that was identified exactly is that Printing too.
 * A picture seen on two different Printings is not trusted, and the Printing must still fit what the title said.
 */
export function matchByImage(catalogue: Catalogue, pairs: { source: SourceListing; listing: Listing }[]): void {
  const printingOf = new Map<string, string | null>();
  for (const { source, listing } of pairs) {
    if (!source.imageKey || listing.confidence !== 'exact' || !listing.printingId) continue;
    const seen = printingOf.get(source.imageKey);
    printingOf.set(source.imageKey, seen === undefined || seen === listing.printingId ? listing.printingId : null);
  }
  for (const { source, listing } of pairs) {
    if (listing.confidence !== 'card-only' || !source.imageKey || !listing.oracleId) continue;
    const id = printingOf.get(source.imageKey);
    const p = id ? catalogue.getPrinting(id) : null;
    if (!p || p.oracleId !== listing.oracleId) continue;
    const fits = catalogue.findPrinting(listing.oracleId, {
      setCode: source.setCode, setName: source.setCode ? undefined : source.setName, collectorNumber: source.collectorNumber, finish: source.finish,
    }).candidates.some(c => c.id === p.id);
    if (!fits) continue;
    listing.printingId = p.id;
    listing.confidence = 'exact';
    if (!p.finishes.includes(listing.finish) && p.finishes.length === 1) listing.finish = p.finishes[0];
  }
}
